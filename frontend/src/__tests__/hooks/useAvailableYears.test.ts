/// <reference types="vitest/globals" />
import { renderHook, waitFor } from '@testing-library/preact';
import { useAvailableYears } from '@/hooks/useAvailableYears';

describe('useAvailableYears', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('fetches years manifest and returns available years', async () => {
    const mockManifest = { years: [2025, 2026, 2027], defaultYear: 2026, generated: '2026-03-03T12:00:00Z' };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockManifest),
    });

    const { result } = renderHook(() => useAvailableYears());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.years).toEqual([2025, 2026, 2027]);
    expect(result.current.defaultYear).toBe(2026);
  });

  it('falls back to computed default year on fetch failure', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 5, 15)); // June 2026
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useAvailableYears());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.defaultYear).toBe(2026);
    expect(result.current.years).toEqual([2026]);
  });

  it('uses cached manifest from localStorage if fresh', async () => {
    const cached = {
      years: [2025, 2026],
      defaultYear: 2026,
      generated: '2026-03-03T12:00:00Z',
      cachedAt: Date.now(),
    };
    localStorage.setItem('chq-calendar-years', JSON.stringify(cached));

    const { result } = renderHook(() => useAvailableYears());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.years).toEqual([2025, 2026]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refetches when cached data is expired', async () => {
    const expired = {
      years: [2025],
      defaultYear: 2025,
      generated: '2025-01-01T00:00:00Z',
      cachedAt: Date.now() - 3600001, // Just over 1 hour
    };
    localStorage.setItem('chq-calendar-years', JSON.stringify(expired));

    const mockManifest = { years: [2025, 2026], defaultYear: 2026, generated: '2026-03-03T12:00:00Z' };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockManifest),
    });

    const { result } = renderHook(() => useAvailableYears());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetch).toHaveBeenCalled();
    expect(result.current.years).toEqual([2025, 2026]);
    expect(result.current.defaultYear).toBe(2026);
  });

  it('caches fetched manifest in localStorage', async () => {
    const mockManifest = { years: [2026], defaultYear: 2026, generated: '2026-03-03T12:00:00Z' };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockManifest),
    });

    renderHook(() => useAvailableYears());

    await waitFor(() => {
      const stored = localStorage.getItem('chq-calendar-years');
      expect(stored).not.toBeNull();
    });

    const stored = JSON.parse(localStorage.getItem('chq-calendar-years')!);
    expect(stored.years).toEqual([2026]);
    expect(stored.defaultYear).toBe(2026);
    expect(stored.cachedAt).toBeDefined();
  });

  it('handles non-ok HTTP response as failure', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 5, 15)); // June 2026
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const { result } = renderHook(() => useAvailableYears());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should fall back to computed default
    expect(result.current.defaultYear).toBe(2026);
    expect(result.current.years).toEqual([2026]);
  });
});
