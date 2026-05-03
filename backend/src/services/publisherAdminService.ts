import type { ApplicationStatus, PublisherRecord, StoredPublisherEvent } from '../types/publisher';
import type { PublisherRegistryService } from './publisherRegistryService';
import type { PublisherEventStore } from './publisherEventStore';
import type { MailService } from './mailService';

export interface CreatePublisherInput {
  id: string;
  name: string;
  contactEmail: string;
  sourceUrl: string;
  sourceType: 'json' | 'html';
  trustLevel?: PublisherRecord['trustLevel'];
}

// Thrown by approveApplication / rejectApplication when the target row is not
// in 'pending' state (already approved, already rejected, or admin-created
// without an applicationStatus). Caught by the handler to return HTTP 409.
export class ApplicationStateError extends Error {
  constructor(
    message: string,
    public readonly currentStatus: ApplicationStatus | undefined,
  ) {
    super(message);
    this.name = 'ApplicationStateError';
  }
}

export interface ApplicationReviewDeps {
  // Optional so existing call sites that don't review applications don't have
  // to wire the mailer. Approve/reject paths require it.
  mail?: MailService;
  // Used to build the magic-link login URL embedded in the approval email.
  // Falls back to https://www.chqcal.org if not set.
  siteBaseUrl?: string;
}

const MAX_REJECTION_REASON_LEN = 500;

export class PublisherAdminService {
  constructor(
    private readonly registry: PublisherRegistryService,
    private readonly store: PublisherEventStore,
    private readonly reviewDeps: ApplicationReviewDeps = {},
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
    // listAll, not listEnabled — a publisher disabled while it has a halt
    // would otherwise become invisible and the halt unresolvable without
    // re-enabling first.
    const all = await this.registry.listAll();
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

  // ─── Phase C: pending application review ───────────────────────────────
  //
  // listPendingApplications returns rows whose applicationStatus === 'pending'.
  // Admin-created publishers (no applicationStatus field) are excluded by
  // virtue of the registry filter expression.
  listPendingApplications(): Promise<PublisherRecord[]> {
    return this.registry.listPending();
  }

  // approveApplication transitions a pending row to approved + enabled.
  // Refuses if the row is not pending (status mismatch → ApplicationStateError).
  // Sends an approval email best-effort; SES errors are logged and swallowed
  // so the state change persists.
  async approveApplication(id: string, reviewerEmail: string): Promise<PublisherRecord> {
    const existing = await this.registry.get(id);
    if (existing == null) {
      throw new Error(`unknown publisher ${id}`);
    }
    if (existing.applicationStatus !== 'pending') {
      throw new ApplicationStateError(
        `cannot approve: applicationStatus is ${existing.applicationStatus ?? 'undefined'}, expected pending`,
        existing.applicationStatus,
      );
    }
    const updated: PublisherRecord = {
      ...existing,
      applicationStatus: 'approved',
      enabled: true,
      reviewedAt: new Date().toISOString(),
      reviewerEmail,
      // Clear any prior rejection reason if this is a re-review.
      rejectionReason: undefined,
    };
    await this.registry.upsert(updated);
    await this.sendApprovalNotification(updated).catch(err => {
      console.error('[publisherAdminService] approval email failed (state change persists):', err);
    });
    return updated;
  }

  // rejectApplication transitions pending → rejected. Defensive: also clears
  // enabled. Persists optional reviewer reason (truncated to 500 chars).
  async rejectApplication(
    id: string,
    reviewerEmail: string,
    reason?: string,
  ): Promise<PublisherRecord> {
    const existing = await this.registry.get(id);
    if (existing == null) {
      throw new Error(`unknown publisher ${id}`);
    }
    if (existing.applicationStatus !== 'pending') {
      throw new ApplicationStateError(
        `cannot reject: applicationStatus is ${existing.applicationStatus ?? 'undefined'}, expected pending`,
        existing.applicationStatus,
      );
    }
    const truncated = typeof reason === 'string'
      ? reason.slice(0, MAX_REJECTION_REASON_LEN)
      : undefined;
    const updated: PublisherRecord = {
      ...existing,
      applicationStatus: 'rejected',
      enabled: false,
      reviewedAt: new Date().toISOString(),
      reviewerEmail,
      rejectionReason: truncated,
    };
    await this.registry.upsert(updated);
    await this.sendRejectionNotification(updated).catch(err => {
      console.error('[publisherAdminService] rejection email failed (state change persists):', err);
    });
    return updated;
  }

  private async sendApprovalNotification(rec: PublisherRecord): Promise<void> {
    if (!this.reviewDeps.mail) return;
    const base = (this.reviewDeps.siteBaseUrl ?? 'https://www.chqcal.org').replace(/\/$/, '');
    const statusUrl = `${base}/publish/status/`;
    const loginUrl = `${base}/publish/login/`;
    await this.reviewDeps.mail.sendApprovalEmail({
      to: rec.contactEmail,
      publisherName: rec.name,
      statusUrl,
      loginUrl,
    });
  }

  private async sendRejectionNotification(rec: PublisherRecord): Promise<void> {
    if (!this.reviewDeps.mail) return;
    const base = (this.reviewDeps.siteBaseUrl ?? 'https://www.chqcal.org').replace(/\/$/, '');
    const applyAgainUrl = `${base}/publish/apply/`;
    await this.reviewDeps.mail.sendRejectionEmail({
      to: rec.contactEmail,
      publisherName: rec.name,
      reason: rec.rejectionReason,
      applyAgainUrl,
    });
  }
}
