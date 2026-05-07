// Actor API: typed wrappers around APIGatewayProxyEvent that drive each
// production handler in the same routing path it would take in real
// API Gateway.
//
// Each method:
//   1. Builds an APIGatewayProxyEvent with realistic shape.
//   2. Calls the appropriate statically-imported handler.
//   3. Parses the JSON response body.
//   4. On non-2xx, throws HandlerError so tests can use rejects.toThrow.

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  handlePublisherApplyRequest,
  handlePublisherApplyVerify,
  handlePublisherAuthRequest,
  handlePublisherAuthVerify,
  handlePublisherStatus,
  handlePublisherProfilePatch,
  handlePublisherEmailChangeRequest,
  handlePublisherEmailChangeCancelSelf,
  handlePublisherEmailChangeVerify,
  handlePublisherEmailChangeCancelByOld,
  handlePublisherFetchNow,
  handlePublisherPause,
  handlePublisherResume,
  handlePublisherDisable,
  handlePublisherRuns,
  handlePublisherEvents,
} from '../../../handlers/publisherPortalHandler';
import { handler as adminHandler } from '../../../handlers/adminHandler';
import type { ApplyFormPayload } from '../../../types/publisher';
import type { Harness } from './harness';

export class HandlerError extends Error {
  constructor(public readonly statusCode: number, public readonly body: any) {
    super(typeof body?.error === 'string' ? body.error : `Handler returned ${statusCode}`);
    this.name = 'HandlerError';
  }
}

interface BuildEventOpts {
  method?: string;
  path?: string;
  body?: Record<string, unknown> | null;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  ip?: string;
}

function buildEvent(opts: BuildEventOpts = {}): APIGatewayProxyEvent {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers ?? {}),
  };
  return {
    httpMethod: opts.method ?? 'POST',
    path: opts.path ?? '/',
    headers,
    multiValueHeaders: {},
    body: opts.body ? JSON.stringify(opts.body) : null,
    isBase64Encoded: false,
    pathParameters: null,
    queryStringParameters: opts.query ?? null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      identity: {
        sourceIp: opts.ip ?? '127.0.0.1',
      },
    } as any,
    resource: '',
  } as unknown as APIGatewayProxyEvent;
}

function parseResult(r: APIGatewayProxyResult): { statusCode: number; body: any } {
  let body: any = {};
  if (typeof r.body === 'string' && r.body.length > 0) {
    try { body = JSON.parse(r.body); }
    catch { body = { _raw: r.body }; }
  }
  return { statusCode: r.statusCode, body };
}

function unwrap<T = any>(r: APIGatewayProxyResult): T {
  const p = parseResult(r);
  if (p.statusCode < 200 || p.statusCode >= 300) {
    throw new HandlerError(p.statusCode, p.body);
  }
  return p.body as T;
}

// ─── Publisher actor ────────────────────────────────────────────────────

export interface PublisherActor {
  apply(payload: Partial<ApplyFormPayload> & { captchaToken?: string }, opts?: { ip?: string }): Promise<{ ok: true }>;
  verifyApplyMagicLink(token: string): Promise<{ jwt: string; publisherId: string; email: string }>;
  loginRequest(email: string, opts?: { ip?: string }): Promise<{ ok: true }>;
  verifyLoginMagicLink(token: string): Promise<{ jwt: string; publisherId: string; email: string }>;
  status(jwtToken: string): Promise<{ publisher: any }>;
  updateProfile(jwtToken: string, patch: Record<string, unknown>): Promise<{ publisher: any }>;
  requestEmailChange(jwtToken: string, newEmail: string): Promise<{ ok: true }>;
  confirmEmailChange(rawToken: string): Promise<any>;
  cancelEmailChangeByOld(rawToken: string): Promise<any>;
  cancelEmailChangeBySelf(jwtToken: string): Promise<any>;
  pause(jwtToken: string): Promise<{ publisher: any }>;
  resume(jwtToken: string): Promise<{ publisher: any }>;
  fetchNow(jwtToken: string): Promise<{ acceptedAt: string }>;
  selfDisable(jwtToken: string, confirmSlug: string): Promise<{ ok: true; emailedTo: string }>;
  runs(jwtToken: string): Promise<{ runs: Array<any> }>;
  events(jwtToken: string): Promise<{ events: Array<any> }>;
}

// ─── Admin actor (routed through adminHandler with bypass) ─────────────

export interface AdminActor {
  approveApplication(publisherId: string, reviewerEmail?: string): Promise<{ publisher: any }>;
  rejectApplication(publisherId: string, reason?: string, reviewerEmail?: string): Promise<{ publisher: any }>;
  listPublishers(): Promise<{ publishers: any[] }>;
  pause(publisherId: string): Promise<{ publisher: any }>;
  resume(publisherId: string): Promise<{ publisher: any }>;
  disable(publisherId: string): Promise<{ publisher: any }>;
  approveEvent(publisherId: string, eventId: string): Promise<void>;
  rejectEvent(publisherId: string, eventId: string, reason?: string): Promise<void>;
  runIngest(reviewerEmail?: string): Promise<{ triggeredAt: string }>;
}

// ─── Ingest actor ───────────────────────────────────────────────────────

export interface IngestActor {
  run(singlePublisherId?: string): Promise<void>;
}

// Combined.
export interface Actors {
  publisher: PublisherActor;
  admin: AdminActor;
  ingest: IngestActor;
}

// To make admin handler routes pass auth, we mint an admin JWT each call.
// adminHandler.ts captures JWT_SECRET at module load. integrationSetup.ts
// (which every integration test imports as its first import) sets
// process.env.JWT_SECRET *before* any production module loads, so that
// captured value is whatever integrationSetup wrote. We re-read it here
// at the same point in time so signatures verify.
//
// We deliberately do NOT fall back to a different literal — if the env
// var is unset, the captured adminHandler value would be 'your-secret-key'
// (its production fallback), which would silently break verification.
// Instead we throw, which will surface as a fast, obvious test failure.
const ADMIN_EMAIL = 'admin@test.chqcal.local';
const ADMIN_JWT_SECRET = (() => {
  const v = process.env.JWT_SECRET;
  if (!v) {
    throw new Error(
      "actors.ts: process.env.JWT_SECRET is not set. " +
      "Make sure integrationSetup.ts ran (every integration test imports it via harness.ts)."
    );
  }
  return v;
})();

import jwt from 'jsonwebtoken';

function mintAdminJwt(email = ADMIN_EMAIL): string {
  return jwt.sign({ email, name: 'Test Admin' }, ADMIN_JWT_SECRET, { expiresIn: '7d' });
}

async function callAdmin(opts: BuildEventOpts & { reviewerEmail?: string }): Promise<APIGatewayProxyResult> {
  const headers = {
    Authorization: `Bearer ${mintAdminJwt(opts.reviewerEmail)}`,
    ...(opts.headers ?? {}),
  };
  const event = buildEvent({ ...opts, headers });
  return adminHandler(event, {} as any);
}

export function buildActors(h: Harness): Actors {
  const publisher: PublisherActor = {
    async apply(payload, opts = {}) {
      const r = await handlePublisherApplyRequest(
        buildEvent({ ip: opts.ip }),
        { ...payload, captchaToken: payload.captchaToken ?? 'test-token' } as any,
      );
      return unwrap(r);
    },
    async verifyApplyMagicLink(token) {
      const r = await handlePublisherApplyVerify(buildEvent(), { token });
      return unwrap(r);
    },
    async loginRequest(email, opts = {}) {
      const r = await handlePublisherAuthRequest(buildEvent({ ip: opts.ip }), { email });
      return unwrap(r);
    },
    async verifyLoginMagicLink(token) {
      const r = await handlePublisherAuthVerify(buildEvent(), { token });
      return unwrap(r);
    },
    async status(jwtToken) {
      const r = await handlePublisherStatus(
        buildEvent({ method: 'GET', headers: { Authorization: `Bearer ${jwtToken}` } }),
        {},
      );
      return unwrap(r);
    },
    async updateProfile(jwtToken, patch) {
      const r = await handlePublisherProfilePatch(
        buildEvent({
          method: 'PATCH',
          headers: { Authorization: `Bearer ${jwtToken}` },
          body: patch,
        }),
        patch,
      );
      return unwrap(r);
    },
    async requestEmailChange(jwtToken, newEmail) {
      const r = await handlePublisherEmailChangeRequest(
        buildEvent({ headers: { Authorization: `Bearer ${jwtToken}` }, body: { newEmail } }),
        { newEmail },
      );
      return unwrap(r);
    },
    async confirmEmailChange(rawToken) {
      const r = await handlePublisherEmailChangeVerify(
        buildEvent({ method: 'GET', query: { token: rawToken } }),
        {},
      );
      return unwrap(r);
    },
    async cancelEmailChangeByOld(rawToken) {
      const r = await handlePublisherEmailChangeCancelByOld(
        buildEvent({ method: 'GET', query: { token: rawToken } }),
        {},
      );
      return unwrap(r);
    },
    async cancelEmailChangeBySelf(jwtToken) {
      const r = await handlePublisherEmailChangeCancelSelf(
        buildEvent({ method: 'DELETE', headers: { Authorization: `Bearer ${jwtToken}` } }),
        {},
      );
      return unwrap(r);
    },
    async pause(jwtToken) {
      const r = await handlePublisherPause(
        buildEvent({ headers: { Authorization: `Bearer ${jwtToken}` } }),
        {},
      );
      return unwrap(r);
    },
    async resume(jwtToken) {
      const r = await handlePublisherResume(
        buildEvent({ headers: { Authorization: `Bearer ${jwtToken}` } }),
        {},
      );
      return unwrap(r);
    },
    async fetchNow(jwtToken) {
      const r = await handlePublisherFetchNow(
        buildEvent({ headers: { Authorization: `Bearer ${jwtToken}` } }),
        {},
      );
      return unwrap(r);
    },
    async selfDisable(jwtToken, confirmSlug) {
      const r = await handlePublisherDisable(
        buildEvent({ headers: { Authorization: `Bearer ${jwtToken}` }, body: { confirmSlug } }),
        { confirmSlug },
      );
      return unwrap(r);
    },
    async runs(jwtToken) {
      const r = await handlePublisherRuns(
        buildEvent({ method: 'GET', path: '/publisher-runs', headers: { Authorization: `Bearer ${jwtToken}` } }),
        {},
      );
      return unwrap(r);
    },
    async events(jwtToken) {
      const r = await handlePublisherEvents(
        buildEvent({ method: 'GET', path: '/publisher-events', headers: { Authorization: `Bearer ${jwtToken}` } }),
        {},
      );
      return unwrap(r);
    },
  };

  const admin: AdminActor = {
    async approveApplication(publisherId, reviewerEmail) {
      const r = await callAdmin({
        method: 'POST',
        path: `/publisher-applications/${encodeURIComponent(publisherId)}/approve`,
        reviewerEmail,
        body: {},
      });
      return unwrap(r);
    },
    async rejectApplication(publisherId, reason, reviewerEmail) {
      const r = await callAdmin({
        method: 'POST',
        path: `/publisher-applications/${encodeURIComponent(publisherId)}/reject`,
        reviewerEmail,
        body: { reason },
      });
      return unwrap(r);
    },
    async listPublishers() {
      const r = await callAdmin({ method: 'GET', path: '/publishers' });
      return unwrap(r);
    },
    async pause(publisherId) {
      const r = await callAdmin({
        method: 'PATCH',
        path: `/publishers/${encodeURIComponent(publisherId)}`,
        body: { paused: true },
      });
      return unwrap(r);
    },
    async resume(publisherId) {
      const r = await callAdmin({
        method: 'PATCH',
        path: `/publishers/${encodeURIComponent(publisherId)}`,
        body: { paused: false },
      });
      return unwrap(r);
    },
    async disable(publisherId) {
      const r = await callAdmin({
        method: 'PATCH',
        path: `/publishers/${encodeURIComponent(publisherId)}`,
        body: { enabled: false },
      });
      return unwrap(r);
    },
    async approveEvent(publisherId, eventId) {
      const r = await callAdmin({
        method: 'POST',
        path: `/publisher-events/${encodeURIComponent(publisherId)}/${encodeURIComponent(eventId)}/approve`,
      });
      if (r.statusCode !== 204) unwrap(r);
    },
    async rejectEvent(publisherId, eventId, reason) {
      const r = await callAdmin({
        method: 'POST',
        path: `/publisher-events/${encodeURIComponent(publisherId)}/${encodeURIComponent(eventId)}/reject`,
        body: reason !== undefined ? { reason } : {},
      });
      if (r.statusCode !== 204) unwrap(r);
    },
    async runIngest(reviewerEmail) {
      const r = await callAdmin({
        method: 'POST',
        path: '/publishers/run-ingest',
        reviewerEmail,
      });
      return unwrap(r);
    },
  };

  const ingest: IngestActor = {
    async run(singlePublisherId) {
      await h.ingest.run(singlePublisherId);
    },
  };

  return { publisher, admin, ingest };
}
