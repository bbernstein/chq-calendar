// Handler tests for the four new email-change routes:
//   POST   /publisher-email-change
//   DELETE /publisher-email-change
//   GET    /publisher-email-change/verify
//   GET    /publisher-email-change/cancel
//
// The publisher-JWT verifier is mocked at module level (matching the
// pattern in the status/profile tests). The status registry is replaced
// via _setStatusRegistryForTests; the email-change service is replaced
// via _setEmailChangeServiceForTests.

import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  handlePublisherEmailChangeRequest,
  handlePublisherEmailChangeCancelSelf,
  handlePublisherEmailChangeVerify,
  handlePublisherEmailChangeCancelByOld,
  _setStatusRegistryForTests,
  _setEmailChangeServiceForTests,
} from '../handlers/publisherPortalHandler';
import { EmailChangeError } from '../services/publisherEmailChangeService';
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
  path: '/publisher-email-change',
  pathParameters: null,
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  stageVariables: null,
  resource: '/publisher-email-change',
  requestContext: { identity: { sourceIp: '203.0.113.1' } } as any,
  ...overrides,
});

const evtAuth = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent =>
  evt({ headers: { Authorization: 'Bearer JWT' }, ...overrides });

const approvedPub: PublisherRecord = {
  id: 'pub-1',
  name: 'X',
  contactEmail: 'old@e.com',
  sourceUrl: 'u',
  sourceType: 'json',
  trustLevel: 'auto',
  enabled: true,
  createdAt: 't',
  applicationStatus: 'approved',
  tokenVersion: 0,
};

describe('POST /publisher-email-change', () => {
  let registry: { get: jest.Mock };
  let emailChange: {
    initiate: jest.Mock;
    cancelBySelf: jest.Mock;
    verifyByNewAddress: jest.Mock;
    cancelByOldAddress: jest.Mock;
    getPendingForPublisher: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    registry = { get: jest.fn() };
    _setStatusRegistryForTests(registry as any);
    emailChange = {
      initiate: jest.fn().mockResolvedValue(undefined),
      cancelBySelf: jest.fn().mockResolvedValue(undefined),
      verifyByNewAddress: jest.fn(),
      cancelByOldAddress: jest.fn(),
      getPendingForPublisher: jest.fn().mockResolvedValue(null),
    };
    _setEmailChangeServiceForTests(emailChange as any);
  });
  afterEach(() => {
    _setStatusRegistryForTests(null);
    _setEmailChangeServiceForTests(null);
  });

  it('401 when Authorization header is missing', async () => {
    const r = await handlePublisherEmailChangeRequest(evt(), { newEmail: 'new@e.com' });
    expect(r.statusCode).toBe(401);
    expect(emailChange.initiate).not.toHaveBeenCalled();
  });

  it('401 when JWT is invalid', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue(null);
    const r = await handlePublisherEmailChangeRequest(evtAuth(), { newEmail: 'new@e.com' });
    expect(r.statusCode).toBe(401);
  });

  it('404 when publisher row is missing', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({ sub: 'pub-1', email: 'a', tokenVersion: 0 });
    registry.get.mockResolvedValue(null);
    const r = await handlePublisherEmailChangeRequest(evtAuth(), { newEmail: 'new@e.com' });
    expect(r.statusCode).toBe(404);
  });

  it('403 when publisher is pending (not approved)', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({ sub: 'pub-1', email: 'a', tokenVersion: 0 });
    registry.get.mockResolvedValue({ ...approvedPub, applicationStatus: 'pending' });
    const r = await handlePublisherEmailChangeRequest(evtAuth(), { newEmail: 'new@e.com' });
    expect(r.statusCode).toBe(403);
    expect(emailChange.initiate).not.toHaveBeenCalled();
  });

  it('400 when newEmail is missing', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({ sub: 'pub-1', email: 'a', tokenVersion: 0 });
    registry.get.mockResolvedValue(approvedPub);
    const r = await handlePublisherEmailChangeRequest(evtAuth(), {});
    expect(r.statusCode).toBe(400);
  });

  it('200 ok on happy path', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({ sub: 'pub-1', email: 'a', tokenVersion: 0 });
    registry.get.mockResolvedValue(approvedPub);
    const r = await handlePublisherEmailChangeRequest(evtAuth(), { newEmail: 'new@e.com' });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true });
    expect(emailChange.initiate).toHaveBeenCalledWith({
      publisherId: 'pub-1',
      oldEmail: 'old@e.com',
      newEmail: 'new@e.com',
    });
  });

  it('409 when service throws email_in_use', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({ sub: 'pub-1', email: 'a', tokenVersion: 0 });
    registry.get.mockResolvedValue(approvedPub);
    emailChange.initiate.mockRejectedValue(new EmailChangeError('email_in_use', 'taken'));
    const r = await handlePublisherEmailChangeRequest(evtAuth(), { newEmail: 'new@e.com' });
    expect(r.statusCode).toBe(409);
    expect(JSON.parse(r.body)).toMatchObject({ code: 'email_in_use' });
  });

  it('423 when service throws locked', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({ sub: 'pub-1', email: 'a', tokenVersion: 0 });
    registry.get.mockResolvedValue(approvedPub);
    emailChange.initiate.mockRejectedValue(
      new EmailChangeError('locked', 'locked', { lockedUntil: '2026-05-06T12:00:00Z' }),
    );
    const r = await handlePublisherEmailChangeRequest(evtAuth(), { newEmail: 'new@e.com' });
    expect(r.statusCode).toBe(423);
    expect(JSON.parse(r.body)).toMatchObject({
      code: 'locked',
      details: { lockedUntil: '2026-05-06T12:00:00Z' },
    });
  });

  it('400 when service throws same_email or invalid_email', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({ sub: 'pub-1', email: 'a', tokenVersion: 0 });
    registry.get.mockResolvedValue(approvedPub);
    emailChange.initiate.mockRejectedValue(new EmailChangeError('same_email', 'no-op'));
    const r = await handlePublisherEmailChangeRequest(evtAuth(), { newEmail: 'old@e.com' });
    expect(r.statusCode).toBe(400);
  });
});

describe('DELETE /publisher-email-change', () => {
  let registry: { get: jest.Mock };
  let emailChange: { cancelBySelf: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    registry = { get: jest.fn() };
    _setStatusRegistryForTests(registry as any);
    emailChange = { cancelBySelf: jest.fn().mockResolvedValue(undefined) };
    _setEmailChangeServiceForTests(emailChange as any);
  });
  afterEach(() => {
    _setStatusRegistryForTests(null);
    _setEmailChangeServiceForTests(null);
  });

  it('200 ok on happy path', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({ sub: 'pub-1', email: 'a', tokenVersion: 0 });
    registry.get.mockResolvedValue(approvedPub);
    const r = await handlePublisherEmailChangeCancelSelf(evtAuth({ httpMethod: 'DELETE' }), {});
    expect(r.statusCode).toBe(200);
    expect(emailChange.cancelBySelf).toHaveBeenCalledWith({ publisherId: 'pub-1' });
  });

  it('401 when no JWT', async () => {
    const r = await handlePublisherEmailChangeCancelSelf(evt({ httpMethod: 'DELETE' }), {});
    expect(r.statusCode).toBe(401);
    expect(emailChange.cancelBySelf).not.toHaveBeenCalled();
  });
});

describe('GET /publisher-email-change/verify', () => {
  let emailChange: { verifyByNewAddress: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    emailChange = { verifyByNewAddress: jest.fn() };
    _setEmailChangeServiceForTests(emailChange as any);
  });
  afterEach(() => _setEmailChangeServiceForTests(null));

  it('returns kind=ok with newEmail on happy path', async () => {
    emailChange.verifyByNewAddress.mockResolvedValue({
      kind: 'ok', publisherId: 'pub-1', newEmail: 'new@e.com',
    });
    const r = await handlePublisherEmailChangeVerify(
      evt({ httpMethod: 'GET', queryStringParameters: { token: 'V_RAW' } }),
      {},
    );
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ kind: 'ok', newEmail: 'new@e.com' });
  });

  it('returns kind=already_used when service says so', async () => {
    emailChange.verifyByNewAddress.mockResolvedValue({ kind: 'already_used' });
    const r = await handlePublisherEmailChangeVerify(
      evt({ httpMethod: 'GET', queryStringParameters: { token: 'V_RAW' } }),
      {},
    );
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ kind: 'already_used' });
  });

  it('returns kind=email_taken on race-loser', async () => {
    emailChange.verifyByNewAddress.mockResolvedValue({ kind: 'email_taken' });
    const r = await handlePublisherEmailChangeVerify(
      evt({ httpMethod: 'GET', queryStringParameters: { token: 'V_RAW' } }),
      {},
    );
    expect(JSON.parse(r.body)).toEqual({ kind: 'email_taken' });
  });

  it('returns already_used when token query param missing (no service call)', async () => {
    const r = await handlePublisherEmailChangeVerify(
      evt({ httpMethod: 'GET', queryStringParameters: null }),
      {},
    );
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ kind: 'already_used' });
    expect(emailChange.verifyByNewAddress).not.toHaveBeenCalled();
  });
});

describe('GET /publisher-email-change/cancel', () => {
  let emailChange: { cancelByOldAddress: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    emailChange = { cancelByOldAddress: jest.fn() };
    _setEmailChangeServiceForTests(emailChange as any);
  });
  afterEach(() => _setEmailChangeServiceForTests(null));

  it('returns kind=ok with lockedUntil on happy path', async () => {
    emailChange.cancelByOldAddress.mockResolvedValue({
      kind: 'ok', publisherId: 'pub-1', lockedUntil: '2026-05-06T12:00:00Z',
    });
    const r = await handlePublisherEmailChangeCancelByOld(
      evt({ httpMethod: 'GET', queryStringParameters: { token: 'C_RAW' } }),
      {},
    );
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ kind: 'ok', lockedUntil: '2026-05-06T12:00:00Z' });
  });

  it('returns kind=expired when service says so', async () => {
    emailChange.cancelByOldAddress.mockResolvedValue({ kind: 'expired' });
    const r = await handlePublisherEmailChangeCancelByOld(
      evt({ httpMethod: 'GET', queryStringParameters: { token: 'C_RAW' } }),
      {},
    );
    expect(JSON.parse(r.body)).toEqual({ kind: 'expired' });
  });

  it('returns already_used when token query param missing', async () => {
    const r = await handlePublisherEmailChangeCancelByOld(
      evt({ httpMethod: 'GET', queryStringParameters: null }),
      {},
    );
    expect(JSON.parse(r.body)).toEqual({ kind: 'already_used' });
    expect(emailChange.cancelByOldAddress).not.toHaveBeenCalled();
  });
});

// CORS lockdown: every response from the publisher-portal handler must echo
// a first-party Allow-Origin, never `*`. The cancel handler is convenient
// because it's reachable without auth or a service mock — but the
// `corsHeaders` constant is shared by every other handler in the module, so
// asserting once here is sufficient.
describe('publisher-portal CORS', () => {
  it('Access-Control-Allow-Origin is the first-party site, never *', async () => {
    const r = await handlePublisherEmailChangeCancelByOld(
      evt({ httpMethod: 'GET', queryStringParameters: null }),
      {},
    );
    const allowOrigin = (r.headers ?? {})['Access-Control-Allow-Origin'];
    expect(allowOrigin).toBeDefined();
    expect(allowOrigin).not.toBe('*');
    // Either the env-supplied SITE_BASE_URL (test runners may set it) or
    // the production default — both are acceptable; the wildcard is not.
    expect(String(allowOrigin)).toMatch(/^https?:\/\//);
  });
});
