import type { FeedDocument, FeedEvent } from '@chq-calendar/publisher-format';
import type {
  ReconcileDiff,
  ReconcileResult,
  StoredPublisherEvent,
  TrustLevel,
} from '../types/publisher';

export interface ReconcileInput {
  stored: StoredPublisherEvent[];
  feed: FeedDocument;
  now: Date;
  trustLevel: TrustLevel;
}

const REMOVAL_MIN = 5;
const REMOVAL_RATIO = 0.5;

function toStored(
  ev: FeedEvent,
  publisher: FeedDocument['publisher'],
  trustLevel: TrustLevel,
  nowIso: string,
  existing?: StoredPublisherEvent,
): StoredPublisherEvent {
  // Once an event reaches state='published' or state='rejected' it is terminal.
  // Re-ingest never demotes — admin approvals (state='published' under
  // trustLevel='review') and admin rejections (state='rejected') are sticky.
  // The only ways out are removal due to feed-absence, both handled outside toStored.
  // When preserving 'rejected', also preserve rejectionReason and rejectedAt.
  const state: 'published' | 'pending' | 'rejected' =
    existing?.state === 'published'
      ? 'published'
      : existing?.state === 'rejected'
        ? 'rejected'
        : trustLevel === 'auto'
          ? 'published'
          : 'pending';
  const result: StoredPublisherEvent = {
    publisherId: publisher.id,
    eventId: ev.id,
    startDate: ev.startDate,
    endDate: ev.endDate,
    lastModified: ev.lastModified,
    payload: { ...ev, sourcePublisherId: publisher.id, sourcePublisherName: publisher.name },
    state,
    updatedAt: nowIso,
  };
  // Preserve rejection metadata (reason and timestamp) when persisting rejected state.
  if (state === 'rejected' && existing) {
    if (existing.rejectionReason) result.rejectionReason = existing.rejectionReason;
    if (existing.rejectedAt) result.rejectedAt = existing.rejectedAt;
  }
  return result;
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  const { stored, feed, now, trustLevel } = input;
  const nowIso = now.toISOString();
  const storedById = new Map(stored.map(s => [s.eventId, s]));
  const incomingById = new Map(feed.events.map(e => [e.id, e]));

  const inserts: StoredPublisherEvent[] = [];
  const updates: StoredPublisherEvent[] = [];
  let unchanged = 0;

  for (const inc of feed.events) {
    const ex = storedById.get(inc.id);
    const newRec = toStored(inc, feed.publisher, trustLevel, nowIso, ex);
    if (!ex) {
      inserts.push(newRec);
    } else if (
      Date.parse(inc.lastModified) > Date.parse(ex.lastModified) ||
      ex.state !== newRec.state
    ) {
      updates.push(newRec);
    } else {
      unchanged++;
    }
  }

  const removals: StoredPublisherEvent[] = [];
  for (const ex of stored) {
    if (incomingById.has(ex.eventId)) continue;
    if (Date.parse(ex.startDate) < now.getTime()) continue;
    removals.push(ex);
  }

  const futureCount = stored.filter(s => Date.parse(s.startDate) >= now.getTime()).length;
  const threshold = Math.max(REMOVAL_MIN, Math.floor(REMOVAL_RATIO * futureCount));
  if (removals.length > threshold) {
    return {
      applied: false,
      diff: { inserts, updates, removals, unchanged },
      haltedByThreshold: {
        reason: `Would remove ${removals.length} of ${futureCount} future events (threshold ${threshold}).`,
      },
    };
  }

  return { applied: true, diff: { inserts, updates, removals, unchanged } };
}
