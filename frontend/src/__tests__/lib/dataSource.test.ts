/// <reference types="vitest/globals" />
import {
  CDN_DATA_BASE,
  LOCAL_DATA_BASE,
  dataBase,
  usingLocalData,
  describeFetchFailure,
} from '@/lib/dataSource';

describe('dataSource', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('dataBase', () => {
    // The regression this file exists for. Before #286 the base path was
    // `import.meta.env.DEV ? '/data' : '/cache/calendar-cache'`, and every dev
    // read a gitignored directory. Vitest runs with DEV true, so restoring
    // that ternary makes this assertion fail — which is what makes it a test.
    it('reads the CDN prefix by default, in dev as well as production', () => {
      expect(dataBase()).toBe(CDN_DATA_BASE);
      expect(dataBase()).toBe('/cache/calendar-cache');
    });

    it('reads local files only when VITE_LOCAL_DATA is explicitly true', () => {
      vi.stubEnv('VITE_LOCAL_DATA', 'true');
      expect(dataBase()).toBe(LOCAL_DATA_BASE);
      expect(dataBase()).toBe('/data');
    });

    // The opt-in is a string flag from the environment, and every other value
    // an env var can hold means "no". A truthiness check would send anyone
    // with VITE_LOCAL_DATA=false straight back into #286.
    it.each(['false', '1', 'TRUE', 'yes', '', 'undefined'])(
      'treats VITE_LOCAL_DATA=%o as not-local',
      (value) => {
        vi.stubEnv('VITE_LOCAL_DATA', value);
        expect(usingLocalData()).toBe(false);
        expect(dataBase()).toBe(CDN_DATA_BASE);
      },
    );
  });

  describe('describeFetchFailure', () => {
    it('names the URL and the status', () => {
      const msg = describeFetchFailure('/cache/calendar-cache/all-events-2026.json', 404);
      expect(msg).toContain('/cache/calendar-cache/all-events-2026.json');
      expect(msg).toContain('404');
    });

    it('omits the status when there is none', () => {
      expect(describeFetchFailure('/x.json')).not.toContain('HTTP');
    });

    // #286's whole cost was that the failure said nothing actionable: the
    // developer got EmptyState's "try reloading in a moment", which could
    // never work. Each mode has to name its own remedy.
    it('points a local-data developer at the sync step', () => {
      vi.stubEnv('VITE_LOCAL_DATA', 'true');
      const msg = describeFetchFailure('/data/all-events-2026.json', 404);
      expect(msg).toContain('sync:local');
      expect(msg).toContain('backend/README-LOCAL-SYNC.md');
      expect(msg).toContain('VITE_LOCAL_DATA');
    });

    it('points a CDN-mode developer at the proxy and the offline route', () => {
      const msg = describeFetchFailure('/cache/calendar-cache/all-events-2026.json', 500);
      expect(msg).toContain('vite.config.ts');
      expect(msg).toContain('sync:local');
      expect(msg).toContain('VITE_LOCAL_DATA=true');
    });
  });
});
