import { runIngest } from '../handlers/publisherIngestHandler';

describe('runIngest (integration)', () => {
  it('processes one auto publisher end to end', async () => {
    const registry = {
      listEnabled: jest.fn().mockResolvedValue([{
        id: 'test-pub', name: 'X', contactEmail: 'a@b', sourceUrl: 'https://x',
        sourceType: 'json', trustLevel: 'auto', enabled: true, createdAt: 't',
      }]),
      recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
      setThresholdHalt: jest.fn().mockResolvedValue(undefined),
    };
    const fetcher = jest.fn().mockResolvedValue({
      fetchStatus: 'ok',
      report: { ok: true, errors: [], warnings: [] },
      feed: {
        formatVersion: '1.0',
        publisher: { id: 'test-pub', name: 'X', contactEmail: 'a@b' },
        events: [{
          id: 'e1', title: 'E',
          startDate: '2026-07-04T18:00:00-04:00',
          endDate: '2026-07-04T19:00:00-04:00',
          category: 'Lecture',
          lastModified: '2026-05-01T00:00:00-04:00',
        }],
      },
    });
    const store = {
      listForPublisher: jest.fn().mockResolvedValue([]),
      applyDiff: jest.fn().mockResolvedValue(undefined),
      listAllPublished: jest.fn().mockResolvedValue([{
        publisherId: 'test-pub', eventId: 'e1', state: 'published',
        startDate: '2026-07-04T18:00:00-04:00',
        endDate: '2026-07-04T19:00:00-04:00',
        lastModified: 't',
        payload: {
          id: 'e1', title: 'E',
          startDate: '2026-07-04T18:00:00-04:00',
          endDate: '2026-07-04T19:00:00-04:00',
          category: 'Lecture',
          lastModified: 't',
          sourcePublisherId: 'test-pub',
          sourcePublisherName: 'X',
        },
        updatedAt: 't',
      }]),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };

    await runIngest({
      registry: registry as any,
      store: store as any,
      sidecar: sidecar as any,
      fetcher: fetcher as any,
      now: new Date('2026-06-01T00:00:00Z'),
    });

    expect(store.applyDiff).toHaveBeenCalledTimes(1);
    expect(sidecar.publish).toHaveBeenCalledTimes(1);
    expect(registry.recordFetchOutcome).toHaveBeenCalledWith('test-pub', { status: 'ok' });
  });

  it('records fetch failure and skips reconciliation', async () => {
    const registry = {
      listEnabled: jest.fn().mockResolvedValue([{
        id: 'p1', name: 'X', contactEmail: 'a@b', sourceUrl: 'https://x',
        sourceType: 'json', trustLevel: 'auto', enabled: true, createdAt: 't',
      }]),
      recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
      setThresholdHalt: jest.fn().mockResolvedValue(undefined),
    };
    const fetcher = jest.fn().mockResolvedValue({
      fetchStatus: 'network_error',
      feed: null,
      report: { ok: false, errors: [{ path: '/', message: 'HTTP 500' }], warnings: [] },
    });
    const store = {
      listForPublisher: jest.fn(),
      applyDiff: jest.fn(),
      listAllPublished: jest.fn().mockResolvedValue([]),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };

    await runIngest({
      registry: registry as any,
      store: store as any,
      sidecar: sidecar as any,
      fetcher: fetcher as any,
      now: new Date('2026-06-01T00:00:00Z'),
    });

    expect(store.listForPublisher).not.toHaveBeenCalled();
    expect(store.applyDiff).not.toHaveBeenCalled();
    expect(registry.recordFetchOutcome).toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'network_error' }));
  });

  it('records threshold halt and does not apply diff', async () => {
    const registry = {
      listEnabled: jest.fn().mockResolvedValue([{
        id: 'p1', name: 'X', contactEmail: 'a@b', sourceUrl: 'https://x',
        sourceType: 'json', trustLevel: 'auto', enabled: true, createdAt: 't',
      }]),
      recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
      setThresholdHalt: jest.fn().mockResolvedValue(undefined),
    };
    const fetcher = jest.fn().mockResolvedValue({
      fetchStatus: 'ok',
      report: { ok: true, errors: [], warnings: [] },
      feed: {
        formatVersion: '1.0',
        publisher: { id: 'p1', name: 'X', contactEmail: 'a@b' },
        events: [],
      },
    });
    const stored = Array.from({ length: 20 }, (_, i) => ({
      publisherId: 'p1', eventId: `e${i}`, state: 'published' as const,
      startDate: '2026-08-01T00:00:00-04:00',
      endDate: '2026-08-01T01:00:00-04:00',
      lastModified: '2026-04-01T00:00:00-04:00',
      payload: {
        id: `e${i}`, title: 'T',
        startDate: '2026-08-01T00:00:00-04:00',
        endDate: '2026-08-01T01:00:00-04:00',
        category: 'Lecture',
        lastModified: '2026-04-01T00:00:00-04:00',
        sourcePublisherId: 'p1', sourcePublisherName: 'X',
      },
      updatedAt: 't',
    }));
    const store = {
      listForPublisher: jest.fn().mockResolvedValue(stored),
      applyDiff: jest.fn().mockResolvedValue(undefined),
      listAllPublished: jest.fn().mockResolvedValue(stored),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };

    await runIngest({
      registry: registry as any,
      store: store as any,
      sidecar: sidecar as any,
      fetcher: fetcher as any,
      now: new Date('2026-06-01T00:00:00Z'),
    });

    expect(store.applyDiff).not.toHaveBeenCalled();
    expect(registry.setThresholdHalt).toHaveBeenCalledTimes(1);
    expect(registry.recordFetchOutcome).toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'threshold_halt' }));
  });
});
