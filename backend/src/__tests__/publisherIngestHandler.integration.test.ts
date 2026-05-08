import { runIngest } from '../handlers/publisherIngestHandler';

function makeFakeRunStore() {
  return {
    recordRun: jest.fn().mockResolvedValue(undefined),
    getMostRecentRun: jest.fn().mockResolvedValue(undefined),
    listRecentRuns: jest.fn().mockResolvedValue([]),
  };
}

function makeFakeNotifier() {
  return {
    notifyIngestRunRecorded: jest.fn().mockResolvedValue(undefined),
    notifyEventRejected: jest.fn().mockResolvedValue(undefined),
  };
}

describe('runIngest (integration)', () => {
  it('processes one auto publisher end to end', async () => {
    const testPub = {
      id: 'test-pub', name: 'X', contactEmail: 'a@b', sourceUrl: 'https://x',
      sourceType: 'json' as const, trustLevel: 'auto' as const, enabled: true, createdAt: 't',
    };
    const registry = {
      listAll: jest.fn().mockResolvedValue([testPub]),
      get: jest.fn().mockResolvedValue(testPub),
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
      deleteAllForPublisher: jest.fn().mockResolvedValue(0),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };

    await runIngest({
      registry: registry as any,
      store: store as any,
      sidecar: sidecar as any,
      fetcher: fetcher as any,
      now: new Date('2026-06-01T00:00:00Z'),
      publishersTableName: 'chq-publishers',
      runStore: makeFakeRunStore() as any,
      notifier: makeFakeNotifier() as any,
    });

    expect(store.applyDiff).toHaveBeenCalledTimes(1);
    expect(sidecar.publish).toHaveBeenCalledTimes(1);
    expect(registry.recordFetchOutcome).toHaveBeenCalledWith('test-pub', { status: 'ok' });
  });

  it('records fetch failure and skips reconciliation', async () => {
    const registry = {
      listAll: jest.fn().mockResolvedValue([{
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
      deleteAllForPublisher: jest.fn().mockResolvedValue(0),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };

    await runIngest({
      registry: registry as any,
      store: store as any,
      sidecar: sidecar as any,
      fetcher: fetcher as any,
      now: new Date('2026-06-01T00:00:00Z'),
      publishersTableName: 'chq-publishers',
      runStore: makeFakeRunStore() as any,
      notifier: makeFakeNotifier() as any,
    });

    expect(store.listForPublisher).not.toHaveBeenCalled();
    expect(store.applyDiff).not.toHaveBeenCalled();
    expect(registry.recordFetchOutcome).toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'network_error' }));
  });

  it('clears pendingThresholdHalt when a previously halted publisher succeeds', async () => {
    const p1 = {
      id: 'p1', name: 'X', contactEmail: 'a@b', sourceUrl: 'https://x',
      sourceType: 'json' as const, trustLevel: 'auto' as const, enabled: true, createdAt: 't',
      pendingThresholdHalt: { detectedAt: 'earlier', incomingFeed: { eventCount: 0, publisherId: 'p1' } },
    };
    const registry = {
      listAll: jest.fn().mockResolvedValue([p1]),
      get: jest.fn().mockResolvedValue(p1),
      recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
      setThresholdHalt: jest.fn().mockResolvedValue(undefined),
    };
    const fetcher = jest.fn().mockResolvedValue({
      fetchStatus: 'ok',
      report: { ok: true, errors: [], warnings: [] },
      feed: {
        formatVersion: '1.0',
        publisher: { id: 'p1', name: 'X', contactEmail: 'a@b' },
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
      listAllPublished: jest.fn().mockResolvedValue([]),
      deleteAllForPublisher: jest.fn().mockResolvedValue(0),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };

    await runIngest({
      registry: registry as any,
      store: store as any,
      sidecar: sidecar as any,
      fetcher: fetcher as any,
      now: new Date('2026-06-01T00:00:00Z'),
      publishersTableName: 'chq-publishers',
      runStore: makeFakeRunStore() as any,
      notifier: makeFakeNotifier() as any,
    });

    expect(registry.setThresholdHalt).toHaveBeenCalledWith('p1', undefined);
    expect(registry.recordFetchOutcome).toHaveBeenCalledWith('p1', { status: 'ok' });
  });

  it('does not call setThresholdHalt on success when no halt was pending', async () => {
    const registry = {
      listAll: jest.fn().mockResolvedValue([{
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
    const store = {
      listForPublisher: jest.fn().mockResolvedValue([]),
      applyDiff: jest.fn().mockResolvedValue(undefined),
      listAllPublished: jest.fn().mockResolvedValue([]),
      deleteAllForPublisher: jest.fn().mockResolvedValue(0),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };

    await runIngest({
      registry: registry as any,
      store: store as any,
      sidecar: sidecar as any,
      fetcher: fetcher as any,
      now: new Date('2026-06-01T00:00:00Z'),
      publishersTableName: 'chq-publishers',
      runStore: makeFakeRunStore() as any,
      notifier: makeFakeNotifier() as any,
    });

    expect(registry.setThresholdHalt).not.toHaveBeenCalled();
  });

  it('records threshold halt and does not apply diff', async () => {
    const registry = {
      listAll: jest.fn().mockResolvedValue([{
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
      deleteAllForPublisher: jest.fn().mockResolvedValue(0),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };

    await runIngest({
      registry: registry as any,
      store: store as any,
      sidecar: sidecar as any,
      fetcher: fetcher as any,
      now: new Date('2026-06-01T00:00:00Z'),
      publishersTableName: 'chq-publishers',
      runStore: makeFakeRunStore() as any,
      notifier: makeFakeNotifier() as any,
    });

    expect(store.applyDiff).not.toHaveBeenCalled();
    expect(registry.setThresholdHalt).toHaveBeenCalledTimes(1);
    expect(registry.recordFetchOutcome).toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'threshold_halt' }));
  });

  it('threshold halt stores a compact summary, not the full feed payload', async () => {
    const registry = {
      listAll: jest.fn().mockResolvedValue([{
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
        events: Array.from({ length: 200 }, (_, i) => ({
          id: `e${i}`, title: 'T'.repeat(50),
          startDate: '2026-08-01T00:00:00-04:00',
          endDate: '2026-08-01T01:00:00-04:00',
          category: 'Lecture',
          lastModified: '2026-04-01T00:00:00-04:00',
        })),
      },
    });
    const stored = Array.from({ length: 600 }, (_, i) => ({
      publisherId: 'p1', eventId: `s${i}`, state: 'published' as const,
      startDate: '2026-08-01T00:00:00-04:00',
      endDate: '2026-08-01T01:00:00-04:00',
      lastModified: '2026-04-01T00:00:00-04:00',
      payload: {} as any, updatedAt: 't',
    }));
    const store = {
      listForPublisher: jest.fn().mockResolvedValue(stored),
      applyDiff: jest.fn().mockResolvedValue(undefined),
      listAllPublished: jest.fn().mockResolvedValue([]),
      deleteAllForPublisher: jest.fn().mockResolvedValue(0),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };

    await runIngest({
      registry: registry as any,
      store: store as any,
      sidecar: sidecar as any,
      fetcher: fetcher as any,
      now: new Date('2026-06-01T00:00:00Z'),
      publishersTableName: 'chq-publishers',
      runStore: makeFakeRunStore() as any,
      notifier: makeFakeNotifier() as any,
    });

    expect(registry.setThresholdHalt).toHaveBeenCalledTimes(1);
    const halt = registry.setThresholdHalt.mock.calls[0][1];
    expect(halt.incomingFeed).toEqual({ eventCount: 200, publisherId: 'p1' });
    expect(JSON.stringify(halt).length).toBeLessThan(2000);
  });

  it('continues to next publisher when one publisher throws, and still publishes sidecar', async () => {
    const broken = { id: 'broken', name: 'Broken', contactEmail: 'a@b', sourceUrl: 'https://x',
      sourceType: 'json' as const, trustLevel: 'auto' as const, enabled: true, createdAt: 't' };
    const good = { id: 'good', name: 'Good', contactEmail: 'a@b', sourceUrl: 'https://y',
      sourceType: 'json' as const, trustLevel: 'auto' as const, enabled: true, createdAt: 't' };
    const byId: Record<string, typeof broken> = { broken, good };
    const registry = {
      listAll: jest.fn().mockResolvedValue([broken, good]),
      get: jest.fn().mockImplementation((id: string) => Promise.resolve(byId[id] ?? null)),
      recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
      setThresholdHalt: jest.fn().mockResolvedValue(undefined),
    };
    const fetcher = jest.fn().mockImplementation(async (req: any) => ({
      fetchStatus: 'ok',
      report: { ok: true, errors: [], warnings: [] },
      feed: {
        formatVersion: '1.0',
        publisher: { id: req.registeredPublisherId, name: 'X', contactEmail: 'a@b' },
        events: [{
          id: `${req.registeredPublisherId}-e1`, title: 'E',
          startDate: '2026-07-04T18:00:00-04:00',
          endDate: '2026-07-04T19:00:00-04:00',
          category: 'Lecture',
          lastModified: '2026-05-01T00:00:00-04:00',
        }],
      },
    }));
    const store = {
      listForPublisher: jest.fn().mockResolvedValue([]),
      applyDiff: jest.fn().mockImplementation(async () => {
        // Throw on the first call (broken publisher), succeed on the second.
        if ((store.applyDiff as any).mock.calls.length === 1) {
          throw new Error('DynamoDB ValidationException simulation');
        }
      }),
      listAllPublished: jest.fn().mockResolvedValue([]),
      deleteAllForPublisher: jest.fn().mockResolvedValue(0),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };

    await runIngest({
      registry: registry as any,
      store: store as any,
      sidecar: sidecar as any,
      fetcher: fetcher as any,
      now: new Date('2026-06-01T00:00:00Z'),
      publishersTableName: 'chq-publishers',
      runStore: makeFakeRunStore() as any,
      notifier: makeFakeNotifier() as any,
    });

    expect(store.applyDiff).toHaveBeenCalledTimes(2);
    expect(registry.recordFetchOutcome).toHaveBeenCalledWith('broken', expect.objectContaining({
      status: 'network_error',
      message: expect.stringContaining('unhandled error'),
    }));
    expect(registry.recordFetchOutcome).toHaveBeenCalledWith('good', { status: 'ok' });
    expect(sidecar.publish).toHaveBeenCalledTimes(1);
  });

  it('still publishes sidecar when every publisher throws', async () => {
    const registry = {
      listAll: jest.fn().mockResolvedValue([
        { id: 'a', name: 'A', contactEmail: 'a@b', sourceUrl: 'https://x',
          sourceType: 'json', trustLevel: 'auto', enabled: true, createdAt: 't' },
      ]),
      recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
      setThresholdHalt: jest.fn().mockResolvedValue(undefined),
    };
    const fetcher = jest.fn().mockRejectedValue(new Error('boom'));
    const store = {
      listForPublisher: jest.fn(),
      applyDiff: jest.fn(),
      listAllPublished: jest.fn().mockResolvedValue([]),
      deleteAllForPublisher: jest.fn().mockResolvedValue(0),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };

    await runIngest({
      registry: registry as any,
      store: store as any,
      sidecar: sidecar as any,
      fetcher: fetcher as any,
      now: new Date('2026-06-01T00:00:00Z'),
      publishersTableName: 'chq-publishers',
      runStore: makeFakeRunStore() as any,
      notifier: makeFakeNotifier() as any,
    });

    expect(sidecar.publish).toHaveBeenCalledTimes(1);
    expect(registry.recordFetchOutcome).toHaveBeenCalledWith('a', expect.objectContaining({ status: 'network_error' }));
  });

  it('retracts events for disabled publishers and republishes the sidecar', async () => {
    const registry = {
      listAll: jest.fn().mockResolvedValue([
        { id: 'gone', name: 'Gone', contactEmail: 'g@b', sourceUrl: 'https://x',
          sourceType: 'json', trustLevel: 'auto', enabled: false, createdAt: 't' },
      ]),
      recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
      setThresholdHalt: jest.fn().mockResolvedValue(undefined),
    };
    const fetcher = jest.fn();
    const store = {
      listForPublisher: jest.fn(),
      applyDiff: jest.fn(),
      listAllPublished: jest.fn().mockResolvedValue([]),
      deleteAllForPublisher: jest.fn().mockResolvedValue(2),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };

    await runIngest({
      registry: registry as any,
      store: store as any,
      sidecar: sidecar as any,
      fetcher: fetcher as any,
      now: new Date('2026-06-01T00:00:00Z'),
      publishersTableName: 'chq-publishers',
      runStore: makeFakeRunStore() as any,
      notifier: makeFakeNotifier() as any,
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(store.deleteAllForPublisher).toHaveBeenCalledWith('gone');
    expect(sidecar.publish).toHaveBeenCalledTimes(1);
    expect(sidecar.publish).toHaveBeenCalledWith([]);
  });

  it('continues to next disabled publisher when one retraction throws', async () => {
    const registry = {
      listAll: jest.fn().mockResolvedValue([
        { id: 'broken-disable', name: 'BD', contactEmail: 'a@b', sourceUrl: 'https://x',
          sourceType: 'json', trustLevel: 'auto', enabled: false, createdAt: 't' },
        { id: 'good-disable', name: 'GD', contactEmail: 'a@b', sourceUrl: 'https://y',
          sourceType: 'json', trustLevel: 'auto', enabled: false, createdAt: 't' },
      ]),
      recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
      setThresholdHalt: jest.fn().mockResolvedValue(undefined),
    };
    const fetcher = jest.fn();
    const store = {
      listForPublisher: jest.fn(),
      applyDiff: jest.fn(),
      listAllPublished: jest.fn().mockResolvedValue([]),
      deleteAllForPublisher: jest.fn()
        .mockRejectedValueOnce(new Error('DynamoDB transient'))
        .mockResolvedValueOnce(3),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };

    await runIngest({
      registry: registry as any,
      store: store as any,
      sidecar: sidecar as any,
      fetcher: fetcher as any,
      now: new Date('2026-06-01T00:00:00Z'),
      publishersTableName: 'chq-publishers',
      runStore: makeFakeRunStore() as any,
      notifier: makeFakeNotifier() as any,
    });

    expect(store.deleteAllForPublisher).toHaveBeenCalledTimes(2);
    expect(store.deleteAllForPublisher).toHaveBeenNthCalledWith(1, 'broken-disable');
    expect(store.deleteAllForPublisher).toHaveBeenNthCalledWith(2, 'good-disable');
    expect(sidecar.publish).toHaveBeenCalledTimes(1);
  });

  it('runs enabled-publisher ingest before disable retraction so sidecar reflects both', async () => {
    const callOrder: string[] = [];
    const registry = {
      listAll: jest.fn().mockImplementation(async () => {
        callOrder.push('listAll');
        return [
          {
            id: 'live', name: 'Live', contactEmail: 'a@b', sourceUrl: 'https://x',
            sourceType: 'json', trustLevel: 'auto', enabled: true, createdAt: 't',
          },
          {
            id: 'gone', name: 'Gone', contactEmail: 'g@b', sourceUrl: 'https://y',
            sourceType: 'json', trustLevel: 'auto', enabled: false, createdAt: 't',
          },
        ];
      }),
      recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
      setThresholdHalt: jest.fn().mockResolvedValue(undefined),
    };
    const fetcher = jest.fn().mockResolvedValue({
      fetchStatus: 'ok',
      report: { ok: true, errors: [], warnings: [] },
      feed: {
        formatVersion: '1.0',
        publisher: { id: 'live', name: 'Live', contactEmail: 'a@b' },
        events: [],
      },
    });
    const store = {
      listForPublisher: jest.fn().mockResolvedValue([]),
      applyDiff: jest.fn().mockResolvedValue(undefined),
      listAllPublished: jest.fn().mockImplementation(async () => {
        callOrder.push('listAllPublished');
        return [];
      }),
      deleteAllForPublisher: jest.fn().mockImplementation(async () => {
        callOrder.push('deleteAllForPublisher');
        return 0;
      }),
    };
    const sidecar = {
      publish: jest.fn().mockImplementation(async () => {
        callOrder.push('publish');
      }),
    };

    await runIngest({
      registry: registry as any,
      store: store as any,
      sidecar: sidecar as any,
      fetcher: fetcher as any,
      now: new Date('2026-06-01T00:00:00Z'),
      publishersTableName: 'chq-publishers',
      runStore: makeFakeRunStore() as any,
      notifier: makeFakeNotifier() as any,
    });

    expect(callOrder).toEqual([
      'listAll',
      'deleteAllForPublisher',
      'listAllPublished',
      'publish',
    ]);
  });

  it('skips paused publishers (no fetch, no event retraction) — events stay in the sidecar', async () => {
    const pausedRow = {
      id: 'paused-pub', name: 'P', contactEmail: 'a@b', sourceUrl: 'https://x',
      sourceType: 'json', trustLevel: 'auto', enabled: true, paused: true, createdAt: 't',
    };
    const registry = {
      listAll: jest.fn().mockResolvedValue([pausedRow]),
      recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
      setThresholdHalt: jest.fn().mockResolvedValue(undefined),
    };
    const fetcher = jest.fn();
    const store = {
      listForPublisher: jest.fn(),
      applyDiff: jest.fn(),
      listAllPublished: jest.fn().mockResolvedValue([]),
      deleteAllForPublisher: jest.fn().mockResolvedValue(0),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };

    await runIngest({
      registry: registry as any,
      store: store as any,
      sidecar: sidecar as any,
      fetcher: fetcher as any,
      now: new Date('2026-06-01T00:00:00Z'),
      publishersTableName: 'chq-publishers',
      runStore: makeFakeRunStore() as any,
      notifier: makeFakeNotifier() as any,
    });

    // Paused publishers are intentionally invisible to the active and
    // disabled loops — no fetch, no reconcile, no retraction. The contract
    // is "ingest is paused but events stay visible".
    expect(fetcher).not.toHaveBeenCalled();
    expect(store.listForPublisher).not.toHaveBeenCalled();
    expect(store.applyDiff).not.toHaveBeenCalled();
    expect(store.deleteAllForPublisher).not.toHaveBeenCalled();
    expect(registry.recordFetchOutcome).not.toHaveBeenCalled();
    // Sidecar still republishes the global view (which contains whatever the
    // paused publisher had previously written).
    expect(sidecar.publish).toHaveBeenCalledTimes(1);
  });

  it('skips applyDiff and outcome recording when the publisher was deleted during ingest', async () => {
    // Race scenario: the listAll snapshot at the top of runIngest captures
    // the publisher, but an admin deletes it before fetch+reconcile completes.
    // The mid-loop registry.get() check catches this and skips writes that
    // would otherwise resurrect the row or re-insert events.
    const registry = {
      listAll: jest.fn().mockResolvedValue([{
        id: 'racey-pub', name: 'X', contactEmail: 'a@b', sourceUrl: 'https://x',
        sourceType: 'json', trustLevel: 'auto', enabled: true, createdAt: 't',
      }]),
      get: jest.fn().mockResolvedValue(null), // deleted between snapshot and applyDiff
      recordFetchOutcome: jest.fn(),
      setThresholdHalt: jest.fn(),
    };
    const fetcher = jest.fn().mockResolvedValue({
      fetchStatus: 'ok',
      report: { ok: true, errors: [], warnings: [] },
      feed: {
        formatVersion: '1.0',
        publisher: { id: 'racey-pub', name: 'X', contactEmail: 'a@b' },
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
      listAllPublished: jest.fn().mockResolvedValue([]),
      deleteAllForPublisher: jest.fn().mockResolvedValue(0),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };

    await runIngest({
      registry: registry as any,
      store: store as any,
      sidecar: sidecar as any,
      fetcher: fetcher as any,
      now: new Date('2026-06-01T00:00:00Z'),
      publishersTableName: 'chq-publishers',
      runStore: makeFakeRunStore() as any,
      notifier: makeFakeNotifier() as any,
    });

    // The fetch went out (it's already in flight before we know about the
    // delete), but applyDiff and outcome recording were skipped — so no
    // events get re-inserted and no publisher row gets resurrected.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(registry.get).toHaveBeenCalledWith('racey-pub');
    expect(store.applyDiff).not.toHaveBeenCalled();
    expect(registry.recordFetchOutcome).not.toHaveBeenCalled();
    expect(registry.setThresholdHalt).not.toHaveBeenCalled();
    // Sidecar still republishes whatever was already published (which doesn't
    // include this deleted publisher).
    expect(sidecar.publish).toHaveBeenCalledTimes(1);
  });

  it('aborts cleanly when the publisher is deleted between get() and applyDiff (TransactionCanceled path)', async () => {
    // Tighter race than the prior test: the publisher exists at get() time
    // but is deleted before the applyDiff transaction commits. The store
    // surfaces this via PublisherDeletedDuringApplyError; the ingest loop
    // must catch it, log, and continue without recording a fetch outcome.
    const { PublisherDeletedDuringApplyError } = await import('../services/publisherEventStore');
    const racePub = {
      id: 'race-pub', name: 'X', contactEmail: 'a@b', sourceUrl: 'https://x',
      sourceType: 'json' as const, trustLevel: 'auto' as const, enabled: true, createdAt: 't',
    };
    const registry = {
      listAll: jest.fn().mockResolvedValue([racePub]),
      get: jest.fn().mockResolvedValue(racePub),
      recordFetchOutcome: jest.fn(),
      setThresholdHalt: jest.fn(),
    };
    const fetcher = jest.fn().mockResolvedValue({
      fetchStatus: 'ok',
      report: { ok: true, errors: [], warnings: [] },
      feed: {
        formatVersion: '1.0',
        publisher: { id: 'race-pub', name: 'X', contactEmail: 'a@b' },
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
      applyDiff: jest.fn().mockRejectedValue(new PublisherDeletedDuringApplyError('race-pub')),
      listAllPublished: jest.fn().mockResolvedValue([]),
      deleteAllForPublisher: jest.fn().mockResolvedValue(0),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };

    await runIngest({
      registry: registry as any,
      store: store as any,
      sidecar: sidecar as any,
      fetcher: fetcher as any,
      now: new Date('2026-06-01T00:00:00Z'),
      publishersTableName: 'chq-publishers',
      runStore: makeFakeRunStore() as any,
      notifier: makeFakeNotifier() as any,
    });

    // The transaction was attempted but rolled back atomically — no events
    // were written. recordFetchOutcome must NOT fire (would resurrect a
    // partial publisher row).
    expect(store.applyDiff).toHaveBeenCalledTimes(1);
    expect(registry.recordFetchOutcome).not.toHaveBeenCalled();
    expect(registry.setThresholdHalt).not.toHaveBeenCalled();
    expect(sidecar.publish).toHaveBeenCalledTimes(1);
  });

  it('disabled-and-paused publisher is treated as disabled (events retracted, not preserved)', async () => {
    // Defensive: paused only matters when enabled. If a row is both
    // enabled=false and paused=true, the disabled retraction loop must still
    // win — otherwise an admin who disables a paused publisher would
    // silently leave events in the sidecar.
    const row = {
      id: 'disabled-paused', name: 'D', contactEmail: 'a@b', sourceUrl: 'https://x',
      sourceType: 'json', trustLevel: 'auto', enabled: false, paused: true, createdAt: 't',
    };
    const registry = {
      listAll: jest.fn().mockResolvedValue([row]),
      recordFetchOutcome: jest.fn(),
      setThresholdHalt: jest.fn(),
    };
    const fetcher = jest.fn();
    const store = {
      listForPublisher: jest.fn(),
      applyDiff: jest.fn(),
      listAllPublished: jest.fn().mockResolvedValue([]),
      deleteAllForPublisher: jest.fn().mockResolvedValue(3),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };

    await runIngest({
      registry: registry as any,
      store: store as any,
      sidecar: sidecar as any,
      fetcher: fetcher as any,
      now: new Date('2026-06-01T00:00:00Z'),
      publishersTableName: 'chq-publishers',
      runStore: makeFakeRunStore() as any,
      notifier: makeFakeNotifier() as any,
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(store.deleteAllForPublisher).toHaveBeenCalledWith('disabled-paused');
  });

  // ── Phase 5 — single-publisher mode ───────────────────────────────────────
  //
  // The self-service /publisher-fetch-now endpoint invokes runIngest with
  // singlePublisherId set. The expectations below cover the four routing
  // cases plus the "row not found" early-exit.

  describe('singlePublisherId mode', () => {
    it('runs only the named publisher when singlePublisherId is supplied', async () => {
      const target = {
        id: 'target', name: 'T', contactEmail: 'a@b', sourceUrl: 'https://t',
        sourceType: 'json' as const, trustLevel: 'auto' as const, enabled: true, createdAt: 't',
      };
      const other = {
        id: 'other', name: 'O', contactEmail: 'a@b', sourceUrl: 'https://o',
        sourceType: 'json' as const, trustLevel: 'auto' as const, enabled: true, createdAt: 't',
      };
      const byId: Record<string, typeof target> = { target, other };
      const registry = {
        listAll: jest.fn().mockResolvedValue([target, other]),
        get: jest.fn().mockImplementation((id: string) => Promise.resolve(byId[id] ?? null)),
        recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
        setThresholdHalt: jest.fn().mockResolvedValue(undefined),
      };
      const fetcher = jest.fn().mockImplementation(async (req: any) => ({
        fetchStatus: 'ok',
        report: { ok: true, errors: [], warnings: [] },
        feed: {
          formatVersion: '1.0',
          publisher: { id: req.registeredPublisherId, name: 'X', contactEmail: 'a@b' },
          events: [],
        },
      }));
      const store = {
        listForPublisher: jest.fn().mockResolvedValue([]),
        applyDiff: jest.fn().mockResolvedValue(undefined),
        listAllPublished: jest.fn().mockResolvedValue([]),
        deleteAllForPublisher: jest.fn().mockResolvedValue(0),
      };
      const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };

      await runIngest(
        {
          registry: registry as any,
          store: store as any,
          sidecar: sidecar as any,
          fetcher: fetcher as any,
          now: new Date('2026-06-01T00:00:00Z'),
          publishersTableName: 'chq-publishers',
          runStore: makeFakeRunStore() as any,
          notifier: makeFakeNotifier() as any,
        },
        { singlePublisherId: 'target' },
      );

      // Only the target publisher's feed is fetched. listAll is NOT called —
      // single-publisher mode reads the one row directly via registry.get.
      expect(registry.listAll).not.toHaveBeenCalled();
      expect(registry.get).toHaveBeenCalledWith('target');
      expect(fetcher).toHaveBeenCalledTimes(1);
      const fetchedReq = fetcher.mock.calls[0][0];
      expect(fetchedReq.registeredPublisherId).toBe('target');
      // Sidecar still re-publishes (the contract is "every run refreshes the
      // global view", not "every run touches every publisher").
      expect(sidecar.publish).toHaveBeenCalledTimes(1);
    });

    it('processes a singlePublisherId publisher even when paused (single-publisher routes through the same buckets)', async () => {
      // The plan's expectation here is "single-publisher routes through the
      // same active/paused/disabled buckets". A paused publisher therefore
      // gets the paused treatment in single-publisher mode too — no fetch,
      // no retraction, sidecar still republishes. (If the design changes to
      // "single-publisher bypasses paused", flip this expectation.)
      const pausedRow = {
        id: 'paused-pub', name: 'P', contactEmail: 'a@b', sourceUrl: 'https://x',
        sourceType: 'json' as const, trustLevel: 'auto' as const, enabled: true, paused: true, createdAt: 't',
      };
      const registry = {
        listAll: jest.fn(),
        get: jest.fn().mockResolvedValue(pausedRow),
        recordFetchOutcome: jest.fn(),
        setThresholdHalt: jest.fn(),
      };
      const fetcher = jest.fn();
      const store = {
        listForPublisher: jest.fn(),
        applyDiff: jest.fn(),
        listAllPublished: jest.fn().mockResolvedValue([]),
        deleteAllForPublisher: jest.fn(),
      };
      const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };

      await runIngest(
        {
          registry: registry as any,
          store: store as any,
          sidecar: sidecar as any,
          fetcher: fetcher as any,
          now: new Date('2026-06-01T00:00:00Z'),
          publishersTableName: 'chq-publishers',
          runStore: makeFakeRunStore() as any,
          notifier: makeFakeNotifier() as any,
        },
        { singlePublisherId: 'paused-pub' },
      );

      expect(registry.listAll).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
      expect(store.deleteAllForPublisher).not.toHaveBeenCalled();
      expect(sidecar.publish).toHaveBeenCalledTimes(1);
    });

    it('respects disabled status: a singlePublisherId for a disabled publisher still retracts events', async () => {
      const disabledRow = {
        id: 'disabled-pub', name: 'D', contactEmail: 'a@b', sourceUrl: 'https://x',
        sourceType: 'json' as const, trustLevel: 'auto' as const, enabled: false, createdAt: 't',
      };
      const registry = {
        listAll: jest.fn(),
        get: jest.fn().mockResolvedValue(disabledRow),
        recordFetchOutcome: jest.fn(),
        setThresholdHalt: jest.fn(),
      };
      const fetcher = jest.fn();
      const store = {
        listForPublisher: jest.fn(),
        applyDiff: jest.fn(),
        listAllPublished: jest.fn().mockResolvedValue([]),
        deleteAllForPublisher: jest.fn().mockResolvedValue(5),
      };
      const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };

      await runIngest(
        {
          registry: registry as any,
          store: store as any,
          sidecar: sidecar as any,
          fetcher: fetcher as any,
          now: new Date('2026-06-01T00:00:00Z'),
          publishersTableName: 'chq-publishers',
          runStore: makeFakeRunStore() as any,
          notifier: makeFakeNotifier() as any,
        },
        { singlePublisherId: 'disabled-pub' },
      );

      expect(fetcher).not.toHaveBeenCalled();
      expect(store.deleteAllForPublisher).toHaveBeenCalledWith('disabled-pub');
      expect(sidecar.publish).toHaveBeenCalledTimes(1);
    });

    it('logs and skips quietly when singlePublisherId does not match any row, but still republishes the sidecar', async () => {
      const registry = {
        listAll: jest.fn(),
        get: jest.fn().mockResolvedValue(null),
        recordFetchOutcome: jest.fn(),
        setThresholdHalt: jest.fn(),
      };
      const fetcher = jest.fn();
      const store = {
        listForPublisher: jest.fn(),
        applyDiff: jest.fn(),
        listAllPublished: jest.fn().mockResolvedValue([]),
        deleteAllForPublisher: jest.fn(),
      };
      const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

      try {
        await runIngest(
          {
            registry: registry as any,
            store: store as any,
            sidecar: sidecar as any,
            fetcher: fetcher as any,
            now: new Date('2026-06-01T00:00:00Z'),
            publishersTableName: 'chq-publishers',
            runStore: makeFakeRunStore() as any,
            notifier: makeFakeNotifier() as any,
          },
          { singlePublisherId: 'no-such-pub' },
        );
      } finally {
        logSpy.mockRestore();
      }

      expect(registry.listAll).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
      expect(store.deleteAllForPublisher).not.toHaveBeenCalled();
      expect(sidecar.publish).toHaveBeenCalledTimes(1);
    });
  });
});

describe('runIngest records run rows and triggers notifications', () => {
  it('records an OK run row with counts', async () => {
    const p = { id: 'p1', name: 'X', contactEmail: 'a@b', sourceUrl: 'https://x', sourceType: 'json' as const, trustLevel: 'auto' as const, enabled: true, createdAt: 't' };
    const registry = {
      listAll: jest.fn().mockResolvedValue([p]),
      get: jest.fn().mockResolvedValue(p),
      recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
      setThresholdHalt: jest.fn().mockResolvedValue(undefined),
    };
    const fetcher = jest.fn().mockResolvedValue({
      fetchStatus: 'ok',
      report: { ok: true, errors: [], warnings: [] },
      feed: { formatVersion: '1.0', publisher: { id: 'p1', name: 'X', contactEmail: 'a@b' }, events: [{
        id: 'e1', title: 'E', startDate: '2026-07-04T18:00:00-04:00', endDate: '2026-07-04T19:00:00-04:00', category: 'Lecture', lastModified: '2026-05-01T00:00:00-04:00',
      }] },
    });
    const store = {
      listForPublisher: jest.fn().mockResolvedValue([]),
      applyDiff: jest.fn().mockResolvedValue(undefined),
      listAllPublished: jest.fn().mockResolvedValue([]),
      deleteAllForPublisher: jest.fn().mockResolvedValue(0),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };
    const runStore = makeFakeRunStore();
    const notifier = makeFakeNotifier();

    await runIngest({
      registry: registry as any, store: store as any, sidecar: sidecar as any,
      fetcher: fetcher as any, now: new Date('2026-06-01T00:00:00Z'),
      publishersTableName: 'chq-publishers',
      runStore: runStore as any, notifier: notifier as any,
    });

    expect(runStore.recordRun).toHaveBeenCalledTimes(1);
    const row = runStore.recordRun.mock.calls[0][0];
    expect(row.status).toBe('ok');
    expect(row.counts).toEqual({ added: 1, updated: 0, retracted: 0, unchanged: 0 });
    expect(row.triggeredBy).toBe('schedule');
    expect(notifier.notifyIngestRunRecorded).toHaveBeenCalledTimes(1);
  });

  it('records a fetch-failure run row and routes through notifier', async () => {
    const p = { id: 'p1', name: 'X', contactEmail: 'a@b', sourceUrl: 'https://x', sourceType: 'json' as const, trustLevel: 'auto' as const, enabled: true, createdAt: 't' };
    const registry = {
      listAll: jest.fn().mockResolvedValue([p]),
      recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
      setThresholdHalt: jest.fn().mockResolvedValue(undefined),
    };
    const fetcher = jest.fn().mockResolvedValue({
      fetchStatus: 'parse_error', feed: null,
      report: { ok: false, errors: [{ path: '/events/0/title', message: 'must be string' }], warnings: [] },
    });
    const store = {
      listForPublisher: jest.fn(), applyDiff: jest.fn(),
      listAllPublished: jest.fn().mockResolvedValue([]),
      deleteAllForPublisher: jest.fn().mockResolvedValue(0),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };
    const runStore = makeFakeRunStore();
    const notifier = makeFakeNotifier();

    await runIngest({
      registry: registry as any, store: store as any, sidecar: sidecar as any,
      fetcher: fetcher as any, now: new Date(), publishersTableName: 'chq-publishers',
      runStore: runStore as any, notifier: notifier as any,
    });

    expect(runStore.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      publisherId: 'p1', status: 'parse_error',
    }));
    expect(notifier.notifyIngestRunRecorded).toHaveBeenCalledTimes(1);
  });

  it('passes opts.trigger through to the run row', async () => {
    const p = { id: 'p1', name: 'X', contactEmail: 'a@b', sourceUrl: 'https://x', sourceType: 'json' as const, trustLevel: 'auto' as const, enabled: true, createdAt: 't' };
    const registry = {
      listAll: jest.fn().mockResolvedValue([p]),
      get: jest.fn().mockResolvedValue(p),
      recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
      setThresholdHalt: jest.fn().mockResolvedValue(undefined),
    };
    const fetcher = jest.fn().mockResolvedValue({
      fetchStatus: 'ok', report: { ok: true, errors: [], warnings: [] },
      feed: { formatVersion: '1.0', publisher: { id: 'p1', name: 'X', contactEmail: 'a@b' }, events: [] },
    });
    const store = {
      listForPublisher: jest.fn().mockResolvedValue([]),
      applyDiff: jest.fn().mockResolvedValue(undefined),
      listAllPublished: jest.fn().mockResolvedValue([]),
      deleteAllForPublisher: jest.fn().mockResolvedValue(0),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };
    const runStore = makeFakeRunStore();
    const notifier = makeFakeNotifier();

    await runIngest({
      registry: registry as any, store: store as any, sidecar: sidecar as any,
      fetcher: fetcher as any, now: new Date(), publishersTableName: 'chq-publishers',
      runStore: runStore as any, notifier: notifier as any,
    }, { trigger: 'publisher-fetch-now' });

    expect(runStore.recordRun.mock.calls[0][0].triggeredBy).toBe('publisher-fetch-now');
  });

  it('runStore.getMostRecentRun failure skips notifier (prevents spurious failure email on flaky DDB)', async () => {
    const p = { id: 'p1', name: 'X', contactEmail: 'a@b', sourceUrl: 'https://x', sourceType: 'json' as const, trustLevel: 'auto' as const, enabled: true, createdAt: 't' };
    const registry = {
      listAll: jest.fn().mockResolvedValue([p]),
      get: jest.fn().mockResolvedValue(p),
      recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
      setThresholdHalt: jest.fn().mockResolvedValue(undefined),
    };
    const fetcher = jest.fn().mockResolvedValue({
      fetchStatus: 'parse_error', feed: null,
      report: { ok: false, errors: [{ path: '/', message: 'boom' }], warnings: [] },
    });
    const store = {
      listForPublisher: jest.fn(), applyDiff: jest.fn(),
      listAllPublished: jest.fn().mockResolvedValue([]),
      deleteAllForPublisher: jest.fn().mockResolvedValue(0),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };
    const runStore = makeFakeRunStore();
    runStore.getMostRecentRun.mockRejectedValueOnce(new Error('DDB read failed'));
    const notifier = makeFakeNotifier();
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runIngest({
      registry: registry as any, store: store as any, sidecar: sidecar as any,
      fetcher: fetcher as any, now: new Date(), publishersTableName: 'chq-publishers',
      runStore: runStore as any, notifier: notifier as any,
    })).resolves.toBeUndefined();
    // The run row is still recorded (best-effort audit) but the notification
    // is skipped — the streak signal is unknowable without prevRun.
    expect(runStore.recordRun).toHaveBeenCalledTimes(1);
    expect(notifier.notifyIngestRunRecorded).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('runStore.recordRun failure does not break ingest', async () => {
    const p = { id: 'p1', name: 'X', contactEmail: 'a@b', sourceUrl: 'https://x', sourceType: 'json' as const, trustLevel: 'auto' as const, enabled: true, createdAt: 't' };
    const registry = {
      listAll: jest.fn().mockResolvedValue([p]),
      get: jest.fn().mockResolvedValue(p),
      recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
      setThresholdHalt: jest.fn().mockResolvedValue(undefined),
    };
    const fetcher = jest.fn().mockResolvedValue({
      fetchStatus: 'ok', report: { ok: true, errors: [], warnings: [] },
      feed: { formatVersion: '1.0', publisher: { id: 'p1', name: 'X', contactEmail: 'a@b' }, events: [] },
    });
    const store = {
      listForPublisher: jest.fn().mockResolvedValue([]),
      applyDiff: jest.fn().mockResolvedValue(undefined),
      listAllPublished: jest.fn().mockResolvedValue([]),
      deleteAllForPublisher: jest.fn().mockResolvedValue(0),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };
    const runStore = makeFakeRunStore();
    runStore.recordRun.mockRejectedValueOnce(new Error('DDB down'));
    const notifier = makeFakeNotifier();
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runIngest({
      registry: registry as any, store: store as any, sidecar: sidecar as any,
      fetcher: fetcher as any, now: new Date(), publishersTableName: 'chq-publishers',
      runStore: runStore as any, notifier: notifier as any,
    })).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    expect(notifier.notifyIngestRunRecorded).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  describe('ci-e2e-test stale-enabled safety net', () => {
    function makeStoreAndSidecar() {
      return {
        store: {
          listForPublisher: jest.fn().mockResolvedValue([]),
          applyDiff: jest.fn().mockResolvedValue(undefined),
          listAllPublished: jest.fn().mockResolvedValue([]),
          deleteAllForPublisher: jest.fn().mockResolvedValue(0),
        },
        sidecar: { publish: jest.fn().mockResolvedValue(undefined) },
      };
    }

    it('disables ci-e2e-test when enabled=true and lastFetchedAt is older than 1h', async () => {
      const now = new Date('2026-06-01T12:00:00Z');
      const stale = new Date(now.getTime() - 90 * 60 * 1000).toISOString(); // 90 min old
      const ciE2e = {
        id: 'ci-e2e-test', name: 'CI', contactEmail: 'ci@x', sourceUrl: 'https://x',
        sourceType: 'json' as const, trustLevel: 'auto' as const, enabled: true, createdAt: 't',
        lastFetchedAt: stale,
      };
      const registry = {
        listAll: jest.fn().mockResolvedValue([ciE2e]),
        get: jest.fn().mockResolvedValue(ciE2e),
        recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
        setThresholdHalt: jest.fn().mockResolvedValue(undefined),
        setEnabledFlag: jest.fn().mockResolvedValue(undefined),
      };
      const fetcher = jest.fn();
      const { store, sidecar } = makeStoreAndSidecar();

      await runIngest({
        registry: registry as any, store: store as any, sidecar: sidecar as any,
        fetcher: fetcher as any, now,
        publishersTableName: 'chq-publishers',
        runStore: makeFakeRunStore() as any, notifier: makeFakeNotifier() as any,
      });

      expect(registry.setEnabledFlag).toHaveBeenCalledWith('ci-e2e-test', false);
      // Mirror in-memory: should be treated as disabled — no fetch, instead
      // it goes through the disabled-retract bucket.
      expect(fetcher).not.toHaveBeenCalled();
      expect(store.deleteAllForPublisher).toHaveBeenCalledWith('ci-e2e-test');
    });

    it('leaves ci-e2e-test alone when lastFetchedAt is fresh (<1h)', async () => {
      const now = new Date('2026-06-01T12:00:00Z');
      const fresh = new Date(now.getTime() - 5 * 60 * 1000).toISOString(); // 5 min old
      const ciE2e = {
        id: 'ci-e2e-test', name: 'CI', contactEmail: 'ci@x', sourceUrl: 'https://x',
        sourceType: 'json' as const, trustLevel: 'auto' as const, enabled: true, createdAt: 't',
        lastFetchedAt: fresh,
      };
      const registry = {
        listAll: jest.fn().mockResolvedValue([ciE2e]),
        get: jest.fn().mockResolvedValue(ciE2e),
        recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
        setThresholdHalt: jest.fn().mockResolvedValue(undefined),
        setEnabledFlag: jest.fn().mockResolvedValue(undefined),
      };
      const fetcher = jest.fn().mockResolvedValue({
        fetchStatus: 'ok', report: { ok: true, errors: [], warnings: [] },
        feed: {
          formatVersion: '1.0',
          publisher: { id: 'ci-e2e-test', name: 'CI', contactEmail: 'ci@x' },
          events: [],
        },
      });
      const { store, sidecar } = makeStoreAndSidecar();

      await runIngest({
        registry: registry as any, store: store as any, sidecar: sidecar as any,
        fetcher: fetcher as any, now,
        publishersTableName: 'chq-publishers',
        runStore: makeFakeRunStore() as any, notifier: makeFakeNotifier() as any,
      });

      expect(registry.setEnabledFlag).not.toHaveBeenCalled();
      // Still gets fetched as a normal active publisher.
      expect(fetcher).toHaveBeenCalled();
    });

    it('leaves ci-e2e-test alone when enabled=false (the baseline)', async () => {
      const now = new Date('2026-06-01T12:00:00Z');
      const stale = new Date(now.getTime() - 90 * 60 * 1000).toISOString();
      const ciE2e = {
        id: 'ci-e2e-test', name: 'CI', contactEmail: 'ci@x', sourceUrl: 'https://x',
        sourceType: 'json' as const, trustLevel: 'auto' as const, enabled: false, createdAt: 't',
        lastFetchedAt: stale,
      };
      const registry = {
        listAll: jest.fn().mockResolvedValue([ciE2e]),
        recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
        setThresholdHalt: jest.fn().mockResolvedValue(undefined),
        setEnabledFlag: jest.fn().mockResolvedValue(undefined),
      };
      const fetcher = jest.fn();
      const { store, sidecar } = makeStoreAndSidecar();

      await runIngest({
        registry: registry as any, store: store as any, sidecar: sidecar as any,
        fetcher: fetcher as any, now,
        publishersTableName: 'chq-publishers',
        runStore: makeFakeRunStore() as any, notifier: makeFakeNotifier() as any,
      });

      expect(registry.setEnabledFlag).not.toHaveBeenCalled();
    });

    it('runs cleanly when ci-e2e-test does not exist (preview accounts)', async () => {
      const registry = {
        listAll: jest.fn().mockResolvedValue([]),
        recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
        setThresholdHalt: jest.fn().mockResolvedValue(undefined),
        setEnabledFlag: jest.fn().mockResolvedValue(undefined),
      };
      const fetcher = jest.fn();
      const { store, sidecar } = makeStoreAndSidecar();

      await expect(runIngest({
        registry: registry as any, store: store as any, sidecar: sidecar as any,
        fetcher: fetcher as any, now: new Date('2026-06-01T12:00:00Z'),
        publishersTableName: 'chq-publishers',
        runStore: makeFakeRunStore() as any, notifier: makeFakeNotifier() as any,
      })).resolves.toBeUndefined();

      expect(registry.setEnabledFlag).not.toHaveBeenCalled();
    });

    it('does NOT auto-disable on single-publisher runs (singlePublisherId path)', async () => {
      const now = new Date('2026-06-01T12:00:00Z');
      const stale = new Date(now.getTime() - 90 * 60 * 1000).toISOString();
      const ciE2e = {
        id: 'ci-e2e-test', name: 'CI', contactEmail: 'ci@x', sourceUrl: 'https://x',
        sourceType: 'json' as const, trustLevel: 'auto' as const, enabled: true, createdAt: 't',
        lastFetchedAt: stale,
      };
      const registry = {
        listAll: jest.fn(),
        get: jest.fn().mockResolvedValue(ciE2e),
        recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
        setThresholdHalt: jest.fn().mockResolvedValue(undefined),
        setEnabledFlag: jest.fn().mockResolvedValue(undefined),
      };
      const fetcher = jest.fn().mockResolvedValue({
        fetchStatus: 'ok', report: { ok: true, errors: [], warnings: [] },
        feed: {
          formatVersion: '1.0',
          publisher: { id: 'ci-e2e-test', name: 'CI', contactEmail: 'ci@x' },
          events: [],
        },
      });
      const { store, sidecar } = makeStoreAndSidecar();

      await runIngest({
        registry: registry as any, store: store as any, sidecar: sidecar as any,
        fetcher: fetcher as any, now,
        publishersTableName: 'chq-publishers',
        runStore: makeFakeRunStore() as any, notifier: makeFakeNotifier() as any,
      }, { singlePublisherId: 'ci-e2e-test' });

      // Single-publisher mode shouldn't auto-disable; the caller asked
      // explicitly to fetch this row.
      expect(registry.setEnabledFlag).not.toHaveBeenCalled();
      expect(registry.listAll).not.toHaveBeenCalled();
    });
  });
});
