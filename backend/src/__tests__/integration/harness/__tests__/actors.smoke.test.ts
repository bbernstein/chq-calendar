// Plumbing-only smoke for each actor method. Hits each method with valid
// inputs and asserts it doesn't throw. Behavior verification lives in the
// journey-shaped test files.

jest.unmock('@aws-sdk/lib-dynamodb');
jest.unmock('@aws-sdk/client-dynamodb');

process.env.AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';

import { createHarness, feedOk } from '../harness';
import { tokenFromMagicLink } from '../testHelpers';

describe('actors', () => {
  it('publisher and admin methods route through handlers without throwing', async () => {
    const h = await createHarness({ now: '2026-06-01T00:00:00Z' });
    try {
      // Publisher actor: apply.
      await h.actors.publisher.apply({
        name: 'X',
        email: 'x@example.com',
        sourceUrl: 'https://example.com/feed.json',
        sourceType: 'json',
      });

      // Verify magic link.
      const applyMail = h.mail.lastTo('x@example.com');
      expect(applyMail).toBeDefined();
      const applyUrl = applyMail!.data.magicLinkUrl as string;
      const token = tokenFromMagicLink(applyUrl);
      const verified = await h.actors.publisher.verifyApplyMagicLink(token);
      expect(verified.publisherId).toMatch(/^pub-/);

      // Admin: list publishers.
      const list = await h.actors.admin.listPublishers();
      expect(Array.isArray(list.publishers)).toBe(true);

      // Admin: approve.
      await h.actors.admin.approveApplication(verified.publisherId);

      // Status with the freshly-issued JWT (post-approval, tokenVersion may have bumped).
      const session = await h.signSession(verified.publisherId);
      const st = await h.actors.publisher.status(session);
      expect(st.publisher.id).toBe(verified.publisherId);

      // Pause / resume / fetch-now.
      await h.actors.publisher.pause(session);
      await h.actors.publisher.resume(session);

      h.feeds.set(verified.publisherId, feedOk(verified.publisherId, 'X', []));
      // fetch-now: rate limit lets first call through.
      await h.actors.publisher.fetchNow(session);

      // Ingest.
      await h.actors.ingest.run();
    } finally {
      h.dispose();
    }
  });
});
