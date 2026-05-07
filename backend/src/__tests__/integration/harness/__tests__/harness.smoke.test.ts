// Smoke-test the harness end-to-end. Confirms wiring works at the plumbing
// level — actual journey coverage lives in lifecycle.test.ts etc.

jest.unmock('@aws-sdk/lib-dynamodb');
jest.unmock('@aws-sdk/client-dynamodb');

// Ensure AWS SDK has a region so adminHandler's module-load
// DynamoDBClient/DynamoDBDocumentClient construction doesn't throw.
process.env.AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';

import { createHarness } from '../harness';

describe('integration harness', () => {
  it('creates a harness, signs a session, applies, advances time', async () => {
    const h = await createHarness({ now: '2026-06-01T00:00:00Z' });
    try {
      // Apply via the publisher actor.
      await h.actors.publisher.apply({
        name: 'Test Publisher',
        email: 'pub@test.example.com',
        sourceUrl: 'https://example.com/feed.json',
        sourceType: 'json',
      });
      // Verify magic link was captured.
      const sent = h.mail.lastTo('pub@test.example.com');
      expect(sent?.kind).toBe('apply');

      h.now.advance(60_000);
      expect(h.now.now.toISOString()).toBe('2026-06-01T00:01:00.000Z');
    } finally {
      h.dispose();
    }
  });
});
