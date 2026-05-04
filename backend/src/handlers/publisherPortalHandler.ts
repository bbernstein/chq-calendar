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
import { verifyPublisherJwt } from '../services/publisherAuthService';
import { verifyCaptcha } from '../services/captchaService';
import {
  DynamoRateLimiter,
  InMemoryRateLimiter,
  type RateLimiter,
} from '../services/rateLimitService';
import type { ApplyFormPayload, PublisherRecord } from '../types/publisher';

// ─── Rate limiter ────────────────────────────────────────────────────────
//
// Phase D: backed by DynamoDB so the limit holds across concurrent Lambda
// containers. Falls back to an in-memory implementation when the
// PUBLISHER_RATE_LIMIT_TABLE_NAME env var is unset (tests, local dev with
// no DDB available) — both implementations share the same `RateLimiter`
// interface.

const PUBLISHER_TEST_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const PUBLISHER_TEST_RATE_LIMIT_MAX = 10;

const PUBLISHER_AUTH_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const PUBLISHER_AUTH_RATE_LIMIT_MAX = 10;

let _rateLimiter: RateLimiter | null = null;

function rateLimiter(): RateLimiter {
  if (_rateLimiter) return _rateLimiter;
  const tableName = process.env.PUBLISHER_RATE_LIMIT_TABLE_NAME;
  if (tableName) {
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
    _rateLimiter = new DynamoRateLimiter(docClient, tableName);
  } else {
    _rateLimiter = new InMemoryRateLimiter();
  }
  return _rateLimiter;
}

// Test-only override (used by handler tests to inject a deterministic limiter).
export function _setRateLimiterForTests(limiter: RateLimiter | null): void {
  _rateLimiter = limiter;
}

export async function checkPublisherTestRateLimit(
  ip: string,
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  return rateLimiter().checkAndConsume({
    key: `pt:${ip}`,
    windowMs: PUBLISHER_TEST_RATE_LIMIT_WINDOW_MS,
    max: PUBLISHER_TEST_RATE_LIMIT_MAX,
  });
}

// Reset both buckets — keeps the existing test-API surface so older tests
// keep working unchanged.
export function _resetPublisherTestRateLimitForTests(): void {
  if (_rateLimiter && 'reset' in _rateLimiter && typeof _rateLimiter.reset === 'function') {
    void _rateLimiter.reset();
  } else {
    // Fall back to a fresh in-memory limiter (mirrors the old behaviour
    // of clearing the Map).
    _rateLimiter = new InMemoryRateLimiter();
  }
}

export async function checkPublisherAuthRateLimit(
  ip: string,
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  return rateLimiter().checkAndConsume({
    key: `pa:${ip}`,
    windowMs: PUBLISHER_AUTH_RATE_LIMIT_WINDOW_MS,
    max: PUBLISHER_AUTH_RATE_LIMIT_MAX,
  });
}

export function _resetPublisherAuthRateLimitForTests(): void {
  // Same backing limiter, so a single reset clears both buckets.
  _resetPublisherTestRateLimitForTests();
}

// ─── Response helpers ────────────────────────────────────────────────────
const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // Authorization is included for Phase C authenticated publisher endpoints
  // (status page, feed management). The Phase A/B routes here don't read it,
  // but the header is shared and CORS preflight is per-resource — better to
  // include it now than be surprised by a preflight rejection later.
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
  // Trust ONLY API Gateway's authoritative sourceIp. The X-Forwarded-For
  // header is client-controllable; falling back to it lets a caller spoof
  // an arbitrary IP and bypass per-IP rate limits entirely.
  const ip = event.requestContext?.identity?.sourceIp ?? 'unknown';
  const rl = await checkPublisherTestRateLimit(ip);
  if (rl.ok === false) {
    // /publisher-test is the main abuse surface (DNS rebinding probes,
    // feed scanning). A warn-level log per denial gives ops a CloudWatch
    // signal for detecting campaigns. IP is fine to log; the path itself
    // contains no PII.
    console.warn(`[publisher-test] rate-limit denied: ip=${ip} retry_after=${rl.retryAfterSeconds}s`);
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

async function applyAuthRateLimit(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult | null> {
  // Trust ONLY API Gateway's authoritative sourceIp. The X-Forwarded-For
  // header is client-controllable; falling back to it lets a caller spoof
  // an arbitrary IP and bypass per-IP rate limits entirely.
  const ip = event.requestContext?.identity?.sourceIp ?? 'unknown';
  const rl = await checkPublisherAuthRateLimit(ip);
  if (rl.ok === false) {
    // Apply/login denials are interesting for spotting account-enumeration
    // and SES-quota-exhaustion attempts. Same warn-level signal as the
    // test endpoint above.
    console.warn(`[publisher-auth] rate-limit denied: ip=${ip} retry_after=${rl.retryAfterSeconds}s`);
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
  const limited = await applyAuthRateLimit(event);
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

  // CAPTCHA gates the apply form to deter scripted abuse. Order matters:
  //   1. Rate-limit check (above) — first, so attackers can't burn quota
  //      with bogus tokens before any verification work.
  //   2. Basic shape check (above) — next, so legitimate users with a
  //      malformed submission see field errors instead of a generic
  //      captcha failure.
  //   3. Captcha verification (here) — last, so the round-trip to Google
  //      only happens for well-formed submissions.
  //
  // The token is passed through unconditionally; verifyCaptcha decides
  // what to do based on environment + secret config. In dev with no
  // VITE_RECAPTCHA_SITE_KEY the frontend sends no token, captchaService
  // returns true because no RECAPTCHA_SECRET_KEY is configured, and the
  // request proceeds. In production the secret is set and an empty or
  // bad token is rejected.
  const captchaToken = typeof requestBody?.captchaToken === 'string' ? requestBody.captchaToken : '';
  const captchaOk = await verifyCaptcha(captchaToken, 'publisher_apply');
  if (!captchaOk) {
    return json(400, { error: 'CAPTCHA verification failed. Please refresh and try again.', field: 'captcha' });
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
  const limited = await applyAuthRateLimit(event);
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

// ─── Publisher status singleton (registry only — no email/token deps) ────
//
// Reused across cold starts. Distinct from `appService` so the status
// endpoint avoids paying the SES/Secrets-Manager init cost (the
// PublisherApplicationService eagerly constructs both).

let _statusRegistry: PublisherRegistryService | null = null;

function statusRegistry(): PublisherRegistryService {
  if (!_statusRegistry) {
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
    _statusRegistry = new PublisherRegistryService(
      docClient,
      process.env.PUBLISHERS_TABLE_NAME ?? 'chautauqua-calendar-publishers',
    );
  }
  return _statusRegistry;
}

export function _setStatusRegistryForTests(r: PublisherRegistryService | null): void {
  _statusRegistry = r;
}

// ─── /publisher-status (publisher JWT only) ──────────────────────────────
//
// Returns the caller's own publisher record, sanitized:
//   - omits `pendingThresholdHalt` (ops-internal signal)
//   - omits `reviewerEmail` (admin PII not relevant to the publisher)
//
// Auth: `Authorization: Bearer <publisher-jwt>`. Invalid or missing → 401.
// Publisher row deleted while JWT is still valid → 404 (clears stale local
// session on the frontend).
export async function handlePublisherStatus(
  event: APIGatewayProxyEvent,
  _requestBody: Record<string, unknown>,
): Promise<APIGatewayProxyResult> {
  const auth = readAuthHeader(event);
  if (!auth) {
    return json(401, { error: 'Authentication required' });
  }
  const claims = await verifyPublisherJwt(auth);
  if (!claims) {
    return json(401, { error: 'Authentication required' });
  }
  try {
    const rec = await statusRegistry().get(claims.sub);
    if (!rec) {
      return json(404, { error: 'Publisher not found' });
    }
    return json(200, { publisher: sanitizePublisher(rec) });
  } catch (err) {
    console.error('Error in /publisher-status:', err);
    return json(500, { error: 'Internal server error' });
  }
}

// Header lookup is case-insensitive; APIGatewayProxyEvent normalizes to the
// caller's casing, so we check both common forms.
function readAuthHeader(event: APIGatewayProxyEvent): string | null {
  const headers = event.headers ?? {};
  const raw = headers.Authorization ?? headers.authorization;
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function sanitizePublisher(rec: PublisherRecord) {
  const {
    pendingThresholdHalt: _omitHalt,
    reviewerEmail: _omitReviewer,
    ...rest
  } = rec;
  return rest;
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
