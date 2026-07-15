import { ChqDailyClient } from '../services/chqDailyClient';
import posts from './fixtures/chqdaily-posts.json';

const CATEGORIES_PAGE = [
  { id: 25, name: 'Interfaith Lecture' },
  { id: 1786, name: 'Hall of Philosophy' },
  { id: 10, name: 'Symphony' },
  { id: 44, name: 'Amphitheater' },
];
const TAGS_PAGE = [
  { id: 274, name: 'Najeeba Syeed' },
  { id: 337, name: 'Lecture Recap' },
  { id: 512, name: 'Beethoven' },
];

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}

describe('ChqDailyClient.fetchPostsModifiedSince', () => {
  test('fetches taxonomies then posts, resolving IDs to names and stripping HTML', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(jsonResponse(CATEGORIES_PAGE)) // categories page 1
      .mockResolvedValueOnce(jsonResponse(TAGS_PAGE))       // tags page 1
      .mockResolvedValueOnce(jsonResponse(posts));          // posts page 1 (< 100 → stop)
    const client = new ChqDailyClient(fetchFn as unknown as typeof fetch);

    const articles = await client.fetchPostsModifiedSince('2026-07-01T00:00:00');

    expect(articles).toHaveLength(2);
    const a = articles[0];
    expect(a.wpPostId).toBe(90210);
    expect(a.title).toBe('Najeeba Syeed speaks ‘from the broken heart of democracy’');
    expect(a.categories).toEqual(['Interfaith Lecture', 'Hall of Philosophy']);
    expect(a.tags).toEqual(['Najeeba Syeed', 'Lecture Recap']);
    expect(a.bodyText).toContain('2 p.m. Tuesday in the Hall of Philosophy');
    expect(a.bodyText).not.toContain('<p>');
    // posts request carries the watermark + politeness params
    const postsUrl = String(fetchFn.mock.calls[2][0]);
    expect(postsUrl).toContain('modified_after=2026-07-01T00%3A00%3A00');
    expect(postsUrl).toContain('per_page=100');
    // every request sends the descriptive User-Agent
    expect(fetchFn.mock.calls[2][1].headers['User-Agent']).toContain('chqcal.org');
  });

  test('paginates posts until a page returns fewer than per_page items', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({ ...posts[0], id: 1000 + i }));
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(jsonResponse(CATEGORIES_PAGE))
      .mockResolvedValueOnce(jsonResponse(TAGS_PAGE))
      .mockResolvedValueOnce(jsonResponse(fullPage))   // posts page 1: full → continue
      .mockResolvedValueOnce(jsonResponse([posts[1]])); // posts page 2: partial → stop
    const client = new ChqDailyClient(fetchFn as unknown as typeof fetch);

    const articles = await client.fetchPostsModifiedSince('2026-06-01T00:00:00');

    expect(articles).toHaveLength(101);
    expect(String(fetchFn.mock.calls[3][0])).toContain('page=2');
  });

  test('unknown taxonomy IDs are dropped, not rendered as undefined', async () => {
    const orphan = [{ ...posts[0], categories: [9999], tags: [] }];
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(jsonResponse(CATEGORIES_PAGE))
      .mockResolvedValueOnce(jsonResponse(TAGS_PAGE))
      .mockResolvedValueOnce(jsonResponse(orphan));
    const client = new ChqDailyClient(fetchFn as unknown as typeof fetch);

    const [a] = await client.fetchPostsModifiedSince('2026-07-01T00:00:00');
    expect(a.categories).toEqual([]);
  });

  test('throws when the posts request fails (watermark must not advance)', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(jsonResponse(CATEGORIES_PAGE))
      .mockResolvedValueOnce(jsonResponse(TAGS_PAGE))
      .mockResolvedValueOnce(jsonResponse({ message: 'boom' }, 500));
    const client = new ChqDailyClient(fetchFn as unknown as typeof fetch);

    await expect(client.fetchPostsModifiedSince('2026-07-01T00:00:00')).rejects.toThrow(/500/);
  });
});
