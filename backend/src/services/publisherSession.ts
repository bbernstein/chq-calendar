// Centralised publisher-session check used by every authenticated publisher
// portal route.
//
// Responsibilities:
//   1. Read and validate the `Authorization: Bearer <jwt>` header.
//   2. Verify the JWT signature, expiry, and shape (publisherAuthService).
//   3. Look up the publisher row referenced by the `sub` claim.
//   4. Refuse the session if the JWT's tokenVersion claim no longer matches
//      the row's current tokenVersion — this is how email-change verify and
//      self-disable invalidate already-issued tokens without standing up a
//      revocation list.
//
// Result kinds:
//   - 'unauthorized'      → handler should return 401 with `message`.
//   - 'publisher_missing' → handler should return 404 (row deleted but the
//                            JWT is otherwise valid; frontend should clear
//                            local session state).
//   - 'ok'                → handler may proceed; receives claims + the row.
//
// Anything thrown by registry.get propagates so handlers can map it to 500.

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { verifyPublisherJwt, type PublisherClaims } from './publisherAuthService';
import type { PublisherRegistryService } from './publisherRegistryService';
import type { PublisherRecord } from '../types/publisher';

export type SessionResult =
  | { kind: 'unauthorized'; message: string }
  | { kind: 'publisher_missing' }
  | { kind: 'ok'; claims: PublisherClaims; publisher: PublisherRecord };

export async function requirePublisherSession(
  event: APIGatewayProxyEvent,
  registry: PublisherRegistryService,
): Promise<SessionResult> {
  const auth = readBearer(event);
  if (!auth) return { kind: 'unauthorized', message: 'Authentication required' };
  const claims = await verifyPublisherJwt(auth);
  if (!claims) return { kind: 'unauthorized', message: 'Authentication required' };
  const publisher = await registry.get(claims.sub);
  if (!publisher) return { kind: 'publisher_missing' };
  // Treat missing tokenVersion on the row as 0 — see PublisherRecord docs.
  const currentVersion = publisher.tokenVersion ?? 0;
  if (claims.tokenVersion !== currentVersion) {
    return {
      kind: 'unauthorized',
      message: 'Session is no longer valid; please sign in again.',
    };
  }
  return { kind: 'ok', claims, publisher };
}

// Header lookup is case-insensitive — APIGatewayProxyEvent normalizes to the
// caller's casing, so we check both common forms.
function readBearer(event: APIGatewayProxyEvent): string | null {
  const headers = event.headers ?? {};
  const raw = headers.Authorization ?? headers.authorization;
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
