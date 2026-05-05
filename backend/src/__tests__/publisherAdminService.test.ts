import { ApplicationStateError, PublisherAdminService } from '../services/publisherAdminService';
import { ConcurrentApplicationUpdateError } from '../services/publisherRegistryService';
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
    listAll: jest.Mock;
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
      listAll: jest.fn(),
      get: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      setThresholdHalt: jest.fn(),
      listPending: jest.fn(),
      setApplicationStatus: jest.fn(),
    } as any;
    store = {
      listPending: jest.fn(),
      approveEvent: jest.fn(),
      rejectEvent: jest.fn(),
      deleteAllForPublisher: jest.fn(),
    } as any;
    svc = new PublisherAdminService(registry as any, store as any);
  });

  // ── listPublishers ─────────────────────────────────────────────────────────

  it('listPublishers includes disabled publishers (delegates to listAll, not listEnabled)', async () => {
    const enabled = makeRecord({ id: 'pub-on', enabled: true });
    const disabled = makeRecord({ id: 'pub-off', enabled: false });
    registry.listAll.mockResolvedValue([enabled, disabled]);

    const result = await svc.listPublishers();

    expect(result).toEqual([enabled, disabled]);
    expect(registry.listAll).toHaveBeenCalledTimes(1);
    expect(registry.listEnabled).not.toHaveBeenCalled();
  });

  // ── createPublisher ────────────────────────────────────────────────────────

  it('createPublisher uses trustLevel "review" by default', async () => {
    registry.get.mockResolvedValue(null);
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
    registry.get.mockResolvedValue(null);
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

  it('createPublisher refuses to overwrite an existing record with the same id', async () => {
    registry.get.mockResolvedValue(makeRecord({ id: 'pub-1' }));
    await expect(svc.createPublisher({
      id: 'pub-1',
      name: 'Conflicting',
      contactEmail: 'x@example.com',
      sourceUrl: 'https://example.com/feed.json',
      sourceType: 'json',
    })).rejects.toThrow('publisher already exists: pub-1');
    expect(registry.upsert).not.toHaveBeenCalled();
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

  // ── setPaused ──────────────────────────────────────────────────────────────

  it('setPaused(true) merges paused=true onto existing record via updatePublisher', async () => {
    const existing = makeRecord({ id: 'pub-1', enabled: true });
    registry.get.mockResolvedValue(existing);
    registry.upsert.mockResolvedValue(undefined);

    await svc.setPaused('pub-1', true);

    expect(registry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pub-1', enabled: true, paused: true }),
    );
  });

  it('setPaused(false) clears the paused flag', async () => {
    const existing = makeRecord({ id: 'pub-1', enabled: true, paused: true });
    registry.get.mockResolvedValue(existing);
    registry.upsert.mockResolvedValue(undefined);

    await svc.setPaused('pub-1', false);

    expect(registry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pub-1', enabled: true, paused: false }),
    );
  });

  it('setPaused throws on unknown id', async () => {
    registry.get.mockResolvedValue(null);
    await expect(svc.setPaused('missing', true)).rejects.toThrow(/unknown publisher missing/);
    expect(registry.upsert).not.toHaveBeenCalled();
  });

  // ── deletePublisher ────────────────────────────────────────────────────────

  it('deletePublisher removes the publisher row first, then the events, and returns the deleted-events count', async () => {
    const existing = makeRecord({ id: 'pub-1' });
    registry.get.mockResolvedValue(existing);
    (store as any).deleteAllForPublisher.mockResolvedValue(7);
    (registry as any).delete.mockResolvedValue(undefined);

    const result = await svc.deletePublisher('pub-1');

    expect(result).toEqual({ deletedEvents: 7 });
    expect((store as any).deleteAllForPublisher).toHaveBeenCalledWith('pub-1');
    expect((registry as any).delete).toHaveBeenCalledWith('pub-1');
    // Order matters: publisher row FIRST. Once it's gone, applyDiff's
    // ConditionCheck (`attribute_exists(id)` on the publishers table)
    // will reject any in-flight ingest's writes, so a concurrent ingest
    // cannot race past our event deletion and re-insert events for a
    // publisher that no longer exists.
    const publisherCallOrder = (registry as any).delete.mock.invocationCallOrder[0];
    const eventsCallOrder = (store as any).deleteAllForPublisher.mock.invocationCallOrder[0];
    expect(publisherCallOrder).toBeLessThan(eventsCallOrder);
  });

  it('deletePublisher throws on unknown id and does not delete events or row', async () => {
    registry.get.mockResolvedValue(null);
    await expect(svc.deletePublisher('missing')).rejects.toThrow(/unknown publisher missing/);
    expect((store as any).deleteAllForPublisher).not.toHaveBeenCalled();
    expect((registry as any).delete).not.toHaveBeenCalled();
  });

  it('deletePublisher returns deletedEvents=0 when the publisher had no stored events', async () => {
    const existing = makeRecord({ id: 'pub-1' });
    registry.get.mockResolvedValue(existing);
    (store as any).deleteAllForPublisher.mockResolvedValue(0);
    (registry as any).delete.mockResolvedValue(undefined);

    const result = await svc.deletePublisher('pub-1');

    expect(result).toEqual({ deletedEvents: 0 });
    expect((registry as any).delete).toHaveBeenCalledWith('pub-1');
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

  it('listThresholdHalts returns only publishers with pendingThresholdHalt set, including disabled ones', async () => {
    const withHalt = makeRecord({
      id: 'pub-halt',
      enabled: false, // disabled but still has a halt that needs to be cleared
      pendingThresholdHalt: {
        detectedAt: '2026-05-01T10:00:00.000Z',
        incomingFeed: { eventCount: 500, publisherId: 'pub-halt' },
      },
    });
    const withoutHalt = makeRecord({ id: 'pub-ok' });
    registry.listAll.mockResolvedValue([withHalt, withoutHalt]);

    const result = await svc.listThresholdHalts();

    expect(result).toEqual([withHalt]);
    expect(result).not.toContainEqual(expect.objectContaining({ id: 'pub-ok' }));
    expect(registry.listAll).toHaveBeenCalledTimes(1);
    expect(registry.listEnabled).not.toHaveBeenCalled();
  });

  it('listThresholdHalts returns empty array when no halts', async () => {
    registry.listAll.mockResolvedValue([makeRecord({ id: 'pub-ok' })]);
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

  // ─── Phase C: pending application review ─────────────────────────────────

  describe('listPendingApplications', () => {
    it('delegates to registry.listPending', async () => {
      const pending = makeRecord({ id: 'pub-pending', applicationStatus: 'pending', enabled: false });
      (registry as any).listPending.mockResolvedValue([pending]);

      const result = await svc.listPendingApplications();

      expect(result).toEqual([pending]);
      expect((registry as any).listPending).toHaveBeenCalledTimes(1);
    });
  });

  describe('approveApplication', () => {
    it('flips status to approved + enabled=true atomically and returns the merged record', async () => {
      const pending = makeRecord({
        id: 'pub-pending',
        applicationStatus: 'pending',
        enabled: false,
      });
      registry.get.mockResolvedValue(pending);
      (registry as any).setApplicationStatus.mockResolvedValue(undefined);

      const result = await svc.approveApplication('pub-pending', 'admin@chqcal.org');

      expect(result.applicationStatus).toBe('approved');
      expect(result.enabled).toBe(true);
      expect(result.reviewerEmail).toBe('admin@chqcal.org');
      expect(typeof result.reviewedAt).toBe('string');
      expect(new Date(result.reviewedAt!).toISOString()).toBe(result.reviewedAt);
      expect(result.rejectionReason).toBeUndefined();
      // The atomic write must include the conditional guard.
      expect((registry as any).setApplicationStatus).toHaveBeenCalledWith(
        'pub-pending',
        'approved',
        expect.objectContaining({
          reviewerEmail: 'admin@chqcal.org',
          enabled: true,
          rejectionReason: undefined,
          expectedFromStatus: 'pending',
        }),
      );
    });

    it('clears any prior rejectionReason on re-review', async () => {
      const pending = makeRecord({
        id: 'pub-pending',
        applicationStatus: 'pending',
        enabled: false,
        rejectionReason: 'old reason that should be cleared',
      });
      registry.get.mockResolvedValue(pending);
      (registry as any).setApplicationStatus.mockResolvedValue(undefined);

      const result = await svc.approveApplication('pub-pending', 'admin@chqcal.org');

      expect(result.rejectionReason).toBeUndefined();
    });

    it('throws unknown publisher when row is missing', async () => {
      registry.get.mockResolvedValue(null);
      await expect(svc.approveApplication('missing', 'a@chqcal.org')).rejects.toThrow('unknown publisher missing');
      expect((registry as any).setApplicationStatus).not.toHaveBeenCalled();
    });

    it('throws ApplicationStateError when row is already approved', async () => {
      const approved = makeRecord({ id: 'pub-1', applicationStatus: 'approved' });
      registry.get.mockResolvedValue(approved);
      await expect(svc.approveApplication('pub-1', 'a@chqcal.org')).rejects.toBeInstanceOf(ApplicationStateError);
      expect((registry as any).setApplicationStatus).not.toHaveBeenCalled();
    });

    it('throws ApplicationStateError when row has no applicationStatus (admin-created)', async () => {
      const adminCreated = makeRecord({ id: 'pub-1' }); // no applicationStatus
      registry.get.mockResolvedValue(adminCreated);
      await expect(svc.approveApplication('pub-1', 'a@chqcal.org')).rejects.toBeInstanceOf(ApplicationStateError);
    });

    it('translates ConcurrentApplicationUpdateError from the registry into ApplicationStateError (race-loser)', async () => {
      const pending = makeRecord({ id: 'pub-pending', applicationStatus: 'pending' });
      registry.get.mockResolvedValue(pending);
      (registry as any).setApplicationStatus.mockRejectedValue(
        new ConcurrentApplicationUpdateError('pending'),
      );
      await expect(svc.approveApplication('pub-pending', 'a@chqcal.org'))
        .rejects.toBeInstanceOf(ApplicationStateError);
    });

    it('still persists state change when approval email throws', async () => {
      const pending = makeRecord({ id: 'pub-pending', applicationStatus: 'pending' });
      registry.get.mockResolvedValue(pending);
      (registry as any).setApplicationStatus.mockResolvedValue(undefined);
      const mail = { sendApprovalEmail: jest.fn().mockRejectedValue(new Error('SES down')) } as any;
      const svcWithMail = new PublisherAdminService(registry as any, store as any, { mail });
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const result = await svcWithMail.approveApplication('pub-pending', 'a@chqcal.org');

      expect(result.applicationStatus).toBe('approved');
      expect((registry as any).setApplicationStatus).toHaveBeenCalledTimes(1);
      expect(mail.sendApprovalEmail).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('passes the correct email payload to mail.sendApprovalEmail', async () => {
      const pending = makeRecord({
        id: 'pub-pending',
        name: 'Acme',
        contactEmail: 'pub@example.com',
        applicationStatus: 'pending',
      });
      registry.get.mockResolvedValue(pending);
      (registry as any).setApplicationStatus.mockResolvedValue(undefined);
      const mail = { sendApprovalEmail: jest.fn().mockResolvedValue({ messageId: 'm' }) } as any;
      const svcWithMail = new PublisherAdminService(registry as any, store as any, {
        mail,
        siteBaseUrl: 'https://x.test/',
      });

      await svcWithMail.approveApplication('pub-pending', 'admin@chqcal.org');

      expect(mail.sendApprovalEmail).toHaveBeenCalledWith({
        to: 'pub@example.com',
        publisherName: 'Acme',
        // The publisher's assigned slug — must be in the email so they
        // know which value to put in their feed's `publisher.id`.
        publisherId: 'pub-pending',
        statusUrl: 'https://x.test/publish/status/',
        loginUrl: 'https://x.test/publish/login/',
      });
    });
  });

  describe('rejectApplication', () => {
    it('flips to rejected + enabled=false and persists reason/reviewer atomically', async () => {
      const pending = makeRecord({ id: 'pub-pending', applicationStatus: 'pending', enabled: false });
      registry.get.mockResolvedValue(pending);
      (registry as any).setApplicationStatus.mockResolvedValue(undefined);

      const result = await svc.rejectApplication('pub-pending', 'admin@chqcal.org', 'Spam-looking events.');

      expect(result.applicationStatus).toBe('rejected');
      expect(result.enabled).toBe(false);
      expect(result.reviewerEmail).toBe('admin@chqcal.org');
      expect(result.rejectionReason).toBe('Spam-looking events.');
      expect(typeof result.reviewedAt).toBe('string');
      expect((registry as any).setApplicationStatus).toHaveBeenCalledWith(
        'pub-pending',
        'rejected',
        expect.objectContaining({
          reviewerEmail: 'admin@chqcal.org',
          rejectionReason: 'Spam-looking events.',
          enabled: false,
          expectedFromStatus: 'pending',
        }),
      );
    });

    it('truncates reasons longer than 500 chars', async () => {
      const pending = makeRecord({ id: 'pub-pending', applicationStatus: 'pending' });
      registry.get.mockResolvedValue(pending);
      (registry as any).setApplicationStatus.mockResolvedValue(undefined);

      const longReason = 'x'.repeat(700);
      const result = await svc.rejectApplication('pub-pending', 'a@chqcal.org', longReason);

      expect(result.rejectionReason!.length).toBe(500);
    });

    it('allows omitting the reason', async () => {
      const pending = makeRecord({ id: 'pub-pending', applicationStatus: 'pending' });
      registry.get.mockResolvedValue(pending);
      (registry as any).setApplicationStatus.mockResolvedValue(undefined);

      const result = await svc.rejectApplication('pub-pending', 'a@chqcal.org');

      expect(result.applicationStatus).toBe('rejected');
      expect(result.rejectionReason).toBeUndefined();
    });

    it('normalizes whitespace-only or empty-string reason to undefined', async () => {
      const pending = makeRecord({ id: 'pub-pending', applicationStatus: 'pending' });
      registry.get.mockResolvedValue(pending);
      (registry as any).setApplicationStatus.mockResolvedValue(undefined);

      const r1 = await svc.rejectApplication('pub-pending', 'a@chqcal.org', '');
      expect(r1.rejectionReason).toBeUndefined();

      // Reset mocks for the second call.
      jest.clearAllMocks();
      registry.get.mockResolvedValue(pending);
      (registry as any).setApplicationStatus.mockResolvedValue(undefined);

      const r2 = await svc.rejectApplication('pub-pending', 'a@chqcal.org', '   \n\t  ');
      expect(r2.rejectionReason).toBeUndefined();
    });

    it('throws unknown publisher when row is missing', async () => {
      registry.get.mockResolvedValue(null);
      await expect(svc.rejectApplication('missing', 'a@chqcal.org')).rejects.toThrow('unknown publisher missing');
    });

    it('throws ApplicationStateError when row is already rejected', async () => {
      const rejected = makeRecord({ id: 'pub-1', applicationStatus: 'rejected' });
      registry.get.mockResolvedValue(rejected);
      await expect(svc.rejectApplication('pub-1', 'a@chqcal.org')).rejects.toBeInstanceOf(ApplicationStateError);
      expect((registry as any).setApplicationStatus).not.toHaveBeenCalled();
    });

    it('translates ConcurrentApplicationUpdateError into ApplicationStateError (race-loser)', async () => {
      const pending = makeRecord({ id: 'pub-pending', applicationStatus: 'pending' });
      registry.get.mockResolvedValue(pending);
      (registry as any).setApplicationStatus.mockRejectedValue(
        new ConcurrentApplicationUpdateError('pending'),
      );
      await expect(svc.rejectApplication('pub-pending', 'a@chqcal.org', 'r'))
        .rejects.toBeInstanceOf(ApplicationStateError);
    });

    it('still persists state change when rejection email throws', async () => {
      const pending = makeRecord({ id: 'pub-pending', applicationStatus: 'pending' });
      registry.get.mockResolvedValue(pending);
      (registry as any).setApplicationStatus.mockResolvedValue(undefined);
      const mail = { sendRejectionEmail: jest.fn().mockRejectedValue(new Error('SES down')) } as any;
      const svcWithMail = new PublisherAdminService(registry as any, store as any, { mail });
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const result = await svcWithMail.rejectApplication('pub-pending', 'a@chqcal.org', 'reason');

      expect(result.applicationStatus).toBe('rejected');
      expect((registry as any).setApplicationStatus).toHaveBeenCalledTimes(1);
      expect(mail.sendRejectionEmail).toHaveBeenCalledTimes(1);
      errorSpy.mockRestore();
    });
  });
});
