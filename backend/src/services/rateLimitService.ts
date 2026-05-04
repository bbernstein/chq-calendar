// Phase D — sliding-window rate limiter, backed by DynamoDB.
//
// Replaces the in-memory `_state` Maps that lived in
// `publisherPortalHandler.ts` (Phases A/B). The in-memory implementation
// is fine for single-container Lambdas but breaks once any container
// scales out — concurrent containers each get their own bucket and the
// effective limit becomes `containers × max`.
//
// Wire-level shape:
//   PK `id` (string): the rate-limit bucket key (e.g. `pt:203.0.113.1`
//   for "publisher-test endpoint, IP X").
//   `timestamps` (number[]): epoch-ms entries for each request inside the
//     active window. Trimmed on each read.
//   `expiresAt` (number, TTL): epoch-seconds for DynamoDB to auto-evict
//     once the window is comfortably past.
//
// The check-then-write is non-atomic — two simultaneous calls to the same
// key could both decide they're under the limit and both write. At our
// throughput (publisher portal, low double-digit RPS at most) this is
// acceptable; the limit could be slightly over-shot but not by orders of
// magnitude. Conditional writes with a version field are a future option.

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

export interface RateLimitDecision {
  ok: boolean;
  // When ok=false, the recommended Retry-After header value in seconds.
  retryAfterSeconds?: number;
}

export interface RateLimitOptions {
  key: string;
  windowMs: number;
  max: number;
}

export interface RateLimiter {
  checkAndConsume(opts: RateLimitOptions): Promise<RateLimitDecision>;
  // Test-only escape hatch.
  reset?(key?: string): Promise<void> | void;
}

// ─── DynamoDB-backed implementation ──────────────────────────────────────

interface RateLimitRow {
  id: string;
  timestamps: number[];
  expiresAt: number;
}

export class DynamoRateLimiter implements RateLimiter {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async checkAndConsume(opts: RateLimitOptions): Promise<RateLimitDecision> {
    const now = this.now();
    const windowStart = now - opts.windowMs;
    const existing = await this.db.send(new GetCommand({
      TableName: this.tableName,
      Key: { id: opts.key },
    }));
    const row = (existing.Item as RateLimitRow | undefined);
    const recent = (row?.timestamps ?? []).filter(t => t > windowStart);
    if (recent.length >= opts.max) {
      const oldest = recent[0];
      return {
        ok: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((oldest + opts.windowMs - now) / 1000),
        ),
      };
    }
    recent.push(now);
    await this.db.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        id: opts.key,
        timestamps: recent,
        // TTL eviction window is the rate window plus a small buffer so
        // the row sticks around long enough that a request right at the
        // boundary still sees its own history. 60s is comfortably over
        // any reasonable jitter.
        expiresAt: Math.ceil((now + opts.windowMs) / 1000) + 60,
      } satisfies RateLimitRow,
    }));
    return { ok: true };
  }
}

// ─── In-memory fallback (used in tests + local dev without a DDB table) ──

export class InMemoryRateLimiter implements RateLimiter {
  private readonly state = new Map<string, number[]>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  async checkAndConsume(opts: RateLimitOptions): Promise<RateLimitDecision> {
    const now = this.now();
    const windowStart = now - opts.windowMs;
    const existing = this.state.get(opts.key) ?? [];
    const recent = existing.filter(t => t > windowStart);
    if (recent.length >= opts.max) {
      const oldest = recent[0];
      this.state.set(opts.key, recent);
      return {
        ok: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((oldest + opts.windowMs - now) / 1000),
        ),
      };
    }
    recent.push(now);
    this.state.set(opts.key, recent);
    return { ok: true };
  }

  reset(key?: string): void {
    if (key === undefined) {
      this.state.clear();
    } else {
      this.state.delete(key);
    }
  }
}
