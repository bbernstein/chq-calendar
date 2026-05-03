import { validateUrlIsPublic } from '../services/urlGuard';

describe('validateUrlIsPublic', () => {
  describe('accepts', () => {
    it.each([
      'https://example.com/feed.json',
      'http://example.com/feed.json',
      'https://www.chqcal.org/cache/calendar-cache/all-events.json',
      'https://api.example.org:8443/v1/feed',
      'https://8.8.8.8/feed.json', // public IPv4
    ])('public url %s', (url) => {
      const r = validateUrlIsPublic(url);
      expect(r.ok).toBe(true);
    });
  });

  describe('rejects on scheme', () => {
    it.each([
      'file:///etc/passwd',
      'data:text/plain,hello',
      'javascript:alert(1)',
      'ftp://example.com/feed',
      'gopher://example.com/',
    ])('blocks scheme %s', (url) => {
      const r = validateUrlIsPublic(url);
      expect(r.ok).toBe(false);
    });
  });

  describe('rejects on hostname', () => {
    it.each([
      ['localhost', 'http://localhost/feed'],
      ['localhost-with-port', 'http://localhost:3000/feed'],
      ['*.localhost suffix', 'http://evil.localhost/feed'],
      ['ip6-localhost', 'http://ip6-localhost/feed'],
    ])('blocks %s', (_label, url) => {
      const r = validateUrlIsPublic(url);
      expect(r.ok).toBe(false);
    });
  });

  describe('rejects on private/loopback IPv4', () => {
    it.each([
      '127.0.0.1',
      '127.255.255.254',
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '192.168.1.1',
      '169.254.0.1',
      '169.254.169.254', // AWS instance metadata
      '0.0.0.0',
      '100.64.0.1', // CGNAT
    ])('blocks IPv4 %s', (ip) => {
      const r = validateUrlIsPublic(`http://${ip}/feed.json`);
      expect(r.ok).toBe(false);
    });
  });

  describe('rejects on private/loopback IPv6', () => {
    it.each([
      ['[::1]'],
      ['[fc00::1]'],
      ['[fd12:3456:789a::1]'],
      ['[fe80::1]'],
      ['[::ffff:127.0.0.1]'],
    ])('blocks IPv6 %s', (host) => {
      const r = validateUrlIsPublic(`http://${host}/feed`);
      expect(r.ok).toBe(false);
    });
  });

  describe('rejects on length', () => {
    it('rejects URLs longer than 2048 chars', () => {
      const url = 'https://example.com/' + 'a'.repeat(2050);
      const r = validateUrlIsPublic(url);
      expect(r.ok).toBe(false);
      if (r.ok === false) expect(r.reason).toMatch(/length/i);
    });

    it('accepts URLs at the boundary (2048 chars)', () => {
      const prefix = 'https://example.com/';
      const url = prefix + 'a'.repeat(2048 - prefix.length);
      expect(url.length).toBe(2048);
      const r = validateUrlIsPublic(url);
      expect(r.ok).toBe(true);
    });
  });

  describe('rejects on bad input', () => {
    it.each([
      ['empty string', ''],
      ['not a URL', 'not-a-url'],
      ['relative path', '/feed.json'],
    ])('rejects %s', (_label, url) => {
      const r = validateUrlIsPublic(url);
      expect(r.ok).toBe(false);
    });

    it('rejects non-string input', () => {
      const r = validateUrlIsPublic(undefined as unknown as string);
      expect(r.ok).toBe(false);
    });
  });
});
