// Lifecycle journeys: apply → admin approve / reject → portal access.
//
// Includes the PR #100 regression test: admin-approved events stay
// `published` across re-ingest with bumped lastModified.

jest.unmock('@aws-sdk/lib-dynamodb');
jest.unmock('@aws-sdk/client-dynamodb');

import { createHarness, feedOk, type Harness } from './harness/harness';
import { tokenFromMagicLink } from './harness/testHelpers';

function getApplyToken(h: Harness, email: string): string {
  const sent = h.mail.lastTo(email);
  if (!sent) throw new Error(`no mail captured to ${email}`);
  const url = sent.data.magicLinkUrl as string;
  return tokenFromMagicLink(url);
}

describe('publisher lifecycle', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness({ now: '2026-06-01T00:00:00Z' });
  });
  afterEach(() => {
    h.dispose();
  });

  it('walks an auto-trust publisher: apply → verify → approve → ingest publishes events as published', async () => {
    const email = 'auto@example.com';
    await h.actors.publisher.apply({
      name: 'Auto Trust',
      email,
      sourceUrl: 'https://example.com/auto.json',
      sourceType: 'json',
    });
    const token = getApplyToken(h, email);
    const verified = await h.actors.publisher.verifyApplyMagicLink(token);
    expect(verified.publisherId).toMatch(/^pub-/);

    await h.actors.admin.approveApplication(verified.publisherId);

    // Promote to auto-trust manually (admin patches the row to bypass review).
    await h.registry.upsert({
      ...((await h.registry.get(verified.publisherId))!),
      trustLevel: 'auto',
    });

    // Configure feed for this publisher.
    h.feeds.set(verified.publisherId, feedOk(verified.publisherId, 'Auto Trust', [
      { id: 'evt-1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.ingest.run();

    const states = await h.events.statesOf(verified.publisherId);
    expect(states).toEqual({ 'evt-1': 'published' });
  });

  it('walks a review-trust publisher and preserves admin-approved state across re-ingest with bumped lastModified', async () => {
    const email = 'review@example.com';
    await h.actors.publisher.apply({
      name: 'Review Trust',
      email,
      sourceUrl: 'https://example.com/review.json',
      sourceType: 'json',
    });
    const token = getApplyToken(h, email);
    const verified = await h.actors.publisher.verifyApplyMagicLink(token);
    await h.actors.admin.approveApplication(verified.publisherId);

    // First ingest with one event → state pending.
    h.feeds.set(verified.publisherId, feedOk(verified.publisherId, 'Review Trust', [
      { id: 'evt-1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-01T00:00:00Z' },
    ]));
    await h.actors.ingest.run();
    expect(await h.events.statesOf(verified.publisherId)).toEqual({ 'evt-1': 'pending' });

    // Admin approves the event.
    await h.actors.admin.approveEvent(verified.publisherId, 'evt-1');
    expect(await h.events.statesOf(verified.publisherId)).toEqual({ 'evt-1': 'published' });

    // Re-ingest with bumped lastModified — PR #100 regression: state must
    // remain 'published'.
    h.feeds.set(verified.publisherId, feedOk(verified.publisherId, 'Review Trust', [
      { id: 'evt-1', startDate: '2026-08-01T10:00:00Z', endDate: '2026-08-01T11:00:00Z', lastModified: '2026-06-02T00:00:00Z' },
    ]));
    h.now.advance(60 * 60 * 1000);
    await h.actors.ingest.run();
    expect(await h.events.statesOf(verified.publisherId)).toEqual({ 'evt-1': 'published' });
  });

  it('rejects an application: applicant gets rejection email; portal login attempt cannot create JWT', async () => {
    const email = 'rejected@example.com';
    await h.actors.publisher.apply({
      name: 'Rejected',
      email,
      sourceUrl: 'https://example.com/rejected.json',
      sourceType: 'json',
    });
    const token = getApplyToken(h, email);
    const verified = await h.actors.publisher.verifyApplyMagicLink(token);

    h.mail.clear();
    await h.actors.admin.rejectApplication(verified.publisherId, 'Not relevant');

    const rejectMail = h.mail.byKind('rejection');
    expect(rejectMail).toHaveLength(1);
    expect(rejectMail[0].to).toBe(email);

    // Pending → rejected: portal-status calls succeed but applicationStatus = 'rejected'.
    const session = await h.signSession(verified.publisherId);
    const status = await h.actors.publisher.status(session);
    expect(status.publisher.applicationStatus).toBe('rejected');

    // Authenticated mutations are gated to approved publishers — pause is 403.
    await expect(h.actors.publisher.pause(session)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('refuses a duplicate-email apply: second apply with the same email is rejected', async () => {
    const email = 'dup@example.com';
    await h.actors.publisher.apply({
      name: 'First',
      email,
      sourceUrl: 'https://example.com/first.json',
      sourceType: 'json',
    });
    const token = getApplyToken(h, email);
    await h.actors.publisher.verifyApplyMagicLink(token);

    // Second apply with the same email → 400.
    await expect(h.actors.publisher.apply({
      name: 'Second',
      email,
      sourceUrl: 'https://example.com/second.json',
      sourceType: 'json',
    })).rejects.toMatchObject({ statusCode: 400 });
  });
});
