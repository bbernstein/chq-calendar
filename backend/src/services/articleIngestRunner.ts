import type { ChqDailyClient } from './chqDailyClient';
import type { ArticleStore } from './articleStore';
import type { EventSnapshotLoader } from './eventSnapshotLoader';
import type { ArticleLinksPublisher } from './articleLinksPublisher';
import type { StoredArticle } from '../types/articles';
import { computeArticleContentHash, computeMatchState, MATCHER_VERSION } from './articleMatcher';

/** First-run backfill starts here (pre-season coverage begins in June). */
export const BACKFILL_START_MONTH_DAY = '06-01';
/**
 * Watermark trails `now` by this overlap so WP timezone quirks around
 * `modified_after` can never permanently skip a post. Re-fetched posts are
 * cheap: unchanged contentHash short-circuits both the write and the rematch.
 */
export const WATERMARK_OVERLAP_MS = 6 * 60 * 60 * 1000;

export interface ArticleIngestDeps {
  client: ChqDailyClient;
  store: ArticleStore;
  loader: EventSnapshotLoader;
  publisher: ArticleLinksPublisher;
  now: Date;
  year: number;
}

export interface ArticleIngestSummary {
  fetched: number;
  upserted: number;
  articlesTotal: number;
  eventsTotal: number;
  matchedEvents: number;
  linksPublished: boolean;
}

/**
 * One ingest cycle: pull changed posts, archive them, incrementally rematch,
 * publish the sidecar when the link set changed. Any thrown error aborts the
 * run before the watermark advances — the next hourly run re-covers the gap.
 */
export async function runArticleIngest(deps: ArticleIngestDeps): Promise<ArticleIngestSummary> {
  const { client, store, loader, publisher, now, year } = deps;

  const watermark = (await store.getWatermark()) ?? `${year}-${BACKFILL_START_MONTH_DAY}T00:00:00`;
  const fetchedPosts = await client.fetchPostsModifiedSince(watermark);

  const existing = await store.listAllArticles();
  const byId = new Map<number, StoredArticle>(existing.map(a => [a.wpPostId, a]));
  let upserted = 0;
  for (const post of fetchedPosts) {
    const contentHash = computeArticleContentHash(post);
    const prev = byId.get(post.wpPostId);
    if (prev && prev.contentHash === contentHash) continue;
    const row: StoredArticle = {
      ...post,
      contentHash,
      firstSeenAt: prev?.firstSeenAt ?? now.toISOString(),
    };
    await store.upsertArticle(row);
    byId.set(post.wpPostId, row);
    upserted++;
  }

  const articles = [...byId.values()];
  const events = await loader.load(year);
  const prevState = await publisher.loadState(year);
  const { state, links, linksChanged, stateChanged } = computeMatchState({ articles, events, prevState });

  const linksPublished = linksChanged || prevState == null;
  if (linksPublished) {
    await publisher.publishLinks(year, {
      generatedAt: now.toISOString(),
      matcherVersion: MATCHER_VERSION,
      links,
    });
  }
  if (stateChanged || prevState == null) {
    await publisher.saveState(year, state);
  }

  await store.setWatermark(new Date(now.getTime() - WATERMARK_OVERLAP_MS).toISOString());

  const summary: ArticleIngestSummary = {
    fetched: fetchedPosts.length,
    upserted,
    articlesTotal: articles.length,
    eventsTotal: events.length,
    matchedEvents: Object.keys(links).length,
    linksPublished,
  };
  console.log('[article-ingest] summary:', JSON.stringify(summary));
  return summary;
}
