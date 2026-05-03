// Tests for the GET /api/publisher-status route added in Phase C.
// The publisher-JWT verifier is mocked at module level so we don't need to
// stand up Secrets Manager. The registry is replaced via _setStatusRegistryForTests.

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handlePublisherStatus, _setStatusRegistryForTests } from '../handlers/publisherPortalHandler';
import type { PublisherRecord } from '../types/publisher';

jest.mock('../services/publisherAuthService', () => ({
  verifyPublisherJwt: jest.fn(),
}));
import { verifyPublisherJwt } from '../services/publisherAuthService';

const evt = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent => ({
  body: '',
  headers: {},
  multiValueHeaders: {},
  httpMethod: 'GET',
  isBase64Encoded: false,
  path: '/publisher-status',
  pathParameters: null,
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  stageVariables: null,
  resource: '/publisher-status',
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
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('handlePublisherStatus', () => {
  let registry: { get: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    registry = { get: jest.fn() };
    _setStatusRegistryForTests(registry as any);
  });
  afterEach(() => {
    _setStatusRegistryForTests(null);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const r = await handlePublisherStatus(evt(), {});
    expect(r.statusCode).toBe(401);
    expect(JSON.parse(r.body).error).toMatch(/Authentication required/);
    expect(registry.get).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header is malformed (no Bearer)', async () => {
    const r = await handlePublisherStatus(
      evt({ headers: { Authorization: 'token-without-bearer' } }),
      {},
    );
    expect(r.statusCode).toBe(401);
  });

  it('returns 401 when JWT verification fails', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue(null);
    const r = await handlePublisherStatus(
      evt({ headers: { Authorization: 'Bearer bad.jwt.value' } }),
      {},
    );
    expect(r.statusCode).toBe(401);
    expect(registry.get).not.toHaveBeenCalled();
  });

  it('returns 404 when publisher row no longer exists', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-deleted', role: 'publisher', email: 'p@x.com',
    });
    registry.get.mockResolvedValue(null);
    const r = await handlePublisherStatus(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      {},
    );
    expect(r.statusCode).toBe(404);
    expect(JSON.parse(r.body).error).toMatch(/not found/i);
  });

  it('returns 200 with the sanitized publisher record on success', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'pub@example.com',
    });
    const rec = makeRecord({
      id: 'pub-1',
      applicationStatus: 'approved',
      reviewerEmail: 'admin@chqcal.org', // PII — must be stripped
      reviewedAt: '2026-05-03T00:00:00.000Z',
      lastFetchedAt: '2026-05-03T01:00:00.000Z',
      lastFetchStatus: 'ok',
      pendingThresholdHalt: { // ops-internal — must be stripped
        detectedAt: '2026-05-02T00:00:00.000Z',
        incomingFeed: { eventCount: 9999, publisherId: 'pub-1' },
      },
    });
    registry.get.mockResolvedValue(rec);

    const r = await handlePublisherStatus(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      {},
    );
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.publisher.id).toBe('pub-1');
    expect(body.publisher.applicationStatus).toBe('approved');
    expect(body.publisher.lastFetchStatus).toBe('ok');
    // Sanitized fields must NOT appear:
    expect(body.publisher.reviewerEmail).toBeUndefined();
    expect(body.publisher.pendingThresholdHalt).toBeUndefined();
    // Public fields preserved:
    expect(body.publisher.contactEmail).toBe('test@example.com');
    expect(body.publisher.sourceUrl).toBe('https://example.com/feed.json');
  });

  it('uses authoritative sub from JWT to look up the row (not any header)', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-from-jwt', role: 'publisher', email: 'p@x.com',
    });
    registry.get.mockResolvedValue(makeRecord({ id: 'pub-from-jwt' }));
    await handlePublisherStatus(
      evt({ headers: { Authorization: 'Bearer good.jwt', 'X-Publisher-Id': 'spoofed' } }),
      {},
    );
    expect(registry.get).toHaveBeenCalledWith('pub-from-jwt');
  });

  it('accepts lowercase "authorization" header', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com',
    });
    registry.get.mockResolvedValue(makeRecord({ id: 'pub-1' }));
    const r = await handlePublisherStatus(
      evt({ headers: { authorization: 'Bearer good.jwt' } }),
      {},
    );
    expect(r.statusCode).toBe(200);
  });

  it('returns 500 on registry exception', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com',
    });
    registry.get.mockRejectedValue(new Error('DDB throttled'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await handlePublisherStatus(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      {},
    );
    expect(r.statusCode).toBe(500);
    errSpy.mockRestore();
  });
});
