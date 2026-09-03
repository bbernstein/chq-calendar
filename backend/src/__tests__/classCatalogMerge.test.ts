import {
  categoriesFor, mergeCatalog, placeSession, statusForAbsent, venueOf, type CrawledClass,
} from '../services/classCatalogMerge';
import type { CatalogClass, CatalogFile } from '../types/catalog';

const CRAWL_DATE = '2026-08-20';

/** The season calendar as buildCatalog records it, so weeks have dates. */
const WEEKS: CatalogFile['weeks'] = {
  '1': ['2026-06-27', '2026-07-03'],
  '2': ['2026-07-04', '2026-07-10'],
  '3': ['2026-07-11', '2026-07-17'],
  '4': ['2026-07-18', '2026-07-24'],
  '5': ['2026-07-25', '2026-07-31'],
  '6': ['2026-08-01', '2026-08-07'],
  '7': ['2026-08-08', '2026-08-14'],
  '8': ['2026-08-15', '2026-08-21'],
  '9': ['2026-08-22', '2026-08-28'],
};

const catalogClass = (over: Partial<CatalogClass> = {}): CatalogClass => ({
  id: '1',
  eventAks: ['CHQ.EVN1'],
  title: 'Watercolour',
  instructor: 'A Painter',
  description: 'Paint, at length.',
  categories: ['Art'],
  ageRange: { min: 18, max: null },
  caregiver: false,
  fee: '$115',
  materials: { fee: '$20', student: false, instructor: true },
  location: 'Hultquist',
  room: '101',
  weeks: [8],
  daysOfWeek: ['Monday'],
  startTime: '9:00 AM',
  endTime: '10:00 AM',
  ...over,
});

const catalogFile = (classes: CatalogClass[]): CatalogFile => ({
  season: 2026,
  generatedAt: '2026-08-20T00:00:00.000Z',
  source: { catalog: 'derived via offline processing of SpecialStudies.csv', crawledAt: '2026-08-20T00:00:00.000Z' },
  weeks: WEEKS,
  classes,
  listedOnly: [],
  needsReview: [],
});

const session = (week: number, start: string, end: string) => ({
  performanceId: `PRF${week}`, week, dateRangeLabel: 'x',
  startDate: start, endDate: end, daysOfWeek: ['Monday'], timeRangeLabel: 'x',
  location: 'Hultquist 101', spotsRemaining: 5, availability: 'open' as const,
});

const crawled = (over: Partial<CrawledClass> = {}): CrawledClass => ({
  id: 'CHQ.EVN1',
  title: 'Watercolour',
  instructor: 'A Painter',
  description: 'Paint, as the site says.',
  weeksLabel: 'Week 8',
  daysLabel: 'M',
  location: 'Hultquist 101',
  ageRangeText: 'Ages 18+',
  ageRange: { min: 18, max: null },
  priceLabel: 'Session: $115.00',
  summary: 'Paint.',
  sessionCount: 1,
  sourceUrl: 'https://tickets.chq.org/class.html?eventAk=CHQ.EVN1',
  sessions: [session(8, '2026-08-17 09:00:00', '2026-08-21 10:00:00')],
  timezone: 'America/New_York',
  ...over,
});

describe('statusForAbsent — the temporal rule', () => {
  const ends = new Map([[1, '2026-06-30'], [8, '2026-08-21'], [9, '2026-08-28']]);

  it('calls a class cancelled when it was scheduled after the crawl', () => {
    expect(statusForAbsent([9], ends, CRAWL_DATE)).toBe('cancelled');
  });

  it('refuses to conclude anything about a class that had already finished', () => {
    expect(statusForAbsent([1], ends, CRAWL_DATE)).toBe('unobserved');
  });

  it('judges on the last week, not the first', () => {
    expect(statusForAbsent([1, 9], ends, CRAWL_DATE)).toBe('cancelled');
  });

  it('will not guess when the week has no date', () => {
    expect(statusForAbsent([9], new Map(), CRAWL_DATE)).toBe('unobserved');
  });

  it('treats a week ending on the crawl date as already over', () => {
    expect(statusForAbsent([8], new Map([[8, CRAWL_DATE]]), CRAWL_DATE)).toBe('unobserved');
  });

  it('says nothing about a class the catalog never scheduled', () => {
    expect(statusForAbsent([], ends, CRAWL_DATE)).toBe('unobserved');
  });
});

describe('placeSession — a session whose week label could not be read', () => {
  // parseClassDetail writes week 0 when "Week N" is illegible. That is not a
  // season week, but it behaves like one everywhere downstream: two of them
  // on a class collapse to one card row, they share a favourite key, and a
  // "0" appears in the week picker.
  const unlabelled = { ...session(0, '2026-08-25 09:00:00', '2026-08-25 10:00:00'), week: 0 };

  it('places it by its own dates', () => {
    expect(placeSession(unlabelled, WEEKS)!.week).toBe(9);
  });

  it('leaves a session that already knows its week alone', () => {
    const known = session(3, '2026-07-13 09:00:00', '2026-07-17 10:00:00');
    expect(placeSession(known, WEEKS)).toBe(known);
  });

  it('gives up when the dates fall in no season week', () => {
    const stray = { ...unlabelled, startDate: '2026-12-25 09:00:00' };
    expect(placeSession(stray, WEEKS)).toBeNull();
  });

  it('gives up when there are no dates either', () => {
    expect(placeSession({ ...unlabelled, startDate: '' }, WEEKS)).toBeNull();
  });

  it('drops the unplaceable rather than publishing a week 0', () => {
    const { classes } = mergeCatalog({
      catalog: catalogFile([catalogClass({ eventAks: [] })]),
      listed: [crawled({
        id: 'CHQ.EVN9', title: 'Unreadable', instructor: 'Nobody',
        sessions: [unlabelled, { ...unlabelled, performanceId: 'PRF2', startDate: '' }],
      })],
      crawlDate: CRAWL_DATE,
    });
    const c = classes.find((x) => x.id === 'CHQ.EVN9')!;
    // One placed into week 9, one dropped — and no 0 anywhere.
    expect(c.sessions.map((sn) => sn.week)).toEqual([9]);
    expect(c.weeks).toEqual([9]);
  });
});

describe('venueOf', () => {
  it('reduces the site\'s room string to a building the catalog names', () => {
    expect(venueOf('Hultquist Center 201B', ['Hultquist Center'])).toBe('Hultquist Center');
  });

  it('prefers the longer venue when one name prefixes another', () => {
    const known = ["Children's School", "Children's School Jessica Trapasso Pavilion"];
    expect(venueOf("Children's School Jessica Trapasso Pavilion", known))
      .toBe("Children's School Jessica Trapasso Pavilion");
  });

  it('keeps a string it cannot reduce rather than dropping the place', () => {
    expect(venueOf('Somewhere Unlisted', ['Hultquist Center'])).toBe('Somewhere Unlisted');
  });
});

describe('categoriesFor', () => {
  it('names the Masters Series from the title when the catalog cannot', () => {
    expect(categoriesFor('Masters Series Masterclass: Someone', [])).toEqual(['Masters Series']);
  });

  it('adds it alongside the catalog categories, not instead of them', () => {
    expect(categoriesFor('Masters Series Culinary Masterclass', ['Culinary']))
      .toEqual(['Culinary', 'Masters Series']);
  });

  it('leaves an ordinary class alone', () => {
    expect(categoriesFor('Watercolour', ['Art'])).toEqual(['Art']);
  });
});

describe('mergeCatalog', () => {
  it('gives each source the fields it is authoritative for', () => {
    const { classes, summary } = mergeCatalog({
      catalog: catalogFile([catalogClass()]), listed: [crawled()], crawlDate: CRAWL_DATE,
    });

    expect(summary.matched).toBe(1);
    const [c] = classes;
    // Catalog: the descriptive fields the site never exposes.
    expect(c.categories).toEqual(['Art']);
    expect(c.room).toBe('101');
    expect(c.fee).toBe('$115');
    expect(c.materials).toEqual({ fee: '$20', student: false, instructor: true });
    // Crawl: what is happening, and what can be booked.
    expect(c.sessions).toHaveLength(1);
    expect(c.location).toBe('Hultquist 101');
    expect(c.provenance).toEqual({ catalog: true, lastObserved: CRAWL_DATE, status: 'listed' });
  });

  it('joins on the eventAks the build resolved, not on the title', () => {
    // The titles disagree entirely; the build already decided they are the
    // same class, and a run has no business second-guessing that.
    const { classes, summary } = mergeCatalog({
      catalog: catalogFile([catalogClass({ title: 'Watercolour, Renamed Since Printing' })]),
      listed: [crawled({ title: 'Something Else Entirely' })],
      crawlDate: CRAWL_DATE,
    });
    expect(summary.matched).toBe(1);
    expect(classes[0].catalogId).toBe('1');
    expect(classes[0].categories).toEqual(['Art']);
  });

  it('lets one catalog row back several of the site\'s per-day listings', () => {
    const { classes } = mergeCatalog({
      catalog: catalogFile([catalogClass({ eventAks: ['CHQ.EVN1', 'CHQ.EVN2'] })]),
      listed: [
        crawled({ id: 'CHQ.EVN1', title: 'Watercolour: Monday Session' }),
        crawled({ id: 'CHQ.EVN2', title: 'Watercolour: Tuesday Session' }),
      ],
      crawlDate: CRAWL_DATE,
    });
    expect(classes.map((c) => c.catalogId)).toEqual(['1', '1']);
    // One catalog row, two listings, and it is not then also reported absent.
    expect(classes.filter((c) => c.provenance.status !== 'listed')).toEqual([]);
  });

  it('prefers the catalog ages over the listing text they were parsed from', () => {
    const { classes } = mergeCatalog({
      catalog: catalogFile([catalogClass({ ageRange: { min: 6, max: 8 } })]),
      listed: [crawled({ ageRange: { min: 6, max: null } })],
      crawlDate: CRAWL_DATE,
    });
    expect(classes[0].ageRange).toEqual({ min: 6, max: 8 });
  });

  it('keeps the parsed ages when the catalog has none', () => {
    const { classes } = mergeCatalog({
      catalog: catalogFile([catalogClass({ ageRange: { min: null, max: null } })]),
      listed: [crawled({ ageRange: { min: 12, max: null } })],
      crawlDate: CRAWL_DATE,
    });
    expect(classes[0].ageRange).toEqual({ min: 12, max: null });
  });

  it('publishes a listing with no catalog row, and leaves its categories empty', () => {
    const { classes, summary } = mergeCatalog({
      catalog: catalogFile([]), listed: [crawled()], crawlDate: CRAWL_DATE,
    });
    expect(summary.listedOnly).toBe(1);
    expect(classes[0].catalogId).toBeNull();
    expect(classes[0].categories).toEqual([]);
    expect(classes[0].provenance.catalog).toBe(false);
  });

  it('publishes an unobserved class from the catalog alone, with no sessions', () => {
    const { classes, summary } = mergeCatalog({
      catalog: catalogFile([
        catalogClass(),
        catalogClass({ id: '2', eventAks: [], title: 'Long Over', weeks: [1] }),
      ]),
      listed: [crawled()],
      crawlDate: CRAWL_DATE,
    });

    expect(summary.unobserved).toBe(1);
    const gone = classes.find((c) => c.id === 'catalog:2')!;
    expect(gone.provenance.status).toBe('unobserved');
    expect(gone.catalogId).toBe('2');
    // Sessions are observed, never planned: inventing them from the intended
    // schedule would manufacture the evidence this design refuses to invent.
    expect(gone.sessions).toEqual([]);
    // No listing means no page, so callers must not build a link.
    expect(gone.sourceUrl).toBe('');
    expect(gone.description).toBe('Paint, at length.');
    expect(gone.categories).toEqual(['Art']);
  });

  it('calls a catalog class cancelled only when it was scheduled ahead', () => {
    const { classes, summary } = mergeCatalog({
      catalog: catalogFile([
        catalogClass(),
        catalogClass({ id: '3', eventAks: [], title: 'Pulled', weeks: [9] }),
      ]),
      listed: [crawled()],
      crawlDate: CRAWL_DATE,
    });
    expect(summary.cancelled).toBe(1);
    expect(classes.find((c) => c.id === 'catalog:3')!.provenance.status).toBe('cancelled');
  });

  it('dates a printed week from the season calendar the build recorded', () => {
    const { classes } = mergeCatalog({
      catalog: catalogFile([catalogClass({ weeks: [8, 9] })]),
      listed: [crawled()],
      crawlDate: CRAWL_DATE,
    });
    expect(classes[0].scheduledWeeks.map((w) => [w.week, w.weekStart, w.weekEnd])).toEqual([
      [8, '2026-08-15', '2026-08-21'],
      [9, '2026-08-22', '2026-08-28'],
    ]);
  });

  it('keeps the weeks the site has forgotten, so history stays filterable', () => {
    const { classes } = mergeCatalog({
      catalog: catalogFile([catalogClass({ weeks: [3, 9] })]),
      listed: [crawled({ sessions: [session(9, '2026-08-24 09:00:00', '2026-08-28 10:00:00')] })],
      crawlDate: CRAWL_DATE,
    });
    expect(classes[0].weeks).toEqual([3, 9]);
  });

  it('keeps the date a now-missing class was last seen listed', () => {
    const yesterday = mergeCatalog({
      catalog: catalogFile([catalogClass()]), listed: [crawled()], crawlDate: '2026-08-19',
    }).classes;
    expect(yesterday[0].provenance.lastObserved).toBe('2026-08-19');

    const { classes } = mergeCatalog({
      catalog: catalogFile([catalogClass({ eventAks: [], weeks: [9] })]),
      listed: [],
      previous: yesterday,
      crawlDate: CRAWL_DATE,
    });
    const gone = classes.find((c) => c.id === 'catalog:1')!;
    expect(gone.provenance.status).toBe('cancelled');
    expect(gone.provenance.lastObserved).toBe('2026-08-19');
  });

  it('publishes the crawl on its own for a season with no catalog', () => {
    // 2027 will come from somewhere other than a spreadsheet. Until it does,
    // the pipeline still runs; the classes simply carry no description.
    const { classes, summary } = mergeCatalog({
      catalog: undefined, listed: [crawled()], crawlDate: CRAWL_DATE,
    });
    expect(classes).toHaveLength(1);
    expect(classes[0].catalogId).toBeNull();
    expect(classes[0].categories).toEqual([]);
    expect(classes[0].weeks).toEqual([8]);
    expect(summary).toEqual({ matched: 0, listedOnly: 1, unobserved: 0, cancelled: 0 });
  });

  it('still names the Masters Series with no catalog at all', () => {
    const { classes } = mergeCatalog({
      catalog: undefined,
      listed: [crawled({ title: 'Masters Series Masterclass: Someone' })],
      crawlDate: CRAWL_DATE,
    });
    expect(classes[0].categories).toEqual(['Masters Series']);
  });
});
