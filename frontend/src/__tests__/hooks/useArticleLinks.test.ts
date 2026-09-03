/// <reference types="vitest/globals" />
import { renderHook, waitFor } from '@testing-library/preact';
import { useArticleLinks, __resetArticleLinksCacheForTests } from '@/hooks/useArticleLinks';

const PAYLOAD = {
  generatedAt: '2026-07-15T14:00:00Z',
  matcherVersion: 1,
  links: {
    '91653': [
      { title: 'Najeeba Syeed speaks', url: 'https://chqdaily.com/a1/', kind: 'recap', pubDate: '2026-07-14' },
    ],
  },
};

describe('useArticleLinks', () => {
  beforeEach(() => {
    __resetArticleLinksCacheForTests();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the sidecar from the CDN base and returns links keyed by event id', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(PAYLOAD),
    });

    const { result } = renderHook(() => useArticleLinks(2026));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    // The CDN base, in dev as well as production (#286). vitest runs with
    // import.meta.env.DEV === true, so this fails if the old
    // `DEV ? '/data' : …` branch ever comes back.
    expect(fetch).toHaveBeenCalledWith('/cache/calendar-cache/article-links-2026.json');
    expect(result.current.links['91653']).toHaveLength(1);
    expect(result.current.links['91653'][0].kind).toBe('recap');
  });

  it('returns empty links on 404', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 404 });
    const { result } = renderHook(() => useArticleLinks(2026));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.links).toEqual({});
  });

  it('returns empty links on network error without throwing', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useArticleLinks(2026));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.links).toEqual({});
  });

  it('shares one in-flight request across concurrent consumers', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(PAYLOAD),
    });
    const { result: a } = renderHook(() => useArticleLinks(2026));
    const { result: b } = renderHook(() => useArticleLinks(2026));
    await waitFor(() => expect(a.current.loading).toBe(false));
    await waitFor(() => expect(b.current.loading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
