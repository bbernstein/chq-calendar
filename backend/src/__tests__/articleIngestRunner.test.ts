import { runArticleIngest, BACKFILL_START_MONTH_DAY, WATERMARK_OVERLAP_MS } from '../services/articleIngestRunner';
import { computeArticleContentHash } from '../services/articleMatcher';
import type { DailyArticle, StoredArticle, CalendarEventLite } from '../types/articles';

const NOW = new Date('2026-07-15T14:00:00.000Z');

function fetched(overrides: Partial<DailyArticle> = {}): DailyArticle {
  return {
    wpPostId: 1,
    title: 'Najeeba Syeed speaks from the broken heart of democracy',
    link: 'https://chqdaily.com/a1/',
    pubDate: '2026-07-15T06:30:00',
    modified: '2026-07-15T06:30:00',
    categories: ['Interfaith Lecture', 'Hall of Philosophy'],
    tags: ['Najeeba Syeed'],
    excerptText: '',
    bodyText: 'Najeeba Syeed speaks at 2 p.m. today in the Hall of Philosophy.',
    ...overrides,
  };
}

function stored(a: DailyArticle): StoredArticle {
  return { ...a, contentHash: computeArticleContentHash(a), firstSeenAt: '2026-07-01T00:00:00.000Z' };
}

const EVENTS: CalendarEventLite[] = [{
  id: 'e1',
  title: 'Interfaith Lecture: From the Broken Heart of Democracy',
  startDate: '2026-07-15T14:00:00',
  venue: { name: 'Hall of Philosophy' },
  category: 'Interfaith Lecture Series',
  presenter: 'Najeeba Syeed',
}];

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    client: { fetchPostsModifiedSince: jest.fn().mockResolvedValue([fetched()]) },
    store: {
      getWatermark: jest.fn().mockResolvedValue(undefined),
      setWatermark: jest.fn().mockResolvedValue(undefined),
      listAllArticles: jest.fn().mockResolvedValue([]),
      upsertArticle: jest.fn().mockResolvedValue(undefined),
    },
    loader: { load: jest.fn().mockResolvedValue(EVENTS) },
    publisher: {
      loadState: jest.fn().mockResolvedValue(undefined),
      saveState: jest.fn().mockResolvedValue(undefined),
      publishLinks: jest.fn().mockResolvedValue(undefined),
    },
    now: NOW,
    year: 2026,
    ...overrides,
  } as any;
}

describe('runArticleIngest', () => {
  test('first run: backfill watermark, upserts, publishes links + state, advances watermark with overlap', async () => {
    const deps = makeDeps();
    const summary = await runArticleIngest(deps);

    expect(deps.client.fetchPostsModifiedSince).toHaveBeenCalledWith(`2026-${BACKFILL_START_MONTH_DAY}T00:00:00`);
    expect(deps.store.upsertArticle).toHaveBeenCalledTimes(1);
    expect(deps.publisher.publishLinks).toHaveBeenCalledTimes(1);
    const file = deps.publisher.publishLinks.mock.calls[0][1];
    expect(file.links['e1']).toHaveLength(1);
    expect(deps.publisher.saveState).toHaveBeenCalledTimes(1);
    const wm = deps.store.setWatermark.mock.calls[0][0];
    expect(wm).toBe(new Date(NOW.getTime() - WATERMARK_OVERLAP_MS).toISOString());
    expect(summary.upserted).toBe(1);
    expect(summary.linksPublished).toBe(true);
  });

  test('refetched article with unchanged contentHash is not re-upserted; no-op run publishes nothing', async () => {
    const already = stored(fetched());
    const deps = makeDeps({
      store: {
        getWatermark: jest.fn().mockResolvedValue('2026-07-15T00:00:00.000Z'),
        setWatermark: jest.fn().mockResolvedValue(undefined),
        listAllArticles: jest.fn().mockResolvedValue([already]),
        upsertArticle: jest.fn().mockResolvedValue(undefined),
      },
    });
    // prevState from an identical earlier run
    const { computeMatchState } = await import('../services/articleMatcher');
    const prev = computeMatchState({ articles: [already], events: EVENTS });
    deps.publisher.loadState.mockResolvedValue(prev.state);

    const summary = await runArticleIngest(deps);
    expect(deps.store.upsertArticle).not.toHaveBeenCalled();
    expect(deps.publisher.publishLinks).not.toHaveBeenCalled();
    expect(deps.publisher.saveState).not.toHaveBeenCalled();
    expect(deps.store.setWatermark).toHaveBeenCalled(); // watermark still advances on success
    expect(summary.linksPublished).toBe(false);
  });

  test('edited article (new hash) preserves firstSeenAt and republishes', async () => {
    const already = stored(fetched());
    const edited = fetched({ bodyText: 'Rescheduled to Wednesday.', modified: '2026-07-15T12:00:00' });
    const deps = makeDeps({
      client: { fetchPostsModifiedSince: jest.fn().mockResolvedValue([edited]) },
      store: {
        getWatermark: jest.fn().mockResolvedValue('2026-07-15T00:00:00.000Z'),
        setWatermark: jest.fn().mockResolvedValue(undefined),
        listAllArticles: jest.fn().mockResolvedValue([already]),
        upsertArticle: jest.fn().mockResolvedValue(undefined),
      },
    });
    const { computeMatchState } = await import('../services/articleMatcher');
    deps.publisher.loadState.mockResolvedValue(computeMatchState({ articles: [already], events: EVENTS }).state);

    await runArticleIngest(deps);
    expect(deps.store.upsertArticle).toHaveBeenCalledTimes(1);
    const row: StoredArticle = deps.store.upsertArticle.mock.calls[0][0];
    expect(row.firstSeenAt).toBe('2026-07-01T00:00:00.000Z'); // preserved
    expect(deps.publisher.publishLinks).toHaveBeenCalledTimes(1);
    expect(deps.publisher.saveState).toHaveBeenCalledTimes(1);
  });

  test('fetch failure propagates and watermark does not advance', async () => {
    const deps = makeDeps({
      client: { fetchPostsModifiedSince: jest.fn().mockRejectedValue(new Error('WP 500')) },
    });
    await expect(runArticleIngest(deps)).rejects.toThrow('WP 500');
    expect(deps.store.setWatermark).not.toHaveBeenCalled();
    expect(deps.publisher.publishLinks).not.toHaveBeenCalled();
  });

  test('publishLinks failure propagates and watermark does not advance', async () => {
    const deps = makeDeps({
      publisher: {
        loadState: jest.fn().mockResolvedValue(undefined),
        saveState: jest.fn().mockResolvedValue(undefined),
        publishLinks: jest.fn().mockRejectedValue(new Error('S3 down')),
      },
    });
    await expect(runArticleIngest(deps)).rejects.toThrow('S3 down');
    expect(deps.store.setWatermark).not.toHaveBeenCalled();
  });

  test('upsertArticle failure propagates and watermark does not advance, links not published', async () => {
    const deps = makeDeps({
      store: {
        getWatermark: jest.fn().mockResolvedValue(undefined),
        setWatermark: jest.fn().mockResolvedValue(undefined),
        listAllArticles: jest.fn().mockResolvedValue([]),
        upsertArticle: jest.fn().mockRejectedValue(new Error('DDB down')),
      },
    });
    await expect(runArticleIngest(deps)).rejects.toThrow('DDB down');
    expect(deps.store.setWatermark).not.toHaveBeenCalled();
    expect(deps.publisher.publishLinks).not.toHaveBeenCalled();
  });
});
