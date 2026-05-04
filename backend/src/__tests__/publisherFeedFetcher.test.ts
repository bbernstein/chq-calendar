import * as fs from 'fs';
import * as path from 'path';
import { fetchAndParseFeed } from '../services/publisherFeedFetcher';

const fix = (n: string) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

const mockFetch = (body: string, contentType: string, ok = true): any =>
  jest.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    text: async () => body,
    headers: { get: () => contentType },
  }));

describe('fetchAndParseFeed', () => {
  it('parses a JSON feed', async () => {
    const r = await fetchAndParseFeed(
      { url: 'https://x/feed.json', sourceType: 'json', registeredPublisherId: 'test-pub' },
      mockFetch(fix('valid-feed.json'), 'application/json'),
    );
    expect(r.fetchStatus).toBe('ok');
    expect(r.feed?.events.length).toBeGreaterThan(0);
    expect(r.report.ok).toBe(true);
  });

  it('parses an HTML page with embedded comments', async () => {
    const r = await fetchAndParseFeed(
      { url: 'https://x/page.html', sourceType: 'html', registeredPublisherId: 'test-pub' },
      mockFetch(fix('valid-feed-page.html'), 'text/html'),
    );
    expect(r.fetchStatus).toBe('ok');
    expect(r.feed?.events.length).toBeGreaterThan(0);
  });

  it('returns network_error on non-ok response', async () => {
    const r = await fetchAndParseFeed(
      { url: 'https://x/feed.json', sourceType: 'json', registeredPublisherId: 'test-pub' },
      mockFetch('', 'application/json', false),
    );
    expect(r.fetchStatus).toBe('network_error');
    expect(r.feed).toBeNull();
  });

  it('returns parse_error on invalid JSON', async () => {
    const r = await fetchAndParseFeed(
      { url: 'https://x/feed.json', sourceType: 'json', registeredPublisherId: 'test-pub' },
      mockFetch('not json {', 'application/json'),
    );
    expect(r.fetchStatus).toBe('parse_error');
    expect(r.feed).toBeNull();
  });

  it('rejects feed where publisher.id does not match registeredPublisherId', async () => {
    const r = await fetchAndParseFeed(
      { url: 'https://x/feed.json', sourceType: 'json', registeredPublisherId: 'different-id' },
      mockFetch(fix('valid-feed.json'), 'application/json'),
    );
    expect(r.fetchStatus).toBe('validation_error');
    expect(r.feed).toBeNull();
    // Mismatch message must spell out both ids — admins triage by reading
    // this string in the publishers table and need to know what the feed
    // claims its id is vs. what we have registered.
    const msg = r.report.errors[0].message;
    expect(msg).toContain('different-id');
    expect(msg).toMatch(/test-pub|publisher.id/);
  });

  it('rejects HTML feed where publisher.id does not match registeredPublisherId', async () => {
    const r = await fetchAndParseFeed(
      { url: 'https://x/page.html', sourceType: 'html', registeredPublisherId: 'different-id' },
      mockFetch(fix('valid-feed-page.html'), 'text/html'),
    );
    expect(r.fetchStatus).toBe('validation_error');
    expect(r.feed).toBeNull();
    expect(r.report.errors[0].message).toContain('different-id');
  });

  it('returns network_error when fetch throws', async () => {
    const fetchFn: any = jest.fn(async () => {
      throw new Error('connection refused');
    });
    const r = await fetchAndParseFeed(
      { url: 'https://x/feed.json', sourceType: 'json', registeredPublisherId: 'test-pub' },
      fetchFn,
    );
    expect(r.fetchStatus).toBe('network_error');
    expect(r.report.errors[0].message).toContain('connection refused');
  });

  it('unwraps err.cause for opaque "fetch failed" network errors', async () => {
    // Real Node fetch errors look like: top-level message "fetch failed",
    // with the actual diagnostic on err.cause. Without unwrapping, admins
    // see no useful info; with it, they see "getaddrinfo ENOTFOUND host".
    const fetchFn: any = jest.fn(async () => {
      const err = new Error('fetch failed') as Error & {
        cause?: { code?: string; message?: string };
      };
      err.cause = { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND example.com' };
      throw err;
    });
    const r = await fetchAndParseFeed(
      { url: 'https://example.com/feed.json', sourceType: 'json', registeredPublisherId: 'test-pub' },
      fetchFn,
    );
    expect(r.fetchStatus).toBe('network_error');
    const msg = r.report.errors[0].message;
    expect(msg).toContain('fetch failed');
    expect(msg).toContain('getaddrinfo ENOTFOUND example.com');
    // The code must not appear twice — Node's message already includes it,
    // so a naive `[code, message].join(' ')` would produce a duplicate.
    expect(msg.match(/ENOTFOUND/g)?.length).toBe(1);
  });

  it('falls back to err.cause.code when cause has no message', async () => {
    const fetchFn: any = jest.fn(async () => {
      const err = new Error('fetch failed') as Error & {
        cause?: { code?: string; message?: string };
      };
      err.cause = { code: 'ECONNREFUSED' };
      throw err;
    });
    const r = await fetchAndParseFeed(
      { url: 'https://example.com/feed.json', sourceType: 'json', registeredPublisherId: 'test-pub' },
      fetchFn,
    );
    expect(r.fetchStatus).toBe('network_error');
    expect(r.report.errors[0].message).toContain('ECONNREFUSED');
  });

  it('returns a clean timeout message on AbortError without leaking cause', async () => {
    const fetchFn: any = jest.fn(async () => {
      const err = new Error('The operation was aborted') as Error & {
        cause?: { name?: string; message?: string };
      };
      err.name = 'AbortError';
      // Some Node versions attach a DOMException-shaped cause; the fetcher
      // must not append it to the message.
      err.cause = { name: 'AbortError', message: 'The operation was aborted' };
      throw err;
    });
    const r = await fetchAndParseFeed(
      { url: 'https://example.com/feed.json', sourceType: 'json', registeredPublisherId: 'test-pub' },
      fetchFn,
    );
    expect(r.fetchStatus).toBe('network_error');
    expect(r.report.errors[0].message).toMatch(/timed out after \d+ms/);
    expect(r.report.errors[0].message).not.toContain('aborted');
  });

  it('passes an AbortSignal to fetch (timeout protection)', async () => {
    const fetchFn: any = jest.fn(async (_url: string, init: any) => ({
      ok: true,
      status: 200,
      text: async () => fix('valid-feed.json'),
      headers: { get: () => 'application/json' },
      _signal: init.signal,
    }));
    await fetchAndParseFeed(
      { url: 'https://x/feed.json', sourceType: 'json', registeredPublisherId: 'test-pub' },
      fetchFn,
    );
    const init = fetchFn.mock.calls[0][1];
    expect(init.signal).toBeDefined();
    expect(init.signal.constructor.name).toBe('AbortSignal');
  });
});
