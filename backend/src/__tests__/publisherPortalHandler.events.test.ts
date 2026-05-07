// Tests for GET /publisher-events (Task 11).
// Uses the same mock pattern as publisherPortalHandler.status.test.ts:
// publisherAuthService is mocked at module level so we don't need Secrets Manager.
// The registry and eventStore are replaced via the _set*ForTests helpers.

import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  handlePublisherEvents,
  _setStatusRegistryForTests,
  _setEventStoreForTests,
} from '../handlers/publisherPortalHandler';
import type { StoredPublisherEvent } from '../types/publisher';

jest.mock('../services/publisherAuthService', () => ({
  verifyPublisherJwt: jest.fn(),
}));
import { verifyPublisherJwt } from '../services/publisherAuthService';

const evt = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent => ({
  httpMethod: 'GET',
  path: '/publisher-events',
  resource: '/publisher-events',
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

function makeStoredEvent(overrides: Partial<StoredPublisherEvent> = {}): StoredPublisherEvent {
  return {
    publisherId: 'p1',
    eventId: 'e1',
    startDate: '2026-07-01T18:00:00Z',
    endDate: '2026-07-01T19:00:00Z',
    lastModified: 't',
    state: 'published',
    updatedAt: '2026-05-01T00:00:00Z',
    payload: { id: 'e1', title: 'Concert' } as any,
    ...overrides,
  };
}

describe('handlePublisherEvents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    _setStatusRegistryForTests(null);
    _setEventStoreForTests(null);
  });

  it('returns 401 when Authorization header is missing', async () => {
    _setStatusRegistryForTests(fakeRegistry({ id: 'p1', applicationStatus: 'approved' }) as any);
    _setEventStoreForTests({ listForPublisher: jest.fn().mockResolvedValue([]) } as any);
    const r = await handlePublisherEvents(evt(), {});
    expect(r.statusCode).toBe(401);
  });

  it('returns 401 when JWT verification fails', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue(null);
    _setStatusRegistryForTests(fakeRegistry({ id: 'p1', applicationStatus: 'approved' }) as any);
    _setEventStoreForTests({ listForPublisher: jest.fn().mockResolvedValue([]) } as any);
    const r = await handlePublisherEvents(
      evt({ headers: { Authorization: 'Bearer bad.jwt' } }),
      {},
    );
    expect(r.statusCode).toBe(401);
  });

  it('returns event summaries for the JWT publisher', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'p1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    _setStatusRegistryForTests(
      fakeRegistry({ id: 'p1', applicationStatus: 'approved', tokenVersion: 0 }) as any,
    );
    const events: StoredPublisherEvent[] = [
      makeStoredEvent({ eventId: 'e1', state: 'published', payload: { id: 'e1', title: 'Concert' } as any }),
      makeStoredEvent({ eventId: 'e2', state: 'pending', startDate: '2026-07-02T18:00:00Z', endDate: '2026-07-02T19:00:00Z', payload: { id: 'e2', title: 'Lecture' } as any }),
      makeStoredEvent({
        eventId: 'e3',
        state: 'rejected',
        startDate: '2026-07-03T18:00:00Z',
        endDate: '2026-07-03T19:00:00Z',
        rejectionReason: 'duplicate',
        rejectedAt: '2026-05-05T10:00:00Z',
        payload: { id: 'e3', title: 'Panel' } as any,
      }),
    ];
    const store = { listForPublisher: jest.fn().mockResolvedValue(events) };
    _setEventStoreForTests(store as any);

    const r = await handlePublisherEvents(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      {},
    );
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.events).toHaveLength(3);

    // First event: published, no optional fields
    expect(body.events[0]).toEqual({
      eventId: 'e1',
      title: 'Concert',
      startDate: '2026-07-01T18:00:00Z',
      endDate: '2026-07-01T19:00:00Z',
      state: 'published',
      updatedAt: '2026-05-01T00:00:00Z',
    });

    // Full payload must NOT leak into the response
    expect((body.events[0] as any).payload).toBeUndefined();

    // Rejected event carries rejectionReason + rejectedAt
    const rejected = body.events.find((e: any) => e.state === 'rejected');
    expect(rejected).toBeDefined();
    expect(rejected.rejectionReason).toBe('duplicate');
    expect(rejected.rejectedAt).toBe('2026-05-05T10:00:00Z');

    // store called with JWT's publisher id
    expect(store.listForPublisher).toHaveBeenCalledWith('p1');
  });

  it('returns empty array when no events exist', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'p1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    _setStatusRegistryForTests(
      fakeRegistry({ id: 'p1', applicationStatus: 'approved', tokenVersion: 0 }) as any,
    );
    _setEventStoreForTests({ listForPublisher: jest.fn().mockResolvedValue([]) } as any);
    const r = await handlePublisherEvents(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      {},
    );
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ events: [] });
  });

  it('cross-publisher isolation: always uses JWT publisherId, not query param', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'p1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    _setStatusRegistryForTests(
      fakeRegistry({ id: 'p1', applicationStatus: 'approved', tokenVersion: 0 }) as any,
    );
    const store = { listForPublisher: jest.fn().mockResolvedValue([]) };
    _setEventStoreForTests(store as any);
    await handlePublisherEvents(
      evt({
        headers: { Authorization: 'Bearer good.jwt' },
        queryStringParameters: { publisherId: 'p2' },
      }),
      {},
    );
    expect(store.listForPublisher).toHaveBeenCalledWith('p1');
    expect(store.listForPublisher).not.toHaveBeenCalledWith('p2');
  });

  it('returns 404 when publisher row does not exist', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'pub-deleted', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    _setStatusRegistryForTests(fakeRegistry(null) as any);
    _setEventStoreForTests({ listForPublisher: jest.fn().mockResolvedValue([]) } as any);
    const r = await handlePublisherEvents(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      {},
    );
    expect(r.statusCode).toBe(404);
  });

  it('rejected events include rejectionReason and rejectedAt when present', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'p1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    _setStatusRegistryForTests(
      fakeRegistry({ id: 'p1', applicationStatus: 'approved', tokenVersion: 0 }) as any,
    );
    const events: StoredPublisherEvent[] = [
      makeStoredEvent({
        eventId: 'e-rejected',
        state: 'rejected',
        rejectionReason: 'too long',
        rejectedAt: '2026-05-06T09:00:00Z',
        payload: { id: 'e-rejected', title: 'Old Event' } as any,
      }),
    ];
    _setEventStoreForTests({ listForPublisher: jest.fn().mockResolvedValue(events) } as any);
    const r = await handlePublisherEvents(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      {},
    );
    const body = JSON.parse(r.body);
    const e = body.events[0];
    expect(e.rejectionReason).toBe('too long');
    expect(e.rejectedAt).toBe('2026-05-06T09:00:00Z');
    // Fields that should NOT be present on non-rejected events
    expect(e.payload).toBeUndefined();
  });

  it('approved event does not include rejectionReason or rejectedAt', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'p1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    _setStatusRegistryForTests(
      fakeRegistry({ id: 'p1', applicationStatus: 'approved', tokenVersion: 0 }) as any,
    );
    const events: StoredPublisherEvent[] = [
      makeStoredEvent({ state: 'published' }),
    ];
    _setEventStoreForTests({ listForPublisher: jest.fn().mockResolvedValue(events) } as any);
    const r = await handlePublisherEvents(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      {},
    );
    const body = JSON.parse(r.body);
    const e = body.events[0];
    expect(e.state).toBe('published');
    expect(e.rejectionReason).toBeUndefined();
    expect(e.rejectedAt).toBeUndefined();
  });

  it('returns 500 when eventStore throws', async () => {
    (verifyPublisherJwt as jest.Mock).mockResolvedValue({
      sub: 'p1', role: 'publisher', email: 'p@x.com', tokenVersion: 0,
    });
    _setStatusRegistryForTests(
      fakeRegistry({ id: 'p1', applicationStatus: 'approved', tokenVersion: 0 }) as any,
    );
    _setEventStoreForTests({
      listForPublisher: jest.fn().mockRejectedValue(new Error('DDB error')),
    } as any);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await handlePublisherEvents(
      evt({ headers: { Authorization: 'Bearer good.jwt' } }),
      {},
    );
    expect(r.statusCode).toBe(500);
    errSpy.mockRestore();
  });
});
