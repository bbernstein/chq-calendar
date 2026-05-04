import { resolveAndValidateUrl, validateUrlIsPublic } from '../services/urlGuard';

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

describe('resolveAndValidateUrl (Phase D — DNS-rebinding mitigation)', () => {
  // The lookup signature matches `dns.promises.lookup(host, { all: true })`.
  const mkLookup = (
    addresses: Array<{ address: string; family: number }>,
  ) => jest.fn(async () => addresses) as any;

  const mkLookupThrowing = (err: Error) => jest.fn(async () => {
    throw err;
  }) as any;

  it('passes through string-check rejection without calling DNS', async () => {
    const lookup = mkLookup([{ address: '8.8.8.8', family: 4 }]);
    const r = await resolveAndValidateUrl('http://localhost/feed', lookup);
    expect(r.ok).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('skips DNS lookup for IPv4 literals (string check already covers them)', async () => {
    const lookup = mkLookup([]);
    const r = await resolveAndValidateUrl('https://8.8.8.8/feed', lookup);
    expect(r.ok).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('skips DNS lookup for IPv6 literals', async () => {
    const lookup = mkLookup([]);
    const r = await resolveAndValidateUrl('https://[2606:4700:4700::1111]/feed', lookup);
    expect(r.ok).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('accepts a hostname that resolves to a public IPv4', async () => {
    const lookup = mkLookup([{ address: '93.184.216.34', family: 4 }]);
    const r = await resolveAndValidateUrl('https://example.com/feed', lookup);
    expect(r.ok).toBe(true);
    expect(lookup).toHaveBeenCalledWith('example.com', expect.objectContaining({ all: true }));
  });

  it('accepts a hostname that resolves to a public IPv6', async () => {
    const lookup = mkLookup([{ address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }]);
    const r = await resolveAndValidateUrl('https://example.org/feed', lookup);
    expect(r.ok).toBe(true);
  });

  it('rejects a hostname whose DNS returns a private IPv4', async () => {
    const lookup = mkLookup([{ address: '192.168.1.10', family: 4 }]);
    const r = await resolveAndValidateUrl('https://feed.evil.test/x', lookup);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.reason).toMatch(/private\/loopback/);
  });

  it('rejects a hostname whose DNS returns a loopback IPv4 (the rebinding payload)', async () => {
    const lookup = mkLookup([{ address: '127.0.0.1', family: 4 }]);
    const r = await resolveAndValidateUrl('https://rebind.evil.test/x', lookup);
    expect(r.ok).toBe(false);
  });

  it('rejects a hostname whose DNS returns a link-local IPv4 (AWS metadata service)', async () => {
    const lookup = mkLookup([{ address: '169.254.169.254', family: 4 }]);
    const r = await resolveAndValidateUrl('https://metadata.evil.test/latest', lookup);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.reason).toMatch(/169\.254\.169\.254/);
  });

  it('rejects a hostname whose DNS returns a loopback IPv6', async () => {
    const lookup = mkLookup([{ address: '::1', family: 6 }]);
    const r = await resolveAndValidateUrl('https://rebind6.evil.test/x', lookup);
    expect(r.ok).toBe(false);
  });

  it('rejects when ANY address in a multi-A response is private (split-horizon DNS)', async () => {
    const lookup = mkLookup([
      { address: '93.184.216.34', family: 4 }, // public
      { address: '10.0.0.5', family: 4 },       // private — taints the whole response
    ]);
    const r = await resolveAndValidateUrl('https://mixed.evil.test/x', lookup);
    expect(r.ok).toBe(false);
  });

  it('rejects when DNS returns no records', async () => {
    const lookup = mkLookup([]);
    const r = await resolveAndValidateUrl('https://nonexistent.evil.test/x', lookup);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.reason).toMatch(/did not resolve/);
  });

  it('rejects when DNS lookup throws (NXDOMAIN, network failure, etc.)', async () => {
    const lookup = mkLookupThrowing(new Error('ENOTFOUND'));
    const r = await resolveAndValidateUrl('https://nope.evil.test/x', lookup);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.reason).toMatch(/DNS lookup failed/);
  });
});
