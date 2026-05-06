// Tests for POST /publisher-disable (Phase 6 — self-disable with typed-
// confirmation gate). Covers auth, validation, the typed-slug match,
// rate-limiting, and the per-error-code response shape.
//
// Mirrors the publisherPortalHandler.pauseResume.test.ts pattern: the
// publisherAuthService is module-mocked, the registry is injected, and the
// rate limiter is replaced with an InMemoryRateLimiter so we can drive the
// bucket deterministically. The selfDisable action itself is also injected
// so we can exercise its error-mapping without re-stubbing every collaborator.

import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  handlePublisherDisable,
  _setStatusRegistryForTests,
  _setRateLimiterForTests,
  _setSelfDisableActionForTests,
} from '../handlers/publisherPortalHandler';
import { SelfDisableError } from '../services/publisherSelfActionService';
import { InMemoryRateLimiter } from '../services/rateLimitService';
import type { PublisherRecord } from '../types/publisher';

jest.mock('../services/publisherAuthService', () => ({
  verifyPublisherJwt: jest.fn(),
}));
import { verifyPublisherJwt } from '../services/publisherAuthService';

const evt = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent => ({
  body: '',
  headers: {},
  multiValueHeaders: {},
  httpMethod: 'POST',
  isBase64Encoded: false,
  path: '/publisher-disable',
  pathParameters: null,
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  stageVariables: null,
  resource: '/publisher-disable',
  requestContext: { identity: { sourceIp: '203.0.113.1' } } as any,
  ...overrides,
});

const makeRecord = (overrides: Partial<PublisherRecord> = {}): PublisherRecord => ({
  id: 'pub-abc',
  name: 'Test Publisher',
  contactEmail: 'pub@example.com',
  sourceUrl: 'https://example.com/feed.json',
  sourceType: 'json',
  trustLevel: 'review',
  enabled: true,
  applicationStatus: 'approved',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('handlePublisherDisable', () => {
  let registry: { get: jest.Mock };
  let action: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = { get: jest.fn() };
    _setStatusRegistryForTests(registry as any);
    _setRateLimiterForTests(new InMemoryRateLimiter());
    action = jest.fn();
    _setSelfDisableActionForTests(action);
  });
  afterEach(() => {
    _setStatusRegistryForTests(null);
    _setRateLimiterForTests(null);
    _setSelfDisableActionForTests(null);
  });

  // ── auth gates ─────────────────────────────────────────────────────────
  it('returns 401 when Authorization header missing', async () => {
    const r = await handlePublisherDisable(evt(), { confirmSlug: 'pub-abc' });
    expect(r.statusCode).toBe(401);
    expect(action).not.toHaveBeenCalled();
  });

  it('returns 401 when JWT is invalid', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue(null);
    const r = await handlePublisherDisable(
      evt({ headers: { Authorization: 'Bearer bad' } }),
      { confirmSlug: 'pub-abc' },
    );
    expect(r.statusCode).toBe(401);
    expect(action).not.toHaveBeenCalled();
  });

  it('returns 404 when publisher row deleted', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-abc', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(null);
    const r = await handlePublisherDisable(
      evt({ headers: { Authorization: 'Bearer ok' } }),
      { confirmSlug: 'pub-abc' },
    );
    expect(r.statusCode).toBe(404);
    expect(action).not.toHaveBeenCalled();
  });

  it('returns 403 when applicationStatus is rejected (or pending)', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-abc', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(makeRecord({ applicationStatus: 'rejected' }));
    const r = await handlePublisherDisable(
      evt({ headers: { Authorization: 'Bearer ok' } }),
      { confirmSlug: 'pub-abc' },
    );
    expect(r.statusCode).toBe(403);
    expect(action).not.toHaveBeenCalled();
  });

  // ── validation ─────────────────────────────────────────────────────────
  it('returns 400 with code=missing_confirm when confirmSlug is missing', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-abc', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(makeRecord());
    const r = await handlePublisherDisable(
      evt({ headers: { Authorization: 'Bearer ok' } }),
      {},
    );
    expect(r.statusCode).toBe(400);
    const body = JSON.parse(r.body);
    expect(body.code).toBe('missing_confirm');
    expect(action).not.toHaveBeenCalled();
  });

  it('returns 400 with code=missing_confirm when confirmSlug is empty string', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-abc', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(makeRecord());
    const r = await handlePublisherDisable(
      evt({ headers: { Authorization: 'Bearer ok' } }),
      { confirmSlug: '' },
    );
    expect(r.statusCode).toBe(400);
    const body = JSON.parse(r.body);
    expect(body.code).toBe('missing_confirm');
    expect(action).not.toHaveBeenCalled();
  });

  it('returns 400 with code=confirm_mismatch when the action raises confirm_mismatch', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-abc', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(makeRecord());
    action.mockRejectedValueOnce(new SelfDisableError('confirm_mismatch'));
    const r = await handlePublisherDisable(
      evt({ headers: { Authorization: 'Bearer ok' } }),
      { confirmSlug: 'wrong-slug' },
    );
    expect(r.statusCode).toBe(400);
    const body = JSON.parse(r.body);
    expect(body.code).toBe('confirm_mismatch');
    expect(action).toHaveBeenCalledTimes(1);
  });

  // ── happy path ─────────────────────────────────────────────────────────
  it('200 with { ok: true, emailedTo } on a successful disable', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-abc', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(makeRecord());
    action.mockResolvedValueOnce({
      publisherId: 'pub-abc',
      slug: 'pub-abc',
      emailedTo: 'pub@example.com',
    });
    const r = await handlePublisherDisable(
      evt({ headers: { Authorization: 'Bearer ok' } }),
      { confirmSlug: 'pub-abc' },
    );
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.emailedTo).toBe('pub@example.com');
    expect(action).toHaveBeenCalledWith({
      publisherId: 'pub-abc',
      confirmSlug: 'pub-abc',
    });
  });

  // ── rate limit ─────────────────────────────────────────────────────────
  it('rate-limits after 5 attempts in an hour (per-publisher key)', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-abc', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(makeRecord());
    // Each call resolves; the limiter is the gate.
    action.mockResolvedValue({
      publisherId: 'pub-abc',
      slug: 'pub-abc',
      emailedTo: 'pub@example.com',
    });
    for (let i = 0; i < 5; i++) {
      const r = await handlePublisherDisable(
        evt({ headers: { Authorization: 'Bearer ok' } }),
        { confirmSlug: 'pub-abc' },
      );
      expect(r.statusCode).toBe(200);
    }
    const sixth = await handlePublisherDisable(
      evt({ headers: { Authorization: 'Bearer ok' } }),
      { confirmSlug: 'pub-abc' },
    );
    expect(sixth.statusCode).toBe(429);
    const body = JSON.parse(sixth.body);
    expect(typeof body.retryAfterSeconds).toBe('number');
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('a missing-confirm 400 does NOT consume a rate-limit slot', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-abc', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(makeRecord());
    action.mockResolvedValue({
      publisherId: 'pub-abc',
      slug: 'pub-abc',
      emailedTo: 'pub@example.com',
    });
    // 6 missing-confirm 400s do not exhaust the bucket because they short-
    // circuit before checkAndConsume runs.
    for (let i = 0; i < 6; i++) {
      const r = await handlePublisherDisable(
        evt({ headers: { Authorization: 'Bearer ok' } }),
        {},
      );
      expect(r.statusCode).toBe(400);
    }
    // A real attempt still succeeds.
    const r = await handlePublisherDisable(
      evt({ headers: { Authorization: 'Bearer ok' } }),
      { confirmSlug: 'pub-abc' },
    );
    expect(r.statusCode).toBe(200);
  });
});
