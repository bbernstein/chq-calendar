# Chautauquan Daily Article Links — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hourly Lambda ingests Chautauquan Daily articles (full body) from the chqdaily.com WordPress REST API, heuristically matches them to calendar events, and publishes an `article-links-<year>.json` sidecar that the frontend renders as newspaper links on event cards.

**Architecture:** Mirrors the publisher-ingest pattern: new EventBridge-scheduled Lambda → DynamoDB article archive → pure deterministic matcher (incremental via contentHash/event fingerprints) → S3 sidecar on the existing `cache/calendar-cache` path → `useArticleLinks` hook → EventCard UI. Spec: `docs/superpowers/specs/2026-07-15-chqdaily-article-links-design.md`.

**Tech Stack:** TypeScript, AWS Lambda (Node 24), DynamoDB, S3/CloudFront, Terraform, jest (backend), Vite + Preact + vitest (frontend), cheerio (HTML→text).

## Global Constraints

- Work on branch `feature/chqdaily-article-links` (already created). NEVER commit to `main`.
- Backend lint runs `--max-warnings=0`: any ESLint warning fails the build.
- Coverage floors (`.coverage-floor.json`): backend lines ≥ 81.1, frontend lines ≥ 74.3. Handlers (`src/handlers/*`) and scripts are excluded from backend coverage — put all logic in `src/services/`.
- Backend tests: jest, files at `backend/src/__tests__/<name>.test.ts`. Frontend tests: vitest globals + `@testing-library/preact`, files under `frontend/src/__tests__/`.
- Frontend files that render JSX import hooks/types from `'react'` (aliased to preact/compat); pure `.ts` files may use `'preact/hooks'`.
- Backend DynamoDB mocking convention: hand-rolled `{ send: jest.fn() }` cast to the client type (see `publisherIngestRunStore.test.ts`).
- All backend commands run from `backend/`, frontend from `frontend/`.
- Constants co-versioned with the matcher: `MATCHER_VERSION = 1`, `MATCH_THRESHOLD = 0.6`, `MAX_LINKS_PER_EVENT = 4`.
- Event/article dates compare as site-local calendar dates (both chq.org events and chqdaily WP `date` are US/Eastern local, no offset suffix).
- New Lambda env vars require `terraform apply` after merge (deploy note, not a code task).

---

### Task 1: Backend types + HTML-to-text utility

**Files:**
- Create: `backend/src/types/articles.ts`
- Create: `backend/src/utils/htmlToText.ts`
- Test: `backend/src/__tests__/htmlToText.test.ts`

**Interfaces:**
- Consumes: nothing (foundation task).
- Produces: all article/matcher types listed below, and `htmlToText(html: string): string` — every later backend task imports from these two files. Exact type shapes below are load-bearing; later tasks use them verbatim.

- [ ] **Step 1: Write the types file** (no test — types only)

```ts
// backend/src/types/articles.ts

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
```

- [ ] **Step 2: Write the failing htmlToText test**

```ts
// backend/src/__tests__/htmlToText.test.ts
import { htmlToText } from '../utils/htmlToText';

describe('htmlToText', () => {
  test('strips tags and collapses whitespace', () => {
    expect(htmlToText('<p>Hello <strong>world</strong></p>\n<p>Second&nbsp;para</p>'))
      .toBe('Hello world Second para');
  });

  test('decodes HTML entities', () => {
    expect(htmlToText('Fiedler &amp; Capretta &#8212; 10:45 a.m.')).toBe('Fiedler & Capretta — 10:45 a.m.');
  });

  test('returns empty string for empty/undefined-ish input', () => {
    expect(htmlToText('')).toBe('');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `backend/`): `npx jest src/__tests__/htmlToText.test.ts`
Expected: FAIL — `Cannot find module '../utils/htmlToText'`

- [ ] **Step 4: Write the implementation**

```ts
// backend/src/utils/htmlToText.ts
import * as cheerio from 'cheerio';

/**
 * Strip HTML to plain text: tags removed, entities decoded, whitespace
 * collapsed to single spaces. Used on WP `title/excerpt/content.rendered`.
 */
export function htmlToText(html: string): string {
  if (!html) return '';
  const $ = cheerio.load(html);
  return $.root().text().replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/__tests__/htmlToText.test.ts`
Expected: PASS (3 tests). Also run `npm run type-check` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/types/articles.ts src/utils/htmlToText.ts src/__tests__/htmlToText.test.ts
git commit -m "feat(articles): article/matcher types and htmlToText utility"
```

---

### Task 2: ChqDailyClient — WordPress REST fetcher

**Files:**
- Create: `backend/src/services/chqDailyClient.ts`
- Create: `backend/src/__tests__/fixtures/chqdaily-posts.json`
- Test: `backend/src/__tests__/chqDailyClient.test.ts`

**Interfaces:**
- Consumes: `DailyArticle` from `../types/articles`, `htmlToText` from `../utils/htmlToText`.
- Produces: `class ChqDailyClient { constructor(fetchFn?: typeof fetch, baseUrl?: string); fetchPostsModifiedSince(sinceIso: string): Promise<DailyArticle[]> }`. Task 7's runner calls exactly `client.fetchPostsModifiedSince(watermark)`.

- [ ] **Step 1: Create the fixture** (shape captured from the live API 2026-07-15)

```json
// backend/src/__tests__/fixtures/chqdaily-posts.json
[
  {
    "id": 90210,
    "date": "2026-07-14T07:00:12",
    "modified": "2026-07-14T19:33:12",
    "link": "https://chqdaily.com/2026/07/najeeba-syeed-interfaith/",
    "title": { "rendered": "Najeeba Syeed speaks &#8216;from the broken heart of democracy&#8217;" },
    "excerpt": { "rendered": "<p>Najeeba Syeed delivered her lecture at 2 p.m. Tuesday in the Hall of Philosophy&hellip;</p>" },
    "content": { "rendered": "<p>Najeeba Syeed delivered her Interfaith Lecture at 2 p.m. Tuesday in the Hall of Philosophy.</p><p>She spoke on peace.</p>" },
    "categories": [25, 1786],
    "tags": [274, 337]
  },
  {
    "id": 90311,
    "date": "2026-07-15T06:30:00",
    "modified": "2026-07-15T06:30:00",
    "link": "https://chqdaily.com/2026/07/cso-preview/",
    "title": { "rendered": "CSO to perform Beethoven under the stars" },
    "excerpt": { "rendered": "<p>The Chautauqua Symphony Orchestra performs at 8:15 p.m. tonight in the Amphitheater.</p>" },
    "content": { "rendered": "<p>The Chautauqua Symphony Orchestra performs at 8:15 p.m. tonight in the Amphitheater.</p>" },
    "categories": [10, 44],
    "tags": [512]
  }
]
```

- [ ] **Step 2: Write the failing tests**

```ts
// backend/src/__tests__/chqDailyClient.test.ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest src/__tests__/chqDailyClient.test.ts`
Expected: FAIL — `Cannot find module '../services/chqDailyClient'`

- [ ] **Step 4: Write the implementation**

```ts
// backend/src/services/chqDailyClient.ts
import { htmlToText } from '../utils/htmlToText';
import type { DailyArticle } from '../types/articles';

const DEFAULT_BASE_URL = 'https://chqdaily.com/wp-json/wp/v2';
const USER_AGENT = 'chqcal.org article-linker (https://www.chqcal.org)';
const PER_PAGE = 100;
/** Hard cap: 30 pages × 100 posts. A full season publishes well under this. */
const MAX_PAGES = 30;
const REQUEST_TIMEOUT_MS = 10_000;
const POST_FIELDS = 'id,date,modified,link,title,excerpt,content,categories,tags';

interface WpRenderedField { rendered: string }
interface WpPost {
  id: number;
  date: string;
  modified: string;
  link: string;
  title: WpRenderedField;
  excerpt: WpRenderedField;
  content: WpRenderedField;
  categories: number[];
  tags: number[];
}
interface WpTerm { id: number; name: string }

/**
 * Read-only client for the chqdaily.com WordPress REST API. Sequential,
 * politely-paced requests; throws on any non-2xx so the caller aborts the
 * run without advancing its watermark.
 */
export class ChqDailyClient {
  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  private async getJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await this.fetchFn(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`chqdaily request failed: ${res.status} ${url}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Page through a WP collection endpoint until a short page or MAX_PAGES. */
  private async getAllPages<T>(pathAndQuery: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const sep = pathAndQuery.includes('?') ? '&' : '?';
      const batch = await this.getJson<T[]>(
        `${this.baseUrl}${pathAndQuery}${sep}per_page=${PER_PAGE}&page=${page}`,
      );
      out.push(...batch);
      if (batch.length < PER_PAGE) break;
    }
    return out;
  }

  private async fetchTaxonomy(kind: 'categories' | 'tags'): Promise<Map<number, string>> {
    const terms = await this.getAllPages<WpTerm>(`/${kind}?_fields=id,name`);
    return new Map(terms.map(t => [t.id, htmlToText(t.name)]));
  }

  /**
   * Fetch all posts modified since `sinceIso` (site-local ISO8601), with
   * category/tag IDs resolved to names and HTML stripped. Full body comes
   * from content.rendered — no article-page crawl needed.
   */
  async fetchPostsModifiedSince(sinceIso: string): Promise<DailyArticle[]> {
    const [catMap, tagMap] = [await this.fetchTaxonomy('categories'), await this.fetchTaxonomy('tags')];
    const posts = await this.getAllPages<WpPost>(
      `/posts?modified_after=${encodeURIComponent(sinceIso)}&_fields=${POST_FIELDS}`,
    );
    return posts.map(p => ({
      wpPostId: p.id,
      title: htmlToText(p.title?.rendered ?? ''),
      link: p.link,
      pubDate: p.date,
      modified: p.modified,
      categories: (p.categories ?? []).map(id => catMap.get(id)).filter((n): n is string => !!n),
      tags: (p.tags ?? []).map(id => tagMap.get(id)).filter((n): n is string => !!n),
      excerptText: htmlToText(p.excerpt?.rendered ?? ''),
      bodyText: htmlToText(p.content?.rendered ?? ''),
    }));
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/__tests__/chqDailyClient.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/services/chqDailyClient.ts src/__tests__/chqDailyClient.test.ts src/__tests__/fixtures/chqdaily-posts.json
git commit -m "feat(articles): ChqDailyClient — paginated WP REST ingestion with taxonomy resolution"
```

---

### Task 3: ArticleStore — DynamoDB archive + watermark

**Files:**
- Create: `backend/src/services/articleStore.ts`
- Test: `backend/src/__tests__/articleStore.test.ts`

**Interfaces:**
- Consumes: `StoredArticle` from `../types/articles`.
- Produces: `class ArticleStore { constructor(db: DynamoDBDocumentClient, tableName: string); upsertArticle(a: StoredArticle): Promise<void>; listAllArticles(): Promise<StoredArticle[]>; getWatermark(): Promise<string | undefined>; setWatermark(iso: string): Promise<void> }`. Table uses a single string hash key `pk`: articles at `ARTICLE#<wpPostId>`, watermark at `META#watermark`.

- [ ] **Step 1: Write the failing tests**

```ts
// backend/src/__tests__/articleStore.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/articleStore.test.ts`
Expected: FAIL — `Cannot find module '../services/articleStore'`

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/services/articleStore.ts
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import type { StoredArticle } from '../types/articles';

const WATERMARK_PK = 'META#watermark';

/**
 * Durable season archive of chqdaily articles plus the ingest watermark.
 * Single-table, string hash key `pk`: `ARTICLE#<wpPostId>` | `META#watermark`.
 */
export class ArticleStore {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async upsertArticle(a: StoredArticle): Promise<void> {
    await this.db.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { pk: `ARTICLE#${a.wpPostId}`, ...a },
      }),
    );
  }

  async listAllArticles(): Promise<StoredArticle[]> {
    const out: StoredArticle[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await this.db.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: 'begins_with(pk, :p)',
          ExpressionAttributeValues: { ':p': 'ARTICLE#' },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of page.Items ?? []) {
        // Copy-then-delete instead of rest-destructuring: the discarded `pk`
        // binding would trip no-unused-vars under --max-warnings=0.
        const copy = { ...(item as StoredArticle & { pk?: string }) };
        delete copy.pk;
        out.push(copy as StoredArticle);
      }
      startKey = page.LastEvaluatedKey;
    } while (startKey);
    return out;
  }

  async getWatermark(): Promise<string | undefined> {
    const out = await this.db.send(
      new GetCommand({ TableName: this.tableName, Key: { pk: WATERMARK_PK } }),
    );
    return (out.Item as { value?: string } | undefined)?.value;
  }

  async setWatermark(iso: string): Promise<void> {
    await this.db.send(
      new PutCommand({ TableName: this.tableName, Item: { pk: WATERMARK_PK, value: iso } }),
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/articleStore.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/articleStore.ts src/__tests__/articleStore.test.ts
git commit -m "feat(articles): ArticleStore — DynamoDB article archive and ingest watermark"
```

---

### Task 4: Matcher part 1 — pair scoring, hashes, fingerprints

**Files:**
- Create: `backend/src/services/articleMatcher.ts`
- Test: `backend/src/__tests__/articleMatcher.test.ts`

**Interfaces:**
- Consumes: `StoredArticle`, `CalendarEventLite`, `ArticleLinkKind` from `../types/articles`; node `crypto`.
- Produces (Task 5 extends this same file):
  - `MATCHER_VERSION = 1`, `MATCH_THRESHOLD = 0.6`, `MAX_LINKS_PER_EVENT = 4`
  - `scorePair(article: StoredArticle, event: CalendarEventLite): PairScore | null` where `PairScore = { score: number; reasons: string[]; kind: ArticleLinkKind }`
  - `computeArticleContentHash(a: DailyArticle): string`
  - `computeEventFingerprint(e: CalendarEventLite): string`
  - `formatEventTimeAsPrinted(startDate: string): string | null` (exported for tests)

- [ ] **Step 1: Write the failing tests**

```ts
// backend/src/__tests__/articleMatcher.test.ts
import {
  scorePair,
  computeArticleContentHash,
  computeEventFingerprint,
  formatEventTimeAsPrinted,
  MATCH_THRESHOLD,
} from '../services/articleMatcher';
import type { StoredArticle, CalendarEventLite } from '../types/articles';

function article(overrides: Partial<StoredArticle> = {}): StoredArticle {
  return {
    wpPostId: 1,
    title: 'Najeeba Syeed speaks from the broken heart of democracy',
    link: 'https://chqdaily.com/a1/',
    pubDate: '2026-07-15T06:30:00',
    modified: '2026-07-15T06:30:00',
    categories: ['Interfaith Lecture', 'Hall of Philosophy'],
    tags: ['Najeeba Syeed'],
    excerptText: 'Najeeba Syeed speaks at 2 p.m. today in the Hall of Philosophy.',
    bodyText: 'Najeeba Syeed speaks at 2 p.m. today in the Hall of Philosophy about interfaith peace.',
    contentHash: 'x',
    firstSeenAt: '2026-07-15T07:00:00.000Z',
    ...overrides,
  };
}

function event(overrides: Partial<CalendarEventLite> = {}): CalendarEventLite {
  return {
    id: 'e1',
    title: 'Interfaith Lecture: From the Broken Heart of Democracy',
    startDate: '2026-07-15T14:00:00',
    venue: { name: 'Hall of Philosophy' },
    category: 'Interfaith Lecture Series',
    presenter: 'Najeeba Syeed',
    ...overrides,
  };
}

describe('formatEventTimeAsPrinted', () => {
  test.each([
    ['2026-07-15T10:45:00', '10:45 a.m.'],
    ['2026-07-15T14:00:00', '2 p.m.'],
    ['2026-07-15T20:15:00', '8:15 p.m.'],
    ['2026-07-15T12:00:00', '12 p.m.'],
    ['2026-07-15T00:30:00', '12:30 a.m.'],
  ])('%s → %s', (iso, printed) => {
    expect(formatEventTimeAsPrinted(iso)).toBe(printed);
  });

  test('returns null for unparseable input', () => {
    expect(formatEventTimeAsPrinted('garbage')).toBeNull();
  });
});

describe('scorePair', () => {
  test('preview with venue + person + same-day printed time scores far above threshold', () => {
    const r = scorePair(article(), event());
    expect(r).not.toBeNull();
    expect(r!.score).toBeGreaterThan(MATCH_THRESHOLD);
    expect(r!.kind).toBe('preview');
    expect(r!.reasons).toEqual(expect.arrayContaining(['venue-category', 'people', 'time-of-day']));
  });

  test('event outside the [-3, +7] day window is gated to null', () => {
    expect(scorePair(article(), event({ startDate: '2026-08-15T14:00:00' }))).toBeNull();
    expect(scorePair(article(), event({ startDate: '2026-07-01T14:00:00' }))).toBeNull();
  });

  test('venue alias: body says "the Amp", event venue is Amphitheater', () => {
    const a = article({
      categories: ['Symphony'],
      tags: [],
      title: 'CSO to perform Beethoven under the stars',
      bodyText: 'The Chautauqua Symphony Orchestra performs at 8:15 p.m. tonight in the Amp.',
      excerptText: '',
    });
    const e = event({
      title: 'Chautauqua Symphony Orchestra: Beethoven',
      startDate: '2026-07-15T20:15:00',
      venue: { name: 'Amphitheater' },
      category: 'Symphony',
      presenter: undefined,
    });
    const r = scorePair(a, e);
    expect(r).not.toBeNull();
    expect(r!.reasons).toEqual(expect.arrayContaining(['venue-body', 'time-of-day']));
  });

  test('recurring-slot disambiguation: same venue+time daily lecture matches the right speaker day', () => {
    const a = article({
      title: 'Jane Marlow to open Week Four lectures',
      tags: ['Jane Marlow'],
      categories: ['Lectures', 'Amphitheater'],
      bodyText: 'Jane Marlow speaks at 10:45 a.m. today in the Amphitheater.',
      excerptText: '',
      pubDate: '2026-07-15T06:00:00',
    });
    const rightDay = event({
      id: 'lecture-wed', title: 'Morning Lecture', startDate: '2026-07-15T10:45:00',
      venue: { name: 'Amphitheater' }, category: 'Morning Lecture', presenter: 'Jane Marlow',
    });
    const wrongDay = event({
      id: 'lecture-thu', title: 'Morning Lecture', startDate: '2026-07-16T10:45:00',
      venue: { name: 'Amphitheater' }, category: 'Morning Lecture', presenter: 'Bob Chen',
    });
    const right = scorePair(a, rightDay);
    const wrong = scorePair(a, wrongDay);
    expect(right).not.toBeNull();
    // Wrong day: venue matches but no person, no same-day time → below threshold
    expect(wrong).toBeNull();
    expect(right!.score).toBeGreaterThan(MATCH_THRESHOLD);
  });

  test('recap: "Lecture Recap" tag or post-event pubDate classifies as recap', () => {
    const tagged = scorePair(article({ tags: ['Najeeba Syeed', 'Lecture Recap'] }), event());
    expect(tagged!.kind).toBe('recap');

    const postEvent = scorePair(
      article({ pubDate: '2026-07-16T06:00:00', bodyText: 'Najeeba Syeed spoke in the Hall of Philosophy.', excerptText: '' }),
      event(),
    );
    expect(postEvent).not.toBeNull();
    expect(postEvent!.kind).toBe('recap');
  });

  test('weak signals alone (category + proximity only) stay below threshold', () => {
    const a = article({
      title: 'Around the grounds this week',
      tags: [],
      categories: ['Lectures'],
      bodyText: 'A roundup of happenings.',
      excerptText: '',
    });
    const e = event({ title: 'Morning Lecture', presenter: 'Someone Else', venue: { name: 'Smith Wilkes Hall' }, category: 'Lectures' });
    expect(scorePair(a, e)).toBeNull();
  });
});

describe('hashes and fingerprints', () => {
  test('contentHash changes with body text, stable otherwise', () => {
    const a = article();
    const h1 = computeArticleContentHash(a);
    expect(computeArticleContentHash({ ...a })).toBe(h1);
    expect(computeArticleContentHash({ ...a, bodyText: 'edited' })).not.toBe(h1);
    // modified timestamp alone does NOT change the hash (layout-only edit)
    expect(computeArticleContentHash({ ...a, modified: '2026-07-16T00:00:00' })).toBe(h1);
  });

  test('event fingerprint changes with startDate, stable across irrelevant fields', () => {
    const e = event();
    const f1 = computeEventFingerprint(e);
    expect(computeEventFingerprint({ ...e })).toBe(f1);
    expect(computeEventFingerprint({ ...e, startDate: '2026-07-16T14:00:00' })).not.toBe(f1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/articleMatcher.test.ts`
Expected: FAIL — `Cannot find module '../services/articleMatcher'`

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/services/articleMatcher.ts
import { createHash } from 'crypto';
import type {
  ArticleLinkKind,
  CalendarEventLite,
  DailyArticle,
  StoredArticle,
} from '../types/articles';

/**
 * Bump when weights, threshold, aliases, or signal logic change — forces a
 * one-time full recompute so scoring improvements apply retroactively.
 */
export const MATCHER_VERSION = 1;
export const MATCH_THRESHOLD = 0.6;
export const MAX_LINKS_PER_EVENT = 4;

const WEIGHTS = {
  venue: 0.3,
  people: 0.35,
  timeOfDay: 0.4,
  category: 0.15,
  proximityMax: 0.1,
} as const;

/** Event date must fall within [pubDate - RECAP_DAYS, pubDate + PREVIEW_DAYS]. */
const RECAP_WINDOW_DAYS = 3;
const PREVIEW_WINDOW_DAYS = 7;

/** canonical (normalized) venue → aliases as they appear in Daily copy. */
const VENUE_ALIASES: Record<string, string[]> = {
  amphitheater: ['amp', 'the amp', 'amphitheatre'],
  'elizabeth s lenna hall': ['lenna hall'],
  'bratton theater': ['bratton theatre'],
};

const STOPWORDS = new Set([
  'the', 'and', 'with', 'from', 'that', 'this', 'for', 'week',
  'chautauqua', 'institution', 'series', 'lecture', 'lectures', 'morning',
  'afternoon', 'evening', 'event', 'events', 'presents', 'present', 'special',
  'featuring', 'performance', 'concert', 'program', 'daily', 'season', 'opens',
]);

export interface PairScore {
  score: number;
  reasons: string[];
  kind: ArticleLinkKind;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Local calendar date (YYYY-MM-DD) from a site-local ISO string. */
function localDate(iso: string): string {
  return iso.slice(0, 10);
}

/** Whole days from dateB to dateA (both YYYY-MM-DD). */
function dayDiff(dateA: string, dateB: string): number {
  const [ay, am, ad] = dateA.split('-').map(Number);
  const [by, bm, bd] = dateB.split('-').map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
}

/**
 * Render an event start time the way the Daily prints it: "10:45 a.m.",
 * "2 p.m.", "12 p.m." (noon). Returns null when startDate has no parseable
 * HH:MM component.
 */
export function formatEventTimeAsPrinted(startDate: string): string | null {
  const m = startDate.match(/T(\d{2}):(\d{2})/);
  if (!m) return null;
  const hour24 = Number(m[1]);
  const minute = Number(m[2]);
  if (hour24 > 23 || minute > 59) return null;
  const ampm = hour24 < 12 ? 'a.m.' : 'p.m.';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return minute === 0 ? `${hour12} ${ampm}` : `${hour12}:${String(minute).padStart(2, '0')} ${ampm}`;
}

/** Canonical venue key for comparison; unknown venues normalize to themselves. */
function canonicalVenue(name: string): string {
  const n = normalize(name);
  if (!n) return '';
  for (const [canon, aliases] of Object.entries(VENUE_ALIASES)) {
    if (n === canon || aliases.includes(n)) return canon;
  }
  return n;
}

/** True when the normalized text mentions the canonical venue or an alias. */
function venueMentioned(normalizedText: string, canonVenue: string): boolean {
  const names = [canonVenue, ...(VENUE_ALIASES[canonVenue] ?? [])];
  return names.some(v => v.length > 2 && normalizedText.includes(` ${v} `));
}

function distinctiveTokens(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter(t => t.length >= 4 && !STOPWORDS.has(t));
}

function eventCategoryNames(e: CalendarEventLite): string[] {
  const names = (e.categories ?? []).map(c => c.name);
  if (e.category) names.push(e.category);
  return names;
}

/**
 * Score one (article, event) pair. Returns null below MATCH_THRESHOLD or
 * outside the date gate. Deterministic; no I/O.
 */
export function scorePair(article: StoredArticle, event: CalendarEventLite): PairScore | null {
  const eventDate = localDate(event.startDate);
  const pubDate = localDate(article.pubDate);
  const diff = dayDiff(eventDate, pubDate); // >0: article precedes event (preview direction)
  if (diff < -RECAP_WINDOW_DAYS || diff > PREVIEW_WINDOW_DAYS) return null;

  let score = 0;
  const reasons: string[] = [];
  const normBody = ` ${normalize(`${article.excerptText} ${article.bodyText}`)} `;

  // Venue
  const eventVenue = canonicalVenue(event.venue?.name ?? event.location ?? '');
  if (eventVenue) {
    if (article.categories.some(c => canonicalVenue(c) === eventVenue)) {
      score += WEIGHTS.venue;
      reasons.push('venue-category');
    } else if (venueMentioned(normBody, eventVenue)) {
      score += WEIGHTS.venue;
      reasons.push('venue-body');
    }
  }

  // People / title overlap
  const articleTokens = new Set(distinctiveTokens(`${article.title} ${article.tags.join(' ')}`));
  const presenterTokens = distinctiveTokens(event.presenter ?? '');
  const surname = presenterTokens[presenterTokens.length - 1];
  const titleOverlap = distinctiveTokens(event.title).filter(t => articleTokens.has(t));
  if ((surname && articleTokens.has(surname)) || titleOverlap.length >= 2) {
    score += WEIGHTS.people;
    reasons.push('people');
  }

  // Time-of-day: printed start time + today/tonight on the event's own day
  if (diff === 0) {
    const printed = formatEventTimeAsPrinted(event.startDate);
    const rawText = `${article.excerptText} ${article.bodyText}`.toLowerCase();
    if (
      printed &&
      rawText.includes(printed) &&
      /\b(today|tonight|this morning|this afternoon|this evening)\b/.test(rawText)
    ) {
      score += WEIGHTS.timeOfDay;
      reasons.push('time-of-day');
    }
  }

  // Category alignment: any distinctive token shared between taxonomies
  const articleCatTokens = new Set(article.categories.flatMap(distinctiveTokens));
  const aligned = eventCategoryNames(event).some(name =>
    distinctiveTokens(name).some(t => articleCatTokens.has(t)),
  );
  if (aligned) {
    score += WEIGHTS.category;
    reasons.push('category');
  }

  // Date proximity (tiebreaker between recurring events)
  score += WEIGHTS.proximityMax * (1 - Math.min(Math.abs(diff), PREVIEW_WINDOW_DAYS) / PREVIEW_WINDOW_DAYS);

  if (score < MATCH_THRESHOLD) return null;

  const isRecapTagged = [...article.categories, ...article.tags].some(c => /recap/i.test(c));
  const kind: ArticleLinkKind = isRecapTagged || diff < 0 ? 'recap' : 'preview';
  return { score: Math.min(1, Number(score.toFixed(4))), reasons, kind };
}

export function computeArticleContentHash(a: DailyArticle): string {
  return createHash('sha256')
    .update(JSON.stringify([a.title, a.bodyText, a.excerptText, a.categories, a.tags, a.pubDate]))
    .digest('hex');
}

export function computeEventFingerprint(e: CalendarEventLite): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        e.id,
        e.title,
        e.startDate,
        e.location ?? null,
        e.venue?.name ?? null,
        e.category ?? null,
        (e.categories ?? []).map(c => c.name),
        e.presenter ?? null,
      ]),
    )
    .digest('hex');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/articleMatcher.test.ts`
Expected: PASS (all tests). If a scoring test fails, fix weights/logic — do NOT weaken the test's intent (the recurring-slot and weak-signals cases are the precision guarantees).

- [ ] **Step 5: Commit**

```bash
git add src/services/articleMatcher.ts src/__tests__/articleMatcher.test.ts
git commit -m "feat(articles): heuristic pair scorer with venue/people/time signals + hashes"
```

---

### Task 5: Matcher part 2 — incremental match-state computation

**Files:**
- Modify: `backend/src/services/articleMatcher.ts` (append)
- Test: `backend/src/__tests__/articleMatcher.incremental.test.ts`

**Interfaces:**
- Consumes: everything from Task 4; `MatchState`, `MatchRecord`, `PublishedArticleLink` types.
- Produces:
  - `computeMatchState(input: { articles: StoredArticle[]; events: CalendarEventLite[]; prevState?: MatchState }): MatchComputation`
  - `type MatchComputation = { state: MatchState; links: Record<string, PublishedArticleLink[]>; linksChanged: boolean; stateChanged: boolean }`
  - Task 7's runner calls exactly `computeMatchState({ articles, events, prevState })`.

- [ ] **Step 1: Write the failing tests**

```ts
// backend/src/__tests__/articleMatcher.incremental.test.ts
import {
  computeMatchState,
  computeArticleContentHash,
  MATCHER_VERSION,
} from '../services/articleMatcher';
import type { StoredArticle, CalendarEventLite, MatchState } from '../types/articles';

function article(overrides: Partial<StoredArticle> = {}): StoredArticle {
  const base: StoredArticle = {
    wpPostId: 1,
    title: 'Najeeba Syeed speaks from the broken heart of democracy',
    link: 'https://chqdaily.com/a1/',
    pubDate: '2026-07-15T06:30:00',
    modified: '2026-07-15T06:30:00',
    categories: ['Interfaith Lecture', 'Hall of Philosophy'],
    tags: ['Najeeba Syeed'],
    excerptText: '',
    bodyText: 'Najeeba Syeed speaks at 2 p.m. today in the Hall of Philosophy.',
    contentHash: '',
    firstSeenAt: '2026-07-15T07:00:00.000Z',
    ...overrides,
  };
  base.contentHash = computeArticleContentHash(base);
  return base;
}

function event(overrides: Partial<CalendarEventLite> = {}): CalendarEventLite {
  return {
    id: 'e1',
    title: 'Interfaith Lecture: From the Broken Heart of Democracy',
    startDate: '2026-07-15T14:00:00',
    venue: { name: 'Hall of Philosophy' },
    category: 'Interfaith Lecture Series',
    presenter: 'Najeeba Syeed',
    ...overrides,
  };
}

describe('computeMatchState', () => {
  test('first run (no prevState): matches found, links built, both changed flags true', () => {
    const r = computeMatchState({ articles: [article()], events: [event()] });
    expect(r.linksChanged).toBe(true);
    expect(r.stateChanged).toBe(true);
    expect(r.state.matcherVersion).toBe(MATCHER_VERSION);
    expect(r.state.matches).toHaveLength(1);
    expect(r.links['e1']).toHaveLength(1);
    expect(r.links['e1'][0]).toEqual({
      title: 'Najeeba Syeed speaks from the broken heart of democracy',
      url: 'https://chqdaily.com/a1/',
      kind: 'preview',
      pubDate: '2026-07-15',
    });
  });

  test('no-op run: identical inputs against prev state → nothing changed', () => {
    const first = computeMatchState({ articles: [article()], events: [event()] });
    const second = computeMatchState({ articles: [article()], events: [event()], prevState: first.state });
    expect(second.linksChanged).toBe(false);
    expect(second.stateChanged).toBe(false);
    expect(second.state.matches).toEqual(first.state.matches);
  });

  test('unchanged pairs are carried over without rescoring; changed article is rescored', () => {
    const a1 = article();
    const a2 = article({ wpPostId: 2, link: 'https://chqdaily.com/a2/', title: 'CSO under the stars', tags: [], categories: ['Symphony', 'Amphitheater'], bodyText: 'The CSO performs at 8:15 p.m. tonight in the Amphitheater.' });
    const e1 = event();
    const e2 = event({ id: 'e2', title: 'Chautauqua Symphony Orchestra', startDate: '2026-07-15T20:15:00', venue: { name: 'Amphitheater' }, category: 'Symphony', presenter: undefined });
    const first = computeMatchState({ articles: [a1, a2], events: [e1, e2] });
    expect(Object.keys(first.links).sort()).toEqual(['e1', 'e2']);

    // Edit a2's body so it no longer matches anything
    const a2edited = article({ ...a2, bodyText: 'Rain check: performance moved.', categories: ['News'] });
    const second = computeMatchState({ articles: [a1, a2edited], events: [e1, e2], prevState: first.state });
    expect(second.links['e1']).toEqual(first.links['e1']); // carried over
    expect(second.links['e2']).toBeUndefined();            // rescored away
    expect(second.linksChanged).toBe(true);
  });

  test('changed event fingerprint dirties that event against all articles', () => {
    const first = computeMatchState({ articles: [article()], events: [event()] });
    // Event moved a month out → date gate now excludes the pair
    const moved = event({ startDate: '2026-08-20T14:00:00' });
    const second = computeMatchState({ articles: [article()], events: [moved], prevState: first.state });
    expect(second.links['e1']).toBeUndefined();
    expect(second.linksChanged).toBe(true);
  });

  test('removed article drops out of links and state', () => {
    const first = computeMatchState({ articles: [article()], events: [event()] });
    const second = computeMatchState({ articles: [], events: [event()], prevState: first.state });
    expect(second.state.matches).toHaveLength(0);
    expect(second.linksChanged).toBe(true);
  });

  test('matcherVersion mismatch forces full recompute', () => {
    const first = computeMatchState({ articles: [article()], events: [event()] });
    const staleState: MatchState = { ...first.state, matcherVersion: 0, matches: [] };
    const second = computeMatchState({ articles: [article()], events: [event()], prevState: staleState });
    expect(second.state.matches).toHaveLength(1); // recomputed despite empty prev matches
    expect(second.stateChanged).toBe(true);
  });

  test('links ordering: previews first, then by pubDate; capped at 4 per event', () => {
    const mk = (id: number, pub: string, tags: string[]) =>
      article({ wpPostId: id, link: `https://chqdaily.com/a${id}/`, pubDate: pub, tags: ['Najeeba Syeed', ...tags] });
    // 5 matching articles: 2 recaps (tagged), 3 previews
    const arts = [
      mk(1, '2026-07-16T06:00:00', ['Lecture Recap']),
      mk(2, '2026-07-14T06:00:00', []),
      mk(3, '2026-07-15T06:00:00', []),
      mk(4, '2026-07-17T06:00:00', ['Lecture Recap']),
      mk(5, '2026-07-13T06:00:00', []),
    ];
    const r = computeMatchState({ articles: arts, events: [event()] });
    const links = r.links['e1'];
    expect(links.length).toBeLessThanOrEqual(4);
    // all previews precede all recaps
    const kinds = links.map(l => l.kind);
    const firstRecap = kinds.indexOf('recap');
    const lastPreview = kinds.lastIndexOf('preview');
    expect(firstRecap).toBeGreaterThan(-1);
    expect(lastPreview).toBeLessThan(firstRecap);
    // previews sorted by pubDate ascending
    const previews = links.filter(l => l.kind === 'preview').map(l => l.pubDate);
    expect(previews).toEqual([...previews].sort());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/articleMatcher.incremental.test.ts`
Expected: FAIL — `computeMatchState is not a function` (or module export error)

- [ ] **Step 3: Append the implementation to `articleMatcher.ts`**

```ts
// backend/src/services/articleMatcher.ts  (append below Task 4 code)
import type { MatchRecord, MatchState, PublishedArticleLink } from '../types/articles';
// NOTE: merge these named imports into the existing import from '../types/articles'
// at the top of the file — TypeScript does not allow duplicate import statements
// from the same module path under the repo's lint rules.

export interface MatchComputation {
  state: MatchState;
  links: Record<string, PublishedArticleLink[]>;
  /** True when the published sidecar content would differ from the previous run. */
  linksChanged: boolean;
  /** True when the private state object needs re-saving. */
  stateChanged: boolean;
}

/** Canonical serialization of the match set, ignoring order. */
function canonicalMatches(matches: MatchRecord[]): string {
  return JSON.stringify(
    [...matches]
      .sort((a, b) => a.eventId.localeCompare(b.eventId) || a.wpPostId - b.wpPostId)
      .map(m => [m.eventId, m.wpPostId, m.kind, m.score]),
  );
}

function buildLinks(
  matches: MatchRecord[],
  articleById: Map<string, StoredArticle>,
): Record<string, PublishedArticleLink[]> {
  const byEvent = new Map<string, MatchRecord[]>();
  for (const m of matches) {
    if (!byEvent.has(m.eventId)) byEvent.set(m.eventId, []);
    byEvent.get(m.eventId)!.push(m);
  }
  const links: Record<string, PublishedArticleLink[]> = {};
  for (const [eventId, ms] of byEvent) {
    const top = [...ms].sort((a, b) => b.score - a.score).slice(0, MAX_LINKS_PER_EVENT);
    const entries = top
      .map(m => {
        const a = articleById.get(String(m.wpPostId));
        if (!a) return null;
        return { title: a.title, url: a.link, kind: m.kind, pubDate: a.pubDate.slice(0, 10) };
      })
      .filter((l): l is PublishedArticleLink => l !== null)
      .sort((x, y) =>
        x.kind === y.kind ? x.pubDate.localeCompare(y.pubDate) : x.kind === 'preview' ? -1 : 1,
      );
    if (entries.length > 0) links[eventId] = entries;
  }
  return links;
}

/**
 * Incremental matching: rescore only pairs involving a changed article or a
 * changed event; carry everything else over from prevState. A matcherVersion
 * mismatch (or missing prevState) forces a full recompute.
 */
export function computeMatchState(input: {
  articles: StoredArticle[];
  events: CalendarEventLite[];
  prevState?: MatchState;
}): MatchComputation {
  const { articles, events, prevState } = input;
  const fullRecompute = !prevState || prevState.matcherVersion !== MATCHER_VERSION;

  const articleById = new Map(articles.map(a => [String(a.wpPostId), a]));
  const eventIds = new Set(events.map(e => e.id));

  const articleHashes: Record<string, string> = {};
  const dirtyArticles = new Set<string>();
  for (const a of articles) {
    const key = String(a.wpPostId);
    articleHashes[key] = a.contentHash;
    if (fullRecompute || prevState!.articleHashes[key] !== a.contentHash) dirtyArticles.add(key);
  }

  const eventFingerprints: Record<string, string> = {};
  const dirtyEvents = new Set<string>();
  for (const e of events) {
    const fp = computeEventFingerprint(e);
    eventFingerprints[e.id] = fp;
    if (fullRecompute || prevState!.eventFingerprints[e.id] !== fp) dirtyEvents.add(e.id);
  }

  const kept = fullRecompute
    ? []
    : prevState!.matches.filter(
        m =>
          articleById.has(String(m.wpPostId)) &&
          eventIds.has(m.eventId) &&
          !dirtyArticles.has(String(m.wpPostId)) &&
          !dirtyEvents.has(m.eventId),
      );

  const rescored: MatchRecord[] = [];
  for (const a of articles) {
    const aDirty = dirtyArticles.has(String(a.wpPostId));
    for (const e of events) {
      if (!aDirty && !dirtyEvents.has(e.id)) continue;
      const r = scorePair(a, e);
      if (r) rescored.push({ eventId: e.id, wpPostId: a.wpPostId, ...r });
    }
  }

  const matches = kept.concat(rescored);
  const state: MatchState = { matcherVersion: MATCHER_VERSION, articleHashes, eventFingerprints, matches };
  const linksChanged = !prevState || canonicalMatches(matches) !== canonicalMatches(prevState.matches);
  const stateChanged =
    fullRecompute || linksChanged || dirtyArticles.size > 0 || dirtyEvents.size > 0 ||
    Object.keys(prevState!.articleHashes).length !== articles.length ||
    Object.keys(prevState!.eventFingerprints).length !== events.length;

  return { state, links: buildLinks(matches, articleById), linksChanged, stateChanged };
}
```

**Implementation note:** when appending, merge the new type imports (`MatchRecord`, `MatchState`, `PublishedArticleLink`) into the existing `import type {...} from '../types/articles'` statement at the top of the file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/articleMatcher.incremental.test.ts src/__tests__/articleMatcher.test.ts`
Expected: PASS (both suites — Task 4's tests must still pass)

- [ ] **Step 5: Commit**

```bash
git add src/services/articleMatcher.ts src/__tests__/articleMatcher.incremental.test.ts
git commit -m "feat(articles): incremental match-state computation with carry-over and link assembly"
```

---

### Task 6: S3 I/O — EventSnapshotLoader + ArticleLinksPublisher

**Files:**
- Create: `backend/src/services/eventSnapshotLoader.ts`
- Create: `backend/src/services/articleLinksPublisher.ts`
- Test: `backend/src/__tests__/eventSnapshotLoader.test.ts`
- Test: `backend/src/__tests__/articleLinksPublisher.test.ts`

**Interfaces:**
- Consumes: `CalendarEventLite`, `MatchState`, `ArticleLinksFile` from `../types/articles`; `@aws-sdk/client-s3`.
- Produces:
  - `class EventSnapshotLoader { constructor(s3: S3Client, bucket: string, keyPrefix: string); load(year: number): Promise<CalendarEventLite[]> }` — reads `<keyPrefix>/all-events-<year>.json` (required; throws if missing) and `<keyPrefix>/publisher-events-<year>.json` (optional), merges deduped by id.
  - `class ArticleLinksPublisher { constructor(s3: S3Client, bucket: string, publicPrefix: string, statePrefix: string); loadState(year: number): Promise<MatchState | undefined>; saveState(year: number, state: MatchState): Promise<void>; publishLinks(year: number, file: ArticleLinksFile): Promise<void> }` — public key `<publicPrefix>/article-links-<year>.json` with `CacheControl: public, max-age=300`; state key `<statePrefix>/article-links-state-<year>.json`.

- [ ] **Step 1: Write the failing loader tests**

```ts
// backend/src/__tests__/eventSnapshotLoader.test.ts
import { EventSnapshotLoader } from '../services/eventSnapshotLoader';

const mockSend = jest.fn();
const mockS3: any = { send: mockSend };

function s3Json(body: unknown) {
  return { Body: { transformToString: () => Promise.resolve(JSON.stringify(body)) } };
}
function noSuchKey() {
  const err = new Error('missing');
  (err as any).name = 'NoSuchKey';
  return err;
}

const PRIMARY = { data: [
  { id: '1', title: 'Morning Lecture', startDate: '2026-07-15T10:45:00', location: 'Amphitheater' },
  { id: '2', title: 'Opera', startDate: '2026-07-15T16:00:00' },
] };
const SIDECAR = { data: [
  { id: '2', title: 'Opera (dup)', startDate: '2026-07-15T16:00:00' },
  { id: 'pub-3', title: 'Publisher Event', startDate: '2026-07-16T12:00:00' },
] };

describe('EventSnapshotLoader', () => {
  beforeEach(() => jest.resetAllMocks());

  test('merges primary + sidecar, deduped by id (primary wins)', async () => {
    mockSend.mockResolvedValueOnce(s3Json(PRIMARY)).mockResolvedValueOnce(s3Json(SIDECAR));
    const loader = new EventSnapshotLoader(mockS3, 'bucket', 'cache/calendar-cache');
    const events = await loader.load(2026);
    expect(events.map(e => e.id)).toEqual(['1', '2', 'pub-3']);
    expect(events[1].title).toBe('Opera'); // primary version kept
    expect(mockSend.mock.calls[0][0].input.Key).toBe('cache/calendar-cache/all-events-2026.json');
    expect(mockSend.mock.calls[1][0].input.Key).toBe('cache/calendar-cache/publisher-events-2026.json');
  });

  test('missing sidecar is tolerated; missing primary throws', async () => {
    mockSend.mockResolvedValueOnce(s3Json(PRIMARY)).mockRejectedValueOnce(noSuchKey());
    const loader = new EventSnapshotLoader(mockS3, 'bucket', 'cache/calendar-cache');
    expect((await loader.load(2026)).map(e => e.id)).toEqual(['1', '2']);

    mockSend.mockReset();
    mockSend.mockRejectedValueOnce(noSuchKey());
    await expect(loader.load(2026)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Write the failing publisher tests**

```ts
// backend/src/__tests__/articleLinksPublisher.test.ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest src/__tests__/eventSnapshotLoader.test.ts src/__tests__/articleLinksPublisher.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 4: Write both implementations**

```ts
// backend/src/services/eventSnapshotLoader.ts
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { CalendarEventLite } from '../types/articles';

function isNoSuchKey(err: unknown): boolean {
  return (err as { name?: string })?.name === 'NoSuchKey';
}

/**
 * Loads the full event snapshot the matcher runs against: the primary
 * all-events file plus the optional publisher sidecar, deduped by id
 * (primary wins). Missing primary is fatal — a run without events would
 * wrongly blank the published links.
 */
export class EventSnapshotLoader {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly keyPrefix: string,
  ) {}

  private async getJson(key: string): Promise<{ data?: CalendarEventLite[] }> {
    const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return JSON.parse(await out.Body!.transformToString()) as { data?: CalendarEventLite[] };
  }

  async load(year: number): Promise<CalendarEventLite[]> {
    const primary = await this.getJson(`${this.keyPrefix}/all-events-${year}.json`);
    let sidecar: { data?: CalendarEventLite[] } = {};
    try {
      sidecar = await this.getJson(`${this.keyPrefix}/publisher-events-${year}.json`);
    } catch (err) {
      if (!isNoSuchKey(err)) throw err;
    }
    const byId = new Map<string, CalendarEventLite>();
    for (const e of [...(primary.data ?? []), ...(sidecar.data ?? [])]) {
      if (e?.id && !byId.has(e.id)) byId.set(e.id, e);
    }
    return [...byId.values()];
  }
}
```

```ts
// backend/src/services/articleLinksPublisher.ts
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { ArticleLinksFile, MatchState } from '../types/articles';

function isNoSuchKey(err: unknown): boolean {
  return (err as { name?: string })?.name === 'NoSuchKey';
}

/**
 * Writes the public article-links sidecar (CloudFront-served, 5-min cache)
 * and round-trips the private incremental match state. Scores/reasons live
 * only in the state object, never in the public file.
 */
export class ArticleLinksPublisher {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly publicPrefix: string,
    private readonly statePrefix: string,
  ) {}

  private publicKey(year: number): string {
    return `${this.publicPrefix}/article-links-${year}.json`;
  }

  private stateKey(year: number): string {
    return `${this.statePrefix}/article-links-state-${year}.json`;
  }

  async loadState(year: number): Promise<MatchState | undefined> {
    try {
      const out = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.stateKey(year) }),
      );
      return JSON.parse(await out.Body!.transformToString()) as MatchState;
    } catch (err) {
      if (isNoSuchKey(err)) return undefined;
      throw err;
    }
  }

  async saveState(year: number, state: MatchState): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.stateKey(year),
        Body: JSON.stringify(state),
        ContentType: 'application/json',
      }),
    );
  }

  async publishLinks(year: number, file: ArticleLinksFile): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.publicKey(year),
        Body: JSON.stringify(file),
        ContentType: 'application/json',
        CacheControl: 'public, max-age=300',
      }),
    );
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/__tests__/eventSnapshotLoader.test.ts src/__tests__/articleLinksPublisher.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/services/eventSnapshotLoader.ts src/services/articleLinksPublisher.ts \
        src/__tests__/eventSnapshotLoader.test.ts src/__tests__/articleLinksPublisher.test.ts
git commit -m "feat(articles): S3 event-snapshot loader and article-links publisher"
```

---

### Task 7: articleIngestRunner — orchestration

**Files:**
- Create: `backend/src/services/articleIngestRunner.ts`
- Test: `backend/src/__tests__/articleIngestRunner.test.ts`

**Interfaces:**
- Consumes: `ChqDailyClient` (Task 2), `ArticleStore` (Task 3), `computeMatchState`/`computeArticleContentHash`/`MATCHER_VERSION` (Tasks 4–5), `EventSnapshotLoader`/`ArticleLinksPublisher` (Task 6).
- Produces: `runArticleIngest(deps: ArticleIngestDeps): Promise<ArticleIngestSummary>` with
  `ArticleIngestDeps = { client: ChqDailyClient; store: ArticleStore; loader: EventSnapshotLoader; publisher: ArticleLinksPublisher; now: Date; year: number }` — Task 8's handler calls exactly this.

- [ ] **Step 1: Write the failing tests**

```ts
// backend/src/__tests__/articleIngestRunner.test.ts
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
  });

  test('fetch failure propagates and watermark does not advance', async () => {
    const deps = makeDeps({
      client: { fetchPostsModifiedSince: jest.fn().mockRejectedValue(new Error('WP 500')) },
    });
    await expect(runArticleIngest(deps)).rejects.toThrow('WP 500');
    expect(deps.store.setWatermark).not.toHaveBeenCalled();
    expect(deps.publisher.publishLinks).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/articleIngestRunner.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/services/articleIngestRunner.ts
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
```

- [ ] **Step 4: Run the full backend suite (coverage floor check)**

Run: `npm run test:ci`
Expected: PASS, global line coverage ≥ 81.1

- [ ] **Step 5: Commit**

```bash
git add src/services/articleIngestRunner.ts src/__tests__/articleIngestRunner.test.ts
git commit -m "feat(articles): ingest runner — fetch, archive, incremental match, conditional publish"
```

---

### Task 8: Lambda handler + esbuild bundle

**Files:**
- Create: `backend/src/handlers/articleIngestHandler.ts`
- Modify: `backend/package.json` (append to `build:prod` script)

**Interfaces:**
- Consumes: `runArticleIngest` (Task 7) and the service constructors (Tasks 2, 3, 6).
- Produces: `scheduledHandler(evt?: { year?: number }): Promise<void>` — the Terraform handler string is `dist/articleIngestHandler.scheduledHandler`. Env vars consumed: `ARTICLES_TABLE_NAME`, `CACHE_S3_BUCKET`, `CACHE_S3_KEY_PREFIX`, `STATE_S3_KEY_PREFIX` (optional, default `internal/article-links`).

Handlers are excluded from coverage (`jest.config` `!src/handlers/*.ts`) — this task is wiring only, no unit test; the services it wires are all tested above.

- [ ] **Step 1: Write the handler**

```ts
// backend/src/handlers/articleIngestHandler.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { ChqDailyClient } from '../services/chqDailyClient';
import { ArticleStore } from '../services/articleStore';
import { EventSnapshotLoader } from '../services/eventSnapshotLoader';
import { ArticleLinksPublisher } from '../services/articleLinksPublisher';
import { runArticleIngest } from '../services/articleIngestRunner';

/**
 * Hourly EventBridge entry point (see infrastructure/article-ingest.tf).
 * Manual invocation supports { year } to target a non-current season.
 */
export async function scheduledHandler(evt?: { year?: number }): Promise<void> {
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const s3 = new S3Client({});
  const now = new Date();
  await runArticleIngest({
    client: new ChqDailyClient(),
    store: new ArticleStore(ddb, process.env.ARTICLES_TABLE_NAME!),
    loader: new EventSnapshotLoader(s3, process.env.CACHE_S3_BUCKET!, process.env.CACHE_S3_KEY_PREFIX!),
    publisher: new ArticleLinksPublisher(
      s3,
      process.env.CACHE_S3_BUCKET!,
      process.env.CACHE_S3_KEY_PREFIX!,
      process.env.STATE_S3_KEY_PREFIX ?? 'internal/article-links',
    ),
    now,
    year: evt?.year ?? now.getFullYear(),
  });
}
```

- [ ] **Step 2: Add the esbuild bundle line**

In `backend/package.json`, append to the end of the `build:prod` script (before the trailing `&& cp -r src/services dist/`... segment — insert right after the `publisherIngestHandler` esbuild command):

```
&& npx esbuild src/handlers/articleIngestHandler.ts --bundle --platform=node --target=node24 --outfile=dist/articleIngestHandler.js --external:@aws-sdk/client-dynamodb --external:@aws-sdk/client-s3 --external:@aws-sdk/lib-dynamodb
```

**Deliberate difference from other handlers:** cheerio is NOT externalized — the `package:terraform` zip contains only `dist/` + `package.json` (no `node_modules`), so cheerio must be bundled into `dist/articleIngestHandler.js`. Only the `@aws-sdk/*` packages (provided by the Lambda runtime) stay external. After building, verify with the grep in Step 3.

- [ ] **Step 3: Verify the bundle**

```bash
npm run validate          # type-check + lint (zero warnings)
npm run build:prod        # full bundle
grep -c "require(\"cheerio\")" dist/articleIngestHandler.js || echo "OK: cheerio bundled"
node -e "const h = require('./dist/articleIngestHandler.js'); if (typeof h.scheduledHandler !== 'function') process.exit(1); console.log('handler export OK')"
```

Expected: validate clean; grep prints `0` or the `OK` line (no external cheerio require); `handler export OK`.

- [ ] **Step 4: Run full backend build**

Run: `npm run build`
Expected: tests + bundle both green.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/articleIngestHandler.ts package.json
git commit -m "feat(articles): articleIngestHandler Lambda entry point + esbuild bundle (cheerio inlined)"
```

---

### Task 9: Terraform — table, Lambda, schedule, IAM

**Files:**
- Create: `infrastructure/article-ingest.tf`

**Interfaces:**
- Consumes: existing Terraform symbols `var.app_name`, `var.environment`, `aws_s3_bucket.frontend_bucket` (all referenced the same way in `publisher-ingest.tf`).
- Produces: Lambda `${var.app_name}-article-ingest` with handler `dist/articleIngestHandler.scheduledHandler`, hourly EventBridge rule, DynamoDB table `${var.app_name}-articles`.

- [ ] **Step 1: Write the Terraform file**

```hcl
# infrastructure/article-ingest.tf
#
# Chautauquan Daily article-links pipeline (docs/superpowers/specs/
# 2026-07-15-chqdaily-article-links-design.md). Mirrors the
# publisher-ingest wiring: hourly EventBridge → Lambda → DynamoDB archive
# → sidecar JSON on the frontend bucket's calendar-cache path.

resource "aws_dynamodb_table" "articles" {
  name         = "${var.app_name}-articles"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name        = "${var.app_name}-articles"
    Environment = var.environment
  }
}

resource "aws_iam_role" "article_ingest_role" {
  name = "${var.app_name}-article-ingest-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect    = "Allow",
      Principal = { Service = "lambda.amazonaws.com" },
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "article_ingest_basic" {
  role       = aws_iam_role.article_ingest_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "article_ingest_scoped" {
  name = "${var.app_name}-article-ingest-scoped"
  role = aws_iam_role.article_ingest_role.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Scan"
        ],
        Resource = aws_dynamodb_table.articles.arn
      },
      {
        # Read the event snapshot (primary + publisher sidecar).
        Effect = "Allow",
        Action = ["s3:GetObject"],
        Resource = [
          "${aws_s3_bucket.frontend_bucket.arn}/cache/calendar-cache/all-events-*.json",
          "${aws_s3_bucket.frontend_bucket.arn}/cache/calendar-cache/publisher-events-*.json"
        ]
      },
      {
        # Publish the public sidecar; round-trip the private match state.
        Effect = "Allow",
        Action = ["s3:GetObject", "s3:PutObject"],
        Resource = [
          "${aws_s3_bucket.frontend_bucket.arn}/cache/calendar-cache/article-links-*.json",
          "${aws_s3_bucket.frontend_bucket.arn}/internal/article-links/*"
        ]
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "article_ingest" {
  name              = "/aws/lambda/${var.app_name}-article-ingest"
  retention_in_days = 14
}

resource "aws_lambda_function" "article_ingest" {
  filename      = "../backend/lambda-function.zip"
  function_name = "${var.app_name}-article-ingest"
  role          = aws_iam_role.article_ingest_role.arn
  handler       = "dist/articleIngestHandler.scheduledHandler"
  runtime       = "nodejs24.x"
  timeout       = 300
  memory_size   = 512

  environment {
    variables = {
      ARTICLES_TABLE_NAME = aws_dynamodb_table.articles.name
      CACHE_S3_BUCKET     = aws_s3_bucket.frontend_bucket.bucket
      CACHE_S3_KEY_PREFIX = "cache/calendar-cache"
      STATE_S3_KEY_PREFIX = "internal/article-links"
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.article_ingest_basic,
    aws_iam_role_policy.article_ingest_scoped,
    aws_cloudwatch_log_group.article_ingest,
  ]

  source_code_hash = filebase64sha256("../backend/lambda-function.zip")
}

resource "aws_cloudwatch_event_rule" "article_ingest_schedule" {
  name                = "${var.app_name}-article-ingest-hourly"
  description         = "Hourly trigger for chqdaily article-links pipeline"
  schedule_expression = "rate(1 hour)"
}

resource "aws_cloudwatch_event_target" "article_ingest_target" {
  rule      = aws_cloudwatch_event_rule.article_ingest_schedule.name
  target_id = "ArticleIngestTarget"
  arn       = aws_lambda_function.article_ingest.arn
}

resource "aws_lambda_permission" "article_ingest_allow_events" {
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.article_ingest.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.article_ingest_schedule.arn
}
```

- [ ] **Step 2: Validate**

```bash
cd infrastructure && terraform fmt article-ingest.tf && terraform validate
```

Expected: `Success! The configuration is valid.` (If `terraform validate` needs init and init is unavailable locally, `terraform fmt -check` passing plus careful symbol review against `publisher-ingest.tf` is the fallback — flag it in the commit message.)

- [ ] **Step 3: Commit**

```bash
git add infrastructure/article-ingest.tf
git commit -m "feat(infra): article-ingest Lambda, articles table, hourly schedule, scoped IAM"
```

**Post-merge deploy note (not a task step):** `terraform apply` is required after merge to create the table/Lambda/rule, and the backend zip must be rebuilt first so `dist/articleIngestHandler.js` exists.

---

### Task 10: Frontend — useArticleLinks hook + dev fixture

**Files:**
- Create: `frontend/src/hooks/useArticleLinks.ts`
- Create: `frontend/public/data/article-links-2026.json` (dev-only fixture)
- Test: `frontend/src/__tests__/hooks/useArticleLinks.test.ts`

**Interfaces:**
- Consumes: the sidecar JSON (`ArticleLinksFile` shape from Task 1, mirrored locally).
- Produces: `useArticleLinks(year: number): { links: Record<string, ArticleLink[]>; loading: boolean }` and `export interface ArticleLink { title: string; url: string; kind: 'preview' | 'recap'; pubDate: string }` — Task 11 imports both. Also `__resetArticleLinksCacheForTests()`.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/__tests__/hooks/useArticleLinks.test.ts
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

  it('fetches the dev-path sidecar and returns links keyed by event id', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(PAYLOAD),
    });

    const { result } = renderHook(() => useArticleLinks(2026));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    // vitest runs with import.meta.env.DEV === true → dev cache base
    expect(fetch).toHaveBeenCalledWith('/data/article-links-2026.json');
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `frontend/`): `npx vitest run src/__tests__/hooks/useArticleLinks.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the hook** (mirrors `useWeeklyThemes.ts` structure exactly)

```ts
// frontend/src/hooks/useArticleLinks.ts
import { useEffect, useState } from 'react';

export type ArticleLinkKind = 'preview' | 'recap';

export interface ArticleLink {
  title: string;
  url: string;
  kind: ArticleLinkKind;
  /** YYYY-MM-DD publication date on chqdaily.com. */
  pubDate: string;
}

interface ArticleLinksFile {
  generatedAt: string;
  matcherVersion: number;
  links: Record<string, ArticleLink[]>;
}

export interface UseArticleLinksResult {
  /** eventId → linked Daily articles (previews first, then recaps). */
  links: Record<string, ArticleLink[]>;
  loading: boolean;
}

interface LoadResult {
  links: Record<string, ArticleLink[]>;
  /** When true the result is durable (200/404) and may be cached forever. */
  cacheable: boolean;
}

const inflight = new Map<number, Promise<LoadResult>>();
const resolved = new Map<number, Record<string, ArticleLink[]>>();

async function loadLinks(year: number): Promise<LoadResult> {
  if (resolved.has(year)) {
    return { links: resolved.get(year)!, cacheable: true };
  }
  const existing = inflight.get(year);
  if (existing) return existing;

  const promise = (async (): Promise<LoadResult> => {
    try {
      // Same dev/prod split as useEventData: Vite dev serves fixtures from
      // /public/data; production serves the Lambda-published sidecar from
      // the CloudFront calendar-cache path.
      const cacheBase = import.meta.env.DEV ? '/data' : '/cache/calendar-cache';
      const res = await fetch(`${cacheBase}/article-links-${year}.json`);
      if (res.status === 404) {
        return { links: {}, cacheable: true };
      }
      if (!res.ok) {
        return { links: {}, cacheable: false };
      }
      const payload = (await res.json()) as ArticleLinksFile;
      return { links: payload.links ?? {}, cacheable: true };
    } catch {
      return { links: {}, cacheable: false };
    }
  })();

  inflight.set(year, promise);
  const result = await promise;
  if (result.cacheable) {
    resolved.set(year, result.links);
  }
  inflight.delete(year);
  return result;
}

export function useArticleLinks(year: number): UseArticleLinksResult {
  const cached = resolved.get(year);
  const [links, setLinks] = useState<Record<string, ArticleLink[]>>(cached ?? {});
  const [loading, setLoading] = useState<boolean>(!cached);

  useEffect(() => {
    let cancelled = false;
    if (resolved.has(year)) {
      setLinks(resolved.get(year)!);
      setLoading(false);
      return;
    }
    setLinks({});
    setLoading(true);
    loadLinks(year).then((result) => {
      if (cancelled) return;
      setLinks(result.links);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [year]);

  return { links, loading };
}

/**
 * Test-only: clear the module-level cache so each test starts fresh.
 * Mirrors __resetWeeklyThemesCacheForTests in useWeeklyThemes.ts.
 */
export function __resetArticleLinksCacheForTests(): void {
  inflight.clear();
  resolved.clear();
}
```

- [ ] **Step 4: Create the dev fixture** (uses a real event id from `frontend/public/data/all-events.json` so local dev shows a working link)

```json
// frontend/public/data/article-links-2026.json
{
  "generatedAt": "2026-07-15T14:00:00Z",
  "matcherVersion": 1,
  "links": {
    "91653": [
      {
        "title": "CLSC presents Debra Magpie Earling's 'The Lost Journals of Sacajewea' (sample dev fixture)",
        "url": "https://chqdaily.com/",
        "kind": "preview",
        "pubDate": "2026-07-14"
      }
    ]
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/hooks/useArticleLinks.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useArticleLinks.ts src/__tests__/hooks/useArticleLinks.test.ts public/data/article-links-2026.json
git commit -m "feat(frontend): useArticleLinks hook fetching the article-links sidecar"
```

---

### Task 11: Frontend — EventCard UI + wiring through EventList and page

**Files:**
- Modify: `frontend/src/components/calendar/EventCard.tsx`
- Modify: `frontend/src/components/calendar/EventList.tsx`
- Modify: `frontend/src/app/page.tsx`
- Test: `frontend/src/__tests__/components/calendar/EventCard.articleLinks.test.tsx`

**Interfaces:**
- Consumes: `ArticleLink` from `@/hooks/useArticleLinks` (Task 10).
- Produces: `EventCardProps` gains optional `articleLinks?: ArticleLink[]`; `EventListProps` gains optional `articleLinks?: Record<string, ArticleLink[]>`.

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/__tests__/components/calendar/EventCard.articleLinks.test.tsx
/// <reference types="vitest/globals" />
import { render, screen } from '@testing-library/preact';
import { EventCard } from '@/components/calendar/EventCard';
import type { Event } from '@/lib/types';
import type { ArticleLink } from '@/hooks/useArticleLinks';

const baseEvent: Event = {
  id: 'e1',
  title: 'Interfaith Lecture',
  description: 'A talk about peace.',
  startDate: '2026-07-15T14:00:00',
  endDate: '2026-07-15T15:00:00',
  location: 'Hall of Philosophy',
};

const LINKS: ArticleLink[] = [
  { title: 'Syeed to speak today', url: 'https://chqdaily.com/preview/', kind: 'preview', pubDate: '2026-07-15' },
  { title: 'Syeed spoke on peace', url: 'https://chqdaily.com/recap/', kind: 'recap', pubDate: '2026-07-16' },
];

function renderCard(overrides: Partial<Parameters<typeof EventCard>[0]> = {}) {
  return render(
    <EventCard
      event={baseEvent}
      index={0}
      isExpanded={false}
      onToggleDescription={vi.fn()}
      onToggleTag={vi.fn()}
      isTagSelected={() => false}
      isFavorite={false}
      onToggleFavorite={vi.fn()}
      onDownloadICS={vi.fn()}
      {...overrides}
    />,
  );
}

describe('EventCard article links', () => {
  it('renders no newspaper affordance when there are no links', () => {
    renderCard();
    expect(screen.queryByTitle('Chautauquan Daily coverage')).toBeNull();
    expect(screen.queryByText('In the Chautauquan Daily')).toBeNull();
  });

  it('collapsed card shows the hint glyph but not the titled links', () => {
    renderCard({ articleLinks: LINKS });
    expect(screen.getByTitle('Chautauquan Daily coverage')).toBeTruthy();
    expect(screen.queryByText('In the Chautauquan Daily')).toBeNull();
  });

  it('expanded card lists each article as a new-tab link with kind label', () => {
    renderCard({ articleLinks: LINKS, isExpanded: true });
    expect(screen.getByText('In the Chautauquan Daily')).toBeTruthy();
    const preview = screen.getByRole('link', { name: /Syeed to speak today/ }) as HTMLAnchorElement;
    expect(preview.href).toBe('https://chqdaily.com/preview/');
    expect(preview.target).toBe('_blank');
    expect(preview.rel).toContain('noopener');
    expect(screen.getByText('(recap)')).toBeTruthy();
    expect(screen.getByText('(preview)')).toBeTruthy();
  });

  it('event with article links but no description still gets the disclosure widget', () => {
    renderCard({
      event: { ...baseEvent, description: undefined, categories: undefined },
      articleLinks: LINKS,
    });
    expect(screen.getByText(/Show more/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/components/calendar/EventCard.articleLinks.test.tsx`
Expected: FAIL — `articleLinks` prop unknown / hint glyph absent

- [ ] **Step 3: Modify EventCard.tsx**

Four edits (line refs to current file):

**(a)** Add the import and prop. After `import type { Event } from '@/lib/types';`:

```tsx
import type { ArticleLink } from '@/hooks/useArticleLinks';
```

In `EventCardProps` add:

```tsx
  articleLinks?: ArticleLink[];
```

and destructure it in the function signature: `..., onDownloadICS, articleLinks }: EventCardProps`.

**(b)** Collapsed hint glyph — in the time/location metadata span (currently lines 37–44), after the location segment:

```tsx
            <span>
              🕐 {new Date(event.startDate).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
              })}
              {event.location && <span className="ml-2">📍 {event.location}</span>}
              {articleLinks && articleLinks.length > 0 && (
                <span className="ml-2" title="Chautauquan Daily coverage">📰</span>
              )}
            </span>
```

**(c)** Disclosure-widget condition (currently line 122) — an event with links but no description/categories must still be expandable. Replace:

```tsx
          {(event.description || (event.categories && event.categories.filter(cat => !cat.name.startsWith('Week ')).length > 0)) && (
```

with:

```tsx
          {(event.description || (event.categories && event.categories.filter(cat => !cat.name.startsWith('Week ')).length > 0) || (articleLinks && articleLinks.length > 0)) && (
```

**(d)** Expanded article-links block — inside the `isExpanded` branch, immediately after the categories `<div className="mb-2 flex flex-wrap gap-1">...</div>` closes (currently line 161):

```tsx
                  {articleLinks && articleLinks.length > 0 && (
                    <div className="mb-2">
                      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                        In the Chautauquan Daily
                      </div>
                      <ul className="space-y-0.5">
                        {articleLinks.map((link) => (
                          <li key={link.url} className="text-sm">
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline"
                            >
                              📰 {link.title}
                            </a>
                            <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">
                              ({link.kind})
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
```

- [ ] **Step 4: Thread the prop through EventList.tsx**

Add to imports: `import type { ArticleLink } from '@/hooks/useArticleLinks';`
Add to `EventListProps`: `articleLinks?: Record<string, ArticleLink[]>;`
Destructure `articleLinks` in the component signature, and pass to each card (the `<EventCard>` render at current line 91):

```tsx
              <EventCard
                key={event.id}
                event={event}
                ...existing props unchanged...
                onDownloadICS={downloadICS}
                articleLinks={articleLinks?.[event.id]}
              />
```

- [ ] **Step 5: Wire the hook in page.tsx**

Next to the existing `useWeeklyThemes` call (current line 44):

```tsx
  const { links: articleLinks } = useArticleLinks(selectedYear);
```

with import `import { useArticleLinks } from '@/hooks/useArticleLinks';` beside the `useWeeklyThemes` import, and add `articleLinks={articleLinks}` to the `<EventList ...>` usage (current line 174).

- [ ] **Step 6: Run the frontend suite + build**

```bash
npx vitest run src/__tests__/components/calendar/EventCard.articleLinks.test.tsx   # new tests PASS
npm run test:ci   # if this script doesn't exist, run: npx vitest run --coverage
npm run build     # validate (type-check + lint) + vite build
```

Expected: all green, frontend coverage ≥ 74.3.

- [ ] **Step 7: Commit**

```bash
git add src/components/calendar/EventCard.tsx src/components/calendar/EventList.tsx src/app/page.tsx \
        src/__tests__/components/calendar/EventCard.articleLinks.test.tsx
git commit -m "feat(frontend): newspaper article links on event cards (hint glyph + expanded list)"
```

---

### Task 12: Runbook, full verification, PR

**Files:**
- Create: `docs/runbooks/article-links.md`

- [ ] **Step 1: Write the runbook**

```markdown
# Runbook — Chautauquan Daily Article Links

Pipeline: hourly EventBridge → `chautauqua-calendar-article-ingest` Lambda →
DynamoDB `chautauqua-calendar-articles` → S3 sidecar
`cache/calendar-cache/article-links-<year>.json` (5-min CloudFront cache) →
`useArticleLinks` hook → EventCard.

Spec: `docs/superpowers/specs/2026-07-15-chqdaily-article-links-design.md`.

## Manual trigger

    aws lambda invoke --function-name chautauqua-calendar-article-ingest \
      --payload '{}' /tmp/article-ingest-out.json

Optional payload `{"year": 2026}` targets a non-current season.

## Logs

    aws logs tail /aws/lambda/chautauqua-calendar-article-ingest --follow

Every successful run logs a one-line JSON summary
(`[article-ingest] summary: {fetched, upserted, articlesTotal, eventsTotal,
matchedEvents, linksPublished}`).

## Force a full rematch

Bump `MATCHER_VERSION` in `backend/src/services/articleMatcher.ts` (code
change + deploy), or delete the state object for a one-time rebuild:

    aws s3 rm s3://<frontend-bucket>/internal/article-links/article-links-state-2026.json

## Reset the article archive (full re-backfill)

Delete the watermark row (`pk = META#watermark`) from the articles table;
the next run re-backfills from June 1. Article rows are upserted in place,
so no table wipe is needed.

## Failure behavior

Any fetch/S3/DDB error aborts the run before the watermark advances — the
previous sidecar stays live and the next hourly run re-covers the gap.
Errors appear in the Lambda's CloudWatch error metric.
```

- [ ] **Step 2: Full verification (per CLAUDE.md checklist)**

```bash
cd frontend && npm run build
cd ../backend && npm run validate && npm run build
cd ../frontend && npm run dev
# Visit http://localhost:3000 — verify events load, expand an event card,
# confirm the sample article link renders (dev fixture from Task 10 on the
# CLSC Debra Magpie Earling event), 📰 glyph shows on that collapsed card.
```

Expected: both builds green; dev smoke shows the link.

- [ ] **Step 3: Commit + push + PR**

```bash
git add docs/runbooks/article-links.md
git commit -m "docs(articles): article-links pipeline runbook"
git push -u origin feature/chqdaily-article-links
gh pr create --title "feat: Chautauquan Daily article links on event cards (#134)" --body "$(cat <<'EOF'
Implements issue #134 per the approved spec (docs/superpowers/specs/2026-07-15-chqdaily-article-links-design.md).

- Hourly `article-ingest` Lambda pulls new/modified posts (full body) from the chqdaily.com WordPress REST API into a DynamoDB season archive
- Deterministic heuristic matcher (venue / people / printed-time / category / proximity signals, 0.6 threshold, top-4 per event) with incremental recompute via contentHash + event fingerprints; `matcherVersion` bump forces full rematch
- Publishes `cache/calendar-cache/article-links-2026.json` sidecar (5-min cache); private match state on `internal/article-links/`
- Frontend: `useArticleLinks` hook + EventCard 📰 hint glyph (collapsed) and "In the Chautauquan Daily" titled links (expanded), preview/recap labeled
- Terraform: articles table, Lambda, hourly EventBridge rule, scoped IAM
- Runbook at docs/runbooks/article-links.md

Deploy notes: requires `terraform apply` after merge (new table/Lambda/rule/env vars).

Phase 2 (deferred by design): AI/embedding matching over the stored bodies.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes (completed)

- **Spec coverage:** ingestion+backfill (T2/T7), full-body storage (T1/T2/T3), incremental rematch + matcherVersion (T4/T5/T7), sidecar format/path (T6/T9), fail-safe watermark (T7), UI both levels (T10/T11), runbook/ops (T12), tests throughout. Phase-2 items intentionally absent.
- **Type consistency:** `DailyArticle`/`StoredArticle`/`CalendarEventLite`/`MatchState`/`MatchRecord`/`PublishedArticleLink`/`ArticleLinksFile` defined once in Task 1 and used verbatim in Tasks 2–8; `ArticleLink` (frontend mirror) defined in Task 10 and used in Task 11.
- **Known judgment calls encoded:** cheerio bundled (not external) into the article handler because the terraform zip has no node_modules; watermark 6h overlap for WP timezone quirks; `internal/article-links/` state prefix is obscure-not-secret (contents are non-sensitive scores over public data).
