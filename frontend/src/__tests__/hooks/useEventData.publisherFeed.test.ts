/// <reference types="vitest/globals" />
import { renderHook, waitFor } from '@testing-library/preact';
import { useEventData } from '@/hooks/useEventData';
import type { GlobalEventData } from '@/lib/types';

const PRIMARY_BODY = {
  data: [
    {
      id: 'p1',
      title: 'Primary',
      startDate: '2026-07-04T00:00:00Z',
      endDate: '2026-07-04T01:00:00Z',
    },
  ],
};

const PUBLISHER_BODY = {
  data: [
    {
      id: 'pub1',
      title: 'Publisher',
      startDate: '2026-07-05T00:00:00Z',
      endDate: '2026-07-05T01:00:00Z',
      sourcePublisherId: 'pub-x',
      sourcePublisherName: 'Pub X',
    },
  ],
};

function makeProps() {
  const globalEventData: GlobalEventData = {
    events: null,
    categories: [],
    locations: [],
    tags: [],
    weeks: [],
    loadedAt: null,
  };
  return {
    year: 2026,
    globalEventData,
    seasonWeeks: [],
    setAvailableCategories: vi.fn(),
    setAvailableLocations: vi.fn(),
  };
}

describe('useEventData with publisher feeds', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_ENABLE_PUBLISHER_FEEDS', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('merges primary and publisher events when flag is on', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('publisher-events')) {
        return { ok: true, json: async () => PUBLISHER_BODY } as Response;
      }
      return { ok: true, json: async () => PRIMARY_BODY } as Response;
    }) as typeof fetch;

    const { result } = renderHook(() => useEventData(makeProps()));
    await waitFor(() => expect(result.current.events.length).toBe(2));
    expect(result.current.events.map((e) => e.id).sort()).toEqual(['p1', 'pub1']);
  });

  it('falls back to primary when sidecar returns 404', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('publisher-events')) {
        return { ok: false, status: 404 } as Response;
      }
      return { ok: true, json: async () => PRIMARY_BODY } as Response;
    }) as typeof fetch;

    const { result } = renderHook(() => useEventData(makeProps()));
    await waitFor(() => expect(result.current.events.length).toBe(1));
    expect(result.current.events[0].id).toBe('p1');
  });

  it('falls back to primary when sidecar fetch throws (network error)', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('publisher-events')) {
        throw new Error('network error');
      }
      return { ok: true, json: async () => PRIMARY_BODY } as Response;
    }) as typeof fetch;

    const { result } = renderHook(() => useEventData(makeProps()));
    await waitFor(() => expect(result.current.events.length).toBe(1));
    expect(result.current.events[0].id).toBe('p1');
  });

  it('dedupes by id so a publisher echoing a primary event renders once', async () => {
    const dupBody = {
      data: [
        {
          id: 'p1', // same id as primary
          title: 'Publisher dup',
          startDate: '2026-07-04T00:00:00Z',
          endDate: '2026-07-04T01:00:00Z',
          sourcePublisherId: 'pub-x',
          sourcePublisherName: 'Pub X',
        },
        {
          id: 'pub2',
          title: 'Publisher unique',
          startDate: '2026-07-06T00:00:00Z',
          endDate: '2026-07-06T01:00:00Z',
          sourcePublisherId: 'pub-x',
          sourcePublisherName: 'Pub X',
        },
      ],
    };
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('publisher-events')) {
        return { ok: true, json: async () => dupBody } as Response;
      }
      return { ok: true, json: async () => PRIMARY_BODY } as Response;
    }) as typeof fetch;

    const { result } = renderHook(() => useEventData(makeProps()));
    await waitFor(() => expect(result.current.events.length).toBe(2));
    expect(result.current.events.map((e) => e.id).sort()).toEqual(['p1', 'pub2']);
    // The primary 'p1' wins (publisher dup is dropped) — primary feed is authoritative.
    const p1 = result.current.events.find((e) => e.id === 'p1');
    expect(p1?.title).toBe('Primary');
  });

  it('skips the sidecar fetch entirely when the flag is off', async () => {
    vi.stubEnv('VITE_ENABLE_PUBLISHER_FEEDS', 'false');
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => PRIMARY_BODY } as Response));
    globalThis.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useEventData(makeProps()));
    await waitFor(() => expect(result.current.events.length).toBe(1));
    const sidecarCalls = fetchMock.mock.calls.filter((c) =>
      String((c as unknown[])[0]).includes('publisher-events'),
    );
    expect(sidecarCalls).toHaveLength(0);
  });
});
