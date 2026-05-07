import type { ApplicationStatus, PublisherRecord, StoredPublisherEvent } from '../types/publisher';
import { ConcurrentApplicationUpdateError } from './publisherRegistryService';
import type { PublisherRegistryService } from './publisherRegistryService';
import type { PublisherEventStore } from './publisherEventStore';
import type { MailService } from './mailService';
import type { PublisherNotificationService } from './publisherNotificationService';

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
  // Optional so callers (smoke harness, tests) that don't need event-rejection
  // emails don't have to wire the notifier. The admin reject path will skip
  // the notification step if this is missing.
  notifier?: PublisherNotificationService;
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

  async setPaused(id: string, paused: boolean): Promise<void> {
    await this.updatePublisher(id, { paused });
  }

  // Hard-deletes the publisher row and all its stored events. Used by the
  // admin UI's "Delete" action. The next sidecar publish (triggered by the
  // ingest loop on its hourly cadence, or manually via "Run ingest now")
  // will reflect the removal. We do NOT publish here — the admin handler
  // owns that decision so callers can batch deletes if desired.
  //
  // Order: publisher row FIRST, then events. This is load-bearing for the
  // delete-during-ingest race close — applyDiff's ConditionCheck asserts
  // attribute_exists(publisher_row) before writing events, so removing the
  // row first guarantees that an in-flight applyDiff is rejected rather
  // than racing past our event-deletion. If we deleted events first, a
  // concurrent ingest's applyDiff could still pass its ConditionCheck
  // (the publisher row still exists at that moment) and write fresh
  // events between our two writes — the very orphan-events scenario the
  // ConditionCheck was designed to prevent.
  async deletePublisher(id: string): Promise<{ deletedEvents: number }> {
    const existing = await this.registry.get(id);
    if (existing == null) {
      throw new Error(`unknown publisher ${id}`);
    }
    await this.registry.delete(id);
    const deletedEvents = await this.store.deleteAllForPublisher(id);
    return { deletedEvents };
  }

  listPendingEvents(): Promise<StoredPublisherEvent[]> {
    return this.store.listPending();
  }

  approveEvent(publisherId: string, eventId: string): Promise<void> {
    return this.store.approveEvent(publisherId, eventId);
  }

  async rejectEvent(
    publisherId: string,
    eventId: string,
    reason?: string,
  ): Promise<void> {
    // Read the event BEFORE rejecting so we have its title/startDate for the
    // notification email. If the row is gone (never existed or already deleted),
    // store.rejectEvent's ConditionExpression will be a no-op — don't notify.
    const event = await this.store.getEvent(publisherId, eventId);
    await this.store.rejectEvent(publisherId, eventId, reason);
    if (event && this.reviewDeps.notifier) {
      const publisher = await this.registry.get(publisherId);
      if (publisher) {
        await this.reviewDeps.notifier.notifyEventRejected({ publisher, event, reason });
      }
    }
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
  // Refuses if the row is not pending — throws ApplicationStateError, which
  // the handler translates to HTTP 409. The status check + write happen
  // atomically via a DynamoDB ConditionExpression so two admins acting on
  // the same row at the same time cannot both "succeed".
  //
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
    try {
      await this.registry.setApplicationStatus(id, 'approved', {
        reviewerEmail,
        // Explicit undefined clears any prior rejection reason on re-review.
        rejectionReason: undefined,
        enabled: true,
        expectedFromStatus: 'pending',
      });
    } catch (err) {
      if (err instanceof ConcurrentApplicationUpdateError) {
        // Another admin won the race; surface as the same 409 the up-front
        // check would have produced. We don't know what they decided, so
        // the message is intentionally generic.
        throw new ApplicationStateError(
          'cannot approve: another admin reviewed this application first',
          undefined,
        );
      }
      throw err;
    }
    // Build the response shape from the known mutation rather than re-reading
    // (eventual consistency could otherwise return stale fields).
    const updated: PublisherRecord = {
      ...existing,
      applicationStatus: 'approved',
      enabled: true,
      reviewedAt: new Date().toISOString(),
      reviewerEmail,
      rejectionReason: undefined,
    };
    await this.sendApprovalNotification(updated).catch(err => {
      console.error('[publisherAdminService] approval email failed (state change persists):', err);
    });
    return updated;
  }

  // rejectApplication transitions pending → rejected and clears `enabled`
  // defensively. Reviewer reason is trimmed and capped to 500 chars; an
  // empty / whitespace-only reason is normalized to undefined so we don't
  // persist a meaningless empty string. Atomic via ConditionExpression
  // (see approveApplication for the rationale).
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
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    const cleanReason = trimmed.length > 0
      ? trimmed.slice(0, MAX_REJECTION_REASON_LEN)
      : undefined;
    try {
      await this.registry.setApplicationStatus(id, 'rejected', {
        reviewerEmail,
        rejectionReason: cleanReason,
        enabled: false,
        expectedFromStatus: 'pending',
      });
    } catch (err) {
      if (err instanceof ConcurrentApplicationUpdateError) {
        throw new ApplicationStateError(
          'cannot reject: another admin reviewed this application first',
          undefined,
        );
      }
      throw err;
    }
    const updated: PublisherRecord = {
      ...existing,
      applicationStatus: 'rejected',
      enabled: false,
      reviewedAt: new Date().toISOString(),
      reviewerEmail,
      rejectionReason: cleanReason,
    };
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
      publisherId: rec.id,
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
