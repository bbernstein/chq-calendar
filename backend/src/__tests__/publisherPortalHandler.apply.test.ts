// Handler-level tests for the four Phase B routes. The application service
// is stubbed via _setAppServiceForTests so we don't hit DynamoDB / SES /
// Secrets Manager. CAPTCHA verification is mocked so we don't hit Google.

jest.mock('../services/captchaService', () => ({
  verifyCaptcha: jest.fn(),
}));

import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  handlePublisherApplyRequest,
  handlePublisherApplyVerify,
  handlePublisherAuthRequest,
  handlePublisherAuthVerify,
  _setAppServiceForTests,
  _resetPublisherAuthRateLimitForTests,
} from '../handlers/publisherPortalHandler';
import { EmailAlreadyInUseError } from '../services/publisherApplicationService';
import { verifyCaptcha } from '../services/captchaService';

const mockVerifyCaptcha = verifyCaptcha as jest.MockedFunction<typeof verifyCaptcha>;

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
  // A valid-shape body used by every test that isn't asserting validation errors.
  // The captchaToken value is arbitrary — verifyCaptcha is mocked.
  const validBody = {
    name: 'A',
    email: 'a@b.com',
    sourceUrl: 'https://x.test/feed',
    sourceType: 'json',
    captchaToken: 'test-captcha-token',
  };

  beforeEach(() => {
    _resetPublisherAuthRateLimitForTests();
    mockVerifyCaptcha.mockReset();
    mockVerifyCaptcha.mockResolvedValue(true);
  });
  afterEach(() => {
    _setAppServiceForTests(null);
  });

  it('returns 200 ok on a valid request', async () => {
    const stub = mkApp();
    stub.requestApply.mockResolvedValue({ ok: true });
    _setAppServiceForTests(stub as any);
    const r = await handlePublisherApplyRequest(evt(), validBody);
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true });
    expect(stub.requestApply).toHaveBeenCalled();
    expect(mockVerifyCaptcha).toHaveBeenCalledWith('test-captcha-token', 'publisher_apply');
  });

  it('passes empty token through to verifyCaptcha when captchaToken is missing', async () => {
    // The handler no longer rejects up-front on missing token — it lets
    // captchaService decide based on environment / secret config. In dev
    // with no secret it returns true; in prod it short-circuits empty
    // tokens to false. This test asserts the delegation; the
    // verifyCaptcha-returns-false case is covered by the next test.
    const stub = mkApp();
    stub.requestApply.mockResolvedValue({ ok: true });
    _setAppServiceForTests(stub as any);
    const { captchaToken: _drop, ...withoutToken } = validBody;
    const r = await handlePublisherApplyRequest(evt(), withoutToken);
    expect(r.statusCode).toBe(200);
    expect(mockVerifyCaptcha).toHaveBeenCalledWith('', 'publisher_apply');
  });

  it('returns 400 with captcha field when verifyCaptcha returns false', async () => {
    const stub = mkApp();
    _setAppServiceForTests(stub as any);
    mockVerifyCaptcha.mockResolvedValue(false);
    const r = await handlePublisherApplyRequest(evt(), validBody);
    expect(r.statusCode).toBe(400);
    const body = JSON.parse(r.body);
    expect(body.field).toBe('captcha');
    expect(body.error).toMatch(/CAPTCHA/);
    expect(stub.requestApply).not.toHaveBeenCalled();
  });

  it('returns 400 on missing fields without calling verifyCaptcha', async () => {
    const stub = mkApp();
    _setAppServiceForTests(stub as any);
    const r = await handlePublisherApplyRequest(evt(), {
      name: 'A',
      captchaToken: 'test-captcha-token',
    });
    expect(r.statusCode).toBe(400);
    expect(stub.requestApply).not.toHaveBeenCalled();
    // Field-shape errors must be surfaced before the Google round-trip so
    // legitimate users see actionable feedback and we don't burn calls to
    // siteverify on malformed submissions.
    expect(mockVerifyCaptcha).not.toHaveBeenCalled();
  });

  it('returns 400 with field name on app-service validation failure', async () => {
    const stub = mkApp();
    stub.requestApply.mockResolvedValue({
      ok: false, reason: 'invalid_input', field: 'sourceUrl', message: 'localhost not allowed',
    });
    _setAppServiceForTests(stub as any);
    const r = await handlePublisherApplyRequest(evt(), {
      ...validBody,
      sourceUrl: 'http://localhost',
    });
    expect(r.statusCode).toBe(400);
    const body = JSON.parse(r.body);
    expect(body.field).toBe('sourceUrl');
    expect(body.error).toMatch(/localhost/);
  });

  it('returns 400 with a generic email-in-use message when service throws EmailAlreadyInUseError', async () => {
    // Phase 3 — the handler must NOT leak which application status the
    // address holds. The body is fixed and points the user to login.
    const stub = mkApp();
    stub.requestApply.mockRejectedValue(new EmailAlreadyInUseError());
    _setAppServiceForTests(stub as any);

    const r = await handlePublisherApplyRequest(evt(), validBody);
    expect(r.statusCode).toBe(400);
    const body = JSON.parse(r.body);
    expect(body.error).toBe(
      "We can't accept this email address. If you already have a publisher account, sign in at /publish/login/.",
    );
    // No status-specific leak in the body.
    expect(body.field).toBeUndefined();
    expect(body.error).not.toMatch(/approved|pending|rejected/i);
  });

  it('rate-limits at 11th request from same IP within an hour', async () => {
    const stub = mkApp();
    stub.requestApply.mockResolvedValue({ ok: true });
    _setAppServiceForTests(stub as any);
    for (let i = 0; i < 10; i++) {
      const r = await handlePublisherApplyRequest(evt(), validBody);
      expect(r.statusCode).toBe(200);
    }
    const limited = await handlePublisherApplyRequest(evt(), validBody);
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
