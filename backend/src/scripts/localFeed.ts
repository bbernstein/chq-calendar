import type { EventsCalendarDataSyncService } from '../services/eventsCalendarDataSyncService';
import type { SyncResult } from '../types';

/**
 * The pieces of `syncDataWithLocalFile.ts` (`npm run sync:local`) that decide
 * whether the file it writes is one the frontend can read.
 *
 * They live here because that script runs `main()` at import, so nothing in
 * it can be tested — and `sync:local` had never once produced a usable file,
 * for four independent reasons (#286, PR #300): the wrong filename, a guard
 * that could not pass, a bare array where the frontend expects an envelope,
 * and an output directory outside the repository. Each was fixed in place and
 * none was pinned, so each could come back unnoticed. The first three are
 * below; the fourth is `LOCAL_DATA_DIR` in `./localDataDir`. All four are
 * guarded by `src/__tests__/localFeed.test.ts`.
 */

/**
 * The name of the feed file for one season — the name the frontend requests
 * (`all-events-${year}.json`, frontend/src/hooks/useEventData.ts).
 *
 * Not `all-events.json`. The cache holds that too, but it is the legacy
 * unversioned every-year blob, ~10MB, read by nothing. The script used to
 * write that name, which is how `npm run sync:local` produced a file the app
 * never asked for.
 */
export function localFeedFilename(year: number): string {
  return `all-events-${year}.json`;
}

/**
 * The cache key the feed for one season is stored and served under — the
 * same string as the filename without `.json`, because CloudFront serves the
 * S3 object at that key and the frontend requests it by that name.
 */
export function localFeedCacheKey(year: number): string {
  return `all-events-${year}`;
}

/**
 * Whether what `MultiLayerCacheService.get()` handed back is a feed worth
 * writing.
 *
 * `get()` returns the cached *payload*, not the stored `{ data, timestamp }`
 * wrapper — it ends in `return cached.data` — so a hit is already the bare
 * `Event[]`. The old guard read `allEvents.data`, which on an array is
 * `undefined`: it could never pass on a real hit, and it would only have
 * passed on the wrapper shape that `get()` never returns. So the script
 * logged "No events found in cache" over a confirmed `Cache HIT` and wrote
 * nothing.
 *
 * An empty array is rejected too. Writing zero events produces exactly the
 * empty calendar this tooling exists to prevent, so it is a failure to report,
 * not a file to save.
 */
export function isUsableCachedFeed(cached: unknown): cached is unknown[] {
  return Array.isArray(cached) && cached.length > 0;
}

/** The shape of `all-events-<year>.json` on the CDN, and so on disk. */
export interface LocalFeedPayload {
  data: unknown[];
  timestamp: number;
  cacheKey: string;
}

/**
 * Re-wrap the cache's bare event array in the envelope the frontend reads.
 *
 * The frontend parses `data.data || []` (useEventData.ts), which is also the
 * shape the S3 object and CloudFront serve. Writing the bare array would
 * produce a file that parses to zero events — the same empty calendar, one
 * layer down. `timestamp` and `cacheKey` match what the cache stores beside
 * `data`, so the local file is the same document the CDN would have served.
 */
export function buildLocalFeedPayload(
  events: unknown[],
  year: number,
  now: number = Date.now(),
): LocalFeedPayload {
  return {
    data: events,
    timestamp: now,
    cacheKey: localFeedCacheKey(year),
  };
}

/** The two service methods the script runs; narrowed so a test can pass a real service or a stand-in. */
export type LocalSyncService = Pick<
  EventsCalendarDataSyncService,
  'syncFullYearEvents' | 'performIncrementalSync'
>;

/**
 * Run the sync that `sync:local` asked for, such that the cache it reads
 * afterwards is the one this run refreshed.
 *
 * The full sync is `syncFullYearEvents(year)`, not `syncAllSeasonEvents(year)`,
 * and that choice is the whole point of this function. After syncing, the
 * script reads `all-events-<year>.json` back out of the cache. Of the
 * service's public full syncs, `syncFullYearEvents` is the only one that warms
 * the cache for the year it was *given*. `syncAllSeasonEvents(year)` syncs
 * year N into DynamoDB and then warms `getDefaultYear()` — the server's
 * current season — whatever N was. So `sync:local -- --year=2027 --force`
 * synced 2027, refreshed 2026's feed, read 2027's untouched one, and once that
 * had passed its TTL printed "No events found in cache" and wrote nothing:
 * the `--year` refusal's own advice could not work.
 *
 * Nothing is lost by the wider window. The feed is not built from what the
 * sync fetched; the warm rebuilds it from DynamoDB with every published event
 * whose `startDate` begins with `<year>-`. A full-year sync fetches a superset
 * of the season, and it is what production's daily and weekly syncs run
 * (`syncDistantFuture`, `syncHandler.ts`), so the local file is built the way
 * the published one is.
 *
 * It is used for every `--force`, not only a non-default `--year`. The
 * service's default year reads the machine's clock while this script's
 * reads Chautauqua's (`./seasonYear`), so "is this the default year" has no
 * clock-independent answer — around October 1 the two disagree for hours.
 * Warming the year passed in needs no such comparison.
 *
 * The incremental sync takes no year (it syncs a now-relative window and
 * warms the server's default), which is why the script refuses an explicit
 * `--year` without `--force` before it gets here.
 *
 * Note what moving `--force` onto the full-year sync changes, compared with
 * the `syncAllSeasonEvents` it replaced: it records a `full` row in the
 * sync-status table, it warms when there are fewer than 5 errors rather than
 * only on zero, and it always rewarms the year's feed. All three are what
 * production's own syncs already do.
 */
export async function runLocalSync(
  syncService: LocalSyncService,
  options: { force: boolean; year: number },
): Promise<SyncResult> {
  if (options.force) {
    return syncService.syncFullYearEvents(options.year);
  }
  return syncService.performIncrementalSync();
}

/**
 * Whether an `all-events-<year>.json` object read straight from S3 (the
 * `--fetch-s3-direct` fallback) is a feed worth writing.
 *
 * The same rule as `isUsableCachedFeed`, applied one layer out. The S3 object
 * is the stored `{ data: [...], timestamp, cacheKey }` envelope, not the bare
 * array the cache service hands back, so it is the envelope's `data` that has
 * to be non-empty. The fallback used to write whatever it parsed, so an object
 * holding `{ data: [] }` — a warm that ran over an empty table, say — became
 * an empty feed on disk and a run that reported success. That is the empty
 * calendar again, reached through the path people use when the first one
 * failed.
 */
export function isUsableFeedPayload(payload: unknown): payload is { data: unknown[] } {
  return typeof payload === 'object'
    && payload !== null
    && isUsableCachedFeed((payload as { data?: unknown }).data);
}

/**
 * The shape of `years.json`, on the CDN and on disk — every field the
 * frontend's `YearsManifest` (frontend/src/hooks/useAvailableYears.ts)
 * declares.
 */
export interface YearsManifest {
  years: number[];
  defaultYear: number;
  generated: string;
}

/**
 * `years.json` as fetched from the CDN, or `null` if it is not that shape.
 *
 * Checked rather than asserted: whatever passes here is merged into the file
 * the frontend follows, so a manifest with no usable `defaultYear` has to be
 * treated as no manifest at all, not written through.
 */
export function parseYearsManifest(raw: unknown): YearsManifest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Partial<Record<keyof YearsManifest, unknown>>;
  if (!Array.isArray(m.years) || !m.years.every((y) => Number.isInteger(y))) return null;
  if (!Number.isInteger(m.defaultYear)) return null;
  if (typeof m.generated !== 'string') return null;
  return { years: m.years as number[], defaultYear: m.defaultYear as number, generated: m.generated };
}

/**
 * The seasons that have a feed in a directory listing of `frontend/public/data/`.
 *
 * Exactly the `localFeedFilename` names. The unsuffixed legacy
 * `all-events.json` is not a season, and the `-links-` sidecars that sit
 * beside the feeds are not feeds.
 */
export function localFeedYears(filenames: readonly string[]): number[] {
  const years = new Set<number>();
  for (const name of filenames) {
    const match = /^all-events-(\d{4})\.json$/.exec(name);
    if (match) years.add(Number(match[1]));
  }
  return [...years].sort((a, b) => a - b);
}

/**
 * The `years.json` to write beside the feeds, given production's manifest
 * (`null` if it could not be fetched), the seasons already on disk and the
 * season this run just wrote.
 *
 * In local-data mode the app opens on this file's `defaultYear` and requests
 * that season's `all-events-<year>.json` from disk, so the one thing the file
 * must not do is name a default with no feed behind it — that is the #286
 * empty calendar again. Copying production's manifest verbatim did exactly
 * that around October 1: production's `defaultYear` flips on the server's
 * clock (#301), the script picks its season on Chautauqua's (`./seasonYear`),
 * and for a while the two name different years. The manifest named 2027, the
 * run wrote 2026, and the app asked for a file nobody had downloaded.
 *
 * So:
 *
 * - `years` is production's list plus every season on disk, the one just
 *   written included. Production's seasons stay so that the year switcher
 *   matches what a reader sees; the local ones are added because a season you
 *   synced with `--year=` and cannot reach is a sync that did nothing.
 * - `defaultYear` is production's when that season is on disk, because
 *   following production is what this file is for; otherwise it is the season
 *   just written, which is the one season certain to be there.
 * - `generated` is production's when there is one, so the file is still the
 *   document the CDN served whenever the two agree, and the time of this run
 *   otherwise.
 */
export function buildLocalYearsManifest(
  remote: YearsManifest | null,
  localYears: readonly number[],
  writtenYear: number,
  now: Date = new Date(),
): YearsManifest {
  const onDisk = new Set<number>([...localYears, writtenYear]);
  const years = [...new Set<number>([...(remote?.years ?? []), ...onDisk])].sort((a, b) => a - b);
  const defaultYear = remote && onDisk.has(remote.defaultYear) ? remote.defaultYear : writtenYear;
  return {
    years,
    defaultYear,
    generated: remote?.generated ?? now.toISOString(),
  };
}
