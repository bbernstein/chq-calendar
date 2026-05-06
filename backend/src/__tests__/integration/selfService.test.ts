// Self-service portal journeys (design Test plan items 5-11).
//
// Includes the PR #78 regression test: self-disable retracts events on next
// ingest run.

jest.unmock('@aws-sdk/lib-dynamodb');
jest.unmock('@aws-sdk/client-dynamodb');

import { createHarness, feedOk, type Harness } from './harness/harness';

async function applyApproveAndSession(
  h: Harness,
  email: string,
  name = 'Test',
  sourceUrl = 'https://example.com/feed.json',
): Promise<{ publisherId: string; session: string }> {
  await h.actors.publisher.apply({ name, email, sourceUrl, sourceType: 'json' });
  const url = h.mail.lastTo(email)!.data.magicLinkUrl as string;
  const token = new URL(url).searchParams.get('token')!;
  const v = await h.actors.publisher.verifyApplyMagicLink(token);
  await h.actors.admin.approveApplication(v.publisherId);
  const session = await h.signSession(v.publisherId);
  return { publisherId: v.publisherId, session };
}

describe('publisher self-service portal', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness({ now: '2026-06-01T00:00:00Z' });
  });
  afterEach(() => {
    h.dispose();
  });

  it('pause skips that publisher in next ingest; resume re-enables', async () => {
    const { publisherId, session } = await applyApproveAndSession(h, 'pause@example.com');
    // Promote to auto-trust so events publish without admin intervention.
    await h.registry.upsert({ ...((await h.registry.get(publisherId))!), trustLevel: 'auto' });
    h.feeds.set(publisherId, feedOk(publisherId, 'P', [
      { id: 'e1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.ingest.run();
    expect(await h.events.count(publisherId)).toBe(1);

    // Pause via portal. Subsequent ingest should leave events untouched but
    // also not pull from the feed (we change the feed to verify).
    await h.actors.publisher.pause(session);
    h.feeds.set(publisherId, feedOk(publisherId, 'P', [
      { id: 'e2', startDate: '2026-08-02T10:00:00Z', endDate: '2026-08-02T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.ingest.run();
    const states = await h.events.statesOf(publisherId);
    expect(Object.keys(states)).toEqual(['e1']);

    // Resume → ingest pulls feed (now containing both e1 and e2).
    h.feeds.set(publisherId, feedOk(publisherId, 'P', [
      { id: 'e1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
      { id: 'e2', startDate: '2026-08-02T10:00:00Z', endDate: '2026-08-02T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.publisher.resume(session);
    await h.actors.ingest.run();
    const after = await h.events.statesOf(publisherId);
    expect(Object.keys(after).sort()).toEqual(['e1', 'e2']);
  });

  it('updates profile name; rejects malformed input', async () => {
    const { session } = await applyApproveAndSession(h, 'profile@example.com');
    const r = await h.actors.publisher.updateProfile(session, { name: 'New Name' });
    expect(r.publisher.name).toBe('New Name');

    // Empty name is rejected.
    await expect(h.actors.publisher.updateProfile(session, { name: '' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('walks email change: request → confirm with magic link → re-using the link fails', async () => {
    const { session } = await applyApproveAndSession(h, 'old@example.com');
    h.mail.clear();
    await h.actors.publisher.requestEmailChange(session, 'new@example.com');

    const verifyMail = h.mail.lastTo('new@example.com');
    expect(verifyMail?.kind).toBe('email_change_verify');
    const verifyUrl = verifyMail!.data.verifyUrl as string;
    const verifyToken = new URL(verifyUrl).searchParams.get('token')!;

    const result = await h.actors.publisher.confirmEmailChange(verifyToken);
    expect(result.kind).toBe('ok');
    expect(result.newEmail).toBe('new@example.com');

    // Replay the same token → already_used.
    const replay = await h.actors.publisher.confirmEmailChange(verifyToken);
    expect(replay.kind).toBe('already_used');
  });

  it('cancels email change via the old-address link; later confirm with the same verify token fails', async () => {
    const { session } = await applyApproveAndSession(h, 'old@example.com');
    h.mail.clear();
    await h.actors.publisher.requestEmailChange(session, 'new@example.com');
    const verifyToken = new URL((h.mail.lastTo('new@example.com')!.data.verifyUrl as string)).searchParams.get('token')!;
    const cancelToken = new URL((h.mail.lastTo('old@example.com')!.data.cancelUrl as string)).searchParams.get('token')!;

    const cancelResult = await h.actors.publisher.cancelEmailChangeByOld(cancelToken);
    expect(cancelResult.kind).toBe('ok');

    const result = await h.actors.publisher.confirmEmailChange(verifyToken);
    expect(result.kind).toBe('already_used');
  });

  it('self-disable retracts events on next ingest (PR #78)', async () => {
    const { publisherId, session } = await applyApproveAndSession(h, 'disable@example.com');
    await h.registry.upsert({ ...((await h.registry.get(publisherId))!), trustLevel: 'auto' });
    h.feeds.set(publisherId, feedOk(publisherId, 'D', [
      { id: 'e1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.ingest.run();
    expect(await h.events.count(publisherId)).toBe(1);

    // Self-disable.
    await h.actors.publisher.selfDisable(session, publisherId);

    // Next ingest retracts events.
    await h.actors.ingest.run();
    expect(await h.events.count(publisherId)).toBe(0);
  });

  it('self-disable typed-slug mismatch returns 400; publisher remains enabled', async () => {
    const { publisherId, session } = await applyApproveAndSession(h, 'mismatch@example.com');

    await expect(h.actors.publisher.selfDisable(session, 'wrong-slug'))
      .rejects.toMatchObject({ statusCode: 400 });

    const pub = await h.registry.get(publisherId);
    expect(pub?.enabled).toBe(true);
  });

  it('fetch-now invokes ingest in-process via FakeLambdaInvoker', async () => {
    const { publisherId, session } = await applyApproveAndSession(h, 'fetch@example.com');
    await h.registry.upsert({ ...((await h.registry.get(publisherId))!), trustLevel: 'auto' });
    h.feeds.set(publisherId, feedOk(publisherId, 'F', [
      { id: 'e1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.publisher.fetchNow(session);
    // The fake invoker triggers runIngest in-process; the event should be there.
    expect(await h.events.count(publisherId)).toBe(1);
    expect(h.invoker.invocations).toHaveLength(1);
    expect(h.invoker.invocations[0].payload).toMatchObject({ singlePublisherId: publisherId });
  });
});
