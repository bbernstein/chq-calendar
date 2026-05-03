// Phase A publisher-portal Lambda handler.
//
// Hosts the public, unauthenticated POST /publisher-test endpoint that powers
// the prospective-publisher self-service test page (frontend Phase A,
// /publish/test/).
//
// ─── Routing decision ────────────────────────────────────────────────────
// The plan offered two options for plumbing this into the existing API:
//   X) Add a route branch inside adminHandler.ts.
//   Y) Create a new dedicated Lambda + Terraform routing.
//
// We chose X for Phase A: faster to ship, no Terraform changes, and the
// only "drawback" is that adminHandler.ts now contains a non-admin route.
// To minimise the coupling, we keep the actual handler code here in a
// dedicated module and have adminHandler.ts delegate to `handlePublisherTest`.
// Phase D can wire this module up as its own Lambda function URL without
// further refactoring.

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { testPublisherFeed } from '../services/publisherTestService';

// ─── Rate limiter ────────────────────────────────────────────────────────
// In-memory per-IP sliding window. Per-instance only — each Lambda warm
// container has its own state. TODO (Phase D): swap for a DynamoDB-backed
// counter so the limit holds across containers.
const PUBLISHER_TEST_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const PUBLISHER_TEST_RATE_LIMIT_MAX = 10;
const _state = new Map<string, number[]>();

export function checkPublisherTestRateLimit(
  ip: string,
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = Date.now();
  const windowStart = now - PUBLISHER_TEST_RATE_LIMIT_WINDOW_MS;
  const existing = _state.get(ip) ?? [];
  const recent = existing.filter(t => t > windowStart);
  if (recent.length >= PUBLISHER_TEST_RATE_LIMIT_MAX) {
    const oldest = recent[0];
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldest + PUBLISHER_TEST_RATE_LIMIT_WINDOW_MS - now) / 1000),
    );
    _state.set(ip, recent);
    return { ok: false, retryAfterSeconds };
  }
  recent.push(now);
  _state.set(ip, recent);
  return { ok: true };
}

// Test-only: clear the rate-limit state between test cases.
export function _resetPublisherTestRateLimitForTests(): void {
  _state.clear();
}

// ─── Response helpers ────────────────────────────────────────────────────
const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  headers: corsHeaders,
  body: JSON.stringify(body),
});

// ─── /publisher-test handler ─────────────────────────────────────────────
//
// Request body:
//   { url: string, sourceType: 'json' | 'html', publisherId?: string }
//
// Response (200): { fetchStatus, feed, report }
//   — fetch/parse/validation failures are reported as part of the payload,
//     NOT as HTTP errors.
//
// Response (400): { error } — caller-side errors (missing/invalid fields,
//   URL blocked by SSRF guard).
//
// Response (429): { error } — rate-limit exceeded; sets Retry-After.
export async function handlePublisherTest(
  event: APIGatewayProxyEvent,
  requestBody: Record<string, unknown>,
): Promise<APIGatewayProxyResult> {
  const sourceIp =
    event.requestContext?.identity?.sourceIp ||
    event.headers?.['x-forwarded-for'] ||
    event.headers?.['X-Forwarded-For'] ||
    'unknown';
  const ip = typeof sourceIp === 'string' ? sourceIp : 'unknown';
  const rl = checkPublisherTestRateLimit(ip);
  if (rl.ok === false) {
    return {
      statusCode: 429,
      headers: { ...corsHeaders, 'Retry-After': String(rl.retryAfterSeconds) },
      body: JSON.stringify({
        error: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds} seconds.`,
      }),
    };
  }

  const { url, sourceType, publisherId } = requestBody as {
    url?: unknown;
    sourceType?: unknown;
    publisherId?: unknown;
  };

  if (typeof url !== 'string' || url.length === 0) {
    return json(400, { error: 'Missing or invalid `url` (string required)' });
  }
  if (sourceType !== 'json' && sourceType !== 'html') {
    return json(400, {
      error: 'Missing or invalid `sourceType` (must be "json" or "html")',
    });
  }
  if (publisherId !== undefined && typeof publisherId !== 'string') {
    return json(400, { error: '`publisherId` must be a string when supplied' });
  }

  try {
    const result = await testPublisherFeed({
      url,
      sourceType,
      publisherId: typeof publisherId === 'string' ? publisherId : undefined,
    });
    if (result.kind === 'error') {
      // Caller-side error: blocked URL → HTTP 400.
      return json(400, { error: result.error.reason });
    }
    const out = result.output;
    return json(200, {
      fetchStatus: out.fetchStatus,
      feed: out.feed,
      report: out.report,
    });
  } catch (err) {
    console.error('Error in /publisher-test:', err);
    return json(500, {
      error: 'Internal server error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
