/// <reference types="vitest/globals" />
import { renderHook, waitFor } from '@testing-library/preact';
import { useProgramLinks, __resetProgramLinksCacheForTests } from '@/hooks/useProgramLinks';
import { useArticleLinks, __resetArticleLinksCacheForTests } from '@/hooks/useArticleLinks';

const PROGRAM_PAYLOAD = {
  generatedAt: '2026-07-15T14:00:00Z',
  matcherVersion: 1,
  links: {
    '91653': [{ title: 'Digital Program', url: 'https://chq.org/programs/91653/' }],
  },
};

const ARTICLE_PAYLOAD = {
  generatedAt: '2026-07-15T14:00:00Z',
  matcherVersion: 1,
  links: {
    '91653': [
      { title: 'Najeeba Syeed speaks', url: 'https://chqdaily.com/a1/', kind: 'recap', pubDate: '2026-07-14' },
    ],
  },
};

describe('useProgramLinks', () => {
  beforeEach(() => {
    __resetProgramLinksCacheForTests();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the sidecar from the CDN base and returns links keyed by event id', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(PROGRAM_PAYLOAD),
    });

    const { result } = renderHook(() => useProgramLinks(2026));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    // The CDN base, in dev as well as production (#286). vitest runs with
    // import.meta.env.DEV === true, so this fails if the old
    // `DEV ? '/data' : …` branch ever comes back.
    expect(fetch).toHaveBeenCalledWith('/cache/calendar-cache/program-links-2026.json');
    expect(result.current.links['91653']).toHaveLength(1);
    expect(result.current.links['91653'][0].title).toBe('Digital Program');
  });

  it('returns empty links on 404 and caches the result (no refetch on remount)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 404 });

    const { result: a } = renderHook(() => useProgramLinks(2026));
    await waitFor(() => expect(a.current.loading).toBe(false));
    expect(a.current.links).toEqual({});

    const { result: b } = renderHook(() => useProgramLinks(2026));
    await waitFor(() => expect(b.current.loading).toBe(false));
    expect(b.current.links).toEqual({});

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns empty links on network error without throwing, and does not cache (refetches on remount)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));

    const { result: a } = renderHook(() => useProgramLinks(2026));
    await waitFor(() => expect(a.current.loading).toBe(false));
    expect(a.current.links).toEqual({});

    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
    const { result: b } = renderHook(() => useProgramLinks(2026));
    await waitFor(() => expect(b.current.loading).toBe(false));
    expect(b.current.links).toEqual({});

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not collide with useArticleLinks cache for the same year', async () => {
    __resetArticleLinksCacheForTests();
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/cache/calendar-cache/program-links-2026.json') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(PROGRAM_PAYLOAD) });
      }
      if (url === '/cache/calendar-cache/article-links-2026.json') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ARTICLE_PAYLOAD) });
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    const { result: program } = renderHook(() => useProgramLinks(2026));
    const { result: article } = renderHook(() => useArticleLinks(2026));

    await waitFor(() => expect(program.current.loading).toBe(false));
    await waitFor(() => expect(article.current.loading).toBe(false));

    expect(program.current.links['91653']).toEqual([
      { title: 'Digital Program', url: 'https://chq.org/programs/91653/' },
    ]);
    expect(article.current.links['91653']).toEqual([
      { title: 'Najeeba Syeed speaks', url: 'https://chqdaily.com/a1/', kind: 'recap', pubDate: '2026-07-14' },
    ]);
    expect(fetch).toHaveBeenCalledWith('/cache/calendar-cache/program-links-2026.json');
    expect(fetch).toHaveBeenCalledWith('/cache/calendar-cache/article-links-2026.json');
  });
});
