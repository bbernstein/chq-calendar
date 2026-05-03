import * as fs from 'fs';
import * as path from 'path';
import { testPublisherFeed } from '../services/publisherTestService';

const fix = (n: string) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

const mockFetch = (body: string, contentType: string, ok = true): any =>
  jest.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    text: async () => body,
    headers: { get: () => contentType },
  }));

describe('testPublisherFeed', () => {
  describe('URL guard', () => {
    it('rejects with kind=error for blocked localhost URL', async () => {
      const r = await testPublisherFeed(
        { url: 'http://localhost/feed.json', sourceType: 'json' },
        mockFetch('{}', 'application/json'),
      );
      expect(r.kind).toBe('error');
      if (r.kind === 'error') {
        expect(r.error.kind).toBe('blocked_url');
      }
    });

    it('rejects with kind=error for private 10.x IPv4', async () => {
      const r = await testPublisherFeed(
        { url: 'http://10.0.0.5/feed.json', sourceType: 'json' },
        mockFetch('{}', 'application/json'),
      );
      expect(r.kind).toBe('error');
    });

    it('rejects with kind=error for unsupported scheme', async () => {
      const r = await testPublisherFeed(
        { url: 'file:///etc/passwd', sourceType: 'json' },
        mockFetch('{}', 'application/json'),
      );
      expect(r.kind).toBe('error');
    });

    it('does NOT call fetchFn when URL is blocked', async () => {
      const fetchFn = mockFetch('{}', 'application/json');
      await testPublisherFeed(
        { url: 'http://127.0.0.1/feed.json', sourceType: 'json' },
        fetchFn,
      );
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('returns kind=ok with fetchStatus=ok for a valid JSON feed (no publisherId)', async () => {
      const r = await testPublisherFeed(
        { url: 'https://example.com/feed.json', sourceType: 'json' },
        mockFetch(fix('valid-feed.json'), 'application/json'),
      );
      expect(r.kind).toBe('ok');
      if (r.kind === 'ok') {
        expect(r.output.fetchStatus).toBe('ok');
        expect(r.output.feed).not.toBeNull();
        expect(r.output.feed!.events.length).toBeGreaterThan(0);
        expect(r.output.report.ok).toBe(true);
      }
    });

    it('returns kind=ok with fetchStatus=ok when publisherId matches', async () => {
      const r = await testPublisherFeed(
        {
          url: 'https://example.com/feed.json',
          sourceType: 'json',
          publisherId: 'test-pub',
        },
        mockFetch(fix('valid-feed.json'), 'application/json'),
      );
      expect(r.kind).toBe('ok');
      if (r.kind === 'ok') {
        expect(r.output.fetchStatus).toBe('ok');
        expect(r.output.feed).not.toBeNull();
      }
    });
  });

  describe('publisher.id mismatch handling', () => {
    it('skips publisher.id check when publisherId is omitted (returns ok)', async () => {
      // The fixture has publisher.id = "test-pub"; we omit publisherId so the
      // check should be skipped entirely and the feed should validate ok.
      const r = await testPublisherFeed(
        { url: 'https://example.com/feed.json', sourceType: 'json' },
        mockFetch(fix('valid-feed.json'), 'application/json'),
      );
      expect(r.kind).toBe('ok');
      if (r.kind === 'ok') {
        expect(r.output.fetchStatus).toBe('ok');
      }
    });

    it('returns validation_error when publisherId is supplied and does not match', async () => {
      const r = await testPublisherFeed(
        {
          url: 'https://example.com/feed.json',
          sourceType: 'json',
          publisherId: 'some-other-id',
        },
        mockFetch(fix('valid-feed.json'), 'application/json'),
      );
      expect(r.kind).toBe('ok');
      if (r.kind === 'ok') {
        expect(r.output.fetchStatus).toBe('validation_error');
        expect(r.output.feed).toBeNull();
        expect(r.output.report.errors.some(e => e.path === '/publisher/id')).toBe(true);
      }
    });
  });

  describe('parse / network errors are surfaced inside the output', () => {
    it('returns kind=ok with fetchStatus=parse_error for malformed JSON', async () => {
      const r = await testPublisherFeed(
        { url: 'https://example.com/feed.json', sourceType: 'json' },
        mockFetch('not json {{{', 'application/json'),
      );
      expect(r.kind).toBe('ok');
      if (r.kind === 'ok') {
        expect(r.output.fetchStatus).toBe('parse_error');
        expect(r.output.feed).toBeNull();
      }
    });

    it('returns kind=ok with fetchStatus=network_error on non-2xx response', async () => {
      const r = await testPublisherFeed(
        { url: 'https://example.com/feed.json', sourceType: 'json' },
        mockFetch('', 'application/json', false),
      );
      expect(r.kind).toBe('ok');
      if (r.kind === 'ok') {
        expect(r.output.fetchStatus).toBe('network_error');
      }
    });

    it('returns kind=ok with fetchStatus=network_error when fetch throws', async () => {
      const fetchFn: any = jest.fn(async () => {
        throw new Error('connection reset');
      });
      const r = await testPublisherFeed(
        { url: 'https://example.com/feed.json', sourceType: 'json' },
        fetchFn,
      );
      expect(r.kind).toBe('ok');
      if (r.kind === 'ok') {
        expect(r.output.fetchStatus).toBe('network_error');
      }
    });
  });
});
