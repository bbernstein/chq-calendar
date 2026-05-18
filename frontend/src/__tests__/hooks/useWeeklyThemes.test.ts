/// <reference types="vitest/globals" />
import { renderHook, waitFor } from '@testing-library/preact';
import { useWeeklyThemes, __resetWeeklyThemesCacheForTests } from '@/hooks/useWeeklyThemes';

const PAYLOAD_2026 = {
  year: 2026,
  scrapedAt: '2026-05-17T18:42:11.000Z',
  source: 'https://www.chq.org/things-to-do/events/weekly-themes/',
  weeks: [
    { number: 1, title: 'Icons and Instigators', description: '', startDate: '2026-06-27', endDate: '2026-07-04' },
    { number: 2, title: 'Breaking the News', description: '', startDate: '2026-07-04', endDate: '2026-07-11' },
  ],
};

describe('useWeeklyThemes', () => {
  beforeEach(() => {
    __resetWeeklyThemesCacheForTests();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches /data/weekly-themes/<year>.json and returns themes keyed by week number', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(PAYLOAD_2026),
    });

    const { result } = renderHook(() => useWeeklyThemes(2026));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetch).toHaveBeenCalledWith('/data/weekly-themes/2026.json');
    expect(result.current.themes[1]).toEqual(PAYLOAD_2026.weeks[0]);
    expect(result.current.themes[2]).toEqual(PAYLOAD_2026.weeks[1]);
  });

  it('returns an empty themes record when the file is missing (404)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const { result } = renderHook(() => useWeeklyThemes(2099));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.themes).toEqual({});
  });

  it('returns an empty themes record on network error', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useWeeklyThemes(2026));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.themes).toEqual({});
  });

  it('shares one in-flight request across concurrent consumers for the same year', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(PAYLOAD_2026),
    });

    const { result: a } = renderHook(() => useWeeklyThemes(2026));
    const { result: b } = renderHook(() => useWeeklyThemes(2026));

    await waitFor(() => {
      expect(a.current.loading).toBe(false);
      expect(b.current.loading).toBe(false);
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a.current.themes[1]).toBeDefined();
    expect(b.current.themes[1]).toBeDefined();
  });

  it('retries on transient (non-404) failures across remounts', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const first = renderHook(() => useWeeklyThemes(2026));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current.themes).toEqual({});
    expect(fetch).toHaveBeenCalledTimes(1);

    // A second mount should refetch — 500 must not poison the cache.
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(PAYLOAD_2026),
    });
    const second = renderHook(() => useWeeklyThemes(2026));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(second.result.current.themes[1]).toBeDefined();
  });

  it('clears stale themes when year changes before the new fetch resolves', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(PAYLOAD_2026),
    });
    const view = renderHook(({ year }: { year: number }) => useWeeklyThemes(year), {
      initialProps: { year: 2026 },
    });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.themes[1]).toBeDefined();

    // Switch to an uncached year — themes should reset before fetch resolves.
    let resolveFetch: (v: unknown) => void = () => {};
    (fetch as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise((r) => { resolveFetch = r; }));
    view.rerender({ year: 2099 });
    expect(view.result.current.themes).toEqual({});
    expect(view.result.current.loading).toBe(true);

    resolveFetch({ ok: false, status: 404 });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.themes).toEqual({});
  });

  it('caches across remounts and does not refetch the same year', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(PAYLOAD_2026),
    });

    const first = renderHook(() => useWeeklyThemes(2026));
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    const second = renderHook(() => useWeeklyThemes(2026));
    await waitFor(() => expect(second.result.current.loading).toBe(false));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(second.result.current.themes[1]).toBeDefined();
  });
});
