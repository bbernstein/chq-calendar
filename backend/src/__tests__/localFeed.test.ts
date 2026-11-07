import * as fs from 'fs';
import * as path from 'path';
import { jest } from '@jest/globals';
import { GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { LOCAL_DATA_DIR } from '../scripts/localDataDir';
import {
  buildLocalFeedPayload,
  buildLocalYearsManifest,
  isUsableCachedFeed,
  isUsableFeedPayload,
  localFeedCacheKey,
  localFeedFilename,
  localFeedYears,
  parseYearsManifest,
  runLocalSync,
  type YearsManifest,
} from '../scripts/localFeed';
import { EventsCalendarDataSyncService } from '../services/eventsCalendarDataSyncService';
import { EventTransformationService } from '../services/eventTransformationService';

jest.mock('../services/eventTransformationService');

/**
 * `npm run sync:local` had never once produced a file the frontend could
 * read, for four independent reasons (#286, PR #300). Each is pinned below,
 * and each test here has been watched going red with its bug put back.
 *
 * The script itself (`syncDataWithLocalFile.ts`) runs `main()` at import and
 * cannot be loaded by a test, which is why the parts that decide what it
 * writes live in `scripts/localFeed.ts` and `scripts/localDataDir.ts`.
 */
describe('sync:local output', () => {
  describe('LOCAL_DATA_DIR', () => {
    // Derived from this file's own location — backend/src/__tests__ is three
    // levels below the repository root — so the assertion holds in any
    // checkout, worktree or CI runner, and is not a copy of the expression
    // under test. The four `../../../../` write sites resolved to the repo's
    // *parent* and quietly built a `frontend/public/data/` tree beside the
    // checkout, which nothing serves and no `git status` shows.
    const repoRoot = path.resolve(__dirname, '../../..');

    it('is <repo>/frontend/public/data', () => {
      expect(LOCAL_DATA_DIR).toBe(path.resolve(repoRoot, 'frontend/public/data'));
    });

    it('is derived from a root that really is this repository', () => {
      // Without this, a wrong `repoRoot` above and a wrong LOCAL_DATA_DIR
      // could agree with each other. The frontend's package.json and the
      // tracked years.json both sit at fixed places in this repo.
      expect(fs.existsSync(path.join(repoRoot, 'frontend', 'package.json'))).toBe(true);
      expect(fs.existsSync(path.join(LOCAL_DATA_DIR, 'years.json'))).toBe(true);
    });
  });

  describe('localFeedFilename', () => {
    // The frontend requests `all-events-${year}.json` (useEventData.ts). The
    // unsuffixed `all-events.json` is the legacy every-year blob nothing reads.
    it.each([2025, 2026, 2027])('names %i\'s feed the way the frontend requests it', (year) => {
      expect(localFeedFilename(year)).toBe(`all-events-${year}.json`);
    });
  });

  describe('isUsableCachedFeed', () => {
    // `MultiLayerCacheService.get()` returns `cached.data` — the bare array.
    it('accepts the bare event array that a cache hit returns', () => {
      expect(isUsableCachedFeed([{ id: 1 }, { id: 2 }])).toBe(true);
    });

    it('rejects a miss', () => {
      expect(isUsableCachedFeed(null)).toBe(false);
      expect(isUsableCachedFeed(undefined)).toBe(false);
    });

    // Zero events written to disk is the empty calendar itself.
    it('rejects an empty feed', () => {
      expect(isUsableCachedFeed([])).toBe(false);
    });

    // The shape the old guard (`allEvents.data`) was written for. `get()`
    // never returns it, so accepting it — and rejecting the array — meant the
    // old script wrote nothing on every real `Cache HIT`.
    it('rejects the { data: [...] } wrapper that get() never returns', () => {
      expect(isUsableCachedFeed({ data: [{ id: 1 }] })).toBe(false);
    });
  });

  describe('isUsableFeedPayload', () => {
    // The `--fetch-s3-direct` fallback reads the stored object, which is the
    // `{ data: [...] }` envelope, and used to write it unchecked.
    it('accepts the S3 object\'s envelope with events in it', () => {
      expect(isUsableFeedPayload({ data: [{ id: 1 }], timestamp: 1, cacheKey: 'all-events-2026' })).toBe(true);
    });

    // The case the review named: an object of `{ data: [] }` became an empty
    // feed on disk and a run that exited 0.
    it('rejects an envelope with no events', () => {
      expect(isUsableFeedPayload({ data: [], timestamp: 1, cacheKey: 'all-events-2026' })).toBe(false);
    });

    it('rejects an envelope without a data array', () => {
      expect(isUsableFeedPayload({})).toBe(false);
      expect(isUsableFeedPayload({ data: null })).toBe(false);
      expect(isUsableFeedPayload({ data: { 0: { id: 1 } } })).toBe(false);
    });

    // An empty body parses to nothing at all; so does a missing one.
    it('rejects no object at all', () => {
      expect(isUsableFeedPayload(undefined)).toBe(false);
      expect(isUsableFeedPayload(null)).toBe(false);
      expect(isUsableFeedPayload('{"data":[1]}')).toBe(false);
    });

    // The bare array is the cache service's shape, not the S3 object's.
    // Written through as-is it parses to zero events in the frontend.
    it('rejects a bare event array', () => {
      expect(isUsableFeedPayload([{ id: 1 }])).toBe(false);
    });
  });

  describe('parseYearsManifest', () => {
    const good = { years: [2025, 2026, 2027], defaultYear: 2027, generated: '2026-11-07T06:00:18.100Z' };

    it('accepts the published manifest', () => {
      expect(parseYearsManifest(good)).toEqual(good);
    });

    // Whatever passes is merged into the file the frontend follows, so a
    // manifest without a usable default must count as no manifest.
    it.each([
      ['no years', { ...good, years: undefined }],
      ['non-integer years', { ...good, years: [2025, '2026'] }],
      ['no defaultYear', { ...good, defaultYear: undefined }],
      ['a string defaultYear', { ...good, defaultYear: '2027' }],
      ['no generated', { ...good, generated: undefined }],
      ['null', null],
      ['an array', [2026]],
    ])('rejects %s', (_label, raw) => {
      expect(parseYearsManifest(raw)).toBeNull();
    });
  });

  describe('localFeedYears', () => {
    // A real listing of frontend/public/data/: feeds, the legacy blob, the
    // link sidecars, years.json and a directory.
    it('finds the seasons with a feed, and nothing else', () => {
      expect(localFeedYears([
        'all-events-2026.json',
        'all-events.json',
        'article-links-2026.json',
        'program-links-2027.json',
        'years.json',
        'weekly-themes',
        'all-events-2025.json',
        // Seasons that are not on disk under the name the app requests.
        'all-events-2024.json.tmp',
        'old-all-events-2023.json',
      ])).toEqual([2025, 2026]);
    });

    it('agrees with localFeedFilename', () => {
      expect(localFeedYears([localFeedFilename(2027)])).toEqual([2027]);
    });
  });

  describe('buildLocalYearsManifest', () => {
    const now = new Date('2026-10-01T03:00:00Z');
    const remote = (defaultYear: number, years = [2025, 2026, 2027]): YearsManifest => ({
      years,
      defaultYear,
      generated: '2026-10-01T02:00:00.000Z',
    });

    // The Copilot finding, as it happens around October 1: production's
    // defaultYear has flipped on the server's clock (#301), this run picked
    // 2026 on Chautauqua's, and only 2026's feed is on disk. A verbatim copy
    // named 2027, and local mode opened on a file nobody downloaded.
    it('does not default to production\'s season when its feed is not on disk', () => {
      const manifest = buildLocalYearsManifest(remote(2027), [2026], 2026, now);
      expect(manifest.defaultYear).toBe(2026);
      // Production's seasons are still listed, so the switcher matches.
      expect(manifest.years).toEqual([2025, 2026, 2027]);
      expect(manifest.generated).toBe('2026-10-01T02:00:00.000Z');
    });

    it('follows production\'s default when that feed is on disk', () => {
      expect(buildLocalYearsManifest(remote(2027), [2026, 2027], 2026, now).defaultYear).toBe(2027);
      // And when the feed is the one this run wrote, before any listing saw it.
      expect(buildLocalYearsManifest(remote(2027), [], 2027, now).defaultYear).toBe(2027);
    });

    // Production's manifest and the default case, agreeing: the file is the
    // document the CDN served, byte-for-byte in content.
    it('is production\'s manifest when the disk agrees with it', () => {
      expect(buildLocalYearsManifest(remote(2026), [2026], 2026, now)).toEqual(remote(2026));
    });

    // `--year=2028 --force` wrote a season production does not list yet. A
    // season synced and unreachable from the year switcher is a sync that did
    // nothing.
    it('lists every season on disk, including ones production does not', () => {
      const manifest = buildLocalYearsManifest(remote(2026), [2024, 2026], 2028, now);
      expect(manifest.years).toEqual([2024, 2025, 2026, 2027, 2028]);
      expect(manifest.defaultYear).toBe(2026);
    });

    // A failed fetch is survivable: the manifest is built from the disk alone,
    // and it can still only name seasons that are there.
    it('without production\'s manifest, lists the disk and defaults to the season written', () => {
      expect(buildLocalYearsManifest(null, [2025, 2026], 2026, now)).toEqual({
        years: [2025, 2026],
        defaultYear: 2026,
        generated: now.toISOString(),
      });
      // The written season counts even if the listing missed it.
      expect(buildLocalYearsManifest(null, [], 2027, now).years).toEqual([2027]);
    });

    // The invariant the whole function exists for, over every combination
    // the cases above sample.
    it('never names a default with no feed on disk', () => {
      for (const remoteDefault of [2025, 2026, 2027, 2028]) {
        for (const local of [[], [2025], [2026], [2025, 2027]]) {
          for (const written of [2026, 2027]) {
            const m = buildLocalYearsManifest(remote(remoteDefault), local, written, now);
            expect([...local, written]).toContain(m.defaultYear);
            expect(m.years).toContain(m.defaultYear);
          }
        }
      }
    });
  });

  describe('buildLocalFeedPayload', () => {
    const events = [{ id: 1, title: 'Morning Lecture' }, { id: 2, title: 'Symphony' }];

    // Read back exactly the way the frontend reads it: `data.data || []`
    // (frontend/src/hooks/useEventData.ts). The bare array the cache hands
    // back has no `.data`, so writing it as-is parses to zero events.
    it('round-trips through the frontend\'s own read of the file', () => {
      const onDisk = JSON.stringify(buildLocalFeedPayload(events, 2026));
      const data = JSON.parse(onDisk);
      const rawEvents = data.data || [];
      expect(rawEvents).toEqual(events);
    });

    it('carries the cache envelope\'s timestamp and key, like the CDN object', () => {
      expect(buildLocalFeedPayload(events, 2027, 1_700_000_000_000)).toEqual({
        data: events,
        timestamp: 1_700_000_000_000,
        cacheKey: 'all-events-2027',
      });
      // The key and the filename name the same object.
      expect(`${localFeedCacheKey(2027)}.json`).toBe(localFeedFilename(2027));
    });
  });

  describe('runLocalSync', () => {
    // A year the service will never treat as its default: its own default is
    // this year or next, read from the machine's clock.
    const year = new Date().getFullYear() + 3;

    const mockApiClient = {
      getSeasonEvents: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
      getFullYearEvents: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
      getAllEventsInRange: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    } as any;
    const mockDbClient = {
      send: jest.fn((command: unknown) => {
        if (command instanceof GetCommand) return Promise.resolve({ Item: null });
        if (command instanceof PutCommand) return Promise.resolve({});
        if (command instanceof ScanCommand) return Promise.resolve({ Items: [] });
        return Promise.resolve({});
      }),
    } as any;

    let warm: jest.SpiedFunction<any>;

    beforeEach(() => {
      jest.clearAllMocks();
      // A complete event, so that both full syncs succeed. Each warms only
      // under its own success condition, and `syncAllSeasonEvents` needs zero
      // errors — with a half-built fixture it would skip the warm entirely
      // and the test below would go red for the wrong reason.
      (EventTransformationService.transformApiEvents as jest.Mock) = jest.fn(() => [
        {
          id: 1,
          uid: 'event-1',
          title: 'Morning Lecture',
          startDate: `${year}-07-01T10:45:00`,
          endDate: `${year}-07-01T11:45:00`,
          timezone: 'America/New_York',
          categories: [],
          tags: [],
          category: 'Lecture',
          week: 1,
          dayOfWeek: 1,
          confidence: 'confirmed',
          syncStatus: 'synced',
          lastModified: `${year}-06-01T00:00:00`,
          source: 'events-calendar-api',
          status: 'publish',
          featured: false,
          lastUpdated: new Date(),
        },
      ]);
      // Stubbed so nothing reaches S3; it is the argument that matters.
      warm = jest
        .spyOn(EventsCalendarDataSyncService.prototype as any, 'warmCacheAfterSync')
        .mockResolvedValue(undefined as never);
    });

    afterEach(() => {
      warm.mockRestore();
    });

    // The real service, not a stand-in, because the defect lived in the
    // service's behaviour rather than in which method name the script typed:
    // `syncAllSeasonEvents(year)` syncs `year` and then warms the server's
    // default year. The script reads `all-events-<year>.json` back out of
    // the cache straight afterwards, so the year that was warmed has to be
    // the year that was asked for, or a non-default `--year --force` run
    // reads an untouched — and, past its TTL, empty — object.
    it('on --force, refreshes the cached feed for the year it was given', async () => {
      const service = new EventsCalendarDataSyncService(mockApiClient, mockDbClient);

      const result = await runLocalSync(service, { force: true, year });

      // The sync really ran clean, so a warm that did not happen, or
      // happened for another year, is the sync's choice and not the fixture's.
      expect(result.success).toBe(true);
      expect(result.eventsCreated).toBe(1);
      expect(warm).toHaveBeenCalled();
      for (const call of warm.mock.calls) {
        expect(call[1]).toBe(year);
      }
    });

    it('without --force, runs the incremental sync, which takes no year', async () => {
      const service = {
        syncFullYearEvents: jest.fn(),
        performIncrementalSync: jest.fn<() => Promise<any>>().mockResolvedValue({ success: true }),
      };

      await runLocalSync(service as any, { force: false, year });

      expect(service.performIncrementalSync).toHaveBeenCalledTimes(1);
      expect(service.syncFullYearEvents).not.toHaveBeenCalled();
    });
  });
});
