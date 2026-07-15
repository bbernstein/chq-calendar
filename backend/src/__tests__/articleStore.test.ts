jest.unmock('@aws-sdk/lib-dynamodb');

import { ArticleStore } from '../services/articleStore';
import type { StoredArticle } from '../types/articles';

const mockSend = jest.fn();
const mockClient: any = { send: mockSend };
const TABLE = 'test-articles-table';

function article(overrides: Partial<StoredArticle> = {}): StoredArticle {
  return {
    wpPostId: 90210,
    title: 'Najeeba Syeed speaks',
    link: 'https://chqdaily.com/2026/07/najeeba-syeed-interfaith/',
    pubDate: '2026-07-14T07:00:12',
    modified: '2026-07-14T19:33:12',
    categories: ['Interfaith Lecture', 'Hall of Philosophy'],
    tags: ['Najeeba Syeed'],
    excerptText: 'excerpt',
    bodyText: 'body',
    contentHash: 'abc123',
    firstSeenAt: '2026-07-14T08:00:00.000Z',
    ...overrides,
  };
}

describe('ArticleStore', () => {
  let store: ArticleStore;
  beforeEach(() => {
    jest.resetAllMocks();
    store = new ArticleStore(mockClient, TABLE);
  });

  test('upsertArticle puts the row under pk ARTICLE#<wpPostId>', async () => {
    mockSend.mockResolvedValue({});
    await store.upsertArticle(article());
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.TableName).toBe(TABLE);
    expect(cmd.input.Item.pk).toBe('ARTICLE#90210');
    expect(cmd.input.Item.title).toBe('Najeeba Syeed speaks');
  });

  test('listAllArticles scans with pagination and strips the pk attribute', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [{ pk: 'ARTICLE#1', ...article({ wpPostId: 1 }) }], LastEvaluatedKey: { pk: 'ARTICLE#1' } })
      .mockResolvedValueOnce({ Items: [{ pk: 'ARTICLE#2', ...article({ wpPostId: 2 }) }] });
    const all = await store.listAllArticles();
    expect(all).toHaveLength(2);
    expect(all.map(a => a.wpPostId)).toEqual([1, 2]);
    expect((all[0] as any).pk).toBeUndefined();
    const second: any = mockSend.mock.calls[1][0];
    expect(second.input.ExclusiveStartKey).toEqual({ pk: 'ARTICLE#1' });
    // Scan filters out the META# row
    expect(mockSend.mock.calls[0][0].input.FilterExpression).toContain('begins_with');
  });

  test('watermark round-trips under META#watermark; missing → undefined', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    expect(await store.getWatermark()).toBeUndefined();

    mockSend.mockResolvedValueOnce({});
    await store.setWatermark('2026-07-15T12:00:00.000Z');
    const put: any = mockSend.mock.calls[1][0];
    expect(put.input.Item).toEqual({ pk: 'META#watermark', value: '2026-07-15T12:00:00.000Z' });

    mockSend.mockResolvedValueOnce({ Item: { pk: 'META#watermark', value: '2026-07-15T12:00:00.000Z' } });
    expect(await store.getWatermark()).toBe('2026-07-15T12:00:00.000Z');
  });
});
