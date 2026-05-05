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
import { InvokeCommand } from '@aws-sdk/client-lambda';
import {
  lambdaClient as ingestLambdaClient,
  publisherIngestFunctionName,
} from '../services/publisherIngestInvoker';
import { testPublisherFeed } from '../services/publisherTestService';
import { MagicTokenService } from '../services/magicTokenService';
import { SesMailService } from '../services/mailService';
import { PublisherNotFoundError, PublisherRegistryService } from '../services/publisherRegistryService';
import { PublisherApplicationService, EmailAlreadyInUseError } from '../services/publisherApplicationService';
import { requirePublisherSession } from '../services/publisherSession';
import { verifyCaptcha } from '../services/captchaService';
import {
  updatePublisherProfile,
  ProfileValidationError,
  type FeedTestResult,
} from '../services/publisherProfileService';
import {
  PublisherEmailChangeService,
  EmailChangeError,
} from '../services/publisherEmailChangeService';
import {
  selfDisable as selfDisableAction,
  SelfDisableError,
  type SelfDisableDeps,
} from '../services/publisherSelfActionService';
import {
  DynamoRateLimiter,
  InMemoryRateLimiter,
  type RateLimiter,
} from '../services/rateLimitService';
import type { ApplyFormPayload, PublisherRecord, SourceType } from '../types/publisher';

// ─── Doc-client helper ───────────────────────────────────────────────────
//
// Multiple singletons in this file build their own DDB doc clients with the
// same boilerplate (region from AWS_REGION, optional DYNAMODB_ENDPOINT for
// local dev with dummy creds). Centralise to one helper so a future change
// to the connection shape — e.g. adding a custom retry strategy — is a
// one-edit operation, and so the singletons stay symmetric in code review.
//
// The credentials block is only attached when DYNAMODB_ENDPOINT is set,
// matching the existing pattern: in Lambda the SDK picks creds from the
// task role, which we never want to override.
function buildDocClient(): DynamoDBDocumentClient {
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
  return DynamoDBDocumentClient.from(dynamoClient);
}

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

// Phase 5 — self-service ingest controls.
//
// Fetch-now is rate-limited to 1 invocation per 5 minutes per publisher
// (not per IP) — the protected resource is the upstream feed-fetch budget,
// not the API surface. A publisher iterating from two browsers should still
// be capped together.
const FETCH_NOW_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const FETCH_NOW_RATE_LIMIT_MAX = 1;

// Pause/resume is far cheaper but we cap toggles per minute to prevent a
// runaway script (or panicked user clicking) from hammering DynamoDB.
const PAUSE_RESUME_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const PAUSE_RESUME_RATE_LIMIT_MAX = 10;

// Phase 6 — self-disable. Conservative cap: this action retracts events on
// the next ingest run and bumps tokenVersion (kicking the active session out),
// so a flurry of attempts almost certainly indicates either confused-user
// retries or scripted abuse. 5 per hour gives a real publisher plenty of
// room to retry on transient failures while shutting the door on either.
const DISABLE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const DISABLE_RATE_LIMIT_MAX = 5;

let _rateLimiter: RateLimiter | null = null;

function rateLimiter(): RateLimiter {
  if (_rateLimiter) return _rateLimiter;
  const tableName = process.env.PUBLISHER_RATE_LIMIT_TABLE_NAME;
  if (tableName) {
    _rateLimiter = new DynamoRateLimiter(buildDocClient(), tableName);
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
//
// Origin is locked to the first-party site (SITE_BASE_URL, defaulting to the
// production hostname). The legacy admin / sync / calendar handlers still
// echo `*` because they predate this hardening; this scoping is intentional
// — only the publisher-portal endpoints are tightened here. If a future
// preview environment needs a different origin it can override SITE_BASE_URL
// at the Lambda env level.
const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': process.env.SITE_BASE_URL ?? 'https://www.chqcal.org',
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
    const docClient = buildDocClient();
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
    // Phase 3 — uniqueness gate. The body is intentionally generic: it must
    // not reveal whether the address is approved, pending, or rejected.
    // Phase 4 extends the same gate to pending email-change rows.
    if (err instanceof EmailAlreadyInUseError) {
      return json(400, {
        error: "We can't accept this email address. If you already have a publisher account, sign in at /publish/login/.",
      });
    }
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
    const docClient = buildDocClient();
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
  try {
    const sess = await requirePublisherSession(event, statusRegistry());
    if (sess.kind === 'unauthorized') return json(401, { error: sess.message });
    if (sess.kind === 'publisher_missing') return json(404, { error: 'Publisher not found' });
    // Surface any pending email change so the frontend can render the
    // banner. Read failures here shouldn't block the status response — the
    // email-change UI is a layered enhancement on top of the core record.
    let pendingEmailChange: { newEmail: string; expiresAt: string } | null = null;
    try {
      pendingEmailChange = await emailChangeService().getPendingForPublisher(sess.publisher.id);
    } catch (err) {
      console.error('Error reading pending email change for status:', err);
    }
    const publisher = sanitizePublisher(sess.publisher);
    return json(200, {
      publisher: pendingEmailChange ? { ...publisher, pendingEmailChange } : publisher,
    });
  } catch (err) {
    console.error('Error in /publisher-status:', err);
    return json(500, { error: 'Internal server error' });
  }
}

// ─── PATCH /publisher-profile (publisher JWT only) ───────────────────────
//
// Self-service edits for an approved publisher's row. Allowed fields:
//   - name, organization (free-form text)
//   - sourceUrl, sourceType (gated by a feed test before commit)
//
// Auth: same publisher JWT as /publisher-status. Pending/rejected applicants
// get 403 — the row exists but isn't editable until an admin approves.
//
// The URL/sourceType change path runs the same SSRF guard + fetch + parse +
// validate pipeline as POST /publisher-test, so a publisher can't move
// themselves to a feed that would fail at ingest time. We adapt
// testPublisherFeed's discriminated-union result into the simple
// `{ ok, errors[] }` shape that the profile service expects (see comments
// inline below for the mapping).
export async function handlePublisherProfilePatch(
  event: APIGatewayProxyEvent,
  body: Record<string, unknown>,
): Promise<APIGatewayProxyResult> {
  try {
    const sess = await requirePublisherSession(event, statusRegistry());
    if (sess.kind === 'unauthorized') return json(401, { error: sess.message });
    if (sess.kind === 'publisher_missing') return json(404, { error: 'Publisher not found' });
    // Approved-only: pending/rejected publishers can't edit the row that
    // admins are reviewing (we'd be moving the goalposts out from under them)
    // and rejected publishers should re-apply, not edit in place.
    if (sess.publisher.applicationStatus !== undefined &&
        sess.publisher.applicationStatus !== 'approved') {
      return json(403, {
        error: 'Profile editing is only available to approved publishers.',
      });
    }

    await updatePublisherProfile(sess.publisher.id, body, {
      registry: statusRegistry(),
      runFeedTest: async ({ url, sourceType }) => adaptFeedTest(url, sourceType),
    });

    const updated = await statusRegistry().get(sess.publisher.id);
    if (!updated) {
      // Row was deleted between the validation read and the post-write read.
      // Treat as 404 — the publisher's session is no longer meaningful.
      return json(404, { error: 'Publisher not found' });
    }
    return json(200, { publisher: sanitizePublisher(updated) });
  } catch (err) {
    if (err instanceof ProfileValidationError) {
      // 'not_found' means the row vanished between validation and write
      // (registry guard tripped, or the pre-write get returned null) —
      // surface as 404 so the frontend redirects to login.
      const status = err.code === 'not_found' ? 404 : 400;
      return json(status, {
        error: err.message,
        code: err.code,
        details: err.details ?? null,
      });
    }
    console.error('Error in PATCH /publisher-profile:', err);
    return json(500, { error: 'Internal server error' });
  }
}

// Adapter: testPublisherFeed returns
//   { kind: 'error', error: { kind: 'blocked_url', reason } }    — SSRF guard rejection
//   { kind: 'ok', output: { fetchStatus, feed, report } }        — fetch ran; outcome on the report
//
// The profile-service contract is `{ ok, errors[], summary? }`. We translate:
//   - blocked_url             → ok=false, errors=[reason]
//   - fetchStatus !== 'ok'    → ok=false, errors=report.errors.map(message)
//   - fetchStatus === 'ok'    → ok=true,  summary="Validated N events"
async function adaptFeedTest(url: string, sourceType: SourceType): Promise<FeedTestResult> {
  const result = await testPublisherFeed({ url, sourceType });
  if (result.kind === 'error') {
    return { ok: false, errors: [result.error.reason] };
  }
  const out = result.output;
  if (out.fetchStatus === 'ok') {
    const eventCount = out.feed?.events.length ?? 0;
    return { ok: true, summary: `Validated ${eventCount} event${eventCount === 1 ? '' : 's'}.` };
  }
  // parse_error / validation_error / network_error / threshold_halt → surface
  // the human-readable error messages from the validation report. Fall back
  // to a generic message (with the fetchStatus code) when the report is empty.
  const messages = out.report.errors.map(e => e.message).filter(Boolean);
  if (messages.length === 0) {
    messages.push(`Feed test failed (${out.fetchStatus}).`);
  }
  return { ok: false, errors: messages };
}

function sanitizePublisher(rec: PublisherRecord) {
  const {
    pendingThresholdHalt: _omitHalt,
    reviewerEmail: _omitReviewer,
    ...rest
  } = rec;
  return rest;
}

// ─── Email-change service singleton (Phase 4) ────────────────────────────
//
// Distinct from `appService` because the email-change service composes the
// same registry + magic-token + mail collaborators but with different
// orchestration. Sharing wouldn't reduce cold-start work meaningfully and
// would couple the two flows together unnecessarily.

let _emailChangeService: PublisherEmailChangeService | null = null;

function emailChangeService(): PublisherEmailChangeService {
  if (!_emailChangeService) {
    const docClient = buildDocClient();
    const registry = new PublisherRegistryService(
      docClient,
      process.env.PUBLISHERS_TABLE_NAME ?? 'chautauqua-calendar-publishers',
    );
    const tokens = new MagicTokenService(
      docClient,
      process.env.PUBLISHER_MAGIC_TOKEN_TABLE_NAME ?? 'chautauqua-calendar-publisher-magic-tokens',
    );
    const mail = new SesMailService();
    _emailChangeService = new PublisherEmailChangeService({
      registry,
      tokens,
      mail,
      siteBaseUrl: process.env.SITE_BASE_URL ?? 'https://www.chqcal.org',
    });
  }
  return _emailChangeService;
}

export function _setEmailChangeServiceForTests(svc: PublisherEmailChangeService | null): void {
  _emailChangeService = svc;
}

// ─── POST /publisher-email-change (publisher JWT) ───────────────────────
//
// Body: { newEmail: string }
// Auth: same publisher-JWT as /publisher-status. Approved-only.
// Returns:
//   200 { ok: true }       — verify + warning emails dispatched
//   400                    — validation_error (missing/malformed newEmail)
//   401                    — no/invalid JWT
//   403                    — pending/rejected applicant
//   409                    — email_in_use
//   423                    — emailChangeLockedUntil not yet passed
export async function handlePublisherEmailChangeRequest(
  event: APIGatewayProxyEvent,
  body: Record<string, unknown>,
): Promise<APIGatewayProxyResult> {
  try {
    const sess = await requirePublisherSession(event, statusRegistry());
    if (sess.kind === 'unauthorized') return json(401, { error: sess.message });
    if (sess.kind === 'publisher_missing') return json(404, { error: 'Publisher not found' });
    if (sess.publisher.applicationStatus !== undefined &&
        sess.publisher.applicationStatus !== 'approved') {
      return json(403, { error: 'Email change is only available to approved publishers.' });
    }

    const newEmail = typeof body?.newEmail === 'string' ? body.newEmail : '';
    if (newEmail.length === 0) {
      return json(400, { error: 'Missing or invalid `newEmail` (string required).' });
    }

    try {
      await emailChangeService().initiate({
        publisherId: sess.publisher.id,
        oldEmail: sess.publisher.contactEmail,
        newEmail,
      });
      return json(200, { ok: true });
    } catch (err) {
      if (err instanceof EmailChangeError) {
        const status =
          err.code === 'locked' ? 423 :
          err.code === 'email_in_use' ? 409 :
          400;
        return json(status, {
          error: err.message,
          code: err.code,
          details: err.details ?? null,
        });
      }
      throw err;
    }
  } catch (err) {
    console.error('Error in POST /publisher-email-change:', err);
    return json(500, { error: 'Internal server error' });
  }
}

// ─── DELETE /publisher-email-change (publisher JWT) ─────────────────────
//
// Cancels a pending email change from the publisher's own session. Always
// succeeds (idempotent). No lock written — they cancelled their own request.
export async function handlePublisherEmailChangeCancelSelf(
  event: APIGatewayProxyEvent,
  _body: Record<string, unknown>,
): Promise<APIGatewayProxyResult> {
  try {
    const sess = await requirePublisherSession(event, statusRegistry());
    if (sess.kind === 'unauthorized') return json(401, { error: sess.message });
    if (sess.kind === 'publisher_missing') return json(404, { error: 'Publisher not found' });
    await emailChangeService().cancelBySelf({ publisherId: sess.publisher.id });
    return json(200, { ok: true });
  } catch (err) {
    console.error('Error in DELETE /publisher-email-change:', err);
    return json(500, { error: 'Internal server error' });
  }
}

// ─── GET /publisher-email-change/verify?token=… (public) ────────────────
//
// One-shot verify token from the new-address email. No auth — the token IS
// the auth. Returns JSON for the frontend to render; the frontend handles
// the redirect to /publish/login/?reason=email-changed itself.
//
// Response shapes:
//   200 { kind: 'ok', newEmail }
//   200 { kind: 'invalid' }       — token query-param entirely missing/empty
//                                   (link truncated by the email client; not the
//                                   same UX as "already used")
//   200 { kind: 'already_used' }
//   200 { kind: 'expired' }
//   200 { kind: 'email_taken' }
//   200 { kind: 'publisher_missing' } — publisher deleted between issue and verify
//
// Always 200 — non-2xx would force the frontend to differentiate transport
// errors from outcome errors. The `kind` field carries the outcome.
export async function handlePublisherEmailChangeVerify(
  event: APIGatewayProxyEvent,
  _body: Record<string, unknown>,
): Promise<APIGatewayProxyResult> {
  try {
    const token = readQueryParam(event, 'token');
    if (!token) {
      return json(200, { kind: 'invalid' });
    }
    const r = await emailChangeService().verifyByNewAddress(token);
    if (r.kind === 'ok') {
      return json(200, { kind: 'ok', newEmail: r.newEmail });
    }
    return json(200, { kind: r.kind });
  } catch (err) {
    console.error('Error in GET /publisher-email-change/verify:', err);
    return json(500, { error: 'Internal server error' });
  }
}

// ─── GET /publisher-email-change/cancel?token=… (public) ────────────────
//
// One-shot cancel token from the old-address email. No auth.
//
// Response shapes:
//   200 { kind: 'ok', lockedUntil }
//   200 { kind: 'invalid' }       — token query-param entirely missing/empty
//   200 { kind: 'already_used' }
//   200 { kind: 'expired' }
//   200 { kind: 'publisher_missing' } — publisher deleted between issue and cancel
export async function handlePublisherEmailChangeCancelByOld(
  event: APIGatewayProxyEvent,
  _body: Record<string, unknown>,
): Promise<APIGatewayProxyResult> {
  try {
    const token = readQueryParam(event, 'token');
    if (!token) {
      return json(200, { kind: 'invalid' });
    }
    const r = await emailChangeService().cancelByOldAddress(token);
    if (r.kind === 'ok') {
      return json(200, { kind: 'ok', lockedUntil: r.lockedUntil });
    }
    return json(200, { kind: r.kind });
  } catch (err) {
    console.error('Error in GET /publisher-email-change/cancel:', err);
    return json(500, { error: 'Internal server error' });
  }
}

function readQueryParam(event: APIGatewayProxyEvent, name: string): string | null {
  const v = event.queryStringParameters?.[name];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// ─── Phase 5 — self-service ingest controls ──────────────────────────────
//
// All three endpoints share the same auth + applicationStatus gate:
//   - Authenticated via publisher JWT (requirePublisherSession).
//   - 401 on missing/invalid JWT, 404 on publisher row missing.
//   - 403 if applicationStatus is set and not 'approved'. (Legacy admin-
//     created rows have no applicationStatus and are treated as approved,
//     consistent with /publisher-profile and /publisher-email-change.)

interface IngestControlGate {
  ok: true;
  publisher: PublisherRecord;
}

async function gateApprovedPublisher(
  event: APIGatewayProxyEvent,
): Promise<IngestControlGate | APIGatewayProxyResult> {
  const sess = await requirePublisherSession(event, statusRegistry());
  if (sess.kind === 'unauthorized') return json(401, { error: sess.message });
  if (sess.kind === 'publisher_missing') return json(404, { error: 'Publisher not found' });
  if (sess.publisher.applicationStatus !== undefined &&
      sess.publisher.applicationStatus !== 'approved') {
    return json(403, {
      error: 'This action is only available to approved publishers.',
    });
  }
  return { ok: true, publisher: sess.publisher };
}

// ─── POST /publisher-fetch-now (publisher JWT) ───────────────────────────
//
// Triggers an immediate publisher-ingest run for the caller's own feed
// (single-publisher mode). Async invoke; the 202 response says "queued",
// not "fetched" — the publisher must poll /publisher-status to see the
// updated lastFetchedAt timestamp.
//
// Per-publisher rate limit: 1 invocation per 5 minutes. The bucket key is
// `fetch_now#<publisherId>` so two browsers signed into the same account
// share the cap (the protected resource is the upstream feed budget).
//
// Returns:
//   202 { acceptedAt }
//   401 / 403 / 404 — auth gates
//   429 { error, retryAfterSeconds } — rate-limit
export async function handlePublisherFetchNow(
  event: APIGatewayProxyEvent,
  _body: Record<string, unknown>,
): Promise<APIGatewayProxyResult> {
  try {
    const gated = await gateApprovedPublisher(event);
    if ('statusCode' in gated) return gated;
    const publisher = gated.publisher;

    const rl = await rateLimiter().checkAndConsume({
      key: `fetch_now#${publisher.id}`,
      windowMs: FETCH_NOW_RATE_LIMIT_WINDOW_MS,
      max: FETCH_NOW_RATE_LIMIT_MAX,
    });
    if (rl.ok === false) {
      return {
        statusCode: 429,
        headers: { ...corsHeaders, 'Retry-After': String(rl.retryAfterSeconds) },
        body: JSON.stringify({
          error: `Fetch-now is limited to once every ${FETCH_NOW_RATE_LIMIT_WINDOW_MS / 60000} minutes. Try again in ${rl.retryAfterSeconds} seconds.`,
          retryAfterSeconds: rl.retryAfterSeconds,
        }),
      };
    }

    const acceptedAt = new Date().toISOString();
    try {
      await ingestLambdaClient().send(new InvokeCommand({
        FunctionName: publisherIngestFunctionName(),
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({
          singlePublisherId: publisher.id,
          source: 'self-service-fetch-now',
          triggeredBy: publisher.id,
          triggeredAt: acceptedAt,
        })),
      }));
    } catch (err) {
      console.error('Error invoking publisher-ingest from /publisher-fetch-now:', err);
      const message = err instanceof Error ? err.message : 'unknown error';
      return json(500, { error: `Failed to trigger fetch: ${message}` });
    }
    return json(202, { acceptedAt });
  } catch (err) {
    console.error('Error in POST /publisher-fetch-now:', err);
    return json(500, { error: 'Internal server error' });
  }
}

// ─── POST /publisher-pause (publisher JWT) ────────────────────────────────
//
// Sets paused=true and stamps selfPausedAt. Idempotent — calling pause on
// an already-paused publisher succeeds with 200. Events stay live in the
// sidecar; only future fetches are skipped (see runIngest's paused bucket).
//
// Returns 200 with the sanitized updated publisher record.
export async function handlePublisherPause(
  event: APIGatewayProxyEvent,
  _body: Record<string, unknown>,
): Promise<APIGatewayProxyResult> {
  return await togglePaused(event, true);
}

// ─── POST /publisher-resume (publisher JWT) ───────────────────────────────
//
// Clears paused (and selfPausedAt). Idempotent.
export async function handlePublisherResume(
  event: APIGatewayProxyEvent,
  _body: Record<string, unknown>,
): Promise<APIGatewayProxyResult> {
  return await togglePaused(event, false);
}

async function togglePaused(
  event: APIGatewayProxyEvent,
  paused: boolean,
): Promise<APIGatewayProxyResult> {
  try {
    const gated = await gateApprovedPublisher(event);
    if ('statusCode' in gated) return gated;
    const publisher = gated.publisher;

    const rl = await rateLimiter().checkAndConsume({
      key: `pause_resume#${publisher.id}`,
      windowMs: PAUSE_RESUME_RATE_LIMIT_WINDOW_MS,
      max: PAUSE_RESUME_RATE_LIMIT_MAX,
    });
    if (rl.ok === false) {
      return {
        statusCode: 429,
        headers: { ...corsHeaders, 'Retry-After': String(rl.retryAfterSeconds) },
        body: JSON.stringify({
          error: `Too many pause/resume requests. Try again in ${rl.retryAfterSeconds} seconds.`,
          retryAfterSeconds: rl.retryAfterSeconds,
        }),
      };
    }

    // selfInitiated only matters when transitioning to paused — see
    // PublisherRegistryService.setPausedFlag. On unpause the registry
    // clears selfPausedAt unconditionally. The helper enforces an
    // attribute_exists(id) guard; if the row was deleted between our gate
    // read and this write, it throws PublisherNotFoundError → 404.
    try {
      await statusRegistry().setPausedFlag(publisher.id, paused, paused ? { selfInitiated: true } : {});
    } catch (err) {
      if (err instanceof PublisherNotFoundError) {
        return json(404, { error: 'Publisher not found' });
      }
      throw err;
    }
    const updated = await statusRegistry().get(publisher.id);
    if (!updated) {
      return json(404, { error: 'Publisher not found' });
    }
    return json(200, { publisher: sanitizePublisher(updated) });
  } catch (err) {
    console.error(`Error in POST /publisher-${paused ? 'pause' : 'resume'}:`, err);
    return json(500, { error: 'Internal server error' });
  }
}

// ─── POST /publisher-disable (Phase 6 — self-disable) ────────────────────
//
// Body: { confirmSlug: string } — must equal the publisher's id exactly.
// Auth: same publisher-JWT gate as the rest of /publisher-* (approved-only).
//
// Side effects (composed in publisherSelfActionService.selfDisable):
//   - Registry row: enabled=false, selfDisabledAt=now, tokenVersion+=1.
//   - Magic-token table: any in-flight email-change pair is purged.
//   - SES: confirmation email to the current contactEmail.
//
// The tokenVersion bump invalidates the JWT used to make this very request,
// so the frontend must redirect to /publish/ on the 200 — calling /publisher-
// status afterwards would 401. The 200 body intentionally omits the publisher
// record (the row is now disabled / not interesting) and just returns the
// emailedTo so the UI can surface "we sent you confirmation at…".
//
// Per-publisher rate limit (5/hour). Keyed on publisher.id, not IP, since
// we want both browsers signed into the same account capped together.
//
// Returns:
//   200 { ok: true, emailedTo }
//   400 { error, code: 'missing_confirm' }
//   400 { error, code: 'confirm_mismatch' }
//   401 — JWT missing/invalid
//   403 — pending/rejected applicant
//   404 — publisher row vanished
//   429 — rate-limited

let _selfDisableServiceForTests:
  | ((input: { publisherId: string; confirmSlug: string }) => Promise<{ publisherId: string; slug: string; emailedTo: string }>)
  | null = null;

export function _setSelfDisableActionForTests(
  fn:
    | ((input: { publisherId: string; confirmSlug: string }) => Promise<{ publisherId: string; slug: string; emailedTo: string }>)
    | null,
): void {
  _selfDisableServiceForTests = fn;
}

// Build the deps lazily on first use, like the other singletons in this file.
// Reuses `statusRegistry()` so we don't pay a second DDB-client cold-start.
let _selfDisableDeps: SelfDisableDeps | null = null;
function selfDisableDeps(): SelfDisableDeps {
  if (_selfDisableDeps) return _selfDisableDeps;
  const docClient = buildDocClient();
  const tokens = new MagicTokenService(
    docClient,
    process.env.PUBLISHER_MAGIC_TOKEN_TABLE_NAME ?? 'chautauqua-calendar-publisher-magic-tokens',
  );
  const mail = new SesMailService();
  _selfDisableDeps = {
    registry: statusRegistry(),
    magicTokens: tokens,
    mail,
  };
  return _selfDisableDeps;
}

export function _setSelfDisableDepsForTests(deps: SelfDisableDeps | null): void {
  _selfDisableDeps = deps;
}

export async function handlePublisherDisable(
  event: APIGatewayProxyEvent,
  body: Record<string, unknown>,
): Promise<APIGatewayProxyResult> {
  try {
    const gated = await gateApprovedPublisher(event);
    if ('statusCode' in gated) return gated;
    const publisher = gated.publisher;

    const confirmSlug = typeof body?.confirmSlug === 'string' ? body.confirmSlug : '';
    if (confirmSlug.length === 0) {
      return json(400, {
        error: 'Missing `confirmSlug` — type your publisher slug exactly to confirm.',
        code: 'missing_confirm',
      });
    }

    // Rate-limit AFTER the missing-field 400 so a typo doesn't burn a slot.
    // The mismatch path still consumes a slot, which is intentional —
    // brute-force guesses (1-in-millions for a uuid4 slug, but still) should
    // hit the cap quickly.
    const rl = await rateLimiter().checkAndConsume({
      key: `disable#${publisher.id}`,
      windowMs: DISABLE_RATE_LIMIT_WINDOW_MS,
      max: DISABLE_RATE_LIMIT_MAX,
    });
    if (rl.ok === false) {
      return {
        statusCode: 429,
        headers: { ...corsHeaders, 'Retry-After': String(rl.retryAfterSeconds) },
        body: JSON.stringify({
          error: `Too many disable attempts. Try again in ${rl.retryAfterSeconds} seconds.`,
          retryAfterSeconds: rl.retryAfterSeconds,
        }),
      };
    }

    try {
      const action = _selfDisableServiceForTests ?? ((input) =>
        selfDisableAction(input, selfDisableDeps()));
      const result = await action({
        publisherId: publisher.id,
        confirmSlug,
      });
      return json(200, { ok: true, emailedTo: result.emailedTo });
    } catch (err) {
      if (err instanceof SelfDisableError) {
        if (err.code === 'not_found') {
          return json(404, { error: 'Publisher not found' });
        }
        // 'confirm_mismatch' → 400 with code so the frontend can render the
        // typed-confirmation hint without parsing the message string.
        return json(400, {
          error: 'The confirmation slug did not match. Type your publisher slug exactly.',
          code: 'confirm_mismatch',
        });
      }
      throw err;
    }
  } catch (err) {
    console.error('Error in POST /publisher-disable:', err);
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
