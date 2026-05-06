// Ingest edge cases (design Test plan items 17-21).

jest.unmock('@aws-sdk/lib-dynamodb');
jest.unmock('@aws-sdk/client-dynamodb');

import { createHarness, feedOk, type Harness } from './harness/harness';

async function applyApprove(h: Harness, email: string): Promise<{ publisherId: string }> {
  await h.actors.publisher.apply({
    name: 'Edge',
    email,
    sourceUrl: 'https://example.com/feed.json',
    sourceType: 'json',
  });
  const url = h.mail.lastTo(email)!.data.magicLinkUrl as string;
  const token = new URL(url).searchParams.get('token')!;
  const v = await h.actors.publisher.verifyApplyMagicLink(token);
  await h.actors.admin.approveApplication(v.publisherId);
  await h.registry.upsert({ ...((await h.registry.get(v.publisherId))!), trustLevel: 'auto' });
  return { publisherId: v.publisherId };
}

describe('ingest edge cases', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness({ now: '2026-06-01T00:00:00Z' });
  });
  afterEach(() => {
    h.dispose();
  });

  it('records network_error when fetcher reports network failure; preserves prior events', async () => {
    const { publisherId } = await applyApprove(h, 'neterr@example.com');
    h.feeds.set(publisherId, feedOk(publisherId, 'N', [
      { id: 'e1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.ingest.run();
    expect(await h.events.count(publisherId)).toBe(1);

    h.feeds.set(publisherId, {
      fetchStatus: 'network_error',
      feed: null,
      report: { ok: false, errors: [{ path: '/', message: 'ECONNREFUSED' }], warnings: [] },
    });
    await h.actors.ingest.run();
    const pub = await h.registry.get(publisherId);
    expect(pub?.lastFetchStatus).toBe('network_error');
    expect(await h.events.count(publisherId)).toBe(1);
  });

  it('records validation_error when fetcher reports schema-invalid; no diff', async () => {
    const { publisherId } = await applyApprove(h, 'validerr@example.com');
    h.feeds.set(publisherId, feedOk(publisherId, 'V', [
      { id: 'e1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.ingest.run();
    expect(await h.events.count(publisherId)).toBe(1);

    h.feeds.set(publisherId, {
      fetchStatus: 'validation_error',
      feed: null,
      report: { ok: false, errors: [{ path: '/events/0/title', message: 'required' }], warnings: [] },
    });
    await h.actors.ingest.run();
    const pub = await h.registry.get(publisherId);
    expect(pub?.lastFetchStatus).toBe('validation_error');
    expect(await h.events.count(publisherId)).toBe(1);
  });

  it('unchanged feed (same lastModified): no state changes; updates timestamps', async () => {
    const { publisherId } = await applyApprove(h, 'unchanged@example.com');
    const evt = { id: 'e1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' };
    h.feeds.set(publisherId, feedOk(publisherId, 'U', [evt]));
    await h.actors.ingest.run();
    const before = (await h.store.listForPublisher(publisherId))[0];

    // Re-ingest same event with same lastModified → no diff applied to it.
    await h.actors.ingest.run();
    const after = (await h.store.listForPublisher(publisherId))[0];
    expect(after.updatedAt).toBe(before.updatedAt); // unchanged → no write
  });

  it('threshold halt: feed shrinks below threshold → setThresholdHalt called; events untouched', async () => {
    const { publisherId } = await applyApprove(h, 'halt@example.com');
    // Seed 10 future events.
    const events = Array.from({ length: 10 }, (_, i) => ({
      id: `e${i}`,
      startDate: `2026-08-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
      endDate: `2026-08-${String(i + 1).padStart(2, '0')}T11:00:00Z`,
      lastModified: '2026-06-01T00:00:00Z',
    }));
    h.feeds.set(publisherId, feedOk(publisherId, 'H', events));
    await h.actors.ingest.run();
    expect(await h.events.count(publisherId)).toBe(10);

    // Shrink to 1 event — removes 9 of 10 future events, well over the 50% threshold.
    h.feeds.set(publisherId, feedOk(publisherId, 'H', [events[0]]));
    await h.actors.ingest.run();
    const pub = await h.registry.get(publisherId);
    expect(pub?.pendingThresholdHalt).toBeDefined();
    expect(pub?.lastFetchStatus).toBe('threshold_halt');
    expect(await h.events.count(publisherId)).toBe(10);
  });

  it('disabled publisher: ingest retracts (skipping reconcile entirely)', async () => {
    const { publisherId } = await applyApprove(h, 'disabled@example.com');
    h.feeds.set(publisherId, feedOk(publisherId, 'D', [
      { id: 'e1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.ingest.run();
    expect(await h.events.count(publisherId)).toBe(1);

    await h.actors.admin.disable(publisherId);
    await h.actors.ingest.run();
    expect(await h.events.count(publisherId)).toBe(0);
  });
});
