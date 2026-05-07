import { reconcile } from '../services/publisherReconciler';
import type { StoredPublisherEvent } from '../types/publisher';
import type { FeedDocument } from '@chq-calendar/publisher-format';

const NOW = new Date('2026-06-01T00:00:00Z');

function ev(
  id: string,
  start: string,
  lastMod: string,
  state: 'published' | 'pending' | 'rejected' = 'published',
  rejectionReason?: string,
  rejectedAt?: string,
): StoredPublisherEvent {
  const result: StoredPublisherEvent = {
    publisherId: 'p',
    eventId: id,
    startDate: start,
    endDate: start,
    lastModified: lastMod,
    payload: {
      id,
      title: id,
      startDate: start,
      endDate: start,
      category: 'Lecture',
      lastModified: lastMod,
      sourcePublisherId: 'p',
      sourcePublisherName: 'P',
    } as any,
    state,
    updatedAt: lastMod,
  };
  if (rejectionReason) result.rejectionReason = rejectionReason;
  if (rejectedAt) result.rejectedAt = rejectedAt;
  return result;
}

function feed(events: any[]): FeedDocument {
  return {
    formatVersion: '1.0',
    publisher: { id: 'p', name: 'P', contactEmail: 'a@b' },
    events,
  } as FeedDocument;
}

describe('reconcile', () => {
  it('inserts new events', () => {
    const r = reconcile({
      stored: [],
      feed: feed([{ id: 'a', title: 'A', startDate: '2026-07-01T00:00:00-04:00', endDate: '2026-07-01T01:00:00-04:00', category: 'Lecture', lastModified: '2026-05-01T00:00:00-04:00' }]),
      now: NOW,
      trustLevel: 'auto',
    });
    expect(r.applied).toBe(true);
    expect(r.diff.inserts).toHaveLength(1);
    expect(r.diff.inserts[0].state).toBe('published');
  });

  it('updates an event when lastModified is newer', () => {
    const stored = [ev('a', '2026-07-01T00:00:00-04:00', '2026-04-01T00:00:00-04:00')];
    const r = reconcile({
      stored,
      feed: feed([{ id: 'a', title: 'A', startDate: '2026-07-01T00:00:00-04:00', endDate: '2026-07-01T01:00:00-04:00', category: 'Lecture', lastModified: '2026-05-01T00:00:00-04:00' }]),
      now: NOW,
      trustLevel: 'auto',
    });
    expect(r.diff.updates).toHaveLength(1);
    expect(r.diff.updates[0].state).toBe('published');
  });

  it('counts unchanged when feed lastModified is not newer', () => {
    const stored = [ev('a', '2026-07-01T00:00:00-04:00', '2026-05-01T00:00:00-04:00')];
    const r = reconcile({
      stored,
      feed: feed([{ id: 'a', title: 'A', startDate: '2026-07-01T00:00:00-04:00', endDate: '2026-07-01T01:00:00-04:00', category: 'Lecture', lastModified: '2026-05-01T00:00:00-04:00' }]),
      now: NOW,
      trustLevel: 'auto',
    });
    expect(r.diff.updates).toHaveLength(0);
    expect(r.diff.unchanged).toBe(1);
  });

  it('does NOT remove past stored events absent from the feed', () => {
    const stored = [ev('past', '2026-04-01T00:00:00-04:00', '2026-03-01T00:00:00-04:00')];
    const r = reconcile({ stored, feed: feed([]), now: NOW, trustLevel: 'auto' });
    expect(r.diff.removals).toHaveLength(0);
  });

  it('removes future stored events absent from the feed', () => {
    const stored = [ev('future', '2026-08-01T00:00:00-04:00', '2026-04-01T00:00:00-04:00')];
    const r = reconcile({ stored, feed: feed([]), now: NOW, trustLevel: 'auto' });
    expect(r.diff.removals).toHaveLength(1);
  });

  it('halts when removals exceed max(50% of future, 5)', () => {
    const stored = Array.from({ length: 20 }, (_, i) =>
      ev(`f${i}`, '2026-08-01T00:00:00-04:00', '2026-04-01T00:00:00-04:00'),
    );
    const r = reconcile({ stored, feed: feed([]), now: NOW, trustLevel: 'auto' });
    expect(r.applied).toBe(false);
    expect(r.haltedByThreshold).toBeDefined();
  });

  it('does NOT halt when removals stay below threshold', () => {
    const stored = Array.from({ length: 20 }, (_, i) =>
      ev(`f${i}`, '2026-08-01T00:00:00-04:00', '2026-04-01T00:00:00-04:00'),
    );
    const incoming = stored.slice(0, 18).map(s => ({
      id: s.eventId,
      title: 'T',
      startDate: s.startDate,
      endDate: s.endDate,
      category: 'Lecture',
      lastModified: '2026-04-01T00:00:00-04:00',
    }));
    const r = reconcile({ stored, feed: feed(incoming), now: NOW, trustLevel: 'auto' });
    expect(r.applied).toBe(true);
    expect(r.diff.removals).toHaveLength(2);
  });

  it('routes to pending when trustLevel is review', () => {
    const r = reconcile({
      stored: [],
      feed: feed([{ id: 'a', title: 'A', startDate: '2026-07-01T00:00:00-04:00', endDate: '2026-07-01T01:00:00-04:00', category: 'Lecture', lastModified: '2026-05-01T00:00:00-04:00' }]),
      now: NOW,
      trustLevel: 'review',
    });
    expect(r.diff.inserts[0].state).toBe('pending');
  });

  it('updates stored event when trust-level promotes pending → published', () => {
    const stored = [ev('a', '2026-07-01T00:00:00-04:00', '2026-05-01T00:00:00-04:00', 'pending')];
    const r = reconcile({
      stored,
      feed: feed([{ id: 'a', title: 'A', startDate: '2026-07-01T00:00:00-04:00', endDate: '2026-07-01T01:00:00-04:00', category: 'Lecture', lastModified: '2026-05-01T00:00:00-04:00' }]),
      now: NOW,
      trustLevel: 'auto',
    });
    expect(r.diff.updates).toHaveLength(1);
    expect(r.diff.updates[0].state).toBe('published');
  });

  it('preserves published state on trust-level demotion (auto → review)', () => {
    const stored = [ev('a', '2026-07-01T00:00:00-04:00', '2026-05-01T00:00:00-04:00', 'published')];
    const r = reconcile({
      stored,
      feed: feed([{ id: 'a', title: 'A', startDate: '2026-07-01T00:00:00-04:00', endDate: '2026-07-01T01:00:00-04:00', category: 'Lecture', lastModified: '2026-05-01T00:00:00-04:00' }]),
      now: NOW,
      trustLevel: 'review',
    });
    expect(r.diff.updates).toHaveLength(0);
    expect(r.diff.unchanged).toBe(1);
  });

  it('preserves admin-approved published state across re-ingest with newer lastModified (review trust)', () => {
    const stored = [ev('a', '2026-07-01T00:00:00-04:00', '2026-04-01T00:00:00-04:00', 'published')];
    const r = reconcile({
      stored,
      feed: feed([{ id: 'a', title: 'A', startDate: '2026-07-01T00:00:00-04:00', endDate: '2026-07-01T01:00:00-04:00', category: 'Lecture', lastModified: '2026-05-01T00:00:00-04:00' }]),
      now: NOW,
      trustLevel: 'review',
    });
    expect(r.diff.updates).toHaveLength(1);
    expect(r.diff.updates[0].state).toBe('published');
  });

  it('counts unchanged for an admin-approved event re-emitted with same lastModified (review trust)', () => {
    const stored = [ev('a', '2026-07-01T00:00:00-04:00', '2026-05-01T00:00:00-04:00', 'published')];
    const r = reconcile({
      stored,
      feed: feed([{ id: 'a', title: 'A', startDate: '2026-07-01T00:00:00-04:00', endDate: '2026-07-01T01:00:00-04:00', category: 'Lecture', lastModified: '2026-05-01T00:00:00-04:00' }]),
      now: NOW,
      trustLevel: 'review',
    });
    expect(r.diff.updates).toHaveLength(0);
    expect(r.diff.unchanged).toBe(1);
  });

  it('preserves admin-approved published state when trustLevel is flagged', () => {
    const stored = [ev('a', '2026-07-01T00:00:00-04:00', '2026-04-01T00:00:00-04:00', 'published')];
    const r = reconcile({
      stored,
      feed: feed([{ id: 'a', title: 'A', startDate: '2026-07-01T00:00:00-04:00', endDate: '2026-07-01T01:00:00-04:00', category: 'Lecture', lastModified: '2026-05-01T00:00:00-04:00' }]),
      now: NOW,
      trustLevel: 'flagged',
    });
    expect(r.diff.updates).toHaveLength(1);
    expect(r.diff.updates[0].state).toBe('published');
  });

  it('routes to pending when trustLevel is flagged', () => {
    const r = reconcile({
      stored: [],
      feed: feed([{ id: 'a', title: 'A', startDate: '2026-07-01T00:00:00-04:00', endDate: '2026-07-01T01:00:00-04:00', category: 'Lecture', lastModified: '2026-05-01T00:00:00-04:00' }]),
      now: NOW,
      trustLevel: 'flagged',
    });
    expect(r.diff.inserts[0].state).toBe('pending');
  });

  it('enriches payload with sourcePublisherId and sourcePublisherName', () => {
    const r = reconcile({
      stored: [],
      feed: feed([{ id: 'a', title: 'A', startDate: '2026-07-01T00:00:00-04:00', endDate: '2026-07-01T01:00:00-04:00', category: 'Lecture', lastModified: '2026-05-01T00:00:00-04:00' }]),
      now: NOW,
      trustLevel: 'auto',
    });
    expect(r.diff.inserts[0].payload.sourcePublisherId).toBe('p');
    expect(r.diff.inserts[0].payload.sourcePublisherName).toBe('P');
  });

  it('preserves admin-rejected state across re-ingest with newer lastModified (review trust)', () => {
    const stored = [
      ev(
        'a',
        '2026-07-01T00:00:00-04:00',
        '2026-04-01T00:00:00-04:00',
        'rejected',
        'duplicate of city-hall keynote',
        '2026-05-02T10:00:00.000Z',
      ),
    ];
    const r = reconcile({
      stored,
      feed: feed([{ id: 'a', title: 'A', startDate: '2026-07-01T00:00:00-04:00', endDate: '2026-07-01T01:00:00-04:00', category: 'Lecture', lastModified: '2026-05-01T00:00:00-04:00' }]),
      now: NOW,
      trustLevel: 'review',
    });
    expect(r.applied).toBe(true);
    expect(r.diff.updates).toHaveLength(1);
    const updated = r.diff.updates[0]!;
    expect(updated.state).toBe('rejected');
    expect(updated.rejectionReason).toBe('duplicate of city-hall keynote');
    expect(updated.rejectedAt).toBe('2026-05-02T10:00:00.000Z');
  });

  it('preserves admin-rejected state when trustLevel is auto (rejection sticks regardless)', () => {
    const stored = [
      ev(
        'a',
        '2026-07-01T00:00:00-04:00',
        '2026-04-01T00:00:00-04:00',
        'rejected',
        'off-topic content',
        '2026-05-01T14:30:00.000Z',
      ),
    ];
    const r = reconcile({
      stored,
      feed: feed([{ id: 'a', title: 'A', startDate: '2026-07-01T00:00:00-04:00', endDate: '2026-07-01T01:00:00-04:00', category: 'Lecture', lastModified: '2026-05-05T00:00:00-04:00' }]),
      now: NOW,
      trustLevel: 'auto',
    });
    expect(r.applied).toBe(true);
    expect(r.diff.updates).toHaveLength(1);
    const updated = r.diff.updates[0]!;
    expect(updated.state).toBe('rejected');
    expect(updated.rejectionReason).toBe('off-topic content');
    expect(updated.rejectedAt).toBe('2026-05-01T14:30:00.000Z');
  });

  it('publisher dropping a rejected event from feed produces a normal removal', () => {
    const stored = [
      ev('a', '2026-08-01T00:00:00-04:00', '2026-04-01T00:00:00-04:00', 'rejected', 'spam', '2026-05-01T10:00:00.000Z'),
    ];
    const r = reconcile({ stored, feed: feed([]), now: NOW, trustLevel: 'review' });
    expect(r.applied).toBe(true);
    expect(r.diff.removals).toHaveLength(1);
    expect(r.diff.removals[0]!.eventId).toBe('a');
    expect(r.diff.removals[0]!.state).toBe('rejected');
  });
});
