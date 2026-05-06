// Tests for POST /publisher-fetch-now (Phase 5 — publisher self-service
// ingest controls). Covers auth gates, the per-publisher rate limit, and
// the LambdaClient invoke shape (single-publisher payload).
//
// Mirrors publisherPortalHandler.profile.test.ts — publisherAuthService is
// module-mocked, the registry is injected via _setStatusRegistryForTests,
// and the rate limiter is replaced with an InMemoryRateLimiter so the test
// can drive the bucket deterministically.

import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  handlePublisherFetchNow,
  _setStatusRegistryForTests,
  _setRateLimiterForTests,
} from '../handlers/publisherPortalHandler';
import { InMemoryRateLimiter } from '../services/rateLimitService';
import { _setLambdaClientForTests } from '../services/publisherIngestInvoker';
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
  path: '/publisher-fetch-now',
  pathParameters: null,
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  stageVariables: null,
  resource: '/publisher-fetch-now',
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

describe('handlePublisherFetchNow', () => {
  let registry: { get: jest.Mock };
  let send: jest.Mock;

  // The handler resolves the target Lambda's name from
  // PUBLISHER_INGEST_FUNCTION_NAME (or the AWS_LAMBDA_FUNCTION_NAME-gated
  // default). Pin it so tests don't depend on the env at run time.
  const PRIOR_INGEST_FN = process.env.PUBLISHER_INGEST_FUNCTION_NAME;
  beforeAll(() => {
    process.env.PUBLISHER_INGEST_FUNCTION_NAME = 'chautauqua-calendar-publisher-ingest';
  });
  afterAll(() => {
    if (PRIOR_INGEST_FN === undefined) delete process.env.PUBLISHER_INGEST_FUNCTION_NAME;
    else process.env.PUBLISHER_INGEST_FUNCTION_NAME = PRIOR_INGEST_FN;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    registry = { get: jest.fn() };
    _setStatusRegistryForTests(registry as any);
    _setRateLimiterForTests(new InMemoryRateLimiter());
    send = jest.fn().mockResolvedValue({ StatusCode: 202 });
    _setLambdaClientForTests({ send } as any);
  });
  afterEach(() => {
    _setStatusRegistryForTests(null);
    _setRateLimiterForTests(null);
    _setLambdaClientForTests(null);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const r = await handlePublisherFetchNow(evt(), {});
    expect(r.statusCode).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it('returns 401 when JWT is invalid', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue(null);
    const r = await handlePublisherFetchNow(
      evt({ headers: { Authorization: 'Bearer bad' } }),
      {},
    );
    expect(r.statusCode).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it('returns 404 when publisher row deleted', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(null);
    const r = await handlePublisherFetchNow(
      evt({ headers: { Authorization: 'Bearer ok' } }),
      {},
    );
    expect(r.statusCode).toBe(404);
  });

  it('returns 403 when applicationStatus is pending', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(makeRecord({ applicationStatus: 'pending' }));
    const r = await handlePublisherFetchNow(
      evt({ headers: { Authorization: 'Bearer ok' } }),
      {},
    );
    expect(r.statusCode).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it('returns 202 with acceptedAt and async-invokes the ingest Lambda with single-publisher payload', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(makeRecord());

    const r = await handlePublisherFetchNow(
      evt({ headers: { Authorization: 'Bearer ok' } }),
      {},
    );

    expect(r.statusCode).toBe(202);
    const body = JSON.parse(r.body);
    expect(body.acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0][0];
    expect(cmd.input.FunctionName).toBe('chautauqua-calendar-publisher-ingest');
    expect(cmd.input.InvocationType).toBe('Event');
    const payload = JSON.parse(Buffer.from(cmd.input.Payload).toString('utf-8'));
    expect(payload.singlePublisherId).toBe('pub-1');
    expect(payload.source).toBe('self-service-fetch-now');
    expect(payload.triggeredAt).toBe(body.acceptedAt);
  });

  it('rate-limits a second call within the window with 429 + retryAfterSeconds', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(makeRecord());

    const first = await handlePublisherFetchNow(
      evt({ headers: { Authorization: 'Bearer ok' } }),
      {},
    );
    expect(first.statusCode).toBe(202);

    const second = await handlePublisherFetchNow(
      evt({ headers: { Authorization: 'Bearer ok' } }),
      {},
    );
    expect(second.statusCode).toBe(429);
    const body = JSON.parse(second.body);
    expect(typeof body.retryAfterSeconds).toBe('number');
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(second.headers!['Retry-After']).toBe(String(body.retryAfterSeconds));
    // Lambda was only invoked once (the 429 doesn't retrigger ingest).
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('rate-limit buckets are per-publisher: a different publisher is not affected by another publisher hitting the cap', async () => {
    // First publisher consumes its bucket.
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(makeRecord({ id: 'pub-1' }));
    await handlePublisherFetchNow(
      evt({ headers: { Authorization: 'Bearer ok-1' } }),
      {},
    );

    // Second publisher's first call should NOT be limited.
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-2', role: 'publisher', email: 'p2@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(makeRecord({ id: 'pub-2' }));
    const r = await handlePublisherFetchNow(
      evt({ headers: { Authorization: 'Bearer ok-2' } }),
      {},
    );
    expect(r.statusCode).toBe(202);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('returns 500 when the Lambda invoke fails', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(makeRecord());
    send.mockRejectedValue(new Error('AccessDeniedException: not allowed'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const r = await handlePublisherFetchNow(
      evt({ headers: { Authorization: 'Bearer ok' } }),
      {},
    );

    expect(r.statusCode).toBe(500);
    expect(JSON.parse(r.body).error).toMatch(/Failed to trigger fetch/);
    errSpy.mockRestore();
  });
});
