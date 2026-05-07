// Tests for PATCH /publisher-profile (Phase 2 — publisher self-service).
//
// Mirrors the structure of publisherPortalHandler.status.test.ts:
// publisherAuthService is mocked at the module level (no Secrets Manager
// round-trips), and the registry is replaced via _setStatusRegistryForTests.
// We additionally mock the publisherTestService so the URL/sourceType-change
// path doesn't try to actually fetch a feed.

import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  handlePublisherProfilePatch,
  _setStatusRegistryForTests,
} from '../handlers/publisherPortalHandler';
import type { PublisherRecord } from '../types/publisher';

jest.mock('../services/publisherAuthService', () => ({
  verifyPublisherJwt: jest.fn(),
}));
import { verifyPublisherJwt } from '../services/publisherAuthService';

jest.mock('../services/publisherTestService', () => ({
  testPublisherFeed: jest.fn(),
  TEST_PUBLISHER_ID_SENTINEL: '__chqcal_test_unregistered__',
}));
import { testPublisherFeed } from '../services/publisherTestService';

const evt = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent => ({
  body: '',
  headers: {},
  multiValueHeaders: {},
  httpMethod: 'PATCH',
  isBase64Encoded: false,
  path: '/publisher-profile',
  pathParameters: null,
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  stageVariables: null,
  resource: '/publisher-profile',
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

describe('handlePublisherProfilePatch', () => {
  let registry: { get: jest.Mock; updateProfile: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    registry = { get: jest.fn(), updateProfile: jest.fn() };
    _setStatusRegistryForTests(registry as any);
  });
  afterEach(() => {
    _setStatusRegistryForTests(null);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const r = await handlePublisherProfilePatch(evt(), { name: 'X' });
    expect(r.statusCode).toBe(401);
    expect(registry.get).not.toHaveBeenCalled();
  });

  it('returns 401 when JWT is invalid', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue(null);
    const r = await handlePublisherProfilePatch(
      evt({ headers: { Authorization: 'Bearer bad.jwt' } }),
      { name: 'X' },
    );
    expect(r.statusCode).toBe(401);
  });

  it('returns 401 when tokenVersion mismatches', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 1,
    });
    registry.get.mockResolvedValue(makeRecord({ tokenVersion: 2 }));
    const r = await handlePublisherProfilePatch(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      { name: 'X' },
    );
    expect(r.statusCode).toBe(401);
    expect(registry.updateProfile).not.toHaveBeenCalled();
  });

  it('returns 404 when publisher row deleted while session is held', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-deleted', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(null);
    const r = await handlePublisherProfilePatch(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      { name: 'X' },
    );
    expect(r.statusCode).toBe(404);
  });

  it('returns 403 when applicationStatus is pending', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(makeRecord({ applicationStatus: 'pending' }));
    const r = await handlePublisherProfilePatch(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      { name: 'X' },
    );
    expect(r.statusCode).toBe(403);
    expect(registry.updateProfile).not.toHaveBeenCalled();
  });

  it('returns 403 when applicationStatus is rejected', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(makeRecord({ applicationStatus: 'rejected' }));
    const r = await handlePublisherProfilePatch(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      { name: 'X' },
    );
    expect(r.statusCode).toBe(403);
  });

  it('returns 400 with code=unknown_field when patch contains a non-editable field', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(makeRecord());
    const r = await handlePublisherProfilePatch(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      { trustLevel: 'auto' },
    );
    expect(r.statusCode).toBe(400);
    const body = JSON.parse(r.body);
    expect(body.code).toBe('unknown_field');
    expect(registry.updateProfile).not.toHaveBeenCalled();
  });

  it('returns 400 with code=empty_name when name is blank', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(makeRecord());
    const r = await handlePublisherProfilePatch(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      { name: '   ' },
    );
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).code).toBe('empty_name');
  });

  it('returns 400 with code=bad_url when sourceUrl is http', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValue(makeRecord());
    const r = await handlePublisherProfilePatch(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      { sourceUrl: 'http://insecure.example/feed' },
    );
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).code).toBe('bad_url');
    expect(testPublisherFeed).not.toHaveBeenCalled();
    expect(registry.updateProfile).not.toHaveBeenCalled();
  });

  it('returns 200 with sanitized publisher when name change succeeds', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get
      .mockResolvedValueOnce(makeRecord())
      .mockResolvedValueOnce(makeRecord({
        name: 'New Name',
        reviewerEmail: 'admin@chqcal.org', // PII — must be stripped
      }));
    registry.updateProfile.mockResolvedValue(undefined);
    const r = await handlePublisherProfilePatch(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      { name: 'New Name' },
    );
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.publisher.name).toBe('New Name');
    expect(body.publisher.reviewerEmail).toBeUndefined();
    expect(registry.updateProfile).toHaveBeenCalledWith('pub-1', { name: 'New Name' });
    expect(testPublisherFeed).not.toHaveBeenCalled();
  });

  it('returns 200 when URL change passes feed test', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get
      .mockResolvedValueOnce(makeRecord()) // session check
      .mockResolvedValueOnce(makeRecord()) // service feed-test get
      .mockResolvedValueOnce(makeRecord({ sourceUrl: 'https://other.example/feed.json' })); // post-write read
    (testPublisherFeed as jest.Mock).mockResolvedValue({
      kind: 'ok',
      output: {
        fetchStatus: 'ok',
        feed: { events: [{ id: '1' }, { id: '2' }] },
        report: { ok: true, errors: [], warnings: [] },
      },
    });
    registry.updateProfile.mockResolvedValue(undefined);
    const r = await handlePublisherProfilePatch(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      { sourceUrl: 'https://other.example/feed.json' },
    );
    expect(r.statusCode).toBe(200);
    expect(testPublisherFeed).toHaveBeenCalledWith({
      url: 'https://other.example/feed.json',
      sourceType: 'json',
    });
    expect(registry.updateProfile).toHaveBeenCalledWith('pub-1', {
      sourceUrl: 'https://other.example/feed.json',
    });
  });

  it('returns 400 with code=feed_test_failed and skips update when feed test fails', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get
      .mockResolvedValueOnce(makeRecord())  // session check
      .mockResolvedValueOnce(makeRecord()); // service get for current values
    (testPublisherFeed as jest.Mock).mockResolvedValue({
      kind: 'ok',
      output: {
        fetchStatus: 'validation_error',
        feed: null,
        report: {
          ok: false,
          errors: [{ path: '/events/0/title', message: 'title is required' }],
          warnings: [],
        },
      },
    });
    const r = await handlePublisherProfilePatch(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      { sourceUrl: 'https://broken.example/feed.json' },
    );
    expect(r.statusCode).toBe(400);
    const body = JSON.parse(r.body);
    expect(body.code).toBe('feed_test_failed');
    expect(body.details).toEqual(['title is required']);
    expect(registry.updateProfile).not.toHaveBeenCalled();
  });

  it('translates blocked_url SSRF guard rejection into feed_test_failed', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get
      .mockResolvedValueOnce(makeRecord())
      .mockResolvedValueOnce(makeRecord());
    (testPublisherFeed as jest.Mock).mockResolvedValue({
      kind: 'error',
      error: { kind: 'blocked_url', reason: 'URL resolves to private IP' },
    });
    const r = await handlePublisherProfilePatch(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      { sourceUrl: 'https://10.0.0.1/feed' },
    );
    expect(r.statusCode).toBe(400);
    const body = JSON.parse(r.body);
    expect(body.code).toBe('feed_test_failed');
    expect(body.details).toEqual(['URL resolves to private IP']);
  });

  it('allows clearing organization with empty string', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get
      .mockResolvedValueOnce(makeRecord({ organization: 'Old Org' }))
      .mockResolvedValueOnce(makeRecord({ organization: undefined }));
    registry.updateProfile.mockResolvedValue(undefined);
    const r = await handlePublisherProfilePatch(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      { organization: '' },
    );
    expect(r.statusCode).toBe(200);
    expect(registry.updateProfile).toHaveBeenCalledWith('pub-1', { organization: '' });
  });

  it('returns 200 for legacy rows with no applicationStatus (treated as approved)', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    const legacy = makeRecord({ applicationStatus: undefined });
    registry.get
      .mockResolvedValueOnce(legacy)
      .mockResolvedValueOnce({ ...legacy, name: 'Renamed' });
    registry.updateProfile.mockResolvedValue(undefined);
    const r = await handlePublisherProfilePatch(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      { name: 'Renamed' },
    );
    expect(r.statusCode).toBe(200);
  });

  it('returns 404 when registry.updateProfile throws PublisherNotFoundError (row deleted between gate and write)', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValueOnce(makeRecord());
    const { PublisherNotFoundError } = await import('../services/publisherRegistryService');
    registry.updateProfile.mockRejectedValue(new PublisherNotFoundError('pub-1', 'updateProfile'));
    const r = await handlePublisherProfilePatch(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      { name: 'New Name' },
    );
    expect(r.statusCode).toBe(404);
    const body = JSON.parse(r.body);
    expect(body.code).toBe('not_found');
  });

  it('returns 500 on unexpected exception', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockRejectedValue(new Error('DDB throttled'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await handlePublisherProfilePatch(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      { name: 'X' },
    );
    expect(r.statusCode).toBe(500);
    errSpy.mockRestore();
  });

  it('PATCH /publisher-profile { notificationsEnabled: false } persists and returns updated record', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get
      .mockResolvedValueOnce(makeRecord()) // session check
      .mockResolvedValueOnce(makeRecord({ notificationsEnabled: false })); // post-write read
    registry.updateProfile.mockResolvedValue(undefined);
    const r = await handlePublisherProfilePatch(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      { notificationsEnabled: false },
    );
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.publisher.notificationsEnabled).toBe(false);
    expect(registry.updateProfile).toHaveBeenCalledWith('pub-1', { notificationsEnabled: false });
    expect(testPublisherFeed).not.toHaveBeenCalled();
  });

  it('PATCH /publisher-profile { notificationsEnabled: true } persists and returns updated record', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get
      .mockResolvedValueOnce(makeRecord({ notificationsEnabled: false })) // session check
      .mockResolvedValueOnce(makeRecord({ notificationsEnabled: true })); // post-write read
    registry.updateProfile.mockResolvedValue(undefined);
    const r = await handlePublisherProfilePatch(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      { notificationsEnabled: true },
    );
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.publisher.notificationsEnabled).toBe(true);
    expect(registry.updateProfile).toHaveBeenCalledWith('pub-1', { notificationsEnabled: true });
    expect(testPublisherFeed).not.toHaveBeenCalled();
  });

  it('returns 400 with code=invalid_notifications_enabled for non-boolean notificationsEnabled', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    registry.get.mockResolvedValueOnce(makeRecord());
    const r = await handlePublisherProfilePatch(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      { notificationsEnabled: 'yes' as any },
    );
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).code).toBe('invalid_notifications_enabled');
    expect(registry.updateProfile).not.toHaveBeenCalled();
  });
});
