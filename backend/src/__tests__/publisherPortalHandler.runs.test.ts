// Tests for GET /publisher-runs (Task 10).
// Uses the same mock pattern as publisherPortalHandler.status.test.ts:
// publisherAuthService is mocked at module level so we don't need Secrets Manager.
// The registry and runStore are replaced via the _set*ForTests helpers.

import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  handlePublisherRuns,
  _setStatusRegistryForTests,
  _setRunStoreForTests,
} from '../handlers/publisherPortalHandler';
import type { IngestRunRow } from '../types/publisherIngestRun';

jest.mock('../services/publisherAuthService', () => ({
  verifyPublisherJwt: jest.fn(),
}));
import { verifyPublisherJwt } from '../services/publisherAuthService';

const evt = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent => ({
  httpMethod: 'GET',
  path: '/publisher-runs',
  resource: '/publisher-runs',
  pathParameters: null,
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  headers: {},
  multiValueHeaders: {},
  body: null,
  isBase64Encoded: false,
  stageVariables: null,
  requestContext: { identity: { sourceIp: '203.0.113.1' } } as any,
  ...overrides,
});

function fakeRegistry(rec: Record<string, unknown> | null) {
  return {
    get: jest.fn().mockResolvedValue(rec),
  };
}

function fakeRunStore(runs: IngestRunRow[]) {
  return {
    listRecentRuns: jest.fn().mockResolvedValue(runs),
    getMostRecentRun: jest.fn().mockResolvedValue(runs[0]),
    recordRun: jest.fn(),
  };
}

describe('handlePublisherRuns', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    _setStatusRegistryForTests(null);
    _setRunStoreForTests(null);
  });

  it('returns 401 when Authorization header is missing', async () => {
    _setStatusRegistryForTests(fakeRegistry({ id: 'p1', applicationStatus: 'approved' }) as any);
    _setRunStoreForTests(fakeRunStore([]) as any);
    const r = await handlePublisherRuns(evt(), {});
    expect(r.statusCode).toBe(401);
  });

  it('returns 401 when JWT verification fails', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue(null);
    _setStatusRegistryForTests(fakeRegistry({ id: 'p1', applicationStatus: 'approved' }) as any);
    _setRunStoreForTests(fakeRunStore([]) as any);
    const r = await handlePublisherRuns(
      evt({ headers: { Authorization: 'Bearer bad.jwt' } }),
      {},
    );
    expect(r.statusCode).toBe(401);
  });

  it('returns the publisher\'s runs when authenticated', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'p1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    _setStatusRegistryForTests(
      fakeRegistry({ id: 'p1', applicationStatus: 'approved', tokenVersion: 0 }) as any,
    );
    const runs: IngestRunRow[] = [
      {
        publisherId: 'p1',
        runAt: '2026-05-06T12:00:00Z',
        status: 'ok',
        triggeredBy: 'schedule',
        counts: { added: 1, updated: 0, retracted: 0, unchanged: 5 },
      },
    ];
    const store = fakeRunStore(runs);
    _setRunStoreForTests(store as any);
    const r = await handlePublisherRuns(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      {},
    );
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.runs).toHaveLength(1);
    expect(store.listRecentRuns).toHaveBeenCalledWith('p1', 30);
  });

  it('returns empty array when no runs exist', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'p1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    _setStatusRegistryForTests(
      fakeRegistry({ id: 'p1', applicationStatus: 'approved', tokenVersion: 0 }) as any,
    );
    _setRunStoreForTests(fakeRunStore([]) as any);
    const r = await handlePublisherRuns(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      {},
    );
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ runs: [] });
  });

  it('always uses JWT publisherId (ignores queryStringParameters.publisherId)', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'p1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    _setStatusRegistryForTests(
      fakeRegistry({ id: 'p1', applicationStatus: 'approved', tokenVersion: 0 }) as any,
    );
    const store = fakeRunStore([]);
    _setRunStoreForTests(store as any);
    await handlePublisherRuns(
      evt({
        headers: { Authorization: 'Bearer good.jwt' },
        queryStringParameters: { publisherId: 'p2' },
      }),
      {},
    );
    expect(store.listRecentRuns).toHaveBeenCalledWith('p1', 30);
  });

  it('returns 404 when publisher row does not exist', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-deleted', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    _setStatusRegistryForTests(fakeRegistry(null) as any);
    _setRunStoreForTests(fakeRunStore([]) as any);
    const r = await handlePublisherRuns(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      {},
    );
    expect(r.statusCode).toBe(404);
  });

  it('returns 500 when runStore throws', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'p1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    _setStatusRegistryForTests(
      fakeRegistry({ id: 'p1', applicationStatus: 'approved', tokenVersion: 0 }) as any,
    );
    const store = {
      listRecentRuns: jest.fn().mockRejectedValue(new Error('DDB throttled')),
    };
    _setRunStoreForTests(store as any);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await handlePublisherRuns(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      {},
    );
    expect(r.statusCode).toBe(500);
    errSpy.mockRestore();
  });
});
