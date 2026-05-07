// Handler-level tests for the smoke-bot endpoints in adminHandler.ts.
//
// Two security gates are exercised here:
//   1. SMOKE_ADMIN_ROUTE_ALLOWLIST — covered indirectly: any non-allowlisted
//      smoke-bot route returns 403 (the route below would even need to
//      exist on the allowlist). The dedicated allowlist regex test lives
//      in adminHandler.publishers.test.ts adjacent suites.
//   2. SMOKE_BBTEST_EMAIL hard-gate — defense-in-depth against a leaked
//      signing key. The email-keyed smoke routes (/smoke-reset-bbtest and
//      /smoke-magic-token-by-email) refuse any request whose body email
//      does not exactly match process.env.SMOKE_BBTEST_EMAIL.

import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import jwt from 'jsonwebtoken';
import {
  handler,
  _setSmokeRouteDepsForTests,
} from '../handlers/adminHandler';

const evt = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent => ({
  body: null,
  headers: {},
  multiValueHeaders: {},
  httpMethod: 'POST',
  isBase64Encoded: false,
  path: '/',
  pathParameters: null,
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  stageVariables: null,
  requestContext: { identity: { sourceIp: '203.0.113.1' } } as any,
  resource: '/',
  ...overrides,
});

const ctx = {} as Context;

const SIGNING_KEY = 'test-signing-key-very-secret';
const BBTEST_EMAIL = 'bbtest@chqcal.org';

function makeSmokeBotToken(): string {
  return jwt.sign({ sub: 'smoke-bot', iss: 'smoke' }, SIGNING_KEY, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });
}

const PRIOR = {
  ADMIN_SMOKE_SIGNING_KEY: process.env.ADMIN_SMOKE_SIGNING_KEY,
  SMOKE_BBTEST_EMAIL: process.env.SMOKE_BBTEST_EMAIL,
  NODE_ENV: process.env.NODE_ENV,
  ENVIRONMENT: process.env.ENVIRONMENT,
  DEV_AUTH_BYPASS: process.env.DEV_AUTH_BYPASS,
};

beforeAll(() => {
  process.env.ADMIN_SMOKE_SIGNING_KEY = SIGNING_KEY;
  process.env.SMOKE_BBTEST_EMAIL = BBTEST_EMAIL;
  // Smoke fallback only triggers when no admin user is authenticated.
  delete process.env.NODE_ENV;
  delete process.env.ENVIRONMENT;
  delete process.env.DEV_AUTH_BYPASS;
});

afterAll(() => {
  for (const [k, v] of Object.entries(PRIOR)) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string | undefined>)[k] = v;
  }
});

afterEach(() => {
  _setSmokeRouteDepsForTests(null);
});

describe('POST /smoke-reset-bbtest — bbtest email gate', () => {
  it('returns 403 when the body email does not match SMOKE_BBTEST_EMAIL', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const r = await handler(
      evt({
        path: '/smoke-reset-bbtest',
        httpMethod: 'POST',
        headers: { Authorization: `Bearer ${makeSmokeBotToken()}` },
        body: JSON.stringify({ email: 'attacker@example.com' }),
      }),
      ctx,
    );
    expect(r.statusCode).toBe(403);
    expect(JSON.parse(r.body).error).toMatch(/configured smoke bbtest email/);
    logSpy.mockRestore();
  });

  it('accepts the request when the body email matches SMOKE_BBTEST_EMAIL', async () => {
    const resetImpl = jest.fn(async () => ({
      rowsAffected: 0,
      applicationsDeleted: 0,
      publishersDeleted: 0,
      eventsDeleted: 0,
      magicTokensDeleted: 0,
    }));
    _setSmokeRouteDepsForTests({
      registry: {} as any,
      eventStore: {} as any,
      magicTokensTableName: 'unused-in-this-test',
      resetImpl,
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const r = await handler(
      evt({
        path: '/smoke-reset-bbtest',
        httpMethod: 'POST',
        headers: { Authorization: `Bearer ${makeSmokeBotToken()}` },
        body: JSON.stringify({ email: BBTEST_EMAIL }),
      }),
      ctx,
    );
    expect(r.statusCode).toBe(200);
    expect(resetImpl).toHaveBeenCalledTimes(1);
    logSpy.mockRestore();
  });

  it('matches case-insensitively (mixed-case body still matches lowercased env)', async () => {
    const resetImpl = jest.fn(async () => ({
      rowsAffected: 0,
      applicationsDeleted: 0,
      publishersDeleted: 0,
      eventsDeleted: 0,
      magicTokensDeleted: 0,
    }));
    _setSmokeRouteDepsForTests({
      registry: {} as any,
      eventStore: {} as any,
      magicTokensTableName: 'unused-in-this-test',
      resetImpl,
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const r = await handler(
      evt({
        path: '/smoke-reset-bbtest',
        httpMethod: 'POST',
        headers: { Authorization: `Bearer ${makeSmokeBotToken()}` },
        body: JSON.stringify({ email: '  BBTest@CHQCAL.ORG  ' }),
      }),
      ctx,
    );
    expect(r.statusCode).toBe(200);
    expect(resetImpl).toHaveBeenCalledTimes(1);
    logSpy.mockRestore();
  });

  it('returns 403 when SMOKE_BBTEST_EMAIL is unset on the Lambda', async () => {
    const prior = process.env.SMOKE_BBTEST_EMAIL;
    delete process.env.SMOKE_BBTEST_EMAIL;
    try {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const r = await handler(
        evt({
          path: '/smoke-reset-bbtest',
          httpMethod: 'POST',
          headers: { Authorization: `Bearer ${makeSmokeBotToken()}` },
          body: JSON.stringify({ email: BBTEST_EMAIL }),
        }),
        ctx,
      );
      expect(r.statusCode).toBe(403);
      expect(JSON.parse(r.body).error).toMatch(/not configured/);
      logSpy.mockRestore();
    } finally {
      if (prior !== undefined) process.env.SMOKE_BBTEST_EMAIL = prior;
    }
  });
});

describe('POST /smoke-magic-token-by-email — bbtest email gate', () => {
  it('returns 403 when the body email does not match SMOKE_BBTEST_EMAIL', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const r = await handler(
      evt({
        path: '/smoke-magic-token-by-email',
        httpMethod: 'POST',
        headers: { Authorization: `Bearer ${makeSmokeBotToken()}` },
        body: JSON.stringify({ email: 'attacker@example.com' }),
      }),
      ctx,
    );
    expect(r.statusCode).toBe(403);
    expect(JSON.parse(r.body).error).toMatch(/configured smoke bbtest email/);
    logSpy.mockRestore();
  });

  it('returns 403 when SMOKE_BBTEST_EMAIL is unset on the Lambda', async () => {
    const prior = process.env.SMOKE_BBTEST_EMAIL;
    delete process.env.SMOKE_BBTEST_EMAIL;
    try {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const r = await handler(
        evt({
          path: '/smoke-magic-token-by-email',
          httpMethod: 'POST',
          headers: { Authorization: `Bearer ${makeSmokeBotToken()}` },
          body: JSON.stringify({ email: BBTEST_EMAIL }),
        }),
        ctx,
      );
      expect(r.statusCode).toBe(403);
      expect(JSON.parse(r.body).error).toMatch(/not configured/);
      logSpy.mockRestore();
    } finally {
      if (prior !== undefined) process.env.SMOKE_BBTEST_EMAIL = prior;
    }
  });
});
