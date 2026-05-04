import { runIngest } from '../handlers/publisherIngestHandler';

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
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(store.deleteAllForPublisher).toHaveBeenCalledWith('disabled-paused');
  });
});
