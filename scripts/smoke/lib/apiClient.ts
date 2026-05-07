// Thin typed fetch wrappers for the post-deploy publisher-lifecycle smoke.
//
// The smoke runs against the real production stack (https://www.chqcal.org by
// default), so this client uses native fetch — no SDK dependency, no in-process
// fakes. Every call funnels through `request()` which:
//
//   - resolves the URL against SMOKE_API_BASE
//   - injects per-call headers (the smoke admin Bearer token for admin
//     routes, X-Smoke-Bypass for the apply route)
//   - parses JSON
//   - throws SmokeApiError on non-2xx so the test fails loudly with the
//     status, body, and the path it tried.

import { signSmokeAdminToken } from './adminAuth';

export class SmokeApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly bodyText: string,
  ) {
    super(`SmokeApiError ${status} ${path}: ${bodyText.slice(0, 500)}`);
    this.name = 'SmokeApiError';
  }
}

export interface SmokeApiClientOpts {
  baseUrl: string; // e.g. https://www.chqcal.org
  // Optional override for tests (jest.mock fetch). Defaults to globalThis.fetch.
  fetchImpl?: typeof fetch;
  // CAPTCHA bypass token — same value provisioned to the admin Lambda env
  // CAPTCHA_BYPASS_TOKEN. Sent in X-Smoke-Bypass header on the apply route.
  captchaBypassToken: string;
}

interface RequestOpts {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;        // path WITHOUT base prefix, e.g. '/api/publisher-apply/request'
  body?: unknown;      // serialized as JSON
  headers?: Record<string, string>;
  // When true, the smoke-admin Bearer token is auto-attached.
  adminAuth?: boolean;
}

export class SmokeApiClient {
  constructor(private readonly opts: SmokeApiClientOpts) {}

  private async request<T>(req: RequestOpts): Promise<T> {
    const url = `${this.opts.baseUrl}${req.path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(req.headers ?? {}),
    };
    if (req.adminAuth) {
      headers['Authorization'] = `Bearer ${signSmokeAdminToken({})}`;
    }
    const fetchImpl = this.opts.fetchImpl ?? globalThis.fetch;
    const r = await fetchImpl(url, {
      method: req.method ?? 'POST',
      headers,
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
    });
    const text = await r.text();
    if (!r.ok) {
      throw new SmokeApiError(r.status, req.path, text);
    }
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new SmokeApiError(r.status, req.path, `non-JSON body: ${text.slice(0, 500)}`);
    }
  }

  // ─── Public publisher portal ───────────────────────────────────────────

  publisher = {
    applyRequest: (payload: {
      email: string;
      name: string;
      sourceUrl: string;
      sourceType: 'json' | 'html';
      organization?: string;
      notes?: string;
      captchaToken?: string;
    }): Promise<{ ok: true } | { ok: false; reason: string }> =>
      this.request({
        path: '/api/publisher-apply/request',
        body: { ...payload, captchaToken: payload.captchaToken ?? 'smoke-bypass' },
        headers: { 'X-Smoke-Bypass': this.opts.captchaBypassToken },
      }),

    applyVerify: (rawToken: string): Promise<{ jwt: string; publisherId: string; email: string }> =>
      this.request({
        path: '/api/publisher-apply/verify',
        body: { token: rawToken },
      }),

    pause: (jwt: string) =>
      this.request<{ ok: true }>({
        path: '/api/publisher-pause',
        headers: { Authorization: `Bearer ${jwt}` },
      }),

    resume: (jwt: string) =>
      this.request<{ ok: true }>({
        path: '/api/publisher-resume',
        headers: { Authorization: `Bearer ${jwt}` },
      }),

    selfDisable: (jwt: string, body: { confirmSlug: string }) =>
      this.request<{ ok: true }>({
        path: '/api/publisher-disable',
        body,
        headers: { Authorization: `Bearer ${jwt}` },
      }),

    runs: (jwt: string) =>
      this.request<{ runs: Array<{ publisherId: string; runAt: string; status: string; message?: string; counts?: { added: number; updated: number; retracted: number; unchanged: number }; triggeredBy: string }> }>({
        method: 'GET',
        path: '/api/publisher-runs',
        headers: { Authorization: `Bearer ${jwt}` },
      }),

    events: (jwt: string) =>
      this.request<{ events: Array<{ eventId: string; title: string; startDate: string; endDate: string; state: 'published' | 'pending' | 'rejected'; rejectionReason?: string; rejectedAt?: string; updatedAt: string }> }>({
        method: 'GET',
        path: '/api/publisher-events',
        headers: { Authorization: `Bearer ${jwt}` },
      }),
  };

  // ─── Admin endpoints (smoke-bot Bearer token) ─────────────────────────

  admin = {
    listPublishers: () =>
      this.request<{ publishers: Array<{ id: string; enabled: boolean; contactEmail: string; applicationStatus?: string }> }>({
        method: 'GET',
        path: '/admin/api/publishers',
        adminAuth: true,
      }),

    runIngest: () =>
      this.request<{ triggeredAt: string }>({
        method: 'POST',
        path: '/admin/api/publishers/run-ingest',
        adminAuth: true,
      }),

    approveApplication: (publisherId: string) =>
      this.request<{ publisher: { id: string; enabled: boolean } }>({
        method: 'POST',
        path: `/admin/api/publisher-applications/${encodeURIComponent(publisherId)}/approve`,
        adminAuth: true,
      }),

    eventCount: (publisherId: string) =>
      this.request<{ count: number }>({
        method: 'POST',
        path: `/admin/api/publishers/${encodeURIComponent(publisherId)}/events/count`,
        adminAuth: true,
      }),

    smokeReset: (email: string) =>
      this.request<{ rowsAffected: number }>({
        method: 'POST',
        path: '/admin/api/smoke-reset-bbtest',
        body: { email },
        adminAuth: true,
      }),

    // Materializes the publisher row from a most-recent apply magic-token
    // row for `email` and returns the resulting publisher JWT + id. See
    // backend/src/handlers/adminHandler.ts for the rationale (raw tokens
    // aren't recoverable from DDB so the smoke can't replay verifyApply).
    consumeApplyByEmail: (email: string, opts: { publisherId?: string } = {}) =>
      this.request<{ jwt: string; publisherId: string; email: string }>({
        method: 'POST',
        path: '/admin/api/smoke-magic-token-by-email',
        // The optional publisherId override is gated to a single allowlisted
        // value ('smoke-bbtest') by the handler; the smoke uses it to make
        // the materialized publisher row's id match the static smoke feed's
        // publisher.id, so the publisher-ingest fetcher's id-match check
        // passes during the run-ingest step.
        body: opts.publisherId ? { email, publisherId: opts.publisherId } : { email },
        adminAuth: true,
      }),
  };
}
