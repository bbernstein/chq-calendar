jest.unmock('@aws-sdk/lib-dynamodb');

// Tests for the Phase D sliding-window rate limiter.
//
// The DynamoRateLimiter test mocks the DynamoDBDocumentClient send
// directly so we exercise the GetCommand/PutCommand wire shapes without
// standing up a live DDB. The InMemoryRateLimiter tests are pure
// in-process.

import {
  DynamoRateLimiter,
  InMemoryRateLimiter,
  type RateLimiter,
} from '../services/rateLimitService';

const mkClock = (start = 1_000_000_000_000) => {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
  };
};

async function runSlidingWindowSuite(
  build: (now: () => number) => RateLimiter,
) {
  const clock = mkClock();
  const limiter = build(clock.now);

  for (let i = 0; i < 3; i += 1) {
    const r = await limiter.checkAndConsume({ key: 'k', windowMs: 1000, max: 3 });
    expect(r.ok).toBe(true);
  }
  const denied = await limiter.checkAndConsume({ key: 'k', windowMs: 1000, max: 3 });
  expect(denied.ok).toBe(false);
  expect(denied.retryAfterSeconds).toBeGreaterThan(0);

  // Advance past the window — old entries evict, new request allowed.
  clock.advance(1100);
  const allowed = await limiter.checkAndConsume({ key: 'k', windowMs: 1000, max: 3 });
  expect(allowed.ok).toBe(true);

  // Different key has its own counter.
  const otherKey = await limiter.checkAndConsume({ key: 'k2', windowMs: 1000, max: 1 });
  expect(otherKey.ok).toBe(true);
  const otherKeyAgain = await limiter.checkAndConsume({ key: 'k2', windowMs: 1000, max: 1 });
  expect(otherKeyAgain.ok).toBe(false);
}

describe('InMemoryRateLimiter', () => {
  it('admits up to max in window, rejects above, evicts after window', async () => {
    await runSlidingWindowSuite((now) => new InMemoryRateLimiter(now));
  });

  it('reset() clears state for a single key', async () => {
    const clock = mkClock();
    const limiter = new InMemoryRateLimiter(clock.now);
    await limiter.checkAndConsume({ key: 'a', windowMs: 1000, max: 1 });
    expect((await limiter.checkAndConsume({ key: 'a', windowMs: 1000, max: 1 })).ok).toBe(false);
    limiter.reset('a');
    expect((await limiter.checkAndConsume({ key: 'a', windowMs: 1000, max: 1 })).ok).toBe(true);
  });

  it('reset() with no key clears everything', async () => {
    const clock = mkClock();
    const limiter = new InMemoryRateLimiter(clock.now);
    await limiter.checkAndConsume({ key: 'a', windowMs: 1000, max: 1 });
    await limiter.checkAndConsume({ key: 'b', windowMs: 1000, max: 1 });
    limiter.reset();
    expect((await limiter.checkAndConsume({ key: 'a', windowMs: 1000, max: 1 })).ok).toBe(true);
    expect((await limiter.checkAndConsume({ key: 'b', windowMs: 1000, max: 1 })).ok).toBe(true);
  });
});

describe('DynamoRateLimiter', () => {
  it('admits up to max in window, rejects above, evicts after window', async () => {
    // The mock send must keep state across calls so a sequence of
    // GetCommand → PutCommand → GetCommand reflects what was written.
    const items = new Map<string, { id: string; timestamps: number[]; expiresAt: number }>();
    const send = jest.fn(async (cmd: any) => {
      const ctorName = cmd.constructor.name;
      if (ctorName === 'GetCommand') {
        const id = cmd.input.Key.id;
        const item = items.get(id);
        return { Item: item };
      }
      if (ctorName === 'PutCommand') {
        items.set(cmd.input.Item.id, cmd.input.Item);
        return {};
      }
      throw new Error(`unexpected command: ${ctorName}`);
    });
    const fakeClient = { send } as any;
    await runSlidingWindowSuite((now) => new DynamoRateLimiter(fakeClient, 'rl-table', now));
    // Sanity: writes did happen for both keys.
    expect(items.has('k')).toBe(true);
    expect(items.has('k2')).toBe(true);
  });

  it('writes a TTL field that is in the future', async () => {
    const items = new Map<string, any>();
    const send = jest.fn(async (cmd: any) => {
      const ctorName = cmd.constructor.name;
      if (ctorName === 'GetCommand') return { Item: items.get(cmd.input.Key.id) };
      if (ctorName === 'PutCommand') { items.set(cmd.input.Item.id, cmd.input.Item); return {}; }
      throw new Error('unexpected');
    });
    const clock = mkClock(2_000_000_000_000); // 2033
    const limiter = new DynamoRateLimiter({ send } as any, 'rl-table', clock.now);
    await limiter.checkAndConsume({ key: 'x', windowMs: 60_000, max: 5 });
    const stored = items.get('x');
    // TTL must be epoch-seconds (not millis) and at least past the window.
    expect(stored.expiresAt).toBeGreaterThan(2_000_000_000); // epoch-seconds for 2033
    expect(stored.expiresAt).toBeLessThan(2_000_010_000); // and not absurdly far out
  });

  it('returns retryAfterSeconds based on the oldest in-window timestamp', async () => {
    const items = new Map<string, any>();
    const send = jest.fn(async (cmd: any) => {
      const ctorName = cmd.constructor.name;
      if (ctorName === 'GetCommand') return { Item: items.get(cmd.input.Key.id) };
      if (ctorName === 'PutCommand') { items.set(cmd.input.Item.id, cmd.input.Item); return {}; }
      throw new Error('unexpected');
    });
    const clock = mkClock();
    const limiter = new DynamoRateLimiter({ send } as any, 'rl-table', clock.now);
    // Saturate the bucket.
    await limiter.checkAndConsume({ key: 'x', windowMs: 10_000, max: 1 });
    // Advance partway through the window; reject reports remaining time.
    clock.advance(3000);
    const r = await limiter.checkAndConsume({ key: 'x', windowMs: 10_000, max: 1 });
    expect(r.ok).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThanOrEqual(7);
    expect(r.retryAfterSeconds).toBeLessThanOrEqual(8);
  });
});
