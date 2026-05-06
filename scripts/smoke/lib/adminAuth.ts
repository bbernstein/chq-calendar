// Smoke admin token signer. Mirrors backend/src/services/smokeAdminAuth.ts'
// verifier — they MUST agree on signing key, algorithm, claims, and TTL
// shape. Any drift here = the smoke fails admin auth at runtime.
//
// The signing key comes from env SMOKE_ADMIN_SIGNING_KEY. In CI this is a
// GitHub repo secret; locally a developer can set it to the same value
// provisioned to the staging admin Lambda for ad-hoc smoke runs.
//
// We sign per-request rather than caching one token across the test
// because (1) tokens are 5-minute TTL by default, and (2) the smoke calls
// admin routes interleaved with publisher routes — caching wouldn't save
// meaningful wall-clock.

import jwt from 'jsonwebtoken';

const DEFAULT_TTL_SEC = 5 * 60;

export function signSmokeAdminToken(opts: { ttlSec?: number } = {}): string {
  const key = process.env.SMOKE_ADMIN_SIGNING_KEY;
  if (!key) {
    throw new Error(
      'SMOKE_ADMIN_SIGNING_KEY env var is not set — cannot sign smoke admin token. ' +
      'Set this to the same value provisioned to the admin Lambda env ADMIN_SMOKE_SIGNING_KEY.',
    );
  }
  return jwt.sign(
    { sub: 'smoke-bot', iss: 'smoke' },
    key,
    {
      algorithm: 'HS256',
      expiresIn: opts.ttlSec ?? DEFAULT_TTL_SEC,
    },
  );
}
