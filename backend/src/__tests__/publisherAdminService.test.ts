import { PublisherAdminService } from '../services/publisherAdminService';
import type { PublisherRecord, StoredPublisherEvent } from '../types/publisher';

function makeRecord(overrides: Partial<PublisherRecord> = {}): PublisherRecord {
  return {
    id: 'pub-1',
    name: 'Test Publisher',
    contactEmail: 'test@example.com',
    sourceUrl: 'https://example.com/feed.json',
    sourceType: 'json',
    trustLevel: 'review',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makePendingEvent(overrides: Partial<StoredPublisherEvent> = {}): StoredPublisherEvent {
  return {
    publisherId: 'pub-1',
    eventId: 'evt-1',
    startDate: '2026-07-01',
    endDate: '2026-07-01',
    lastModified: '2026-01-01T00:00:00.000Z',
    payload: {
      id: 'evt-1',
      title: 'Test Event',
      startDate: '2026-07-01T00:00:00-04:00',
      endDate: '2026-07-01T01:00:00-04:00',
      category: 'Music',
      lastModified: '2026-01-01T00:00:00.000Z',
      sourcePublisherId: 'pub-1',
      sourcePublisherName: 'Test Publisher',
    } as StoredPublisherEvent['payload'],
    state: 'pending',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('PublisherAdminService', () => {
  let registry: {
    listEnabled: jest.Mock;
    get: jest.Mock;
    upsert: jest.Mock;
    setThresholdHalt: jest.Mock;
  };
  let store: {
    listPending: jest.Mock;
    approveEvent: jest.Mock;
    rejectEvent: jest.Mock;
  };
  let svc: PublisherAdminService;

  beforeEach(() => {
    jest.resetAllMocks();
    registry = {
      listEnabled: jest.fn(),
      get: jest.fn(),
      upsert: jest.fn(),
      setThresholdHalt: jest.fn(),
    };
    store = {
      listPending: jest.fn(),
      approveEvent: jest.fn(),
      rejectEvent: jest.fn(),
    };
    svc = new PublisherAdminService(registry as any, store as any);
  });

  // ── createPublisher ────────────────────────────────────────────────────────

  it('createPublisher uses trustLevel "review" by default', async () => {
    registry.upsert.mockResolvedValue(undefined);
    const rec = await svc.createPublisher({
      id: 'pub-1',
      name: 'Test Publisher',
      contactEmail: 'test@example.com',
      sourceUrl: 'https://example.com/feed.json',
      sourceType: 'json',
    });
    expect(rec.trustLevel).toBe('review');
    expect(rec.enabled).toBe(true);
    expect(typeof rec.createdAt).toBe('string');
    // ISO 8601 format check
    expect(() => new Date(rec.createdAt)).not.toThrow();
    expect(new Date(rec.createdAt).toISOString()).toBe(rec.createdAt);
    expect(registry.upsert).toHaveBeenCalledWith(rec);
  });

  it('createPublisher honors an explicit trustLevel', async () => {
    registry.upsert.mockResolvedValue(undefined);
    const rec = await svc.createPublisher({
      id: 'pub-2',
      name: 'Auto Publisher',
      contactEmail: 'auto@example.com',
      sourceUrl: 'https://example.com/feed.json',
      sourceType: 'html',
      trustLevel: 'auto',
    });
    expect(rec.trustLevel).toBe('auto');
    expect(rec.id).toBe('pub-2');
    expect(rec.sourceType).toBe('html');
  });

  // ── updatePublisher ────────────────────────────────────────────────────────

  it('updatePublisher throws on unknown id', async () => {
    registry.get.mockResolvedValue(null);
    await expect(svc.updatePublisher('missing', { name: 'X' })).rejects.toThrow('unknown publisher missing');
  });

  it('updatePublisher merges patch over existing record, preserves id, and upserts', async () => {
    const existing = makeRecord({ id: 'pub-1', name: 'Old Name', trustLevel: 'review' });
    registry.get.mockResolvedValue(existing);
    registry.upsert.mockResolvedValue(undefined);

    const result = await svc.updatePublisher('pub-1', { name: 'New Name', trustLevel: 'auto' });

    expect(result.id).toBe('pub-1');
    expect(result.name).toBe('New Name');
    expect(result.trustLevel).toBe('auto');
    // Other fields preserved
    expect(result.contactEmail).toBe(existing.contactEmail);
    expect(registry.upsert).toHaveBeenCalledWith(result);
  });

  it('updatePublisher id in patch is overridden by the existing id', async () => {
    const existing = makeRecord({ id: 'pub-1' });
    registry.get.mockResolvedValue(existing);
    registry.upsert.mockResolvedValue(undefined);

    const result = await svc.updatePublisher('pub-1', { id: 'should-be-ignored' } as any);

    expect(result.id).toBe('pub-1');
  });

  // ── setEnabled ─────────────────────────────────────────────────────────────

  it('setEnabled(false) round-trips through updatePublisher', async () => {
    const existing = makeRecord({ id: 'pub-1', enabled: true });
    registry.get.mockResolvedValue(existing);
    registry.upsert.mockResolvedValue(undefined);

    await svc.setEnabled('pub-1', false);

    expect(registry.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'pub-1', enabled: false }));
  });

  it('setEnabled(true) round-trips through updatePublisher', async () => {
    const existing = makeRecord({ id: 'pub-1', enabled: false });
    registry.get.mockResolvedValue(existing);
    registry.upsert.mockResolvedValue(undefined);

    await svc.setEnabled('pub-1', true);

    expect(registry.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'pub-1', enabled: true }));
  });

  // ── listPendingEvents ──────────────────────────────────────────────────────

  it('listPendingEvents delegates to store.listPending', async () => {
    const events = [makePendingEvent()];
    store.listPending.mockResolvedValue(events);

    const result = await svc.listPendingEvents();

    expect(store.listPending).toHaveBeenCalledTimes(1);
    expect(result).toBe(events);
  });

  // ── approveEvent / rejectEvent ─────────────────────────────────────────────

  it('approveEvent delegates to store.approveEvent with same args', async () => {
    store.approveEvent.mockResolvedValue(undefined);

    await svc.approveEvent('pub-1', 'evt-1');

    expect(store.approveEvent).toHaveBeenCalledWith('pub-1', 'evt-1');
  });

  it('rejectEvent delegates to store.rejectEvent with same args', async () => {
    store.rejectEvent.mockResolvedValue(undefined);

    await svc.rejectEvent('pub-1', 'evt-1');

    expect(store.rejectEvent).toHaveBeenCalledWith('pub-1', 'evt-1');
  });

  // ── listThresholdHalts ─────────────────────────────────────────────────────

  it('listThresholdHalts returns only publishers with pendingThresholdHalt set', async () => {
    const withHalt = makeRecord({
      id: 'pub-halt',
      pendingThresholdHalt: {
        detectedAt: '2026-05-01T10:00:00.000Z',
        incomingFeed: { eventCount: 500, publisherId: 'pub-halt' },
      },
    });
    const withoutHalt = makeRecord({ id: 'pub-ok' });
    registry.listEnabled.mockResolvedValue([withHalt, withoutHalt]);

    const result = await svc.listThresholdHalts();

    expect(result).toEqual([withHalt]);
    expect(result).not.toContainEqual(expect.objectContaining({ id: 'pub-ok' }));
  });

  it('listThresholdHalts returns empty array when no halts', async () => {
    registry.listEnabled.mockResolvedValue([makeRecord({ id: 'pub-ok' })]);
    const result = await svc.listThresholdHalts();
    expect(result).toEqual([]);
  });

  // ── approveThresholdHalt ───────────────────────────────────────────────────

  it('approveThresholdHalt calls registry.setThresholdHalt(id, undefined)', async () => {
    registry.setThresholdHalt.mockResolvedValue(undefined);

    await svc.approveThresholdHalt('pub-1');

    expect(registry.setThresholdHalt).toHaveBeenCalledWith('pub-1', undefined);
    expect(registry.setThresholdHalt).toHaveBeenCalledTimes(1);
  });

  // ── cancelThresholdHalt ────────────────────────────────────────────────────

  it('cancelThresholdHalt calls registry.setThresholdHalt(id, undefined)', async () => {
    registry.setThresholdHalt.mockResolvedValue(undefined);

    await svc.cancelThresholdHalt('pub-1');

    expect(registry.setThresholdHalt).toHaveBeenCalledWith('pub-1', undefined);
    expect(registry.setThresholdHalt).toHaveBeenCalledTimes(1);
  });
});
