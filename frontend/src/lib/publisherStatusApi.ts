// Client for the publisher-facing /api/publisher-status endpoint (Phase C).
// On 401 we clear the local session and bounce to /publish/login/ — the
// caller doesn't need to handle that case.

import { clearPublisherSession, getPublisherJwt } from '@/lib/publisherAuthClient';

export type ApplicationStatus = 'pending' | 'approved' | 'rejected';

export interface PublisherStatusRecord {
  id: string;
  name: string;
  contactEmail: string;
  sourceUrl: string;
  sourceType: 'json' | 'html';
  trustLevel: 'auto' | 'review' | 'flagged';
  enabled: boolean;
  createdAt: string;
  applicationStatus?: ApplicationStatus;
  appliedAt?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  organization?: string;
  applicantNotes?: string;
  lastFetchedAt?: string;
  lastFetchStatus?: 'ok' | 'parse_error' | 'validation_error' | 'network_error' | 'threshold_halt';
  lastFetchMessage?: string;
  // Phase 4 — surfaced when an email change is mid-flight (verify token
  // not yet clicked / cancelled / expired). Drives the yellow banner on
  // /publish/status/.
  pendingEmailChange?: { newEmail: string; expiresAt: string };
  // Phase 5 — self-service pause state. Both fields are optional; when
  // unset the publisher is considered active.
  paused?: boolean;
  selfPausedAt?: string;
}

const API_BASE = (import.meta as any).env?.VITE_API_URL ?? '';

export class PublisherStatusError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'PublisherStatusError';
  }
}

// Returns the publisher's own record. Throws PublisherStatusError on
// non-2xx responses (other than 401, which we handle by redirecting).
//
// The redirect-on-401 means callers can treat a thrown error as a real
// "something went wrong" rather than an auth event — auth events take the
// user straight to /publish/login/ before the throw.
export async function getPublisherStatus(): Promise<PublisherStatusRecord> {
  const jwt = getPublisherJwt();
  if (!jwt) {
    redirectToLogin();
    // redirectToLogin replaces the page; throw is reachable only in tests.
    throw new PublisherStatusError('No publisher session.', 401);
  }
  const r = await fetch(`${API_BASE}/api/publisher-status`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
  });
  if (r.status === 401) {
    clearPublisherSession();
    redirectToLogin();
    throw new PublisherStatusError('Session expired.', 401);
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new PublisherStatusError(
      typeof body?.error === 'string' ? body.error : `Request failed (${r.status}).`,
      r.status,
    );
  }
  if (!body || typeof body.publisher !== 'object' || body.publisher === null) {
    throw new PublisherStatusError('Malformed response.', 500);
  }
  return body.publisher as PublisherStatusRecord;
}

function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  window.location.replace('/publish/login/');
}

// ─── Phase 2 (self-service profile editing) ───────────────────────────────
//
// PATCH /api/publisher-profile — sparse profile update for the authenticated
// publisher. Returns the updated record on success; throws on validation
// failure with the backend's error message (and code, when available, in
// the .code property of the thrown PublisherStatusError-shaped object).

export interface PublisherProfilePatch {
  name?: string;
  organization?: string;
  sourceUrl?: string;
  sourceType?: 'json' | 'html';
}

export class PublisherProfileError extends PublisherStatusError {
  constructor(
    message: string,
    status: number,
    public readonly code: string | null,
    public readonly details: unknown,
  ) {
    super(message, status);
    this.name = 'PublisherProfileError';
  }
}

export async function patchPublisherProfile(
  patch: PublisherProfilePatch,
): Promise<PublisherStatusRecord> {
  const jwt = getPublisherJwt();
  if (!jwt) {
    redirectToLogin();
    throw new PublisherStatusError('No publisher session.', 401);
  }
  const r = await fetch(`${API_BASE}/api/publisher-profile`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(patch),
  });
  if (r.status === 401) {
    clearPublisherSession();
    redirectToLogin();
    throw new PublisherStatusError('Session expired.', 401);
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new PublisherProfileError(
      typeof body?.error === 'string' ? body.error : `Request failed (${r.status}).`,
      r.status,
      typeof body?.code === 'string' ? body.code : null,
      body?.details ?? null,
    );
  }
  if (!body || typeof body.publisher !== 'object' || body.publisher === null) {
    throw new PublisherStatusError('Malformed response.', 500);
  }
  return body.publisher as PublisherStatusRecord;
}

// Pre-flight check used by SourceEditPanel: re-uses the public
// /api/publisher-test endpoint (same SSRF guard + parse + validate) so the
// publisher gets identical feedback to what the backend will use to gate the
// PATCH. Translates the public endpoint's verbose response into the simple
// { ok, summary } / { ok, errors } shape SourceEditPanel expects.
export async function previewPublisherFeed(
  url: string,
  sourceType: 'json' | 'html',
): Promise<{ ok: true; summary: string } | { ok: false; errors: string[] }> {
  const r = await fetch(`${API_BASE}/api/publisher-test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, sourceType }),
  });
  const body = await r.json().catch(() => ({}));
  if (r.status === 200 && body?.fetchStatus === 'ok' && body?.report?.ok === true) {
    const eventCount = Array.isArray(body?.feed?.events) ? body.feed.events.length : 0;
    return {
      ok: true,
      summary: `Validated ${eventCount} event${eventCount === 1 ? '' : 's'}.`,
    };
  }
  // Either non-200 (caller-side error: blocked URL, rate limit, etc.) or
  // 200 with a non-ok fetchStatus/report. In both cases produce a flat
  // string list — preferring the validation report messages when present,
  // since those are the most actionable for a publisher iterating on a feed.
  const reportErrors: string[] = Array.isArray(body?.report?.errors)
    ? body.report.errors
        .map((e: { message?: string; path?: string }) =>
          e?.path ? `${e.path}: ${e.message ?? ''}` : (e?.message ?? ''))
        .filter((s: string) => s.length > 0)
    : [];
  if (reportErrors.length > 0) return { ok: false, errors: reportErrors };
  if (typeof body?.error === 'string') return { ok: false, errors: [body.error] };
  return {
    ok: false,
    errors: [`Preview failed (HTTP ${r.status})`],
  };
}

// ─── Phase 4 (email-change double-opt-in) ─────────────────────────────────

export class PublisherEmailChangeError extends PublisherStatusError {
  constructor(
    message: string,
    status: number,
    public readonly code: string | null,
    public readonly details: unknown,
  ) {
    super(message, status);
    this.name = 'PublisherEmailChangeError';
  }
}

// POSTs to /api/publisher-email-change. Returns when the backend has
// accepted the request (verify+warning emails dispatched). Throws
// PublisherEmailChangeError on validation rejection (with `code` carrying
// the backend's code so callers can render the right message), or
// PublisherStatusError on other transport / 5xx errors.
export async function requestEmailChange(newEmail: string): Promise<void> {
  const jwt = getPublisherJwt();
  if (!jwt) {
    redirectToLogin();
    throw new PublisherStatusError('No publisher session.', 401);
  }
  const r = await fetch(`${API_BASE}/api/publisher-email-change`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ newEmail }),
  });
  if (r.status === 401) {
    clearPublisherSession();
    redirectToLogin();
    throw new PublisherStatusError('Session expired.', 401);
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new PublisherEmailChangeError(
      typeof body?.error === 'string' ? body.error : `Request failed (${r.status}).`,
      r.status,
      typeof body?.code === 'string' ? body.code : null,
      body?.details ?? null,
    );
  }
}

// ─── Phase 5 (self-service ingest controls) ───────────────────────────────
//
// Three routes — fetch-now (202 / 429), pause (200), resume (200). All
// authenticated; 401 clears the session and bounces to /publish/login/
// like the other endpoints in this module.
//
// FetchNowError carries retryAfterSeconds so the IngestControls component
// can render a countdown without re-parsing the body.

export class PublisherFetchNowError extends PublisherStatusError {
  constructor(
    message: string,
    status: number,
    public readonly retryAfterSeconds: number | null,
  ) {
    super(message, status);
    this.name = 'PublisherFetchNowError';
  }
}

export interface FetchNowResponse {
  acceptedAt: string;
}

export async function triggerFetchNow(): Promise<FetchNowResponse> {
  const jwt = getPublisherJwt();
  if (!jwt) {
    redirectToLogin();
    throw new PublisherStatusError('No publisher session.', 401);
  }
  const r = await fetch(`${API_BASE}/api/publisher-fetch-now`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
  });
  if (r.status === 401) {
    clearPublisherSession();
    redirectToLogin();
    throw new PublisherStatusError('Session expired.', 401);
  }
  const body = await r.json().catch(() => ({}));
  if (r.status === 429) {
    // Prefer the body's retryAfterSeconds (always set by the backend) over
    // parsing the Retry-After header — the backend writes both for transport
    // robustness, but the body is the typed contract.
    const retryAfter = typeof body?.retryAfterSeconds === 'number'
      ? body.retryAfterSeconds
      : Number(r.headers.get('Retry-After')) || null;
    throw new PublisherFetchNowError(
      typeof body?.error === 'string' ? body.error : 'Fetch-now is rate-limited.',
      429,
      retryAfter,
    );
  }
  if (!r.ok) {
    throw new PublisherStatusError(
      typeof body?.error === 'string' ? body.error : `Request failed (${r.status}).`,
      r.status,
    );
  }
  return {
    acceptedAt: typeof body?.acceptedAt === 'string' ? body.acceptedAt : new Date().toISOString(),
  };
}

async function postPauseToggle(path: 'publisher-pause' | 'publisher-resume'): Promise<PublisherStatusRecord> {
  const jwt = getPublisherJwt();
  if (!jwt) {
    redirectToLogin();
    throw new PublisherStatusError('No publisher session.', 401);
  }
  const r = await fetch(`${API_BASE}/api/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
  });
  if (r.status === 401) {
    clearPublisherSession();
    redirectToLogin();
    throw new PublisherStatusError('Session expired.', 401);
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new PublisherStatusError(
      typeof body?.error === 'string' ? body.error : `Request failed (${r.status}).`,
      r.status,
    );
  }
  if (!body || typeof body.publisher !== 'object' || body.publisher === null) {
    throw new PublisherStatusError('Malformed response.', 500);
  }
  return body.publisher as PublisherStatusRecord;
}

export async function pausePublisher(): Promise<PublisherStatusRecord> {
  return postPauseToggle('publisher-pause');
}

export async function resumePublisher(): Promise<PublisherStatusRecord> {
  return postPauseToggle('publisher-resume');
}

// ─── Phase 6 (self-disable) ───────────────────────────────────────────────
//
// POST /api/publisher-disable. The body's confirmSlug must match the
// publisher's slug (publisher.id) exactly — that gate lives on the server
// and the UI also enforces it client-side as a defence-in-depth check.
//
// On a successful 200 the publisher's tokenVersion has been bumped, which
// invalidates the JWT used to make this very call. The next status fetch
// would 401, so callers should redirect to /publish/ rather than re-render
// the status page.

export class PublisherSelfDisableError extends PublisherStatusError {
  constructor(
    message: string,
    status: number,
    public readonly code: string | null,
  ) {
    super(message, status);
    this.name = 'PublisherSelfDisableError';
  }
}

export interface SelfDisableResponse {
  ok: true;
  emailedTo: string;
}

export async function selfDisablePublisher(confirmSlug: string): Promise<SelfDisableResponse> {
  const jwt = getPublisherJwt();
  if (!jwt) {
    redirectToLogin();
    throw new PublisherStatusError('No publisher session.', 401);
  }
  const r = await fetch(`${API_BASE}/api/publisher-disable`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ confirmSlug }),
  });
  // 401 here means the session was already invalid coming in (the token
  // bump happens server-side AFTER auth verification, so a 401 on this
  // route indicates a stale local token rather than a successful disable).
  if (r.status === 401) {
    clearPublisherSession();
    redirectToLogin();
    throw new PublisherStatusError('Session expired.', 401);
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new PublisherSelfDisableError(
      typeof body?.error === 'string' ? body.error : `Request failed (${r.status}).`,
      r.status,
      typeof body?.code === 'string' ? body.code : null,
    );
  }
  return {
    ok: true,
    emailedTo: typeof body?.emailedTo === 'string' ? body.emailedTo : '',
  };
}

// DELETE /api/publisher-email-change — cancel-by-self. Always succeeds
// (idempotent server-side). 401 still triggers the redirect-to-login path.
export async function cancelEmailChangeBySelf(): Promise<void> {
  const jwt = getPublisherJwt();
  if (!jwt) {
    redirectToLogin();
    throw new PublisherStatusError('No publisher session.', 401);
  }
  const r = await fetch(`${API_BASE}/api/publisher-email-change`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
  });
  if (r.status === 401) {
    clearPublisherSession();
    redirectToLogin();
    throw new PublisherStatusError('Session expired.', 401);
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new PublisherStatusError(
      typeof body?.error === 'string' ? body.error : `Request failed (${r.status}).`,
      r.status,
    );
  }
}
