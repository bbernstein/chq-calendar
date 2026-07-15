import { ArticleLinksPublisher } from '../services/articleLinksPublisher';
import type { MatchState, ArticleLinksFile } from '../types/articles';

const mockSend = jest.fn();
const mockS3: any = { send: mockSend };

const STATE: MatchState = { matcherVersion: 1, articleHashes: {}, eventFingerprints: {}, matches: [] };
const FILE: ArticleLinksFile = { generatedAt: '2026-07-15T14:00:00.000Z', matcherVersion: 1, links: {} };

describe('ArticleLinksPublisher', () => {
  let pub: ArticleLinksPublisher;
  beforeEach(() => {
    jest.resetAllMocks();
    pub = new ArticleLinksPublisher(mockS3, 'bucket', 'cache/calendar-cache', 'internal/article-links');
  });

  test('publishLinks writes public key with 5-minute cache-control', async () => {
    mockSend.mockResolvedValue({});
    await pub.publishLinks(2026, FILE);
    const cmd: any = mockSend.mock.calls[0][0];
    expect(cmd.input.Key).toBe('cache/calendar-cache/article-links-2026.json');
    expect(cmd.input.CacheControl).toBe('public, max-age=300');
    expect(cmd.input.ContentType).toBe('application/json');
    expect(JSON.parse(cmd.input.Body)).toEqual(FILE);
  });

  test('state round-trips on the internal prefix; missing state → undefined', async () => {
    mockSend.mockResolvedValueOnce({});
    await pub.saveState(2026, STATE);
    expect(mockSend.mock.calls[0][0].input.Key).toBe('internal/article-links/article-links-state-2026.json');

    const err = new Error('nope');
    (err as any).name = 'NoSuchKey';
    mockSend.mockRejectedValueOnce(err);
    expect(await pub.loadState(2026)).toBeUndefined();

    mockSend.mockResolvedValueOnce({ Body: { transformToString: () => Promise.resolve(JSON.stringify(STATE)) } });
    expect(await pub.loadState(2026)).toEqual(STATE);
  });

  test('loadState rethrows non-NoSuchKey errors (run must abort, not full-recompute)', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));
    await expect(pub.loadState(2026)).rejects.toThrow('AccessDenied');
  });
});
