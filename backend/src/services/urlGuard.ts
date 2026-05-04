// SSRF / abuse guard for the public publisher-test endpoint.
//
// Phase A scope: string-based check on the URL's hostname. We reject the
// obvious local/private/loopback/link-local ranges before any fetch is made.
//
// Phase D adds `resolveAndValidateUrl` — a stricter variant that also runs
// a DNS lookup and rejects if any resolved IP falls inside the same
// blocked ranges. This closes the obvious DNS-rebinding hole where a
// public hostname (e.g. `feed.example.com`) is configured to resolve to
// 192.168.1.1.
//
// Residual risk: between our DNS resolution and Node's HTTP-client
// resolution there is a tiny window in which the upstream resolver could
// return a different answer. Closing this window completely would require
// fetching the literal resolved IP with a `Host:` header, which is
// materially more code (especially for HTTPS + SNI) and not justified by
// the threat model — a hostile DNS server is the only way to exploit, and
// the rate limiter caps the damage at 10 attempts per 5 minutes per IP.

const MAX_URL_LENGTH = 2048;

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// Hostnames that should always be rejected, regardless of any IP shenanigans.
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
]);

// Returns true if `host` is an IPv4 dotted-quad in a private / loopback /
// link-local / CGNAT range. Returns false for non-IPv4-literal strings (e.g.
// regular DNS hostnames) — those are accepted at this layer.
function isBlockedIPv4(host: string): boolean {
  // Only treat as IPv4 if it parses cleanly as four 0..255 octets.
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const octets: number[] = [];
  for (const p of parts) {
    if (!/^[0-9]+$/.test(p)) return false;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return false;
    octets.push(n);
  }
  const [a, b] = octets;
  // 0.0.0.0/8 — "this network"
  if (a === 0) return true;
  // 10.0.0.0/8 — private
  if (a === 10) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 — private
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 — private
  if (a === 192 && b === 168) return true;
  // 100.64.0.0/10 — CGNAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

// IPv6 string check. Node's URL.hostname keeps the surrounding [] for IPv6
// literals, so we strip them first. Node also normalises IPv4-mapped
// addresses to hex form (e.g. ::ffff:127.0.0.1 → ::ffff:7f00:1), which we
// recognise and decode below.
function isBlockedIPv6(rawHost: string): boolean {
  // Strip surrounding brackets if present (Node's URL.hostname includes them).
  const host = rawHost.startsWith('[') && rawHost.endsWith(']')
    ? rawHost.slice(1, -1)
    : rawHost;
  if (!host.includes(':')) return false;
  const lower = host.toLowerCase();
  // Loopback ::1 (and any zero-padded variant like 0:0:0:0:0:0:0:1).
  if (/^(0+:){0,6}0*1$/.test(lower) || lower === '::1') return true;
  // Unspecified ::
  if (lower === '::') return true;
  // Unique local fc00::/7 — first 7 bits of the address are 1111 110.
  // First hextet is fc00..fdff.
  const firstHextetMatch = lower.match(/^([0-9a-f]{1,4}):/);
  if (firstHextetMatch) {
    const first = parseInt(firstHextetMatch[1], 16);
    // fc00::/7 → 0xfc00 .. 0xfdff
    if (first >= 0xfc00 && first <= 0xfdff) return true;
    // fe80::/10 → first hextet 0xfe80 .. 0xfebf
    if (first >= 0xfe80 && first <= 0xfebf) return true;
  }
  // IPv4-mapped IPv6 (textual form ::ffff:a.b.c.d) — Node normalises this
  // to hex, so we also handle ::ffff:HHHH:HHHH below.
  const v4MappedTextual = lower.match(/^::ffff:([0-9.]+)$/);
  if (v4MappedTextual && isBlockedIPv4(v4MappedTextual[1])) return true;
  // IPv4-mapped, hex form: ::ffff:HHHH:HHHH (e.g. ::ffff:7f00:1).
  const v4MappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (v4MappedHex) {
    const high = parseInt(v4MappedHex[1], 16);
    const low = parseInt(v4MappedHex[2], 16);
    const a = (high >> 8) & 0xff;
    const b = high & 0xff;
    const c = (low >> 8) & 0xff;
    const d = low & 0xff;
    if (isBlockedIPv4(`${a}.${b}.${c}.${d}`)) return true;
  }
  return false;
}

export type UrlGuardResult = { ok: true } | { ok: false; reason: string };

/**
 * Validate that `url` is safe to fetch from a public-facing endpoint:
 *   - is http or https
 *   - is not absurdly long
 *   - does not target localhost / loopback / private / link-local IPs
 *
 * Note: DNS-rebinding / hostname-resolution checks are NOT performed here —
 * deferred to Phase D.
 */
export function validateUrlIsPublic(url: string): UrlGuardResult {
  if (typeof url !== 'string' || url.length === 0) {
    return { ok: false, reason: 'URL is required' };
  }
  if (url.length > MAX_URL_LENGTH) {
    return { ok: false, reason: `URL exceeds maximum length of ${MAX_URL_LENGTH} characters` };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'URL is not a valid absolute URL' };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, reason: `Unsupported URL scheme: ${parsed.protocol}` };
  }

  // URL.hostname is already lowercased for DNS hostnames; for IPv6 it strips
  // the surrounding brackets.
  const host = parsed.hostname.toLowerCase();
  if (host.length === 0) {
    return { ok: false, reason: 'URL has no hostname' };
  }

  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, reason: `Hostname is not allowed: ${host}` };
  }

  // Block any hostname that ends with .localhost (RFC 6761) — e.g.
  // "evil.localhost" should not bypass this guard.
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return { ok: false, reason: `Hostname is not allowed: ${host}` };
  }

  if (isBlockedIPv4(host)) {
    return { ok: false, reason: `Hostname resolves to a private/loopback IPv4 range: ${host}` };
  }

  if (isBlockedIPv6(host)) {
    return { ok: false, reason: `Hostname resolves to a private/loopback IPv6 range: ${host}` };
  }

  return { ok: true };
}

// ─── Phase D: DNS-aware guard ───────────────────────────────────────────

import { promises as dnsPromises } from 'dns';

// Injectable for tests.
type LookupFn = (
  hostname: string,
  options: { all: true; verbatim?: boolean },
) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: LookupFn = (hostname, options) =>
  dnsPromises.lookup(hostname, options) as ReturnType<LookupFn>;

/**
 * Stricter variant of `validateUrlIsPublic`: also resolves the hostname
 * via DNS and rejects if ANY returned address falls inside a blocked
 * IPv4/IPv6 range. Defends against DNS-rebinding setups where a hostile
 * DNS server returns a public IP at validation time and a private one at
 * fetch time — `lookup({ all: true })` returns every A/AAAA record so a
 * mixed answer still triggers a rejection.
 *
 * If the URL hostname is already an IP literal, the string-only guard
 * already covers it and we skip the lookup.
 *
 * The `lookup` parameter exists for unit tests; production callers omit
 * it to use Node's resolver.
 */
export async function resolveAndValidateUrl(
  url: string,
  lookup: LookupFn = defaultLookup,
): Promise<UrlGuardResult> {
  const stringCheck = validateUrlIsPublic(url);
  if (!stringCheck.ok) return stringCheck;

  const parsed = new URL(url); // already validated above
  const host = parsed.hostname.toLowerCase();

  // IP literal? string check already covered it.
  if (looksLikeIpLiteral(host)) {
    return { ok: true };
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: `DNS lookup failed for hostname: ${host}` };
  }

  if (addresses.length === 0) {
    return { ok: false, reason: `Hostname did not resolve to any address: ${host}` };
  }

  for (const entry of addresses) {
    const blocked = entry.family === 6
      ? isBlockedIPv6(entry.address)
      : isBlockedIPv4(entry.address);
    if (blocked) {
      return {
        ok: false,
        reason: `Hostname ${host} resolves to a private/loopback address (${entry.address}); refusing to fetch`,
      };
    }
  }

  return { ok: true };
}

function looksLikeIpLiteral(host: string): boolean {
  // Tight match: exactly four dotted decimal octets. Any looser pattern
  // would let numeric forms like "2130706433" (decimal encoding of
  // 127.0.0.1) skip the DNS-aware guard while ALSO not matching
  // isBlockedIPv4 (which requires four octets) — the URL would fetch
  // localhost via Node's URL parser. Mirroring isBlockedIPv4's structure
  // closes that gap.
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return true;
  // IPv6 literal: contains a colon (URL.hostname strips the [...]).
  if (host.includes(':')) return true;
  return false;
}
