// Handler-level tests for the Phase C admin pending-application routes.
// We bypass auth via DEV_AUTH_BYPASS so the test focuses on routing +
// service-error → HTTP-status translation. The PublisherAdminService is
// stubbed via _setPublisherAdminForTests so we don't hit DynamoDB/SES.

import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler, _setPublisherAdminForTests } from '../handlers/adminHandler';
import { ApplicationStateError } from '../services/publisherAdminService';

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
  listPendingApplications: jest.fn(),
  approveApplication: jest.fn(),
  rejectApplication: jest.fn(),
  // The route handler also calls into other methods; provide harmless stubs
  // so unrelated routing through the file (which builds the response) works.
  listPublishers: jest.fn(),
  createPublisher: jest.fn(),
  updatePublisher: jest.fn(),
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
  // Bypass admin JWT auth — production guards prevent this in real envs.
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
});

describe('GET /publisher-applications/pending', () => {
  it('returns 200 with the wrapped list on success', async () => {
    const stub = mkAdmin();
    stub.listPendingApplications.mockResolvedValue([
      { id: 'p1', name: 'Pending One', applicationStatus: 'pending' },
    ]);
    _setPublisherAdminForTests(stub as any);

    const r = await handler(
      evt({ path: '/publisher-applications/pending', httpMethod: 'GET' }),
      ctx,
    );
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.applications).toHaveLength(1);
    expect(body.applications[0].id).toBe('p1');
    expect(stub.listPendingApplications).toHaveBeenCalledTimes(1);
  });

  it('returns 500 on service exception', async () => {
    const stub = mkAdmin();
    stub.listPendingApplications.mockRejectedValue(new Error('DDB throttled'));
    _setPublisherAdminForTests(stub as any);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const r = await handler(
      evt({ path: '/publisher-applications/pending', httpMethod: 'GET' }),
      ctx,
    );
    expect(r.statusCode).toBe(500);
    expect(JSON.parse(r.body).error).toMatch(/Failed to list/);
    errSpy.mockRestore();
  });
});

describe('POST /publisher-applications/:id/approve', () => {
  it('returns 200 with the updated publisher on success', async () => {
    const stub = mkAdmin();
    stub.approveApplication.mockResolvedValue({
      id: 'p1', applicationStatus: 'approved', enabled: true,
    });
    _setPublisherAdminForTests(stub as any);

    const r = await handler(
      evt({ path: '/publisher-applications/p1/approve', httpMethod: 'POST' }),
      ctx,
    );
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).publisher.id).toBe('p1');
    // Reviewer email comes from the dev-bypass user, never from the body.
    expect(stub.approveApplication).toHaveBeenCalledWith('p1', 'dev@localhost.local');
  });

  it('translates ApplicationStateError to HTTP 409', async () => {
    const stub = mkAdmin();
    stub.approveApplication.mockRejectedValue(
      new ApplicationStateError('cannot approve: applicationStatus is approved, expected pending', 'approved'),
    );
    _setPublisherAdminForTests(stub as any);

    const r = await handler(
      evt({ path: '/publisher-applications/p1/approve', httpMethod: 'POST' }),
      ctx,
    );
    expect(r.statusCode).toBe(409);
    const body = JSON.parse(r.body);
    expect(body.error).toMatch(/cannot approve/);
    expect(body.currentStatus).toBe('approved');
  });

  it('translates "unknown publisher" to HTTP 404', async () => {
    const stub = mkAdmin();
    stub.approveApplication.mockRejectedValue(new Error('unknown publisher missing'));
    _setPublisherAdminForTests(stub as any);

    const r = await handler(
      evt({ path: '/publisher-applications/missing/approve', httpMethod: 'POST' }),
      ctx,
    );
    expect(r.statusCode).toBe(404);
  });

  it('returns 500 on unexpected service exception', async () => {
    const stub = mkAdmin();
    stub.approveApplication.mockRejectedValue(new Error('SES brokenness'));
    _setPublisherAdminForTests(stub as any);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const r = await handler(
      evt({ path: '/publisher-applications/p1/approve', httpMethod: 'POST' }),
      ctx,
    );
    expect(r.statusCode).toBe(500);
    errSpy.mockRestore();
  });

  it('URL-decodes the publisher id parameter', async () => {
    const stub = mkAdmin();
    stub.approveApplication.mockResolvedValue({ id: 'pub-with/slash' });
    _setPublisherAdminForTests(stub as any);

    // The route regex disallows internal slashes anyway; use percent-encoded
    // alternative so we can still verify decoding when allowed characters
    // are encoded.
    const encoded = encodeURIComponent('pub special');
    await handler(
      evt({ path: `/publisher-applications/${encoded}/approve`, httpMethod: 'POST' }),
      ctx,
    );
    expect(stub.approveApplication).toHaveBeenCalledWith('pub special', 'dev@localhost.local');
  });
});

describe('POST /publisher-applications/:id/reject', () => {
  it('passes the optional reason from the body to the service', async () => {
    const stub = mkAdmin();
    stub.rejectApplication.mockResolvedValue({
      id: 'p1', applicationStatus: 'rejected', enabled: false, rejectionReason: 'because',
    });
    _setPublisherAdminForTests(stub as any);

    const r = await handler(
      evt({
        path: '/publisher-applications/p1/reject',
        httpMethod: 'POST',
        body: JSON.stringify({ reason: 'because' }),
      }),
      ctx,
    );
    expect(r.statusCode).toBe(200);
    expect(stub.rejectApplication).toHaveBeenCalledWith('p1', 'dev@localhost.local', 'because');
  });

  it('omits reason from the call when the body has none', async () => {
    const stub = mkAdmin();
    stub.rejectApplication.mockResolvedValue({ id: 'p1', applicationStatus: 'rejected' });
    _setPublisherAdminForTests(stub as any);

    await handler(
      evt({ path: '/publisher-applications/p1/reject', httpMethod: 'POST' }),
      ctx,
    );
    expect(stub.rejectApplication).toHaveBeenCalledWith('p1', 'dev@localhost.local', undefined);
  });

  it('translates ApplicationStateError to HTTP 409', async () => {
    const stub = mkAdmin();
    stub.rejectApplication.mockRejectedValue(
      new ApplicationStateError('cannot reject: another admin reviewed this application first', undefined),
    );
    _setPublisherAdminForTests(stub as any);

    const r = await handler(
      evt({ path: '/publisher-applications/p1/reject', httpMethod: 'POST' }),
      ctx,
    );
    expect(r.statusCode).toBe(409);
  });

  it('translates "unknown publisher" to HTTP 404', async () => {
    const stub = mkAdmin();
    stub.rejectApplication.mockRejectedValue(new Error('unknown publisher missing'));
    _setPublisherAdminForTests(stub as any);

    const r = await handler(
      evt({ path: '/publisher-applications/missing/reject', httpMethod: 'POST' }),
      ctx,
    );
    expect(r.statusCode).toBe(404);
  });
});
