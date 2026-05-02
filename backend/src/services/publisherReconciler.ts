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
): StoredPublisherEvent {
  return {
    publisherId: publisher.id,
    eventId: ev.id,
    startDate: ev.startDate,
    endDate: ev.endDate,
    lastModified: ev.lastModified,
    payload: { ...ev, sourcePublisherId: publisher.id, sourcePublisherName: publisher.name },
    state: trustLevel === 'auto' ? 'published' : 'pending',
    updatedAt: nowIso,
  };
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
    const newRec = toStored(inc, feed.publisher, trustLevel, nowIso);
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
