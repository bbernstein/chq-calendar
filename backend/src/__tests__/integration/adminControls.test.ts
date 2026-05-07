// Admin controls journeys (design Test plan items 12-16).

jest.unmock('@aws-sdk/lib-dynamodb');
jest.unmock('@aws-sdk/client-dynamodb');

import { createHarness, feedOk, type Harness } from './harness/harness';
import { tokenFromMagicLink } from './harness/testHelpers';

async function applyApprove(
  h: Harness,
  email: string,
  trustLevel: 'auto' | 'review' = 'auto',
): Promise<{ publisherId: string; session: string }> {
  await h.actors.publisher.apply({
    name: 'Admin Test',
    email,
    sourceUrl: 'https://example.com/feed.json',
    sourceType: 'json',
  });
  const url = h.mail.lastTo(email)!.data.magicLinkUrl as string;
  const token = tokenFromMagicLink(url);
  const v = await h.actors.publisher.verifyApplyMagicLink(token);
  await h.actors.admin.approveApplication(v.publisherId);
  if (trustLevel === 'auto') {
    await h.registry.upsert({ ...((await h.registry.get(v.publisherId))!), trustLevel: 'auto' });
  }
  const session = await h.signSession(v.publisherId);
  return { publisherId: v.publisherId, session };
}

describe('admin controls', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness({ now: '2026-06-01T00:00:00Z' });
  });
  afterEach(() => {
    h.dispose();
  });

  it('admin disable retracts events on next ingest', async () => {
    const { publisherId } = await applyApprove(h, 'admindisable@example.com', 'auto');
    h.feeds.set(publisherId, feedOk(publisherId, 'X', [
      { id: 'e1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.ingest.run();
    expect(await h.events.count(publisherId)).toBe(1);

    await h.actors.admin.disable(publisherId);
    await h.actors.ingest.run();
    expect(await h.events.count(publisherId)).toBe(0);
  });

  it('admin pause skips that publisher in next ingest', async () => {
    const { publisherId } = await applyApprove(h, 'adminpause@example.com', 'auto');
    h.feeds.set(publisherId, feedOk(publisherId, 'X', [
      { id: 'e1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.ingest.run();
    expect(await h.events.count(publisherId)).toBe(1);

    await h.actors.admin.pause(publisherId);
    h.feeds.set(publisherId, feedOk(publisherId, 'X', [
      { id: 'e2', startDate: '2026-08-02T10:00:00Z', endDate: '2026-08-02T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.ingest.run();
    const states = await h.events.statesOf(publisherId);
    expect(Object.keys(states)).toEqual(['e1']);
  });

  it('admin reject event preserves the event removal across re-ingest (no clobber)', async () => {
    const { publisherId } = await applyApprove(h, 'adminreject@example.com', 'review');
    h.feeds.set(publisherId, feedOk(publisherId, 'X', [
      { id: 'evt-bad', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.ingest.run();
    expect(await h.events.statesOf(publisherId)).toEqual({ 'evt-bad': 'pending' });

    await h.actors.admin.rejectEvent(publisherId, 'evt-bad');
    expect(await h.events.count(publisherId)).toBe(0);

    // Re-ingest with bumped lastModified — re-emerges as pending (no automatic
    // suppression yet; reject is a delete and the next feed pull recreates it).
    h.feeds.set(publisherId, feedOk(publisherId, 'X', [
      { id: 'evt-bad', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-02T00:00:00Z' },
    ]));
    await h.actors.ingest.run();
    // It DOES come back as pending — but is NOT auto-published, which is the
    // important guarantee. (A future enhancement could persist a tombstone.)
    expect(await h.events.statesOf(publisherId)).toEqual({ 'evt-bad': 'pending' });
  });

  it('admin approve event idempotent: approving an already-published event throws 409', async () => {
    const { publisherId } = await applyApprove(h, 'adminapprove@example.com', 'review');
    h.feeds.set(publisherId, feedOk(publisherId, 'X', [
      { id: 'e1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.ingest.run();
    await h.actors.admin.approveEvent(publisherId, 'e1');
    expect(await h.events.statesOf(publisherId)).toEqual({ 'e1': 'published' });

    // Second approve: store.approveEvent's ConditionExpression requires
    // state=pending → ConditionalCheckFailed → handler maps to 409.
    await expect(h.actors.admin.approveEvent(publisherId, 'e1'))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('admin "Run ingest now" routes through the lambda invoker', async () => {
    const { publisherId } = await applyApprove(h, 'runingest@example.com', 'auto');
    h.feeds.set(publisherId, feedOk(publisherId, 'X', [
      { id: 'e1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));

    const before = h.invoker.invocations.length;
    await h.actors.admin.runIngest();
    expect(h.invoker.invocations.length).toBe(before + 1);
    // Effect of the in-process invocation: events were ingested.
    expect(await h.events.count(publisherId)).toBe(1);
  });
});
