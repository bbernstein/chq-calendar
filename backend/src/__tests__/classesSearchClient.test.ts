import * as fs from 'fs';
import * as path from 'path';
import { ClassesSearchClient } from '../services/classesSearchClient';

const fix = (n: string) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const SEARCH_FRAGMENT = fix('chq-classes-search.html');
const EMPTY_FRAGMENT = '<div id="searchEventRequestResult"><div class="panel-group d-none"></div></div>';
const SEARCH_PAGE = '<html><form action="/post/search/classes"><input name="_csrf" value="tok-1"/></form></html>';

/** What a stubbed response needs to carry — not a real Response. */
interface StubResponse {
  status?: number;
  body?: string;
  cookies?: string[];
}

/** A fetch double that records the calls made through it. */
function stubFetch(handler: (url: string, init: RequestInit) => StubResponse) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const { body = '', status = 200, cookies } = handler(url, init);
    return {
      ok: status < 400,
      status,
      headers: {
        getSetCookie: () => cookies ?? [
          'JSESSIONID=abc; Path=/; Secure; HttpOnly',
          'SESSION_chq=def; Path=/; Secure; HttpOnly',
        ],
      },
      text: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

/** Answers the handshake, then one page of results per subject. */
function catalogStub(fragmentByPage: (page: number) => string) {
  return stubFetch((url, init) => {
    if (url.includes('searchclasses.html')) return { body: SEARCH_PAGE };
    const page = Number(new URLSearchParams(String(init.body)).get('page'));
    return { body: fragmentByPage(page) };
  });
}

describe('ClassesSearchClient handshake', () => {
  it('sends the cookies and token from the same handshake on every search', async () => {
    const { fn, calls } = catalogStub(p => (p === 0 ? SEARCH_FRAGMENT : EMPTY_FRAGMENT));
    await new ClassesSearchClient(fn, 'https://tickets.chq.org', 0).fetchCatalog();

    const posts = calls.filter(c => c.url.includes('/post/search/classes'));
    expect(posts.length).toBeGreaterThan(0);
    for (const post of posts) {
      // Pairing a token with a cookie from a different handshake is what the
      // server answers 403 to, and a 403 looks exactly like an empty catalog.
      expect(post.init.headers).toMatchObject({ Cookie: 'JSESSIONID=abc; SESSION_chq=def' });
      expect(String(post.init.body)).toContain('_csrf=tok-1');
    }
  });

  it('always sends the full week set, which the search requires', async () => {
    const { fn, calls } = catalogStub(p => (p === 0 ? SEARCH_FRAGMENT : EMPTY_FRAGMENT));
    await new ClassesSearchClient(fn, 'https://tickets.chq.org', 0).fetchCatalog();

    // An empty eventCategories answers 200 with gate passes instead of
    // classes — a wrong catalog rather than an error.
    const body = new URLSearchParams(String(calls.find(c => c.url.includes('/post/'))!.init.body));
    expect(body.get('eventCategories')).toBe(
      'WEEK1,WEEK2,WEEK3,WEEK4,WEEK5,WEEK6,WEEK7,WEEK8,WEEK9',
    );
  });

  it('refuses to crawl when the search page carries no token', async () => {
    const { fn } = stubFetch(() => ({ body: '<html><form action="/post/search/classes"></form></html>' }));
    await expect(new ClassesSearchClient(fn, 'https://tickets.chq.org', 0).fetchCatalog())
      .rejects.toThrow(/no CSRF token/);
  });

  it('aborts when a waiting room answers instead of the search page', async () => {
    const { fn } = stubFetch(() => ({ body: '<html><body>You are in line.</body></html>' }));
    await expect(new ClassesSearchClient(fn, 'https://tickets.chq.org', 0).fetchCatalog())
      .rejects.toThrow(/did not come back as expected/);
  });
});

describe('ClassesSearchClient.fetchCatalog', () => {
  it('returns each class once', async () => {
    const { fn } = catalogStub(p => (p === 0 ? SEARCH_FRAGMENT : EMPTY_FRAGMENT));
    const rows = await new ClassesSearchClient(fn, 'https://tickets.chq.org', 0).fetchCatalog();

    expect(rows).toHaveLength(6);
    expect(new Set(rows.map(r => r.id)).size).toBe(6);
  });

  it('crawls the catalog by week, and leaves subjectCategories empty', async () => {
    const { fn, calls } = catalogStub(p => (p === 0 ? SEARCH_FRAGMENT : EMPTY_FRAGMENT));
    await new ClassesSearchClient(fn, 'https://tickets.chq.org', 0).fetchCatalog();

    const posts = calls.filter(c => c.url.includes('/post/search/classes'));
    expect(posts).toHaveLength(2);
    const body = new URLSearchParams(String(posts[0].init.body));
    // Everything the server filters on rides in eventCategories. The field
    // actually named subjectCategories is never read — putting a subject
    // there filters nothing and looks like a catalog with no subjects.
    expect(body.get('eventCategories')).toBe('WEEK1,WEEK2,WEEK3,WEEK4,WEEK5,WEEK6,WEEK7,WEEK8,WEEK9');
    expect(body.get('subjectCategories')).toBe('');
  });

  it('re-opens an expired session once and carries on', async () => {
    let forbidden = true;
    const { fn, calls } = stubFetch((url, init) => {
      if (url.includes('searchclasses.html')) return { body: SEARCH_PAGE };
      if (forbidden) {
        forbidden = false; // only the first search is rejected
        return { status: 403, body: '' };
      }
      const page = Number(new URLSearchParams(String(init.body)).get('page'));
      return { body: page === 0 ? SEARCH_FRAGMENT : EMPTY_FRAGMENT };
    });

    const rows = await new ClassesSearchClient(fn, 'https://tickets.chq.org', 0).fetchCatalog();
    expect(rows).toHaveLength(6);
    expect(calls.filter(c => c.url.includes('searchclasses.html'))).toHaveLength(2);
  });

  it('reports an empty crawl rather than throwing on it', async () => {
    // Between October and June the site lists nothing, and that is the truth
    // rather than a fault. Throwing here made the off-season look identical
    // to an outage and alarmed both schedules hourly for eight months; only
    // the runner knows whether a catalog was ever published for the year.
    const { fn } = stubFetch(url =>
      url.includes('searchclasses.html') ? { body: SEARCH_PAGE } : { body: EMPTY_FRAGMENT });
    const rows = await new ClassesSearchClient(fn, 'https://tickets.chq.org', 0).fetchCatalog();
    expect(rows).toEqual([]);
  });

  it('treats a page that links classes but parses to none as markup drift', async () => {
    const { fn } = catalogStub(() =>
      '<div id="searchEventRequestResult"><a href="/class.html?eventAk=CHQ.EVN1">x</a></div>');
    await expect(new ClassesSearchClient(fn, 'https://tickets.chq.org', 0).fetchCatalog())
      .rejects.toThrow(/markup drift/);
  });
});

describe('ClassesSearchClient.fetchClassDetail', () => {
  it('returns the detail HTML for a class', async () => {
    const { fn, calls } = stubFetch(() => ({ body: fix('chq-class-detail.html') }));
    const html = await new ClassesSearchClient(fn, 'https://tickets.chq.org', 0)
      .fetchClassDetail('CHQ.EVN1687');

    expect(html).toContain('CHQ.EVN1687.PRF1');
    expect(calls[0].url).toBe('https://tickets.chq.org/class.html?eventAk=CHQ.EVN1687');
  });

  it('aborts when the detail page is not a class page', async () => {
    const { fn } = stubFetch(() => ({ body: '<html><body>Please wait</body></html>' }));
    await expect(new ClassesSearchClient(fn, 'https://tickets.chq.org', 0)
      .fetchClassDetail('CHQ.EVN1687')).rejects.toThrow(/did not come back as expected/);
  });

  it('raises the status on a failed fetch', async () => {
    const { fn } = stubFetch(() => ({ status: 500, body: '' }));
    await expect(new ClassesSearchClient(fn, 'https://tickets.chq.org', 0)
      .fetchClassDetail('CHQ.EVN1687')).rejects.toThrow(/500/);
  });
});

describe('ClassesSearchClient.forEachClassDetail', () => {
  it('fetches every class with several requests in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const { fn } = stubFetch(() => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      inFlight--;
      return { body: '<div class="perf-title">x</div>' };
    });
    const ids = Array.from({ length: 20 }, (_, i) => `CHQ.EVN${i}`);
    const seen: string[] = [];

    const result = await new ClassesSearchClient(fn, 'https://tickets.chq.org', 0)
      .forEachClassDetail(ids, id => { seen.push(id); }, 4);

    expect(result.fetched).toBe(20);
    expect(result.failures).toEqual([]);
    expect(new Set(seen).size).toBe(20);
  });

  it('records a failed class and keeps going', async () => {
    const { fn } = stubFetch(url =>
      url.includes('CHQ.EVN2') ? { status: 500, body: '' } : { body: '<div class="perf-title">x</div>' });
    const ids = ['CHQ.EVN1', 'CHQ.EVN2', 'CHQ.EVN3'];

    const result = await new ClassesSearchClient(fn, 'https://tickets.chq.org', 0)
      .forEachClassDetail(ids, () => {}, 2);

    // One unreadable class must not cost the other 465.
    expect(result.fetched).toBe(2);
    expect(result.failures).toEqual([{ id: 'CHQ.EVN2', error: expect.stringContaining('500') }]);
  });
});
