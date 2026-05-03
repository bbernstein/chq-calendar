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
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { testPublisherFeed } from '../services/publisherTestService';
import { MagicTokenService } from '../services/magicTokenService';
import { SesMailService } from '../services/mailService';
import { PublisherRegistryService } from '../services/publisherRegistryService';
import { PublisherApplicationService } from '../services/publisherApplicationService';
import type { ApplyFormPayload } from '../types/publisher';

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

// ─── Apply / login flow rate limiter ─────────────────────────────────────
// Same in-memory pattern as the test endpoint, but a tighter window: 10
// requests per HOUR per IP. Apply/login emails are far more expensive (SES
// quota) than the test fetch, so we throttle harder. Phase D: move to DDB.
const PUBLISHER_AUTH_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const PUBLISHER_AUTH_RATE_LIMIT_MAX = 10;
const _authRateState = new Map<string, number[]>();

export function checkPublisherAuthRateLimit(
  ip: string,
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = Date.now();
  const windowStart = now - PUBLISHER_AUTH_RATE_LIMIT_WINDOW_MS;
  const existing = _authRateState.get(ip) ?? [];
  const recent = existing.filter(t => t > windowStart);
  if (recent.length >= PUBLISHER_AUTH_RATE_LIMIT_MAX) {
    const oldest = recent[0];
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldest + PUBLISHER_AUTH_RATE_LIMIT_WINDOW_MS - now) / 1000),
    );
    _authRateState.set(ip, recent);
    return { ok: false, retryAfterSeconds };
  }
  recent.push(now);
  _authRateState.set(ip, recent);
  return { ok: true };
}

export function _resetPublisherAuthRateLimitForTests(): void {
  _authRateState.clear();
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

// ─── Publisher application service singleton ─────────────────────────────
//
// One instance per Lambda warm container. The application service depends on
// SES + Secrets Manager + DynamoDB clients, all of which are cheap to keep
// alive across invocations.

let _appService: PublisherApplicationService | null = null;

function appService(): PublisherApplicationService {
  if (!_appService) {
    const dynamoClient = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.DYNAMODB_ENDPOINT && {
        endpoint: process.env.DYNAMODB_ENDPOINT,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'dummy',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'dummy',
        },
      }),
    });
    const docClient = DynamoDBDocumentClient.from(dynamoClient);
    const registry = new PublisherRegistryService(
      docClient,
      process.env.PUBLISHERS_TABLE_NAME ?? 'chautauqua-calendar-publishers',
    );
    const tokens = new MagicTokenService(
      docClient,
      process.env.PUBLISHER_MAGIC_TOKEN_TABLE_NAME ?? 'chautauqua-calendar-publisher-magic-tokens',
    );
    const mail = new SesMailService();
    _appService = new PublisherApplicationService({
      registry,
      tokens,
      mail,
      siteBaseUrl: process.env.SITE_BASE_URL ?? 'https://www.chqcal.org',
    });
  }
  return _appService;
}

// Test-only override (used by handler tests to inject a stub).
export function _setAppServiceForTests(svc: PublisherApplicationService | null): void {
  _appService = svc;
}

// ─── Auth-rate-limit + IP extraction shared helper ───────────────────────

function applyAuthRateLimit(event: APIGatewayProxyEvent): APIGatewayProxyResult | null {
  const sourceIp =
    event.requestContext?.identity?.sourceIp ||
    event.headers?.['x-forwarded-for'] ||
    event.headers?.['X-Forwarded-For'] ||
    'unknown';
  const ip = typeof sourceIp === 'string' ? sourceIp : 'unknown';
  const rl = checkPublisherAuthRateLimit(ip);
  if (rl.ok === false) {
    return {
      statusCode: 429,
      headers: { ...corsHeaders, 'Retry-After': String(rl.retryAfterSeconds) },
      body: JSON.stringify({
        error: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds} seconds.`,
      }),
    };
  }
  return null;
}

// ─── /publisher-apply/request ────────────────────────────────────────────
//
// Body: { name, email, organization?, sourceUrl, sourceType, notes? }
// Response: 200 { ok: true } on success, 400 on validation failure,
//           429 on rate-limit.
//
// The 200 response is intentionally generic (no enumeration possible) — we
// only reveal validation failures because they help the legitimate user fix
// their input.
export async function handlePublisherApplyRequest(
  event: APIGatewayProxyEvent,
  requestBody: Record<string, unknown>,
): Promise<APIGatewayProxyResult> {
  const limited = applyAuthRateLimit(event);
  if (limited) return limited;

  const payload = requestBody as Partial<ApplyFormPayload>;
  if (
    typeof payload?.name !== 'string' ||
    typeof payload?.email !== 'string' ||
    typeof payload?.sourceUrl !== 'string' ||
    typeof payload?.sourceType !== 'string'
  ) {
    return json(400, { error: 'Missing or invalid fields. Required: name, email, sourceUrl, sourceType.' });
  }

  try {
    const r = await appService().requestApply({ payload: payload as ApplyFormPayload });
    if (r.ok === false) {
      return json(400, { error: r.message, field: r.field });
    }
    return json(200, { ok: true });
  } catch (err) {
    console.error('Error in /publisher-apply/request:', err);
    return json(500, { error: 'Internal server error' });
  }
}

// ─── /publisher-apply/verify ─────────────────────────────────────────────
//
// Body: { token: string }
// Response: 200 { jwt, publisherId, email } | 400 { error }
export async function handlePublisherApplyVerify(
  _event: APIGatewayProxyEvent,
  requestBody: Record<string, unknown>,
): Promise<APIGatewayProxyResult> {
  const token = typeof requestBody?.token === 'string' ? requestBody.token : '';
  if (token.length === 0) {
    return json(400, { error: 'Missing or invalid `token`' });
  }
  try {
    const r = await appService().verifyApply(token);
    if (r.ok === false) {
      return json(400, { error: explainTokenFailure(r.reason) });
    }
    return json(200, { jwt: r.jwt, publisherId: r.publisherId, email: r.email });
  } catch (err) {
    console.error('Error in /publisher-apply/verify:', err);
    return json(500, { error: 'Internal server error' });
  }
}

// ─── /publisher-auth/request ─────────────────────────────────────────────
//
// Body: { email: string }
// Response: ALWAYS 200 { ok: true } regardless of whether the email matches.
//           Anti-enumeration — see PublisherApplicationService.requestLogin.
//           The only failure cases are rate-limit (429) and 5xx.
export async function handlePublisherAuthRequest(
  event: APIGatewayProxyEvent,
  requestBody: Record<string, unknown>,
): Promise<APIGatewayProxyResult> {
  const limited = applyAuthRateLimit(event);
  if (limited) return limited;

  const email = typeof requestBody?.email === 'string' ? requestBody.email : '';
  try {
    await appService().requestLogin(email);
    return json(200, { ok: true });
  } catch (err) {
    console.error('Error in /publisher-auth/request:', err);
    return json(500, { error: 'Internal server error' });
  }
}

// ─── /publisher-auth/verify ──────────────────────────────────────────────
//
// Body: { token: string }
// Response: 200 { jwt, publisherId, email } | 400 { error }
export async function handlePublisherAuthVerify(
  _event: APIGatewayProxyEvent,
  requestBody: Record<string, unknown>,
): Promise<APIGatewayProxyResult> {
  const token = typeof requestBody?.token === 'string' ? requestBody.token : '';
  if (token.length === 0) {
    return json(400, { error: 'Missing or invalid `token`' });
  }
  try {
    const r = await appService().verifyLogin(token);
    if (r.ok === false) {
      return json(400, { error: explainTokenFailure(r.reason) });
    }
    return json(200, { jwt: r.jwt, publisherId: r.publisherId, email: r.email });
  } catch (err) {
    console.error('Error in /publisher-auth/verify:', err);
    return json(500, { error: 'Internal server error' });
  }
}

function explainTokenFailure(
  reason: 'not_found' | 'expired' | 'wrong_purpose' | 'malformed_payload' | 'publisher_missing',
): string {
  switch (reason) {
    case 'not_found':
      return 'This link is invalid. Tokens are single-use; request a new one.';
    case 'expired':
      return 'This link has expired. Magic-links last 15 minutes — request a new one.';
    case 'wrong_purpose':
      return 'This link is for a different action. Use the link from the matching email.';
    case 'malformed_payload':
      return 'This application link is corrupt. Please apply again.';
    case 'publisher_missing':
      return 'The publisher account associated with this link no longer exists.';
  }
}
