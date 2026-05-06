// Auth and abuse-mitigation journeys (design Test plan items 22-26).

jest.unmock('@aws-sdk/lib-dynamodb');
jest.unmock('@aws-sdk/client-dynamodb');

import { createHarness, type Harness } from './harness/harness';

describe('auth and limits', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness({ now: '2026-06-01T00:00:00Z' });
  });
  afterEach(() => {
    h.dispose();
  });

  it('apply with failing CAPTCHA returns 400; no application created', async () => {
    h.captcha.fail();
    await expect(h.actors.publisher.apply({
      name: 'X',
      email: 'cap@example.com',
      sourceUrl: 'https://example.com/feed.json',
      sourceType: 'json',
    })).rejects.toMatchObject({ statusCode: 400 });

    // No magic-token row written.
    expect(h.ddb.dump('magic-tokens')).toHaveLength(0);
    // No publisher row written.
    expect(h.ddb.dump('publishers')).toHaveLength(0);
  });

  it('apply with passing CAPTCHA succeeds', async () => {
    h.captcha.pass();
    await h.actors.publisher.apply({
      name: 'X',
      email: 'cap2@example.com',
      sourceUrl: 'https://example.com/feed.json',
      sourceType: 'json',
    });
    expect(h.ddb.dump('magic-tokens')).toHaveLength(1);
  });

  it('magic token: replay rejected; expired rejected; valid one-shot succeeds', async () => {
    await h.actors.publisher.apply({
      name: 'M',
      email: 'magic@example.com',
      sourceUrl: 'https://example.com/feed.json',
      sourceType: 'json',
    });
    const url = h.mail.lastTo('magic@example.com')!.data.magicLinkUrl as string;
    const token = new URL(url).searchParams.get('token')!;
    // Valid one-shot succeeds.
    await h.actors.publisher.verifyApplyMagicLink(token);
    // Replay → 400.
    await expect(h.actors.publisher.verifyApplyMagicLink(token))
      .rejects.toMatchObject({ statusCode: 400 });

    // Issue another, then expire.
    await h.actors.publisher.apply({
      name: 'E',
      email: 'expire@example.com',
      sourceUrl: 'https://example.com/feed.json',
      sourceType: 'json',
    });
    const url2 = h.mail.lastTo('expire@example.com')!.data.magicLinkUrl as string;
    const token2 = new URL(url2).searchParams.get('token')!;
    h.now.advance(20 * 60 * 1000); // 20 min > 15 min TTL
    await expect(h.actors.publisher.verifyApplyMagicLink(token2))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('per-IP rate limit on portal POST: 11th apply burst returns 429; advancing the clock unblocks', async () => {
    // Auth-bucket cap is 10/hour. 10 successful applies (each writes a unique row),
    // 11th hits the limiter.
    for (let i = 0; i < 10; i++) {
      await h.actors.publisher.apply({
        name: `P${i}`,
        email: `burst${i}@example.com`,
        sourceUrl: 'https://example.com/feed.json',
        sourceType: 'json',
      }, { ip: '203.0.113.50' });
    }
    await expect(h.actors.publisher.apply({
      name: 'P11',
      email: 'burst11@example.com',
      sourceUrl: 'https://example.com/feed.json',
      sourceType: 'json',
    }, { ip: '203.0.113.50' })).rejects.toMatchObject({ statusCode: 429 });

    // Advance past the 1h window → succeeds again.
    h.now.advance(61 * 60 * 1000);
    await h.actors.publisher.apply({
      name: 'P11',
      email: 'burst11@example.com',
      sourceUrl: 'https://example.com/feed.json',
      sourceType: 'json',
    }, { ip: '203.0.113.50' });
  });

  it('DNS-rebinding guard rejects loopback / private / metadata URLs at apply time (PR #85)', async () => {
    for (const url of [
      'http://0.0.0.0/feed.json',
      'http://127.0.0.1/feed.json',
      'http://169.254.169.254/feed.json',
    ]) {
      await expect(h.actors.publisher.apply({
        name: 'Bad',
        email: `bad-${Math.random()}@example.com`,
        sourceUrl: url,
        sourceType: 'json',
      })).rejects.toMatchObject({ statusCode: 400 });
    }
  });
});
