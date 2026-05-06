// Smoke-bot admin auth verifier for the post-deploy publisher-lifecycle
// smoke test (scripts/smoke/publisher-lifecycle.test.ts).
//
// The smoke runs against the real production stack and needs to drive a
// handful of admin-only endpoints (approve application, list publishers,
// run ingest, smoke reset, etc.) without going through the Google OAuth
// flow. Rather than minting a per-run service-account credential, we issue
// a short-lived HS256 JWT signed with a shared secret (env
// ADMIN_SMOKE_SIGNING_KEY) that's provisioned to:
//   - the admin Lambda's environment, AND
//   - the deploy-production.yml workflow as a GitHub secret.
//
// The signing key NEVER overlaps with the regular admin JWT_SECRET (which
// signs Google-OAuth-derived sessions). A leak of the smoke key cannot
// forge a normal admin session.
//
// Security envelope:
//   - HS256 with a 256-bit-random secret (provisioned via Terraform).
//   - sub claim MUST equal 'smoke-bot'. iss claim MUST equal 'smoke'.
//   - Token MUST be unexpired.
//   - Even when the verifier admits the token, the caller (adminHandler)
//     MUST cross-check `route` against SMOKE_ADMIN_ROUTE_ALLOWLIST. The
//     verifier returns the principal; route gating is the caller's job.
//     This split is intentional: routing context is in the handler, not
//     here, and we want the route allowlist to live next to the routes
//     it gates.

import jwt from 'jsonwebtoken';

export interface SmokeAdminPrincipal {
  sub: 'smoke-bot';
  iss: 'smoke';
}

/**
 * Returns the smoke principal when the bearer token is a valid, unexpired
 * smoke-bot HS256 JWT. Returns `null` for every other case (no env, no
 * header, malformed header, bad signature, wrong claims, expired) — the
 * caller treats `null` as "smoke auth not applicable" and either
 * proceeds to the next auth strategy or returns 401.
 *
 * `authHeader` is the raw Authorization header value (e.g. "Bearer eyJ..."),
 * NOT the bare token. Mirrors the pattern in adminHandler.authenticateRequest.
 */
export function verifySmokeAdminToken(
  authHeader: string | undefined,
): SmokeAdminPrincipal | null {
  const key = process.env.ADMIN_SMOKE_SIGNING_KEY;
  if (!key) return null;
  if (typeof authHeader !== 'string' || authHeader.length === 0) return null;

  // Accept both "Bearer <jwt>" and a bare jwt — adminHandler's existing
  // X-Auth-Token path forwards the bare token, and we want a single
  // verifier helper either way.
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : authHeader.trim();
  if (token.length === 0) return null;

  let decoded: jwt.JwtPayload | string;
  try {
    decoded = jwt.verify(token, key, { algorithms: ['HS256'] });
  } catch {
    // jsonwebtoken throws TokenExpiredError, JsonWebTokenError, etc. We
    // intentionally collapse all of them to a single null return — the
    // caller cannot act on the distinction (the smoke doesn't produce
    // user-facing error messages here) and exposing the reason to logs
    // would just provide attackers with a side-channel into key state.
    return null;
  }

  if (typeof decoded !== 'object' || decoded === null) return null;
  if (decoded.sub !== 'smoke-bot') return null;
  if (decoded.iss !== 'smoke') return null;

  return { sub: 'smoke-bot', iss: 'smoke' };
}
