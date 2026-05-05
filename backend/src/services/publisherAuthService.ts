// Publisher JWT signing + verification.
//
// Separate from the admin JWT service (handlers/adminAuth/...) so a leak of
// the publisher signing key cannot impersonate an admin.
//
// JWT claims:
//   sub          string  — publisher record id (UUID for self-applied rows,
//                          slug for admin-created rows)
//   role         'publisher'
//   email        string  — normalized lowercase contact email
//   iat / exp    standard
//
// HS256, 7-day expiry. Token issued ONLY after a successful magic-link
// verify; users must re-authenticate weekly.

import jwt from 'jsonwebtoken';
import { getPublisherJwtSecret } from './publisherSecretCache';

export interface PublisherClaims {
  sub: string;        // publisher id
  role: 'publisher';
  email: string;
  // Identity-version counter copied from PublisherRecord.tokenVersion at sign
  // time. Must equal the row's current value at verify time, otherwise the
  // session is treated as invalid (see services/publisherSession.ts).
  // Defaults to 0 for legacy rows / callers that omit the field.
  tokenVersion: number;
  iat?: number;
  exp?: number;
}

const DEFAULT_EXPIRY = '7d';

export async function signPublisherJwt(
  payload: { publisherId: string; email: string; tokenVersion?: number },
  expiresIn: string | number = DEFAULT_EXPIRY,
): Promise<string> {
  const secret = await getPublisherJwtSecret();
  return jwt.sign(
    {
      sub: payload.publisherId,
      role: 'publisher' as const,
      email: payload.email.trim().toLowerCase(),
      tokenVersion: payload.tokenVersion ?? 0,
    },
    secret,
    { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] },
  );
}

export async function verifyPublisherJwt(token: string): Promise<PublisherClaims | null> {
  if (typeof token !== 'string' || token.length === 0) return null;
  const secret = await getPublisherJwtSecret();
  try {
    const decoded = jwt.verify(token, secret);
    if (typeof decoded !== 'object' || decoded === null) return null;
    const c = decoded as Record<string, unknown>;
    if (
      typeof c.sub !== 'string' ||
      typeof c.email !== 'string' ||
      c.role !== 'publisher' ||
      typeof c.tokenVersion !== 'number'
    ) {
      return null;
    }
    return {
      sub: c.sub,
      role: 'publisher',
      email: c.email,
      tokenVersion: c.tokenVersion,
      iat: typeof c.iat === 'number' ? c.iat : undefined,
      exp: typeof c.exp === 'number' ? c.exp : undefined,
    };
  } catch {
    // jwt.verify throws on expired / invalid signature / malformed.
    return null;
  }
}
