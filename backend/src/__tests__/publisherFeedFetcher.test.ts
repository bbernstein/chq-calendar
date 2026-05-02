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
