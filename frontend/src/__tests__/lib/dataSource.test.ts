/// <reference types="vitest/globals" />
import {
  CDN_DATA_BASE,
  LOCAL_DATA_BASE,
  dataBase,
  dataCacheKey,
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

    // `/data` is a working-tree directory the dev server serves; CloudFront has
    // no such prefix, so a production bundle that asks for it gets a 404 and
    // an empty calendar for every reader. Before #286 that was impossible by
    // construction (the branch was DEV-only). The flag must not reopen it: a
    // developer with VITE_LOCAL_DATA=true in .env.local who runs
    // deploy-frontend.sh is building production on their own machine.
    it('ignores VITE_LOCAL_DATA=true outside the dev server', () => {
      vi.stubEnv('VITE_LOCAL_DATA', 'true');
      vi.stubEnv('DEV', false);
      expect(usingLocalData()).toBe(false);
      expect(dataBase()).toBe(CDN_DATA_BASE);
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

  // The hooks cache what they fetched for an hour. Keyed by name alone, a
  // developer who flips VITE_LOCAL_DATA keeps seeing the other source's data
  // until it expires, and concludes the switch is broken.
  describe('dataCacheKey', () => {
    // Byte-for-byte, not merely "some key": this is the key every production
    // reader already has a warm entry under, and any change to it costs each
    // of them a cold fetch of the whole season.
    it('leaves the CDN key exactly as it was', () => {
      expect(dataCacheKey('chq-calendar-years')).toBe('chq-calendar-years');
      expect(dataCacheKey('chq-calendar-events-2026')).toBe('chq-calendar-events-2026');
    });

    it('gives the local source keys of its own', () => {
      vi.stubEnv('VITE_LOCAL_DATA', 'true');
      expect(dataCacheKey('chq-calendar-years')).toBe('chq-calendar-years-local');
      expect(dataCacheKey('chq-calendar-events-2026')).toBe('chq-calendar-events-2026-local');
    });

    it('never produces a local key in a production build', () => {
      vi.stubEnv('VITE_LOCAL_DATA', 'true');
      vi.stubEnv('DEV', false);
      expect(dataCacheKey('chq-calendar-years')).toBe('chq-calendar-years');
    });
  });

  // The pin in src/__tests__/setup.ts. Everything above that says "by
  // default" assumes it, and so does every hook test that expects a CDN URL.
  // It only discriminates when the variable is set in the environment running
  // the suite — `VITE_LOCAL_DATA=true npx vitest run` — which is exactly the
  // developer it protects.
  it('starts every test with VITE_LOCAL_DATA unset, even after unstubAllEnvs', () => {
    vi.stubEnv('VITE_LOCAL_DATA', 'true');
    vi.unstubAllEnvs();
    expect(import.meta.env.VITE_LOCAL_DATA).toBeUndefined();
    expect(usingLocalData()).toBe(false);
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
      // The three above appear in the CDN-mode message too, so on their own
      // they pass with the local branch deleted. These are what only the
      // local branch says: where the files live, why a fresh clone lacks them,
      // and not the CDN branch's network advice, which cannot help here.
      expect(msg).toContain('frontend/public/data/');
      expect(msg).toContain('which git ignores');
      expect(msg).not.toContain('network connection');
    });

    it('points a CDN-mode developer at the proxy and the offline route', () => {
      const msg = describeFetchFailure('/cache/calendar-cache/all-events-2026.json', 500);
      expect(msg).toContain('vite.config.ts');
      expect(msg).toContain('sync:local');
      expect(msg).toContain('VITE_LOCAL_DATA=true');
    });
  });
});
