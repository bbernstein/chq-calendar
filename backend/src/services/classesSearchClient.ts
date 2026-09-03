import { parseSearchResults } from './classesScraper';
import type { ClassSearchRow } from '../types/classes';

const DEFAULT_BASE_URL = 'https://tickets.chq.org';
const USER_AGENT = 'chqcal.org class-catalog (https://www.chqcal.org)';
const REQUEST_TIMEOUT_MS = 15_000;


/** Every season week. The search rejects an empty week set — see `search`. */
const ALL_WEEKS = ['WEEK1', 'WEEK2', 'WEEK3', 'WEEK4', 'WEEK5', 'WEEK6', 'WEEK7', 'WEEK8', 'WEEK9'];

/** The server ignores a larger pageSize and returns ten rows regardless. */
const PAGE_SIZE = 10;

/**
 * Detail pages in flight at once: enough to finish in minutes, few enough to
 * stay a modest neighbour on someone else's site.
 */
const DETAIL_CONCURRENCY = 6;

/**
 * Stops a crawl that never returns an empty page. The catalog ran to 47
 * pages of ten in August 2026; this leaves room to grow before it trips.
 */
const MAX_PAGES = 200;

/**
 * A cookie/token pair from one handshake. They must be used together: the
 * token is bound to the session the cookies identify, so pairing a fresh
 * token with an older cookie (or vice versa) is rejected — see `search`.
 */
interface SearchSession {
  cookie: string;
  csrf: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Read-only client for the tickets.chq.org class search.
 *
 * The catalog is not reachable by plain GET: `searchclasses.html` renders a
 * short promo carousel, and the real listing comes from a form POST that
 * needs a session and a CSRF token. Everything here is GET/POST against
 * search endpoints — it never touches a cart, an account, or a checkout.
 */
export class ClassesSearchClient {
  private session: SearchSession | null = null;

  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
    /** Pause between requests, to stay a well-behaved visitor. */
    private readonly requestDelayMs: number = 250,
  ) {}

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await this.fetchFn(url, {
        ...init,
        headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Opens a search session: one GET yields both the cookies and the CSRF
   * token, which are only valid as a pair.
   */
  private async handshake(): Promise<SearchSession> {
    const url = `${this.baseUrl}/searchclasses.html?subjectParentCat=L2_CC_SUB&weekParentCat=SEAS_WKS`;
    const res = await this.request(url, { method: 'GET', headers: { Accept: 'text/html' } });
    if (!res.ok) {
      throw new Error(`[classes] search handshake failed: ${res.status}`);
    }
    const html = await res.text();
    assertServedBy(html, 'post/search/classes', 'the class search page');

    const csrf = /name="_csrf"\s+value="([^"]+)"/.exec(html)?.[1];
    if (!csrf) {
      throw new Error('[classes] no CSRF token on the search page — refusing to crawl (markup drift?)');
    }
    // Both cookies are HttpOnly; the pair identifies the session the token
    // is bound to.
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    if (!cookie) {
      throw new Error('[classes] search page set no session cookie — refusing to crawl');
    }
    return { cookie, csrf };
  }

  /**
   * One page of results for one subject.
   *
   * Two failure modes here are silent by default and are made loud instead:
   * a stale session answers 403, and an empty `eventCategories` answers 200
   * with gate passes and daily tickets rather than classes. Both look like
   * "this subject has no classes" if you only count rows, so the week set is
   * always sent in full and a 403 re-handshakes once.
   */
  private async search(
    session: SearchSession,
    categories: string,
    page: number,
  ): Promise<{ rows: ClassSearchRow[]; forbidden: boolean }> {
    const body = new URLSearchParams({
      _csrf: session.csrf,
      text: '',
      // Never read by the server; sent only because the form sends it.
      subjectCategories: '',
      eventCategories: categories,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    const res = await this.request(`${this.baseUrl}/post/search/classes`, {
      method: 'POST',
      headers: {
        Accept: 'text/html',
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: session.cookie,
      },
      body: body.toString(),
    });
    if (res.status === 403) return { rows: [], forbidden: true };
    if (!res.ok) {
      throw new Error(`[classes] search failed: ${res.status} (${categories}, page ${page})`);
    }

    const html = await res.text();
    assertServedBy(html, 'searchEventRequestResult', 'the search results');
    const rows = parseSearchResults(html, this.baseUrl);
    if (rows.length === 0 && html.includes('eventAk=')) {
      throw new Error(
        `[classes] page ${page} of ${categories} links classes but parsed to none — refusing to publish (markup drift?)`,
      );
    }
    return { rows, forbidden: false };
  }

  /**
   * Every page of one category selection, as rows keyed by class id.
   *
   * `categories` is the `eventCategories` value: a comma-separated list of
   * week codes, subject codes, or both. It must never be empty — the server
   * answers an empty one with gate passes and daily tickets rather than an
   * error, which reads as a catalog full of the wrong things.
   */
  private async crawl(categories: string): Promise<Map<string, ClassSearchRow>> {
    let session = this.session ?? (this.session = await this.handshake());
    const byId = new Map<string, ClassSearchRow>();

    for (let page = 0; page < MAX_PAGES; page++) {
      await sleep(this.requestDelayMs);
      let { rows, forbidden } = await this.search(session, categories, page);
      if (forbidden) {
        // Sessions expire mid-crawl; re-open one and retry this page once.
        session = this.session = await this.handshake();
        ({ rows, forbidden } = await this.search(session, categories, page));
        if (forbidden) {
          throw new Error(`[classes] search rejected a fresh session (${categories}, page ${page})`);
        }
      }
      if (rows.length === 0) break;
      for (const row of rows) if (!byId.has(row.id)) byId.set(row.id, row);
    }
    return byId;
  }

  /** Every class in the catalog, found by asking for every week. */
  async fetchCatalog(): Promise<ClassSearchRow[]> {
    const byId = await this.crawl(ALL_WEEKS.join(','));
    // An empty result is reported, not thrown on. Between October and June it
    // is simply the truth — the site lists nothing for a season that has not
    // opened — and throwing made the off-season indistinguishable from an
    // outage, alarming both schedules every hour for eight months. The runner
    // decides what emptiness means, because only it knows whether a catalog
    // for this year was ever published.
    return [...byId.values()];
  }


  /**
   * Detail pages for many classes, a few in flight at a time.
   *
   * Sequential fetching is not viable: the site answers in roughly 2.5s, so
   * the ~470-class catalog would take about twenty minutes and outlast any
   * Lambda. Pages are handed to `onDetail` as they arrive and never
   * accumulated — holding every page would be well over a hundred megabytes.
   *
   * One class failing does not end the crawl. Failures are returned so the
   * caller can decide whether the run is still worth publishing; a class
   * whose page could not be read keeps whatever the previous run knew.
   */
  async forEachClassDetail(
    ids: string[],
    onDetail: (id: string, html: string) => void | Promise<void>,
    concurrency: number = DETAIL_CONCURRENCY,
  ): Promise<{ fetched: number; failures: { id: string; error: string }[] }> {
    const queue = [...ids];
    const failures: { id: string; error: string }[] = [];
    let fetched = 0;

    const worker = async (): Promise<void> => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        try {
          await onDetail(id, await this.fetchClassDetail(id));
          fetched++;
        } catch (err) {
          failures.push({ id, error: err instanceof Error ? err.message : String(err) });
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(concurrency, ids.length)) }, worker),
    );
    return { fetched, failures };
  }

  /** The raw HTML of one class's detail page, for `parseClassDetail`. */
  async fetchClassDetail(id: string): Promise<string> {
    await sleep(this.requestDelayMs);
    const url = `${this.baseUrl}/class.html?eventAk=${encodeURIComponent(id)}`;
    const res = await this.request(url, { method: 'GET', headers: { Accept: 'text/html' } });
    if (!res.ok) {
      throw new Error(`[classes] detail fetch failed: ${res.status} (${id})`);
    }
    const html = await res.text();
    assertServedBy(html, 'perf-title', `the detail page for ${id}`);
    return html;
  }
}

/**
 * Rejects a response that is not the page we asked for.
 *
 * The site fronts a queue-it waiting room and a password gate, either of
 * which answers 200 with a page that parses to zero classes; publishing that
 * would quietly empty the catalog. The check is positive — "does this look
 * like the page we wanted" — rather than a search for waiting-room markers,
 * because a healthy page already references both queue-it and the password
 * script, so looking for those names aborts every good run.
 */
function assertServedBy(html: string, marker: string, what: string): void {
  if (!html.includes(marker)) {
    throw new Error(
      `[classes] ${what} did not come back as expected — waiting room, password gate, or markup drift. Aborting run.`,
    );
  }
}
