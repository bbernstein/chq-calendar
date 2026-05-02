import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  listPublishers,
  createPublisher,
  updatePublisher,
  listPending,
  approveEvent,
  rejectEvent,
  listHalts,
  approveHalt,
  cancelHalt,
} from '@/lib/adminPublisherApi';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOkResponse(body: unknown, status = 200): Response {
  return {
    ok: true,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
  } as unknown as Response;
}

function makeErrorResponse(status: number, body = 'Bad Request'): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

function makeNoContentResponse(): Response {
  return {
    ok: true,
    status: 204,
    json: () => Promise.resolve(undefined),
    text: () => Promise.resolve(''),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

// Typed as `any` so we can both assign to `globalThis.fetch` and inspect
// `.mock.calls` without fighting the strict fetch signature.
let fetchMock: any;

beforeEach(() => {
  fetchMock = vi.fn();
  // Cast required because vi.fn() signature doesn't match the strict fetch type
  globalThis.fetch = fetchMock as typeof globalThis.fetch;
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// URL-shape tests
// ---------------------------------------------------------------------------

describe('listPublishers', () => {
  it('GETs the URL ending in /admin/api/publishers and unwraps the publishers envelope', async () => {
    const records = [{ id: 'p1' }, { id: 'p2' }];
    fetchMock.mockResolvedValueOnce(makeOkResponse({ publishers: records }));
    const result = await listPublishers();
    expect(result).toEqual(records);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/admin\/api\/publishers$/),
      expect.any(Object)
    );
  });
});

describe('createPublisher', () => {
  it('POSTs JSON, sends Content-Type and id, and unwraps the publisher envelope', async () => {
    fetchMock.mockResolvedValueOnce(makeOkResponse({ publisher: { id: 'pub-1', name: 'Test Publisher' } }));
    const result = await createPublisher({
      id: 'pub-1',
      name: 'Test Publisher',
      contactEmail: 'test@example.com',
      sourceUrl: 'https://example.com/feed.json',
      sourceType: 'json',
    });
    expect(result).toMatchObject({ id: 'pub-1', name: 'Test Publisher' });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/admin\/api\/publishers$/);
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(options.body as string)).toMatchObject({ id: 'pub-1' });
  });
});

describe('updatePublisher', () => {
  it('PATCHes the URL ending in /admin/api/publishers/<id> and unwraps the publisher envelope', async () => {
    fetchMock.mockResolvedValueOnce(makeOkResponse({ publisher: { id: 'pub-1', enabled: false } }));
    const result = await updatePublisher('pub-1', { enabled: false });
    expect(result).toMatchObject({ id: 'pub-1', enabled: false });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/admin\/api\/publishers\/pub-1$/);
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(options.body as string)).toMatchObject({ enabled: false });
  });

  it('URL-encodes publisher ids that contain special characters', async () => {
    fetchMock.mockResolvedValueOnce(makeOkResponse({ publisher: { id: 'pub/with space' } }));
    await updatePublisher('pub/with space', { enabled: true });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(encodeURIComponent('pub/with space'));
  });
});

describe('listPending', () => {
  it('GETs /admin/api/publisher-events/pending and unwraps the events envelope', async () => {
    const events = [{ publisherId: 'p', eventId: 'e' }];
    fetchMock.mockResolvedValueOnce(makeOkResponse({ events }));
    const result = await listPending();
    expect(result).toEqual(events);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/admin\/api\/publisher-events\/pending$/),
      expect.any(Object)
    );
  });
});

describe('approveEvent', () => {
  it('POSTs to /admin/api/publisher-events/<publisherId>/<eventId>/approve', async () => {
    fetchMock.mockResolvedValueOnce(makeOkResponse({}));
    await approveEvent('pub-1', 'evt-42');
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/admin\/api\/publisher-events\/pub-1\/evt-42\/approve$/);
    expect(options.method).toBe('POST');
  });
});

describe('rejectEvent', () => {
  it('POSTs to /admin/api/publisher-events/<publisherId>/<eventId>/reject', async () => {
    fetchMock.mockResolvedValueOnce(makeOkResponse({}));
    await rejectEvent('pub-1', 'evt-42');
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/admin\/api\/publisher-events\/pub-1\/evt-42\/reject$/);
    expect(options.method).toBe('POST');
  });
});

describe('listHalts', () => {
  it('GETs /admin/api/publisher-halts and unwraps the halts envelope', async () => {
    const halts = [{ id: 'p1', pendingThresholdHalt: { detectedAt: 't' } }];
    fetchMock.mockResolvedValueOnce(makeOkResponse({ halts }));
    const result = await listHalts();
    expect(result).toEqual(halts);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/admin\/api\/publisher-halts$/),
      expect.any(Object)
    );
  });
});

describe('approveHalt', () => {
  it('POSTs to /admin/api/publisher-halts/<publisherId>/approve', async () => {
    fetchMock.mockResolvedValueOnce(makeOkResponse({ inserted: 3, updated: 1, removed: 0 }));
    const result = await approveHalt('pub-1');
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/admin\/api\/publisher-halts\/pub-1\/approve$/);
    expect(options.method).toBe('POST');
    expect(result).toMatchObject({ inserted: 3, updated: 1, removed: 0 });
  });

  it('also works when the backend returns an empty object {}', async () => {
    fetchMock.mockResolvedValueOnce(makeOkResponse({}));
    const result = await approveHalt('pub-1');
    expect(result).toEqual({});
  });
});

describe('cancelHalt', () => {
  it('POSTs to /admin/api/publisher-halts/<publisherId>/cancel', async () => {
    fetchMock.mockResolvedValueOnce(makeOkResponse({}));
    await cancelHalt('pub-1');
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/admin\/api\/publisher-halts\/pub-1\/cancel$/);
    expect(options.method).toBe('POST');
  });
});

// ---------------------------------------------------------------------------
// Authorization header tests
// ---------------------------------------------------------------------------

describe('Authorization header', () => {
  it('includes Bearer token when one is present in localStorage', async () => {
    localStorage.setItem('chq_auth_token', 'fake-jwt');
    fetchMock.mockResolvedValueOnce(makeOkResponse({ publishers: [] }));
    await listPublishers();
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer fake-jwt');
  });

  it('omits Authorization header when no token is set', async () => {
    // localStorage is cleared in beforeEach — no token present
    fetchMock.mockResolvedValueOnce(makeOkResponse({ publishers: [] }));
    await listPublishers();
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('throws an error with the status code when the response is not ok', async () => {
    fetchMock.mockResolvedValueOnce(makeErrorResponse(403, 'Forbidden'));
    await expect(listPublishers()).rejects.toThrow('403');
  });

  it('includes the response body text in the error message', async () => {
    fetchMock.mockResolvedValueOnce(makeErrorResponse(500, 'Internal Server Error'));
    await expect(listPublishers()).rejects.toThrow('Internal Server Error');
  });

  it('throws on 4xx responses', async () => {
    fetchMock.mockResolvedValueOnce(makeErrorResponse(400, 'Bad Request'));
    await expect(createPublisher({
      id: 'bad',
      name: 'Bad',
      contactEmail: 'bad@example.com',
      sourceUrl: 'https://example.com',
      sourceType: 'json',
    })).rejects.toThrow('400');
  });
});

// ---------------------------------------------------------------------------
// 204 No Content
// ---------------------------------------------------------------------------

describe('204 No Content', () => {
  it('resolves to undefined without attempting to parse JSON', async () => {
    fetchMock.mockResolvedValueOnce(makeNoContentResponse());
    const result = await rejectEvent('pub-1', 'evt-42');
    expect(result).toBeUndefined();
  });

  it('resolves to undefined for cancelHalt on 204', async () => {
    fetchMock.mockResolvedValueOnce(makeNoContentResponse());
    const result = await cancelHalt('pub-1');
    expect(result).toBeUndefined();
  });
});
