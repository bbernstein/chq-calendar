// Handler-level tests for the admin publishers routes added alongside the
// /admin/publishers/ "Run ingest now", pause-via-PATCH, and delete actions.
// We bypass auth via DEV_AUTH_BYPASS so the test focuses on routing +
// service-error → HTTP-status translation.

import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import {
  handler,
  _setPublisherAdminForTests,
  _setLambdaClientForTests,
} from '../handlers/adminHandler';

const evt = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent => ({
  body: null,
  headers: {},
  multiValueHeaders: {},
  httpMethod: 'GET',
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

const mkAdmin = () => ({
  listPublishers: jest.fn(),
  createPublisher: jest.fn(),
  updatePublisher: jest.fn(),
  deletePublisher: jest.fn(),
  setPaused: jest.fn(),
  // Stubs for unrelated methods reachable through the same module.
  listPendingApplications: jest.fn(),
  approveApplication: jest.fn(),
  rejectApplication: jest.fn(),
  listPendingEvents: jest.fn(),
  approveEvent: jest.fn(),
  rejectEvent: jest.fn(),
  listThresholdHalts: jest.fn(),
  approveThresholdHalt: jest.fn(),
  cancelThresholdHalt: jest.fn(),
});

const PRIOR_DEV_BYPASS = process.env.DEV_AUTH_BYPASS;
const PRIOR_NODE_ENV = process.env.NODE_ENV;

beforeAll(() => {
  process.env.DEV_AUTH_BYPASS = 'true';
  delete process.env.NODE_ENV;
  delete process.env.ENVIRONMENT;
});

afterAll(() => {
  if (PRIOR_DEV_BYPASS === undefined) delete process.env.DEV_AUTH_BYPASS;
  else process.env.DEV_AUTH_BYPASS = PRIOR_DEV_BYPASS;
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});

afterEach(() => {
  _setPublisherAdminForTests(null);
  _setLambdaClientForTests(null);
});

describe('DELETE /publishers/:id', () => {
  it('returns 200 with deletedEvents count on success', async () => {
    const stub = mkAdmin();
    stub.deletePublisher.mockResolvedValue({ deletedEvents: 4 });
    _setPublisherAdminForTests(stub as any);

    const r = await handler(
      evt({ path: '/publishers/pub-1', httpMethod: 'DELETE' }),
      ctx,
    );
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ deletedEvents: 4 });
    expect(stub.deletePublisher).toHaveBeenCalledWith('pub-1');
  });

  it('decodes URL-encoded ids before passing them through', async () => {
    const stub = mkAdmin();
    stub.deletePublisher.mockResolvedValue({ deletedEvents: 0 });
    _setPublisherAdminForTests(stub as any);

    const r = await handler(
      evt({ path: '/publishers/pub%2Fwith%20space', httpMethod: 'DELETE' }),
      ctx,
    );
    expect(r.statusCode).toBe(200);
    expect(stub.deletePublisher).toHaveBeenCalledWith('pub/with space');
  });

  it('translates "unknown publisher" to HTTP 404', async () => {
    const stub = mkAdmin();
    stub.deletePublisher.mockRejectedValue(new Error('unknown publisher missing'));
    _setPublisherAdminForTests(stub as any);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const r = await handler(
      evt({ path: '/publishers/missing', httpMethod: 'DELETE' }),
      ctx,
    );
    expect(r.statusCode).toBe(404);
    expect(JSON.parse(r.body).error).toMatch(/unknown publisher missing/);
    errSpy.mockRestore();
  });

  it('returns 500 on unexpected service exceptions', async () => {
    const stub = mkAdmin();
    stub.deletePublisher.mockRejectedValue(new Error('DDB throttled'));
    _setPublisherAdminForTests(stub as any);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const r = await handler(
      evt({ path: '/publishers/pub-1', httpMethod: 'DELETE' }),
      ctx,
    );
    expect(r.statusCode).toBe(500);
    expect(JSON.parse(r.body).error).toMatch(/Failed to delete publisher/);
    errSpy.mockRestore();
  });
});

describe('PATCH /publishers/:id with paused', () => {
  it('passes the paused flag through to updatePublisher', async () => {
    const stub = mkAdmin();
    stub.updatePublisher.mockResolvedValue({ id: 'pub-1', paused: true });
    _setPublisherAdminForTests(stub as any);

    const r = await handler(
      evt({
        path: '/publishers/pub-1',
        httpMethod: 'PATCH',
        body: JSON.stringify({ paused: true }),
      }),
      ctx,
    );
    expect(r.statusCode).toBe(200);
    expect(stub.updatePublisher).toHaveBeenCalledWith('pub-1', { paused: true });
    expect(JSON.parse(r.body).publisher.paused).toBe(true);
  });

  it('passes paused=false through (resume)', async () => {
    const stub = mkAdmin();
    stub.updatePublisher.mockResolvedValue({ id: 'pub-1', paused: false });
    _setPublisherAdminForTests(stub as any);

    const r = await handler(
      evt({
        path: '/publishers/pub-1',
        httpMethod: 'PATCH',
        body: JSON.stringify({ paused: false }),
      }),
      ctx,
    );
    expect(r.statusCode).toBe(200);
    expect(stub.updatePublisher).toHaveBeenCalledWith('pub-1', { paused: false });
  });
});

describe('POST /publishers/run-ingest', () => {
  it('async-invokes the ingest Lambda and returns 202 with triggeredAt', async () => {
    const send = jest.fn().mockResolvedValue({ StatusCode: 202 });
    _setLambdaClientForTests({ send } as any);

    const r = await handler(
      evt({ path: '/publishers/run-ingest', httpMethod: 'POST' }),
      ctx,
    );

    expect(r.statusCode).toBe(202);
    const body = JSON.parse(r.body);
    expect(body.triggeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0][0];
    expect(cmd.input.FunctionName).toBe('chautauqua-calendar-publisher-ingest');
    expect(cmd.input.InvocationType).toBe('Event');
    const payload = JSON.parse(Buffer.from(cmd.input.Payload).toString('utf-8'));
    expect(payload.source).toBe('admin-ui');
    expect(payload.triggeredBy).toBe('dev@localhost.local');
    expect(payload.triggeredAt).toBe(body.triggeredAt);
  });

  it('uses PUBLISHER_INGEST_FUNCTION_NAME when set', async () => {
    const PRIOR = process.env.PUBLISHER_INGEST_FUNCTION_NAME;
    process.env.PUBLISHER_INGEST_FUNCTION_NAME = 'custom-ingest-fn';
    try {
      const send = jest.fn().mockResolvedValue({ StatusCode: 202 });
      _setLambdaClientForTests({ send } as any);

      await handler(
        evt({ path: '/publishers/run-ingest', httpMethod: 'POST' }),
        ctx,
      );
      const cmd = send.mock.calls[0][0];
      expect(cmd.input.FunctionName).toBe('custom-ingest-fn');
    } finally {
      if (PRIOR === undefined) delete process.env.PUBLISHER_INGEST_FUNCTION_NAME;
      else process.env.PUBLISHER_INGEST_FUNCTION_NAME = PRIOR;
    }
  });

  it('returns 500 with the underlying error message when the invoke fails', async () => {
    const send = jest.fn().mockRejectedValue(new Error('AccessDeniedException: not allowed'));
    _setLambdaClientForTests({ send } as any);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const r = await handler(
      evt({ path: '/publishers/run-ingest', httpMethod: 'POST' }),
      ctx,
    );

    expect(r.statusCode).toBe(500);
    expect(JSON.parse(r.body).error).toMatch(/Failed to trigger publisher ingest/);
    expect(JSON.parse(r.body).error).toMatch(/AccessDeniedException/);
    errSpy.mockRestore();
  });
});
