/**
 * Auth helper for integration tests.
 *
 * Mirrors the localStorage shapes used by:
 *   - frontend/src/lib/auth.ts            — admin (`chq_auth_token` + user)
 *   - frontend/src/lib/publisherAuthClient.ts — publisher portal (`chq_publisher_*`)
 *
 * The publisher JWT must include a real-looking `exp` claim because
 * isPublisherAuthenticated() decodes it and treats anything without an exp
 * (or with an expired exp) as logged out. We synthesize a minimal HS256-shape
 * JWT with `exp` set far in the future. The signature is gibberish; nothing
 * in the frontend verifies it.
 */

import {
  AUTH_TOKEN_KEY,
  AUTH_USER_KEY,
  type AuthUser,
} from '@/lib/auth';
import {
  PUBLISHER_EMAIL_KEY,
  PUBLISHER_ID_KEY,
  PUBLISHER_JWT_KEY,
} from '@/lib/publisherAuthClient';

function base64url(input: object): string {
  return btoa(JSON.stringify(input))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** Build a JWT that decodes cleanly and has an `exp` far in the future. */
function makePublisherJwt(opts: { publisherId: string; email: string; ttlSec?: number }): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + (opts.ttlSec ?? 3600);
  const payload = {
    sub: opts.publisherId,
    email: opts.email,
    iat: Math.floor(Date.now() / 1000),
    exp,
  };
  // Signature is a constant placeholder — no client code verifies it.
  return `${base64url(header)}.${base64url(payload)}.test-signature`;
}

export interface PublisherLoginOpts {
  publisherId?: string;
  email?: string;
  jwt?: string;
}

export function loginAsPublisher(opts: PublisherLoginOpts = {}): {
  publisherId: string;
  email: string;
  jwt: string;
} {
  const publisherId = opts.publisherId ?? 'pub-test-1';
  const email = opts.email ?? 'pub@example.test';
  const jwt = opts.jwt ?? makePublisherJwt({ publisherId, email });
  localStorage.setItem(PUBLISHER_JWT_KEY, jwt);
  localStorage.setItem(PUBLISHER_ID_KEY, publisherId);
  localStorage.setItem(PUBLISHER_EMAIL_KEY, email);
  return { publisherId, email, jwt };
}

export interface AdminLoginOpts {
  email?: string;
  name?: string;
  jwt?: string;
}

export function loginAsAdmin(opts: AdminLoginOpts = {}): AuthUser & { jwt: string } {
  const email = opts.email ?? 'admin@example.test';
  const name = opts.name ?? 'Admin User';
  const jwt = opts.jwt ?? 'test-admin-jwt';
  localStorage.setItem(AUTH_TOKEN_KEY, jwt);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify({ email, name }));
  return { email, name, jwt };
}

export function logout(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  localStorage.removeItem(PUBLISHER_JWT_KEY);
  localStorage.removeItem(PUBLISHER_ID_KEY);
  localStorage.removeItem(PUBLISHER_EMAIL_KEY);
}
