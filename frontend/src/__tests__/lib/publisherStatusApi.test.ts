// Unit tests for the observability additions to publisherStatusApi.ts:
// getPublisherRuns and getPublisherEvents (Phase 7).
//
// We test the happy path, 401 redirect, non-ok error, and malformed response
// for each function — mirroring the coverage pattern used for adminPublisherApi.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPublisherRuns, getPublisherEvents } from '@/lib/publisherStatusApi';

// ---------------------------------------------------------------------------
// Auth client mock — getPublisherJwt always returns a token; clearPublisherSession
// is a no-op. window.location.replace is stubbed to avoid jsdom navigation errors.
// ---------------------------------------------------------------------------

vi.mock('@/lib/publisherAuthClient', () => ({
  getPublisherJwt: vi.fn(() => 'test-jwt'),
  clearPublisherSession: vi.fn(),
}));

import { getPublisherJwt, clearPublisherSession } from '@/lib/publisherAuthClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOk(body: unknown, status = 200): Response {
  return {
    ok: true,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function makeError(status: number, body: unknown = {}): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

let fetchMock: any;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as typeof globalThis.fetch;
  // Prevent jsdom from complaining about navigation
  Object.defineProperty(window, 'location', {
    value: { replace: vi.fn() },
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// getPublisherRuns
// ---------------------------------------------------------------------------

describe('getPublisherRuns', () => {
  it('returns the runs array on a 200 response', async () => {
    const runs = [
      { publisherId: 'p1', runAt: '2026-05-06T12:00:00Z', status: 'ok', counts: { added: 1, updated: 0, retracted: 0, unchanged: 5 }, triggeredBy: 'schedule' },
    ];
    fetchMock.mockResolvedValueOnce(makeOk({ runs }));
    const result = await getPublisherRuns();
    expect(result).toEqual(runs);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/publisher-runs$/),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('sends the JWT in the Authorization header', async () => {
    fetchMock.mockResolvedValueOnce(makeOk({ runs: [] }));
    await getPublisherRuns();
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer test-jwt');
  });

  it('throws PublisherStatusError on non-ok response with error body', async () => {
    fetchMock.mockResolvedValueOnce(makeError(500, { error: 'Internal server error' }));
    await expect(getPublisherRuns()).rejects.toMatchObject({
      name: 'PublisherStatusError',
      status: 500,
      message: 'Internal server error',
    });
  });

  it('throws PublisherStatusError on non-ok response without error body', async () => {
    fetchMock.mockResolvedValueOnce(makeError(503, {}));
    await expect(getPublisherRuns()).rejects.toMatchObject({
      name: 'PublisherStatusError',
      status: 503,
    });
  });

  it('throws PublisherStatusError on malformed response (no runs array)', async () => {
    fetchMock.mockResolvedValueOnce(makeOk({ wrong: 'shape' }));
    await expect(getPublisherRuns()).rejects.toMatchObject({
      name: 'PublisherStatusError',
      status: 500,
      message: 'Malformed response.',
    });
  });

  it('clears session and throws on 401', async () => {
    fetchMock.mockResolvedValueOnce(makeError(401));
    await expect(getPublisherRuns()).rejects.toMatchObject({ status: 401 });
    expect(clearPublisherSession).toHaveBeenCalled();
  });

  it('throws and redirects when no JWT is present', async () => {
    (getPublisherJwt as any).mockReturnValueOnce(null);
    await expect(getPublisherRuns()).rejects.toMatchObject({ status: 401 });
  });
});

// ---------------------------------------------------------------------------
// getPublisherEvents
// ---------------------------------------------------------------------------

describe('getPublisherEvents', () => {
  it('returns the events array on a 200 response', async () => {
    const events = [
      { eventId: 'e1', title: 'Concert', startDate: '2030-07-01T18:00:00Z', endDate: '2030-07-01T20:00:00Z', state: 'published', updatedAt: 'x' },
    ];
    fetchMock.mockResolvedValueOnce(makeOk({ events }));
    const result = await getPublisherEvents();
    expect(result).toEqual(events);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/publisher-events$/),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('sends the JWT in the Authorization header', async () => {
    fetchMock.mockResolvedValueOnce(makeOk({ events: [] }));
    await getPublisherEvents();
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer test-jwt');
  });

  it('throws PublisherStatusError on non-ok response with error body', async () => {
    fetchMock.mockResolvedValueOnce(makeError(500, { error: 'Something went wrong' }));
    await expect(getPublisherEvents()).rejects.toMatchObject({
      name: 'PublisherStatusError',
      status: 500,
      message: 'Something went wrong',
    });
  });

  it('throws PublisherStatusError on non-ok response without error body', async () => {
    fetchMock.mockResolvedValueOnce(makeError(502, {}));
    await expect(getPublisherEvents()).rejects.toMatchObject({
      name: 'PublisherStatusError',
      status: 502,
    });
  });

  it('throws PublisherStatusError on malformed response (no events array)', async () => {
    fetchMock.mockResolvedValueOnce(makeOk({ wrong: 'shape' }));
    await expect(getPublisherEvents()).rejects.toMatchObject({
      name: 'PublisherStatusError',
      status: 500,
      message: 'Malformed response.',
    });
  });

  it('clears session and throws on 401', async () => {
    fetchMock.mockResolvedValueOnce(makeError(401));
    await expect(getPublisherEvents()).rejects.toMatchObject({ status: 401 });
    expect(clearPublisherSession).toHaveBeenCalled();
  });

  it('throws and redirects when no JWT is present', async () => {
    (getPublisherJwt as any).mockReturnValueOnce(null);
    await expect(getPublisherEvents()).rejects.toMatchObject({ status: 401 });
  });
});
