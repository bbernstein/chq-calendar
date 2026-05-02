import type { PublisherRecord, StoredPublisherEvent } from '../types/publisher';
import type { PublisherRegistryService } from './publisherRegistryService';
import type { PublisherEventStore } from './publisherEventStore';

export interface CreatePublisherInput {
  id: string;
  name: string;
  contactEmail: string;
  sourceUrl: string;
  sourceType: 'json' | 'html';
  trustLevel?: PublisherRecord['trustLevel'];
}

export class PublisherAdminService {
  constructor(
    private readonly registry: PublisherRegistryService,
    private readonly store: PublisherEventStore,
  ) {}

  listPublishers(): Promise<PublisherRecord[]> {
    // Admin UI must see disabled rows so they can re-enable them; listEnabled
    // would orphan disabled publishers from the page.
    return this.registry.listAll();
  }

  async createPublisher(input: CreatePublisherInput): Promise<PublisherRecord> {
    const conflict = await this.registry.get(input.id);
    if (conflict != null) {
      throw new Error(`publisher already exists: ${input.id}`);
    }
    const rec: PublisherRecord = {
      id: input.id,
      name: input.name,
      contactEmail: input.contactEmail,
      sourceUrl: input.sourceUrl,
      sourceType: input.sourceType,
      trustLevel: input.trustLevel ?? 'review',
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    await this.registry.upsert(rec);
    return rec;
  }

  async updatePublisher(id: string, patch: Partial<PublisherRecord>): Promise<PublisherRecord> {
    const existing = await this.registry.get(id);
    if (existing == null) {
      throw new Error(`unknown publisher ${id}`);
    }
    const merged: PublisherRecord = { ...existing, ...patch, id };
    await this.registry.upsert(merged);
    return merged;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.updatePublisher(id, { enabled });
  }

  listPendingEvents(): Promise<StoredPublisherEvent[]> {
    return this.store.listPending();
  }

  approveEvent(publisherId: string, eventId: string): Promise<void> {
    return this.store.approveEvent(publisherId, eventId);
  }

  rejectEvent(publisherId: string, eventId: string): Promise<void> {
    return this.store.rejectEvent(publisherId, eventId);
  }

  async listThresholdHalts(): Promise<PublisherRecord[]> {
    const all = await this.registry.listEnabled();
    return all.filter(p => p.pendingThresholdHalt != null);
  }

  // Clears the pendingThresholdHalt field. The next scheduled ingest run will
  // re-fetch and reconcile; if the feed is still suspicious it will halt again.
  // The narrative distinction from cancelThresholdHalt is intent ('yes, let the
  // next pass through' vs 'no, keep current state'); the storage operation is
  // the same.
  approveThresholdHalt(publisherId: string): Promise<void> {
    return this.registry.setThresholdHalt(publisherId, undefined);
  }

  cancelThresholdHalt(publisherId: string): Promise<void> {
    return this.registry.setThresholdHalt(publisherId, undefined);
  }
}
