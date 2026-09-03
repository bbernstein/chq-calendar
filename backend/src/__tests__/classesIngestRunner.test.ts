import * as fs from 'fs';
import * as path from 'path';
import { runClassesIngest, type ClassesSink, type ClassesSource } from '../services/classesIngestRunner';
import type { CatalogClass, CatalogFile } from '../types/catalog';
import type { ChqClass, ClassSearchRow, ClassesFile } from '../types/classes';

const fix = (n: string) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const DAY_1 = fix('chq-class-detail.html');
const DAY_2 = fix('chq-class-detail-next-day.html');
const NOW = new Date('2026-08-20T15:00:00Z');

const row = (id: string): ClassSearchRow => ({
  id,
  title: 'If Chocolate Brings You Joy: Wednesday Session',
  weeksLabel: 'Weeks 8 to 9',
  daysLabel: 'W',
  location: 'Turner Community Center Conference Room',
  ageRangeText: 'Ages 12+',
  ageRange: { min: 12, max: null },
  instructor: 'Jill Sandler',
  priceLabel: 'Session: $55.00',
  summary: 'Chocolate.',
  sessionCount: 1,
  sourceUrl: `https://tickets.chq.org/class.html?eventAk=${id}`,
});

/** A source serving one page of HTML per class id. */
function source(
  rows: ClassSearchRow[],
  html: Record<string, string>,
  fail: string[] = [],
): ClassesSource {
  return {
    fetchCatalog: async () => rows,
    forEachClassDetail: async (ids, onDetail) => {
      const failures: { id: string; error: string }[] = [];
      let fetched = 0;
      for (const id of ids) {
        if (fail.includes(id)) { failures.push({ id, error: 'boom' }); continue; }
        await onDetail(id, html[id] ?? DAY_1);
        fetched++;
      }
      return { fetched, failures };
    },
  };
}

/** A compiled catalog class, joined to a listing by eventAk rather than title. */
const catalogEntry = (over: Partial<CatalogClass> = {}): CatalogClass => ({
  id: '1',
  eventAks: ['CHQ.EVN1687'],
  title: 'If Chocolate Brings You Joy: Wednesday Session',
  instructor: 'Jill Sandler',
  description: 'Chocolate, at length.',
  categories: ['Culinary'],
  ageRange: { min: 12, max: null },
  caregiver: false,
  fee: '$55',
  materials: { fee: '', student: false, instructor: true },
  location: 'Turner Community Center',
  room: 'Conference Room',
  weeks: [8, 9],
  daysOfWeek: ['Wednesday'],
  startTime: '4:30 PM',
  endTime: '5:45 PM',
  ...over,
});

const catalogFile = (classes: CatalogClass[]): CatalogFile => ({
  season: 2026,
  generatedAt: '2026-08-20T00:00:00.000Z',
  source: { catalog: 'derived via offline processing of SpecialStudies.csv', crawledAt: '2026-08-20T00:00:00.000Z' },
  weeks: {
    '1': ['2026-06-27', '2026-07-03'], '2': ['2026-07-04', '2026-07-10'],
    '3': ['2026-07-11', '2026-07-17'], '4': ['2026-07-18', '2026-07-24'],
    '5': ['2026-07-25', '2026-07-31'], '6': ['2026-08-01', '2026-08-07'],
    '7': ['2026-08-08', '2026-08-14'], '8': ['2026-08-15', '2026-08-21'],
    '9': ['2026-08-22', '2026-08-28'],
  },
  classes,
  listedOnly: [],
  needsReview: [],
});

/** The catalog-supplied fields on a class the catalog does not cover. */
const UNCATALOGUED = {
  catalogId: null, categories: [], materials: null, fee: null, room: null,
  provenance: { catalog: false, lastObserved: '2026-08-20', status: 'listed' as const },
};

/**
 * A sink that behaves like S3: it hands out a version on read and refuses a
 * write whose expected version is not the current one.
 */
function sink(initial?: ClassesFile) {
  const published: ClassesFile[] = [];
  const expectations: (string | undefined)[] = [];
  let current = initial;
  let version = initial ? 'v1' : undefined;

  let pending: ClassesFile | undefined;

  const api: ClassesSink = {
    loadCatalog: async () => {
      const snapshot = current ? { file: current, version } : undefined;
      // An armed clobber lands after this read and before the write — which
      // is the only window the race actually occupies.
      if (pending) {
        current = pending;
        version = 'other';
        pending = undefined;
      }
      return snapshot;
    },
    publishCatalog: async (_year, file, expected) => {
      expectations.push(expected);
      if (expected !== version) {
        throw new Error('[classes] catalog changed while this run was working');
      }
      current = file;
      version = `v${published.length + 2}`;
      published.push(file);
    },
  };
  return {
    api,
    published,
    expectations,
    /** Arm another run to publish between this one's read and its write. */
    clobber(file: ClassesFile) { pending = file; },
  };
}

describe('runClassesIngest — full crawl', () => {
  it('joins each listing row to its detail page and publishes', async () => {
    const s = sink();
    const summary = await runClassesIngest({
      client: source([row('CHQ.EVN1687')], { 'CHQ.EVN1687': DAY_1 }),
      sink: s.api, now: NOW, year: 2026, mode: 'full', catalog: catalogFile([]),
    });

    expect(summary).toMatchObject({ classes: 1, sessions: 2, detailsFetched: 1, published: true });
    const cls = s.published[0].classes[0];
    // Listing fields and detail fields both survive the join.
    expect(cls.ageRangeText).toBe('Ages 12+');
    expect(cls.sessions.map(x => x.spotsRemaining)).toEqual([13, 28]);
    expect(cls.timezone).toBe('America/New_York');
  });

  it('rewrites an unchanged catalog so the timestamp says when it was checked', async () => {
    const first = sink();
    await runClassesIngest({
      client: source([row('CHQ.EVN1687')], { 'CHQ.EVN1687': DAY_1 }),
      sink: first.api, now: NOW, year: 2026, mode: 'full', catalog: catalogFile([]),
    });

    const second = sink(first.published[0]);
    const summary = await runClassesIngest({
      client: source([row('CHQ.EVN1687')], { 'CHQ.EVN1687': DAY_1 }),
      sink: second.api, now: new Date('2026-08-21T15:00:00Z'), year: 2026, mode: 'full', catalog: catalogFile([]),
    });

    // The catalog did not move, and `changed` says so. It is still written,
    // because the page reports "spot counts updated N ago" from generatedAt —
    // and freezing that made a stamp about when the numbers last *moved* read
    // as one about when they were last *checked*.
    expect(summary.changed).toBe(false);
    expect(summary.published).toBe(true);
    expect(second.published).toHaveLength(1);
    expect(second.published[0].generatedAt).toBe('2026-08-21T15:00:00.000Z');
    // The sessions are identical; only `lastObserved` moved, with the date.
    // That field is excluded from the comparison on purpose — stamping it on
    // every listed class would make the catalog differ every single day by
    // construction, and `changed` could never be false.
    expect(second.published[0].classes.map(c => c.sessions))
      .toEqual(first.published[0].classes.map(c => c.sessions));
    expect(second.published[0].classes[0].provenance.lastObserved).toBe('2026-08-21');
    expect(first.published[0].classes[0].provenance.lastObserved).toBe('2026-08-20');
  });

  it('publishes when real enrollment moves', async () => {
    const first = sink();
    await runClassesIngest({
      client: source([row('CHQ.EVN1687')], { 'CHQ.EVN1687': DAY_1 }),
      sink: first.api, now: NOW, year: 2026, mode: 'full', catalog: catalogFile([]),
    });

    const second = sink(first.published[0]);
    const summary = await runClassesIngest({
      client: source([row('CHQ.EVN1687')], { 'CHQ.EVN1687': DAY_2 }),
      sink: second.api, now: NOW, year: 2026, mode: 'full', catalog: catalogFile([]),
    });

    expect(summary.published).toBe(true);
    // The real 24h diff: one session aged out, the other lost two spots.
    expect(second.published[0].classes[0].sessions).toHaveLength(1);
    expect(second.published[0].classes[0].sessions[0].spotsRemaining).toBe(26);
  });

  it('keeps the sessions it knew when a detail page cannot be read', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `CHQ.EVN${i}`);
    const first = sink();
    await runClassesIngest({
      client: source(ids.map(row), {}),  // every id serves the day-1 page
      sink: first.api, now: NOW, year: 2026, mode: 'full', catalog: catalogFile([]),
    });
    expect(first.published[0].classes).toHaveLength(10);

    // Next run: nine classes refresh to the day-2 page, one page fails.
    const second = sink(first.published[0]);
    const day2 = Object.fromEntries(ids.map(id => [id, DAY_2]));
    const summary = await runClassesIngest({
      client: source(ids.map(row), day2, ['CHQ.EVN3']),
      sink: second.api, now: NOW, year: 2026, mode: 'full', catalog: catalogFile([]),
    });

    expect(summary).toMatchObject({ detailsFetched: 9, detailFailures: 1, carriedForward: 1 });

    const byId = new Map(second.published[0].classes.map(c => [c.id, c]));
    // The nine that answered show the new number.
    expect(byId.get('CHQ.EVN0')!.sessions.map(x => x.spotsRemaining)).toEqual([26]);
    // The one that did not keeps what the last run saw. Publishing zero
    // sessions here would read as "this class is over", which is the one
    // thing a failed fetch must never be allowed to say.
    expect(byId.get('CHQ.EVN3')!.sessions.map(x => x.spotsRemaining)).toEqual([13, 28]);
  });

  it('refuses a crawl that lost a fifth of the catalog', async () => {
    const previous: ClassesFile = {
      generatedAt: '2026-08-19T00:00:00.000Z',
      year: 2026,
      classes: Array.from({ length: 100 }, (_, i) => ({
        ...row(`CHQ.EVN${i}`), description: '', sessions: [], timezone: 'America/New_York', ...UNCATALOGUED,
      })) as ChqClass[],
    };
    const s = sink(previous);

    await expect(runClassesIngest({
      client: source(Array.from({ length: 50 }, (_, i) => row(`CHQ.EVN${i}`)), {}),
      sink: s.api, now: NOW, year: 2026, mode: 'full', catalog: catalogFile([]),
    })).rejects.toThrow(/listing fell from 100 to 50/);
    expect(s.published).toHaveLength(0);
  });

  it('refuses when too many detail pages fail', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `CHQ.EVN${i}`);
    const s = sink();
    await expect(runClassesIngest({
      client: source(ids.map(row), {}, ids.slice(0, 5)),
      sink: s.api, now: NOW, year: 2026, mode: 'full', catalog: catalogFile([]),
    })).rejects.toThrow(/5 of 10 detail pages failed/);
    expect(s.published).toHaveLength(0);
  });
});

describe('runClassesIngest — the catalog join', () => {
  it('takes description fields from the catalog and keeps the crawl for sessions', async () => {
    const s = sink();
    const summary = await runClassesIngest({
      client: source([row('CHQ.EVN1687')], { 'CHQ.EVN1687': DAY_1 }),
      sink: s.api, now: NOW, year: 2026, mode: 'full', catalog: catalogFile([catalogEntry()]),
    });

    const cls = s.published[0].classes[0];
    expect(summary.matched).toBe(1);
    expect(cls.catalogId).toBe('1');
    expect(cls.categories).toEqual(['Culinary']);
    // Location and room, which the site runs together into one string.
    expect(cls.room).toBe('Conference Room');
    expect(cls.materials).toEqual({ fee: '', student: false, instructor: true });
    // Sessions stay the crawl's: the catalog cannot know a spot count.
    expect(cls.sessions.map(x => x.spotsRemaining)).toEqual([13, 28]);
    expect(cls.provenance).toEqual({ catalog: true, lastObserved: '2026-08-20', status: 'listed' });
  });

  it('publishes a listing the catalog never printed, with no categories', async () => {
    const s = sink();
    const summary = await runClassesIngest({
      client: source([row('CHQ.EVN9999')], { 'CHQ.EVN9999': DAY_1 }),
      sink: s.api, now: NOW, year: 2026, mode: 'full',
      catalog: catalogFile([catalogEntry({ eventAks: ['CHQ.EVN0000'], title: 'Something Else Entirely' })]),
    });

    const cls = s.published[0].classes.find(c => c.id === 'CHQ.EVN9999')!;
    expect(summary.listedOnly).toBe(1);
    expect(cls.catalogId).toBeNull();
    // An honest gap rather than a category guessed from the ticket site.
    expect(cls.categories).toEqual([]);
    expect(cls.provenance.catalog).toBe(false);
  });

  it('records a finished catalog class as unobserved, never cancelled', async () => {
    const s = sink();
    // The crawl's own sessions date week 9 to Aug 26, before which everything
    // has already run — so absence proves nothing.
    const summary = await runClassesIngest({
      client: source([row('CHQ.EVN1687')], { 'CHQ.EVN1687': DAY_1 }),
      sink: s.api, now: NOW, year: 2026, mode: 'full',
      catalog: catalogFile([
        catalogEntry(),
        catalogEntry({ id: '2', eventAks: [], title: 'Long Since Over', weeks: [1] }),
      ]),
    });

    const gone = s.published[0].classes.find(c => c.id === 'catalog:2')!;
    expect(summary.unobserved).toBe(1);
    expect(summary.cancelled).toBe(0);
    expect(gone.provenance.status).toBe('unobserved');
    // Catalog-only classes carry no sessions: sessions are observed, not planned.
    expect(gone.sessions).toEqual([]);
    // And no page to link to, so the UI must not build one.
    expect(gone.sourceUrl).toBe('');
  });

  it('calls a catalog class cancelled only when it was scheduled ahead of the crawl', async () => {
    const s = sink();
    const summary = await runClassesIngest({
      client: source([row('CHQ.EVN1687')], { 'CHQ.EVN1687': DAY_1 }),
      sink: s.api, now: NOW, year: 2026, mode: 'full',
      // Week 9 ends Aug 26, after the Aug 20 crawl — so absence is evidence.
      catalog: catalogFile([
        catalogEntry(),
        catalogEntry({ id: '3', eventAks: [], title: 'Pulled From The Schedule', weeks: [9] }),
      ]),
    });

    const gone = s.published[0].classes.find(c => c.id === 'catalog:3')!;
    expect(summary.cancelled).toBe(1);
    expect(gone.provenance.status).toBe('cancelled');
    expect(gone.provenance.lastObserved).toBeNull();
  });

  it('keeps catalog-only classes out of the shrink guard', async () => {
    // 10 listed + 40 catalog-only previously; a crawl returning 10 is steady,
    // not a collapse — counting the catalog-only 40 would read as an 80% drop.
    const previous: ClassesFile = {
      generatedAt: '2026-08-19T00:00:00.000Z',
      year: 2026,
      classes: [
        ...Array.from({ length: 10 }, (_, i) => ({
          ...row(`CHQ.EVN${i}`), description: '', sessions: [],
          timezone: 'America/New_York', ...UNCATALOGUED,
        })),
        ...Array.from({ length: 40 }, (_, i) => ({
          ...row(`catalog:${i}`), description: '', sessions: [],
          timezone: 'America/New_York', ...UNCATALOGUED,
          provenance: { catalog: true, lastObserved: null, status: 'unobserved' as const },
        })),
      ] as ChqClass[],
    };
    const s = sink(previous);

    const summary = await runClassesIngest({
      client: source(Array.from({ length: 10 }, (_, i) => row(`CHQ.EVN${i}`)), {}),
      sink: s.api, now: NOW, year: 2026, mode: 'full', catalog: catalogFile([]),
    });
    expect(summary.classes).toBe(10);
  });
});

describe('runClassesIngest — two schedules, one file', () => {
  /** A catalog on the bucket with one class running inside the spots horizon. */
  const onBucket = (): ClassesFile => ({
    generatedAt: '2026-08-19T00:00:00.000Z',
    year: 2026,
    classes: [{
      ...row('CHQ.EVN1687'), description: '', timezone: 'America/New_York', ...UNCATALOGUED,
      sessions: [{
        performanceId: 'CHQ.EVN1687.PRF2', week: 9, dateRangeLabel: 'Aug 26 - Aug 26',
        startDate: '2026-08-26 16:30:00', endDate: '2026-08-26 17:45:00',
        daysOfWeek: ['Wednesday'], timeRangeLabel: '4:30 pm - 5:45 pm',
        location: 'Turner Community Center Conference Room',
        spotsRemaining: 28, availability: 'open',
      }],
    }] as ChqClass[],
  });

  it('writes conditionally on the copy it read', async () => {
    const s = sink();
    await runClassesIngest({
      client: source([row('CHQ.EVN1687')], { 'CHQ.EVN1687': DAY_1 }),
      sink: s.api, now: NOW, year: 2026, mode: 'full', catalog: catalogFile([]),
    });
    // No catalog existed, so the write must assert that it still does not —
    // otherwise two runs creating a season's first file both think they won.
    expect(s.expectations).toEqual([undefined]);
  });

  it('passes back the version it was given', async () => {
    const s = sink(onBucket());
    await runClassesIngest({
      client: source([], { 'CHQ.EVN1687': DAY_2 }),
      sink: s.api, now: NOW, year: 2026, mode: 'spots', catalog: catalogFile([]),
    });
    expect(s.expectations).toEqual(['v1']);
  });

  it('fails rather than overwriting a run that published first', async () => {
    // The daily full crawl takes 258s; the hourly spots pass can begin inside
    // that window, read the pre-crawl copy, and finish first. Writing then
    // would silently discard the crawl's new and cancelled classes.
    const s = sink(onBucket());
    s.clobber({ ...onBucket(), generatedAt: '2026-08-20T09:04:18.000Z' });

    await expect(runClassesIngest({
      client: source([], { 'CHQ.EVN1687': DAY_2 }),
      sink: s.api, now: NOW, year: 2026, mode: 'spots', catalog: catalogFile([]),
    })).rejects.toThrow(/changed while this run was working/);
    expect(s.published).toHaveLength(0);
  });
});

describe('runClassesIngest — the off-season', () => {
  it('waits quietly when a season has not opened yet', async () => {
    // October to June the site lists nothing for the coming year. There is no
    // previous catalog either, so nothing has gone missing — nothing has
    // started. It must not alarm, and must not write an empty file.
    const s = sink();
    const summary = await runClassesIngest({
      client: source([], {}), sink: s.api, now: NOW, year: 2027, mode: 'full', catalog: catalogFile([]),
    });
    expect(summary.published).toBe(false);
    expect(s.published).toHaveLength(0);
  });

  it('still refuses to publish an empty catalog over a good one', async () => {
    // Same empty crawl, but this year already had classes — so something is
    // wrong with the site or the crawl, and the published file must stand.
    const previous: ClassesFile = {
      generatedAt: '2026-08-19T00:00:00.000Z',
      year: 2026,
      classes: Array.from({ length: 20 }, (_, i) => ({
        ...row(`CHQ.EVN${i}`), description: '', sessions: [],
        timezone: 'America/New_York', ...UNCATALOGUED,
      })) as ChqClass[],
    };
    const s = sink(previous);
    await expect(runClassesIngest({
      client: source([], {}), sink: s.api, now: NOW, year: 2026, mode: 'full', catalog: catalogFile([]),
    })).rejects.toThrow(/refusing to publish an empty catalog over a good one/);
    expect(s.published).toHaveLength(0);
  });
});

describe('runClassesIngest — spots refresh', () => {
  const published = (): ClassesFile => ({
    generatedAt: '2026-08-19T00:00:00.000Z',
    year: 2026,
    classes: [{
      ...row('CHQ.EVN1687'),
      description: '',
      timezone: 'America/New_York',
      ...UNCATALOGUED,
      // Week 9 session on Aug 26 — six days out from NOW.
      sessions: [{
        performanceId: 'CHQ.EVN1687.PRF2', week: 9, dateRangeLabel: 'Aug 26 - Aug 26',
        startDate: '2026-08-26 16:30:00', endDate: '2026-08-26 17:45:00',
        daysOfWeek: ['Wednesday'], timeRangeLabel: '4:30 pm - 5:45 pm',
        location: 'Turner Community Center Conference Room',
        spotsRemaining: 28, availability: 'open',
      }],
    }] as ChqClass[],
  });

  it('refreshes only the classes starting within the horizon', async () => {
    const s = sink(published());
    const summary = await runClassesIngest({
      client: source([], { 'CHQ.EVN1687': DAY_2 }),
      sink: s.api, now: NOW, year: 2026, mode: 'spots', catalog: catalogFile([]),
    });

    expect(summary.detailsFetched).toBe(1);
    expect(s.published[0].classes[0].sessions[0].spotsRemaining).toBe(26);
  });

  it('leaves a far-off catalog alone', async () => {
    const far = published();
    far.classes[0].sessions[0].startDate = '2026-09-30 16:30:00';
    const s = sink(far);

    const summary = await runClassesIngest({
      client: source([], {}), sink: s.api, now: NOW, year: 2026, mode: 'spots', catalog: catalogFile([]),
    });

    expect(summary.detailsFetched).toBe(0);
    // Nothing was worth re-reading, but the pass ran and confirmed as much.
    expect(summary.changed).toBe(false);
    expect(summary.published).toBe(true);
  });

  it('does nothing when there is no published catalog to refresh', async () => {
    // Off-season this fires every hour until a full crawl finds something.
    // A no-op, not a failure — throwing alarmed the schedule 24 times a day.
    const s = sink();
    const summary = await runClassesIngest({
      client: source([], {}), sink: s.api, now: NOW, year: 2026, mode: 'spots', catalog: catalogFile([]),
    });
    expect(summary.published).toBe(false);
    expect(s.published).toHaveLength(0);
  });
});

describe('the spots horizon', () => {
  const withSession = (start: string, end: string): ClassesFile => ({
    generatedAt: '2026-08-19T00:00:00.000Z',
    year: 2026,
    classes: [{
      ...row('CHQ.EVN1687'), description: '', timezone: 'America/New_York', ...UNCATALOGUED,
      sessions: [{
        performanceId: 'CHQ.EVN1687.PRF2', week: 8, dateRangeLabel: 'x',
        startDate: start, endDate: end, daysOfWeek: ['Monday'], timeRangeLabel: 'x',
        location: 'x', spotsRemaining: 28, availability: 'open',
      }],
    }] as ChqClass[],
  });

  it('refreshes a session already under way', async () => {
    // Began Monday, runs to Friday, and today is Thursday: the count on its
    // page is still live, so it must not be skipped for having started.
    const s = sink(withSession('2026-08-17 13:00:00', '2026-08-21 15:00:00'));
    const summary = await runClassesIngest({
      client: source([], { 'CHQ.EVN1687': DAY_2 }),
      sink: s.api, now: NOW, year: 2026, mode: 'spots', catalog: catalogFile([]),
    });
    expect(summary.detailsFetched).toBe(1);
  });

  it('leaves a session that has already finished', async () => {
    const s = sink(withSession('2026-08-10 13:00:00', '2026-08-14 15:00:00'));
    const summary = await runClassesIngest({
      client: source([], {}), sink: s.api, now: NOW, year: 2026, mode: 'spots', catalog: catalogFile([]),
    });
    expect(summary.detailsFetched).toBe(0);
  });
});
