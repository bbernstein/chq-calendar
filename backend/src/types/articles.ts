/** A chqdaily.com article normalized from the WordPress REST API. */
export interface DailyArticle {
  wpPostId: number;
  title: string;
  /** Canonical article URL on chqdaily.com. */
  link: string;
  /** WP `date` — site-local (US/Eastern) ISO, e.g. "2026-07-14T19:33:12". */
  pubDate: string;
  /** WP `modified` — site-local ISO. */
  modified: string;
  /** Resolved category names (not IDs). */
  categories: string[];
  /** Resolved tag names (not IDs). */
  tags: string[];
  /** HTML-stripped excerpt. */
  excerptText: string;
  /** HTML-stripped full body (stored for Phase 2 AI matching; used lightly by v1 matcher). */
  bodyText: string;
}

/** DynamoDB row: DailyArticle plus bookkeeping. */
export interface StoredArticle extends DailyArticle {
  /** Hash of matcher-relevant fields; drives incremental rematching. */
  contentHash: string;
  firstSeenAt: string;
}

/** Minimal event shape the matcher needs, parsed from the events JSON. */
export interface CalendarEventLite {
  id: string;
  title: string;
  /** Site-local ISO, e.g. "2026-07-15T10:45:00". */
  startDate: string;
  location?: string;
  venue?: { name?: string };
  category?: string;
  categories?: Array<{ name: string }>;
  presenter?: string;
}

export type ArticleLinkKind = 'preview' | 'recap';

/** One entry in the published sidecar. */
export interface PublishedArticleLink {
  title: string;
  url: string;
  kind: ArticleLinkKind;
  /** YYYY-MM-DD (site-local). */
  pubDate: string;
}

/** Shape of cache/calendar-cache/article-links-<year>.json. */
export interface ArticleLinksFile {
  generatedAt: string;
  matcherVersion: number;
  links: Record<string, PublishedArticleLink[]>;
}

/** One above-threshold (article, event) match kept in private state. */
export interface MatchRecord {
  eventId: string;
  wpPostId: number;
  score: number;
  reasons: string[];
  kind: ArticleLinkKind;
}

/** Private S3 state enabling incremental recompute across runs. */
export interface MatchState {
  matcherVersion: number;
  /** String(wpPostId) -> contentHash */
  articleHashes: Record<string, string>;
  /** eventId -> fingerprint */
  eventFingerprints: Record<string, string>;
  matches: MatchRecord[];
}
