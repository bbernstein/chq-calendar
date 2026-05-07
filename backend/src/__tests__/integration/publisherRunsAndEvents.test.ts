// Integration coverage for publisher observability endpoints (Task 20):
//   GET /publisher-runs   — last N ingest run rows for the calling publisher
//   GET /publisher-events — the calling publisher's events (all states)
// Plus the admin-reject-with-reason → notification email path, end-to-end.

jest.unmock('@aws-sdk/lib-dynamodb');
jest.unmock('@aws-sdk/client-dynamodb');

import { createHarness, feedOk, type Harness } from './harness/harness';
import { tokenFromMagicLink } from './harness/testHelpers';

async function applyApproveAndSession(
  h: Harness,
  email: string,
  name = 'Test',
  sourceUrl = 'https://example.com/feed.json',
): Promise<{ publisherId: string; session: string }> {
  await h.actors.publisher.apply({ name, email, sourceUrl, sourceType: 'json' });
  const url = h.mail.lastTo(email)!.data.magicLinkUrl as string;
  const token = tokenFromMagicLink(url);
  const v = await h.actors.publisher.verifyApplyMagicLink(token);
  await h.actors.admin.approveApplication(v.publisherId);
  const session = await h.signSession(v.publisherId);
  return { publisherId: v.publisherId, session };
}

describe('publisher observability — /publisher-runs and /publisher-events', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness({ now: '2026-06-01T00:00:00Z' });
  });
  afterEach(() => {
    h.dispose();
  });

  it('returns runs and events scoped to the JWT publisher', async () => {
    const { publisherId, session } = await applyApproveAndSession(h, 'obs1@example.com');
    // Auto-trust so events publish without admin approval.
    await h.registry.upsert({ ...((await h.registry.get(publisherId))!), trustLevel: 'auto' });
    h.feeds.set(publisherId, feedOk(publisherId, 'P', [
      { id: 'e1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
      { id: 'e2', startDate: '2026-08-02T10:00:00Z', endDate: '2026-08-02T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.ingest.run();

    const runsResp = await h.actors.publisher.runs(session);
    expect(runsResp.runs.length).toBe(1);
    expect(runsResp.runs[0].publisherId).toBe(publisherId);
    expect(runsResp.runs[0].status).toBe('ok');
    expect(runsResp.runs[0].counts).toEqual({ added: 2, updated: 0, retracted: 0, unchanged: 0 });

    const eventsResp = await h.actors.publisher.events(session);
    expect(eventsResp.events.length).toBe(2);
    for (const e of eventsResp.events) {
      expect(e.state).toBe('published');
      expect(typeof e.title).toBe('string');
      // The full feed payload should NOT leak into the response.
      expect((e as any).payload).toBeUndefined();
    }
  });

  it('cross-publisher isolation: pub-A JWT cannot see pub-B events or runs', async () => {
    const a = await applyApproveAndSession(h, 'a@example.com', 'A');
    const b = await applyApproveAndSession(h, 'b@example.com', 'B');
    await h.registry.upsert({ ...((await h.registry.get(a.publisherId))!), trustLevel: 'auto' });
    await h.registry.upsert({ ...((await h.registry.get(b.publisherId))!), trustLevel: 'auto' });
    h.feeds.set(a.publisherId, feedOk(a.publisherId, 'A', [
      { id: 'a1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    h.feeds.set(b.publisherId, feedOk(b.publisherId, 'B', [
      { id: 'b1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
      { id: 'b2', startDate: '2026-08-02T10:00:00Z', endDate: '2026-08-02T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.ingest.run();

    const aEvents = await h.actors.publisher.events(a.session);
    expect(aEvents.events.map((e: any) => e.eventId).sort()).toEqual(['a1']);

    const bEvents = await h.actors.publisher.events(b.session);
    expect(bEvents.events.map((e: any) => e.eventId).sort()).toEqual(['b1', 'b2']);

    const aRuns = await h.actors.publisher.runs(a.session);
    expect(aRuns.runs.every((r: any) => r.publisherId === a.publisherId)).toBe(true);

    const bRuns = await h.actors.publisher.runs(b.session);
    expect(bRuns.runs.every((r: any) => r.publisherId === b.publisherId)).toBe(true);
  });

  it('runs reflect streak transitions: ok → fail → ok', async () => {
    const { publisherId, session } = await applyApproveAndSession(h, 'streak@example.com');
    await h.registry.upsert({ ...((await h.registry.get(publisherId))!), trustLevel: 'auto' });
    h.feeds.set(publisherId, feedOk(publisherId, 'P', [
      { id: 'e1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.ingest.run();

    // Advance clock so the second run gets a distinct runAt sort key.
    h.now.advance(60_000);

    // Simulate a fetch failure by overwriting the feed fixture with a
    // network_error response. The harness FakeFeedFetcher returns whatever
    // was last set for a given publisherId.
    h.feeds.set(publisherId, {
      fetchStatus: 'network_error',
      feed: null,
      report: { ok: false, errors: [{ path: '/', message: 'simulated failure' }], warnings: [] },
    });
    await h.actors.ingest.run();

    // Advance clock again and restore the working feed.
    h.now.advance(60_000);
    h.feeds.set(publisherId, feedOk(publisherId, 'P', [
      { id: 'e1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.ingest.run();

    const runs = await h.actors.publisher.runs(session);
    expect(runs.runs.length).toBe(3);
    // listRecentRuns returns newest-first (ScanIndexForward: false).
    expect(runs.runs[0].status).toBe('ok');
    expect(runs.runs[1].status).not.toBe('ok');
    expect(runs.runs[2].status).toBe('ok');
  });

  it('admin reject with reason: event becomes state=rejected with reason; notification email captured', async () => {
    const { publisherId } = await applyApproveAndSession(h, 'reject@example.com');
    // Use review trustLevel so events stay state='pending' awaiting admin action.
    await h.registry.upsert({ ...((await h.registry.get(publisherId))!), trustLevel: 'review' });
    h.feeds.set(publisherId, feedOk(publisherId, 'P', [
      { id: 'e1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.ingest.run();

    h.mail.clear();

    await h.actors.admin.rejectEvent(publisherId, 'e1', 'duplicate of upstream feed');

    // The stored row should now be state='rejected' with the reason preserved.
    const states = await h.events.statesOf(publisherId);
    expect(states['e1']).toBe('rejected');

    // The publisher contactEmail should have received an event_rejected mail.
    const sent = h.mail.lastTo('reject@example.com');
    expect(sent).toBeTruthy();
    expect(sent!.kind).toBe('event_rejected');
    expect(sent!.data.reason).toBe('duplicate of upstream feed');
  });

  it('admin reject without reason: event becomes state=rejected; notification email sent with no reason', async () => {
    const { publisherId } = await applyApproveAndSession(h, 'reject2@example.com');
    await h.registry.upsert({ ...((await h.registry.get(publisherId))!), trustLevel: 'review' });
    h.feeds.set(publisherId, feedOk(publisherId, 'P', [
      { id: 'e1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.ingest.run();

    h.mail.clear();
    await h.actors.admin.rejectEvent(publisherId, 'e1');

    const states = await h.events.statesOf(publisherId);
    expect(states['e1']).toBe('rejected');

    // Notification still sent (notificationsEnabled defaults to true).
    const sent = h.mail.lastTo('reject2@example.com');
    expect(sent).toBeTruthy();
    expect(sent!.kind).toBe('event_rejected');
    // reason field should be absent or undefined when no reason provided.
    expect(sent!.data.reason).toBeUndefined();
  });

  it('notificationsEnabled=false suppresses emails on admin reject', async () => {
    const { publisherId } = await applyApproveAndSession(h, 'silent@example.com');
    await h.registry.upsert({
      ...((await h.registry.get(publisherId))!),
      trustLevel: 'review',
      notificationsEnabled: false,
    });
    h.feeds.set(publisherId, feedOk(publisherId, 'P', [
      { id: 'e1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.ingest.run();

    h.mail.clear();
    await h.actors.admin.rejectEvent(publisherId, 'e1', 'reason');

    expect(h.mail.lastTo('silent@example.com')).toBeUndefined();
  });

  it('PATCH /publisher-profile { notificationsEnabled: false } persists', async () => {
    const { publisherId, session } = await applyApproveAndSession(h, 'toggle@example.com');
    const updated = await h.actors.publisher.updateProfile(session, { notificationsEnabled: false });
    expect(updated.publisher.notificationsEnabled).toBe(false);
    const fresh = (await h.registry.get(publisherId))!;
    expect(fresh.notificationsEnabled).toBe(false);
  });
});
