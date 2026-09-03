/// <reference types="vitest/globals" />
/**
 * Every hook that fetches published data asks for it from the same place.
 *
 * `dataSource.test.ts` proves the base path is right; this proves the hooks
 * actually use it. Those are different claims, and #286 was a failure of the
 * second one — the module-level constant was fine, three call sites each had
 * their own copy of a stale ternary, and the calendar was empty on every fresh
 * clone for months.
 *
 * Vitest runs with `import.meta.env.DEV` true, so any of these that reverted
 * to `DEV ? '/data' : …` would fail here. Verified by injection: restoring the
 * old ternary in dataBase() turns all four URL assertions red.
 */
import { renderHook, waitFor } from '@testing-library/preact';
import { useEventData } from '@/hooks/useEventData';
import { useAvailableYears } from '@/hooks/useAvailableYears';
import { useSidecarLinks } from '@/hooks/useSidecarLinks';
import { CDN_DATA_BASE } from '@/lib/dataSource';
import type { GlobalEventData } from '@/lib/types';

const FEED = {
  data: [
    {
      id: 'e1',
      title: 'An event',
      startDate: '2026-07-04T00:00:00Z',
      endDate: '2026-07-04T01:00:00Z',
    },
  ],
};

function eventDataProps() {
  const globalEventData: GlobalEventData = {
    events: null,
    categories: [],
    locations: [],
    tags: [],
    weeks: [],
    loadedAt: null,
  };
  return {
    year: 2026,
    globalEventData,
    seasonWeeks: [],
    setAvailableCategories: vi.fn(),
    setAvailableLocations: vi.fn(),
  };
}

/** Every URL the hook under test asked for, as strings. */
function requestedUrls(): string[] {
  return (fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
}

describe('published-data hooks all read from the CDN base', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('useEventData requests the year-suffixed feed from the CDN base', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => FEED } as Response)));

    // Props built once, outside the render callback. `useEventData` rebuilds
    // its fetch callback whenever `globalEventData` or `seasonWeeks` change
    // identity, and the effect that calls it depends on that callback — so
    // fresh objects per render re-fetch on a loop. Production is safe
    // (page.tsx:45-46 passes a context value and a useMemo), but the failure
    // path below has no `dataLoaded` guard to stop it, and an unstable props
    // object there spins until the worker dies.
    const props = eventDataProps();
    const { result } = renderHook(() => useEventData(props));
    await waitFor(() => expect(result.current.events.length).toBe(1));

    expect(requestedUrls()).toContain(`${CDN_DATA_BASE}/all-events-2026.json`);
  });

  it('useAvailableYears requests the manifest from the CDN base', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ years: [2025, 2026, 2027], defaultYear: 2026, generated: 'x' }),
    } as Response)));

    const { result } = renderHook(() => useAvailableYears());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(requestedUrls()).toContain(`${CDN_DATA_BASE}/years.json`);
  });

  it('useSidecarLinks requests its sidecar from the CDN base', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ generatedAt: 'x', matcherVersion: 7, links: {} }),
    } as Response)));

    // A prefix no other test has loaded — the hook memoises resolved files in
    // module-level maps that persist across tests in this file.
    renderHook(() => useSidecarLinks('wiring-probe-links', 2026));
    await waitFor(() => expect(requestedUrls().length).toBeGreaterThan(0));

    expect(requestedUrls()).toContain(`${CDN_DATA_BASE}/wiring-probe-links-2026.json`);
  });

  it('explains what to do when the feed 404s, rather than "Failed to fetch events"', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.map(String).join(' '));
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 } as Response)));

    const props = eventDataProps();
    const { result } = renderHook(() => useEventData(props));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const message = errors.join('\n');
    expect(message).toContain(`${CDN_DATA_BASE}/all-events-2026.json`);
    expect(message).toContain('404');
    // The remedy, which the old bare message did not carry.
    expect(message).toContain('sync:local');
    expect(message).toContain('backend/README-LOCAL-SYNC.md');
  });
});
