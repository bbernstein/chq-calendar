// Tests for POST /publisher-pause and /publisher-resume (Phase 5).
//
// Both routes are thin wrappers around PublisherRegistryService.setPausedFlag,
// gated on publisher JWT + applicationStatus=approved. Idempotent — calling
// pause on an already-paused row succeeds with 200 (the registry update is
// a no-op write, not an error).

import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  handlePublisherPause,
  handlePublisherResume,
  _setStatusRegistryForTests,
  _setRateLimiterForTests,
} from '../handlers/publisherPortalHandler';
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
  path: '/publisher-pause',
  pathParameters: null,
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  stageVariables: null,
  resource: '/publisher-pause',
  requestContext: { identity: { sourceIp: '203.0.113.1' } } as any,
  ...overrides,
});

const makeRecord = (overrides: Partial<PublisherRecord> = {}): PublisherRecord => ({
  id: 'pub-1',
  name: 'Test Publisher',
  contactEmail: 'test@example.com',
  sourceUrl: 'https://example.com/feed.json',
  sourceType: 'json',
  trustLevel: 'review',
  enabled: true,
  applicationStatus: 'approved',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('handlePublisherPause / handlePublisherResume', () => {
  let registry: { get: jest.Mock; setPausedFlag: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    registry = {
      get: jest.fn(),
      setPausedFlag: jest.fn().mockResolvedValue(undefined),
    };
    _setStatusRegistryForTests(registry as any);
    _setRateLimiterForTests(new InMemoryRateLimiter());
  });
  afterEach(() => {
    _setStatusRegistryForTests(null);
    _setRateLimiterForTests(null);
  });

  // ── auth gates ─────────────────────────────────────────────────────────
  it('pause returns 401 when Authorization header missing', async () => {
    const r = await handlePublisherPause(evt(), {});
    expect(r.statusCode).toBe(401);
    expect(registry.setPausedFlag).not.toHaveBeenCalled();
  });

  it('resume returns 401 when JWT is invalid', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue(null);
    const r = await handlePublisherResume(
      evt({ headers: { Authorization: 'Bearer bad' } }),
      {},
    );
    expect(r.statusCode).toBe(401);
    expect(registry.setPausedFlag).not.toHaveBeenCalled();
  });

  it('pause returns 404 when publisher row deleted', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(null);
    const r = await handlePublisherPause(
      evt({ headers: { Authorization: 'Bearer ok' } }),
      {},
    );
    expect(r.statusCode).toBe(404);
  });

  it('pause returns 403 when applicationStatus is rejected', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(makeRecord({ applicationStatus: 'rejected' }));
    const r = await handlePublisherPause(
      evt({ headers: { Authorization: 'Bearer ok' } }),
      {},
    );
    expect(r.statusCode).toBe(403);
    expect(registry.setPausedFlag).not.toHaveBeenCalled();
  });

  // ── happy paths ────────────────────────────────────────────────────────
  it('pause invokes setPausedFlag(id, true, { selfInitiated: true }) and returns updated publisher', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    const before = makeRecord();
    const after = makeRecord({ paused: true, selfPausedAt: '2026-05-05T12:00:00.000Z' });
    // Two get() calls: first by requirePublisherSession (auth), second to
    // re-read after the update so the response reflects the post-write state.
    registry.get.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    const r = await handlePublisherPause(
      evt({ headers: { Authorization: 'Bearer ok' } }),
      {},
    );
    expect(r.statusCode).toBe(200);
    expect(registry.setPausedFlag).toHaveBeenCalledWith('pub-1', true, { selfInitiated: true });
    const body = JSON.parse(r.body);
    expect(body.publisher.id).toBe('pub-1');
    expect(body.publisher.paused).toBe(true);
    expect(body.publisher.selfPausedAt).toBe('2026-05-05T12:00:00.000Z');
  });

  it('resume invokes setPausedFlag(id, false, {}) and returns updated publisher', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    const before = makeRecord({ paused: true, selfPausedAt: '2026-05-05T12:00:00.000Z' });
    const after = makeRecord({ paused: false });
    registry.get.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    const r = await handlePublisherResume(
      evt({ headers: { Authorization: 'Bearer ok' } }),
      {},
    );
    expect(r.statusCode).toBe(200);
    expect(registry.setPausedFlag).toHaveBeenCalledWith('pub-1', false, {});
    const body = JSON.parse(r.body);
    expect(body.publisher.paused).toBe(false);
    expect(body.publisher.selfPausedAt).toBeUndefined();
  });

  // ── idempotence ─────────────────────────────────────────────────────────
  it('pause is idempotent: calling pause on an already-paused publisher succeeds', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    const already = makeRecord({ paused: true });
    registry.get.mockResolvedValue(already);
    const r = await handlePublisherPause(
      evt({ headers: { Authorization: 'Bearer ok' } }),
      {},
    );
    expect(r.statusCode).toBe(200);
    expect(registry.setPausedFlag).toHaveBeenCalledTimes(1);
  });

  it('resume is idempotent: calling resume on an already-active publisher succeeds', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    const already = makeRecord({ paused: false });
    registry.get.mockResolvedValue(already);
    const r = await handlePublisherResume(
      evt({ headers: { Authorization: 'Bearer ok' } }),
      {},
    );
    expect(r.statusCode).toBe(200);
    expect(registry.setPausedFlag).toHaveBeenCalledWith('pub-1', false, {});
  });

  // ── rate limit ─────────────────────────────────────────────────────────
  it('rate-limits after 10 toggles in a minute (per-publisher key)', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(makeRecord());
    // Fire 10 successful pauses (the cap), then expect the 11th to 429.
    for (let i = 0; i < 10; i++) {
      const r = await handlePublisherPause(
        evt({ headers: { Authorization: 'Bearer ok' } }),
        {},
      );
      expect(r.statusCode).toBe(200);
    }
    const eleventh = await handlePublisherPause(
      evt({ headers: { Authorization: 'Bearer ok' } }),
      {},
    );
    expect(eleventh.statusCode).toBe(429);
    const body = JSON.parse(eleventh.body);
    expect(typeof body.retryAfterSeconds).toBe('number');
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
  });
});
