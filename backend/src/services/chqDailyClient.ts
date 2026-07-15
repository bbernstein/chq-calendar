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
