import { parseClassDetail } from './classesScraper';
import { mergeCatalog, type CrawledClass } from './classCatalogMerge';
import type { CatalogFile } from '../types/catalog';
import type { ChqClass, ClassSearchRow, ClassesFile } from '../types/classes';

/** Structural deps, so the local script can substitute file-backed stand-ins. */
export interface ClassesSource {
  fetchCatalog(): Promise<ClassSearchRow[]>;
  forEachClassDetail(
    ids: string[],
    onDetail: (id: string, html: string) => void | Promise<void>,
    concurrency?: number,
  ): Promise<{ fetched: number; failures: { id: string; error: string }[] }>;
}

/**
 * A catalog as it was read, with the token needed to write back over it.
 *
 * `version` is opaque here — S3's ETag in production, and unused by the file
 * sink the local script uses. It travels through the run so the write can be
 * made conditional on nothing else having published in between.
 */
export interface LoadedCatalog {
  file: ClassesFile;
  version?: string;
}

export interface ClassesSink {
  /**
   * The previously published catalog. It doubles as this pipeline's state:
   * unlike the program matcher there is nothing private to keep — the
   * catalog is entirely public data — so a separate state object would only
   * be a second copy to keep in step.
   */
  loadCatalog(year: number): Promise<LoadedCatalog | undefined>;
  /**
   * `expected` is the version that was read, or undefined when there was no
   * catalog — in which case the write must fail if one has since appeared.
   */
  publishCatalog(year: number, file: ClassesFile, expected?: string): Promise<void>;
}

export type ClassesIngestMode = 'full' | 'spots';

export interface ClassesIngestDeps {
  client: ClassesSource;
  sink: ClassesSink;
  now: Date;
  year: number;
  mode: ClassesIngestMode;
  /**
   * The season's compiled catalog, bundled with the code — or undefined for a
   * season nobody has one for, where the crawl publishes on its own.
   *
   * It supplies every descriptive field the site does not expose, and it is
   * why the subject crawl is gone: categories come from here, so there is no
   * reason to spend 143 paginated requests learning the site's own taxonomy.
   */
  catalog: CatalogFile | undefined;
  /** How far ahead `spots` mode refreshes. */
  spotsHorizonDays?: number;
}

export interface ClassesIngestSummary {
  mode: ClassesIngestMode;
  classes: number;
  sessions: number;
  detailsFetched: number;
  detailFailures: number;
  carriedForward: number;
  /** The file was written. False only when there was nothing to write. */
  published: boolean;
  /**
   * Anything but the timestamp differed from the published copy.
   *
   * Separate from `published` because a run that confirms the numbers have
   * not moved is still worth recording — that is what makes the page's
   * "updated N ago" mean "checked N ago" rather than "last changed N ago".
   */
  changed: boolean;
  /** Listings joined to a catalog row. */
  matched: number;
  /** Listed with no catalog row: added after the catalog printed. */
  listedOnly: number;
  /** In the catalog, absent from the crawl, and already finished. Unknowable. */
  unobserved: number;
  /** In the catalog, scheduled ahead, and absent from the crawl. Gone. */
  cancelled: number;

}

const DEFAULT_SPOTS_HORIZON_DAYS = 10;

/**
 * How far the catalog may shrink before a run is treated as broken.
 *
 * The listing does not shrink as the season ends: a class stays listed with
 * zero sessions left once its last week passes, verified across two days in
 * late August. So a real drop means a truncated crawl, not the calendar
 * moving on, and the threshold can sit close to 1 without false alarms.
 */
const MIN_CATALOG_RATIO = 0.8;

/** Fraction of detail pages that may fail before the run is not worth publishing. */
const MAX_DETAIL_FAILURE_RATIO = 0.2;

/**
 * The season the ticket site is currently selling, turning over on October 1
 * in Institution time — the same rule the web app's `getDefaultYear` uses.
 *
 * This is not cosmetic. The site prints session dates with no year at all
 * ("Aug 19 - Aug 21"), so the year we stamp is the only thing that decides
 * which season those dates land in. Reading it in Institution time keeps a
 * run east of Eastern from rolling over a few hours early on September 30.
 */
export function institutionSeasonYear(now: Date): number {
  const [year, month] = institutionDateKey(now).split('-').map(Number);
  return month >= 10 ? year + 1 : year;
}

/**
 * A date in the Institution's timezone, as YYYY-MM-DD.
 *
 * Exported because the offline backfill has to reach the same answer. It used
 * `toISOString()` — UTC — so a crawl stamped at half past ten on an August
 * evening was dated the following day there and the current one here, and the
 * two disagreed about whether a class ending that day was `cancelled` or
 * `unobserved`.
 */
export function institutionDateKey(d: Date): string {
  // en-CA formats as YYYY-MM-DD, which sorts and compares as a string.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function addDays(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Sessions carry "2026-08-26 16:30:00"; the date half is the comparable part. */
const dateKey = (naiveLocal: string): string => naiveLocal.slice(0, 10);

/**
 * Classes with a session running in, or starting within, the horizon.
 *
 * Overlap rather than start date: a class that began on Monday and runs to
 * Friday still has a live spot count on Wednesday, and its page is exactly
 * the one showing a number someone might act on. Filtering on start alone
 * dropped roughly a third of the sessions that still had places.
 */
function nearTermClassIds(classes: ChqClass[], now: Date, horizonDays: number): string[] {
  const today = institutionDateKey(now);
  const limit = addDays(today, horizonDays);
  return classes
    .filter(c => c.sessions.some(s => dateKey(s.endDate) >= today && dateKey(s.startDate) <= limit))
    .map(c => c.id);
}

/**
 * Compares catalogs ignoring the fields that move on their own.
 *
 * `generatedAt` changes every run by definition. So does
 * `provenance.lastObserved`, which is stamped with the crawl date on every
 * listed class — and that one matters more than it looks: leaving it in would
 * make the catalog differ every single day by construction, so this function
 * could never return false and the whole no-op check would be dead code.
 *
 * The cost is that `lastObserved` is a lower bound rather than an exact date:
 * it records the last crawl that published, not the last that looked. For a
 * class still listed that is invisible, because the file's own `generatedAt`
 * says when the catalog was current. For one that has since vanished it can
 * understate by a few days, which is the right way round for a field whose
 * job is "this was still running as of at least...".
 */
function catalogChanged(before: ClassesFile | undefined, after: ClassesFile): boolean {
  if (!before) return true;
  const comparable = (classes: ChqClass[]): string => JSON.stringify(
    classes.map(({ provenance, ...rest }) => ({
      ...rest,
      provenance: { catalog: provenance.catalog, status: provenance.status },
    })),
  );
  return comparable(before.classes) !== comparable(after.classes);
}

/**
 * One ingest cycle.
 *
 * `full` rebuilds the catalog: crawl the listing, then read every class's
 * detail page. `spots` re-reads only the classes with a session starting
 * soon, and patches their availability into the published catalog — the
 * numbers people are actually deciding on, refreshed without paying for a
 * whole crawl.
 *
 * Both refuse to publish a result that looks broken rather than merely
 * changed. A previously published catalog is better than a truncated one.
 */
export async function runClassesIngest(deps: ClassesIngestDeps): Promise<ClassesIngestSummary> {
  const { sink, now, year, mode } = deps;
  const loaded = await sink.loadCatalog(year);
  const previous = loaded?.file;

  const classes = mode === 'full'
    ? await runFullCrawl(deps, previous)
    : await runSpotsRefresh(deps, previous);

  const file: ClassesFile = { generatedAt: now.toISOString(), year, classes: classes.classes };

  // `generatedAt` is a freshness stamp, and a stamp only tells the truth if
  // it is rewritten when the numbers are checked — not only when they move.
  // Skipping the write on an unchanged catalog froze it, so the page could
  // say "spot counts updated 3 days ago" about counts confirmed accurate an
  // hour earlier. Late in a week, and every day off-season, that is the
  // normal case rather than the edge one.
  //
  // So a successful pass publishes. The cost is a 1.4 MB PUT on runs where
  // nothing moved — around twenty-five a day, against a file the page already
  // revalidates every 300 seconds — and `changed` still says whether anything
  // actually did, which is what the log and the summary are for.
  //
  // An empty catalog is still never written: off-season both passes return
  // nothing, and a file saying "this season has no classes" is worse than no
  // file, because the page cannot fall back past it.
  const changed = catalogChanged(previous, file);
  const published = file.classes.length > 0;
  if (published) {
    // Conditional on the copy this run read. Two schedules share this
    // function and each rewrites the whole file, so an overlapping pass would
    // otherwise publish its stale copy over the other's finished work.
    await sink.publishCatalog(year, file, loaded?.version);
  }

  const summary: ClassesIngestSummary = {
    mode,
    classes: file.classes.length,
    sessions: file.classes.reduce((n, c) => n + c.sessions.length, 0),
    detailsFetched: classes.fetched,
    detailFailures: classes.failures,
    carriedForward: classes.carriedForward,
    published,
    changed,
    ...classes.merge,
  };
  console.log('[classes-ingest] summary:', JSON.stringify(summary));
  return summary;
}

interface Pass {
  classes: ChqClass[];
  fetched: number;
  failures: number;
  carriedForward: number;
  merge: MergeCounts;
}

type MergeCounts = Pick<
  ClassesIngestSummary,
  'matched' | 'listedOnly' | 'unobserved' | 'cancelled'
>;

/** A spots pass re-reads sessions only; the join is whatever the last full crawl decided. */
const CARRIED_MERGE: MergeCounts = {
  matched: 0, listedOnly: 0, unobserved: 0, cancelled: 0,
};

async function runFullCrawl(deps: ClassesIngestDeps, previous: ClassesFile | undefined): Promise<Pass> {
  const { client, year, now, catalog } = deps;
  const rows = await client.fetchCatalog();

  // Nothing listed at all. With a catalog already published for this year
  // that is an outage and the shrink guard below says so; with none, the
  // season has not opened and there is nothing to do but wait.
  if (rows.length === 0) {
    const priorListed = (previous?.classes ?? []).filter(c => c.provenance.status === 'listed').length;
    if (priorListed === 0) {
      console.log(`[classes-ingest] no classes listed for ${year} yet — nothing to publish`);
      return { classes: previous?.classes ?? [], fetched: 0, failures: 0, carriedForward: 0, merge: CARRIED_MERGE };
    }
    throw new Error(
      `[classes-ingest] the listing returned no classes, but ${priorListed} were published ` +
      'for this year — refusing to publish an empty catalog over a good one',
    );
  }

  if (previous && previous.classes.length > 0) {
    // Compare like with like: the published file also holds catalog-only
    // classes, which no crawl returns, so counting them here would make every
    // run look like a collapse.
    const priorListed = previous.classes.filter(c => c.provenance.status === 'listed').length;
    const ratio = priorListed > 0 ? rows.length / priorListed : 1;
    if (ratio < MIN_CATALOG_RATIO) {
      throw new Error(
        `[classes-ingest] listing fell from ${priorListed} to ${rows.length} classes ` +
        `(${Math.round(ratio * 100)}%) — refusing to publish a likely truncated crawl`,
      );
    }
  }

  const priorById = new Map((previous?.classes ?? []).map(c => [c.id, c]));

  const details = new Map<string, CrawledClass>();
  const { fetched, failures } = await client.forEachClassDetail(
    rows.map(r => r.id),
    (id, html) => {
      const row = rows.find(r => r.id === id)!;
      const detail = parseClassDetail(html, id, year);
      details.set(id, { ...row, ...detail, timezone: 'America/New_York' });
    },
  );

  if (rows.length > 0 && failures.length / rows.length > MAX_DETAIL_FAILURE_RATIO) {
    throw new Error(
      `[classes-ingest] ${failures.length} of ${rows.length} detail pages failed — refusing to publish`,
    );
  }

  // A class whose page could not be read keeps the sessions the last run
  // saw. Publishing it with none would read exactly like "this class is
  // over", which is the one thing a failed fetch must not be allowed to say.
  let carriedForward = 0;
  const crawled: CrawledClass[] = rows.map((row) => {
    const fresh = details.get(row.id);
    if (fresh) return fresh;
    const prior = priorById.get(row.id);
    if (prior) {
      carriedForward++;
      return { ...prior, ...row, sessions: prior.sessions };
    }
    // Never seen before and unreadable now: list it with what the row
    // gives us, and let the next run fill in the sessions.
    carriedForward++;
    return { ...row, description: '', sessions: [], timezone: 'America/New_York' as const };
  });

  const { classes, summary } = mergeCatalog({
    catalog,
    listed: crawled,
    previous: previous?.classes,
    crawlDate: institutionDateKey(now),
  });

  console.log(
    `[classes-ingest] joined ${summary.matched}/${crawled.length} listings to the catalog; ` +
    `${summary.listedOnly} listed-only, ${summary.unobserved} unobserved, ` +
    `${summary.cancelled} cancelled`,
  );

  return { classes, fetched, failures: failures.length, carriedForward, merge: summary };
}

async function runSpotsRefresh(deps: ClassesIngestDeps, previous: ClassesFile | undefined): Promise<Pass> {
  const { client, year, now, spotsHorizonDays = DEFAULT_SPOTS_HORIZON_DAYS } = deps;
  if (!previous) {
    // Off-season this is every hour of every day until the next full crawl
    // finds something. It is a no-op, not a failure.
    console.log(`[classes-ingest] no published catalog for ${year} to refresh spots in`);
    return { classes: [], fetched: 0, failures: 0, carriedForward: 0, merge: CARRIED_MERGE };
  }

  // Only listed classes have a page to re-read. Catalog-only records carry no
  // sessions by design, so they are never in scope here and pass through
  // untouched — including their status, which only a full crawl can revise.
  const listedNow = previous.classes.filter(c => c.provenance.status === 'listed');
  const ids = nearTermClassIds(listedNow, now, spotsHorizonDays);
  if (ids.length === 0) {
    console.log('[classes-ingest] no sessions start within the horizon; nothing to refresh');
    return {
      classes: previous.classes, fetched: 0, failures: 0,
      carriedForward: 0, merge: CARRIED_MERGE,
    };
  }

  const refreshed = new Map<string, ChqClass>();
  const { fetched, failures } = await client.forEachClassDetail(ids, (id, html) => {
    const prior = previous.classes.find(c => c.id === id)!;
    const detail = parseClassDetail(html, id, year);
    // The detail page carries sessions and description; everything the
    // catalog contributed stays as the last full crawl left it.
    refreshed.set(id, {
      ...prior,
      ...detail,
      provenance: { ...prior.provenance, lastObserved: institutionDateKey(now) },
    });
  });

  // Unlike a full crawl this touches a handful of classes, so a failure just
  // leaves that class as it was until the next pass.
  const classes = previous.classes.map(c => refreshed.get(c.id) ?? c);
  return {
    classes, fetched, failures: failures.length,
    carriedForward: failures.length, merge: CARRIED_MERGE,
  };
}
