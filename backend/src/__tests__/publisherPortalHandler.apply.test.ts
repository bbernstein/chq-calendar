// Handler-level tests for the four Phase B routes. The application service
// is stubbed via _setAppServiceForTests so we don't hit DynamoDB / SES /
// Secrets Manager.

import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  handlePublisherApplyRequest,
  handlePublisherApplyVerify,
  handlePublisherAuthRequest,
  handlePublisherAuthVerify,
  _setAppServiceForTests,
  _resetPublisherAuthRateLimitForTests,
} from '../handlers/publisherPortalHandler';

const evt = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent => ({
  body: '',
  headers: {},
  multiValueHeaders: {},
  httpMethod: 'POST',
  isBase64Encoded: false,
  path: '/',
  pathParameters: null,
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  stageVariables: null,
  resource: '/',
  requestContext: { identity: { sourceIp: '203.0.113.1' } } as any,
  ...overrides,
});

const mkApp = () => ({
  requestApply: jest.fn(),
  verifyApply: jest.fn(),
  requestLogin: jest.fn(),
  verifyLogin: jest.fn(),
});

describe('handlePublisherApplyRequest', () => {
  beforeEach(() => {
    _resetPublisherAuthRateLimitForTests();
  });
  afterEach(() => {
    _setAppServiceForTests(null);
  });

  it('returns 200 ok on a valid request', async () => {
    const stub = mkApp();
    stub.requestApply.mockResolvedValue({ ok: true });
    _setAppServiceForTests(stub as any);
    const r = await handlePublisherApplyRequest(evt(), {
      name: 'A', email: 'a@b.com', sourceUrl: 'https://x.test/feed', sourceType: 'json',
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true });
    expect(stub.requestApply).toHaveBeenCalled();
  });

  it('returns 400 on missing fields', async () => {
    const stub = mkApp();
    _setAppServiceForTests(stub as any);
    const r = await handlePublisherApplyRequest(evt(), { name: 'A' });
    expect(r.statusCode).toBe(400);
    expect(stub.requestApply).not.toHaveBeenCalled();
  });

  it('returns 400 with field name on app-service validation failure', async () => {
    const stub = mkApp();
    stub.requestApply.mockResolvedValue({
      ok: false, reason: 'invalid_input', field: 'sourceUrl', message: 'localhost not allowed',
    });
    _setAppServiceForTests(stub as any);
    const r = await handlePublisherApplyRequest(evt(), {
      name: 'A', email: 'a@b.com', sourceUrl: 'http://localhost', sourceType: 'json',
    });
    expect(r.statusCode).toBe(400);
    const body = JSON.parse(r.body);
    expect(body.field).toBe('sourceUrl');
    expect(body.error).toMatch(/localhost/);
  });

  it('rate-limits at 11th request from same IP within an hour', async () => {
    const stub = mkApp();
    stub.requestApply.mockResolvedValue({ ok: true });
    _setAppServiceForTests(stub as any);
    const body = { name: 'A', email: 'a@b.com', sourceUrl: 'https://x.test/feed', sourceType: 'json' };
    for (let i = 0; i < 10; i++) {
      const r = await handlePublisherApplyRequest(evt(), body);
      expect(r.statusCode).toBe(200);
    }
    const limited = await handlePublisherApplyRequest(evt(), body);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers?.['Retry-After']).toBeTruthy();
  });
});

describe('handlePublisherApplyVerify', () => {
  afterEach(() => {
    _setAppServiceForTests(null);
  });

  it('returns 400 on missing token', async () => {
    const stub = mkApp();
    _setAppServiceForTests(stub as any);
    const r = await handlePublisherApplyVerify(evt(), {});
    expect(r.statusCode).toBe(400);
    expect(stub.verifyApply).not.toHaveBeenCalled();
  });

  it('returns 200 with jwt + publisherId on success', async () => {
    const stub = mkApp();
    stub.verifyApply.mockResolvedValue({ ok: true, jwt: 'jwt.token.here', publisherId: 'pub-1', email: 'a@b.com' });
    _setAppServiceForTests(stub as any);
    const r = await handlePublisherApplyVerify(evt(), { token: 'rawtok' });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ jwt: 'jwt.token.here', publisherId: 'pub-1', email: 'a@b.com' });
  });

  it('returns 400 with explained reason on expired token', async () => {
    const stub = mkApp();
    stub.verifyApply.mockResolvedValue({ ok: false, reason: 'expired' });
    _setAppServiceForTests(stub as any);
    const r = await handlePublisherApplyVerify(evt(), { token: 'rawtok' });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toMatch(/expired|15 minutes/i);
  });
});

describe('handlePublisherAuthRequest', () => {
  beforeEach(() => {
    _resetPublisherAuthRateLimitForTests();
  });
  afterEach(() => {
    _setAppServiceForTests(null);
  });

  it('returns 200 ok regardless of email match (anti-enumeration)', async () => {
    const stub = mkApp();
    stub.requestLogin.mockResolvedValue({ ok: true });
    _setAppServiceForTests(stub as any);
    const r = await handlePublisherAuthRequest(evt(), { email: 'whoever@example.com' });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true });
    expect(stub.requestLogin).toHaveBeenCalledWith('whoever@example.com');
  });

  it('does not fail when email is missing — passes empty string downstream', async () => {
    const stub = mkApp();
    stub.requestLogin.mockResolvedValue({ ok: true });
    _setAppServiceForTests(stub as any);
    const r = await handlePublisherAuthRequest(evt(), {});
    expect(r.statusCode).toBe(200);
    expect(stub.requestLogin).toHaveBeenCalledWith('');
  });
});

describe('handlePublisherAuthVerify', () => {
  afterEach(() => {
    _setAppServiceForTests(null);
  });

  it('returns 200 with jwt on a valid login token', async () => {
    const stub = mkApp();
    stub.verifyLogin.mockResolvedValue({ ok: true, jwt: 'j', publisherId: 'pub-1', email: 'a@b' });
    _setAppServiceForTests(stub as any);
    const r = await handlePublisherAuthVerify(evt(), { token: 'rawtok' });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).jwt).toBe('j');
  });

  it('returns 400 publisher_missing message when registry has no row', async () => {
    const stub = mkApp();
    stub.verifyLogin.mockResolvedValue({ ok: false, reason: 'publisher_missing' });
    _setAppServiceForTests(stub as any);
    const r = await handlePublisherAuthVerify(evt(), { token: 'rawtok' });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toMatch(/no longer exists/i);
  });
});
