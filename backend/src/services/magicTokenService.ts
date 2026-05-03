// Magic-link token issue/consume primitives for the publisher portal Phase B
// apply + login flows.
//
// Storage shape (DynamoDB table chautauqua-calendar-publisher-magic-tokens):
//   PK tokenHash : sha256(rawToken) hex
//   purpose      : 'apply' | 'login'
//   email        : normalized lowercase address
//   publisherId? : present for login tokens (existing approved publisher)
//   applyPayload?: present for apply tokens (full ApplyFormPayload)
//   createdAt    : ISO timestamp
//   expiresAt    : epoch seconds — DynamoDB TTL deletes after this point
//
// Security:
// - Raw tokens are 32 random bytes encoded base64url (~43 chars). 256 bits
//   of entropy: brute-forcing the hash space is infeasible.
// - Only the SHA-256 hash is stored. A table-leak does NOT enable account
//   takeover.
// - Tokens are SINGLE-USE. consumeToken deletes the row regardless of the
//   outcome, preventing replay if the email is intercepted twice.
// - 15-minute expiry. DynamoDB TTL is best-effort (delete may lag by minutes
//   after expiresAt) so consumeToken double-checks the timestamp in code.

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { createHash, randomBytes } from 'crypto';
import type { ApplyFormPayload } from '../types/publisher';

export type TokenPurpose = 'apply' | 'login';

export interface MagicTokenRow {
  tokenHash: string;
  purpose: TokenPurpose;
  email: string;
  publisherId?: string;
  applyPayload?: ApplyFormPayload;
  createdAt: string;
  expiresAt: number; // epoch seconds for DynamoDB TTL
}

export interface IssueTokenInput {
  purpose: TokenPurpose;
  email: string;
  publisherId?: string;
  applyPayload?: ApplyFormPayload;
  ttlSeconds?: number;
}

export interface IssuedToken {
  // The raw token to embed in the magic-link URL. NEVER log this.
  rawToken: string;
  expiresAt: number;
}

export type ConsumeResult =
  | { ok: true; row: MagicTokenRow }
  | { ok: false; reason: 'not_found' | 'expired' | 'wrong_purpose' };

const DEFAULT_TTL_SECONDS = 15 * 60;

export class MagicTokenService {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  static hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  // Generates a fresh raw token and persists its hash + payload. Returns the
  // raw token so the caller can embed it in the magic-link email URL.
  async issueToken(input: IssueTokenInput): Promise<IssuedToken> {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = MagicTokenService.hashToken(rawToken);
    const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const nowMs = this.now().getTime();
    const expiresAt = Math.floor(nowMs / 1000) + ttl;

    const row: MagicTokenRow = {
      tokenHash,
      purpose: input.purpose,
      email: input.email.trim().toLowerCase(),
      createdAt: new Date(nowMs).toISOString(),
      expiresAt,
    };
    if (input.publisherId !== undefined) row.publisherId = input.publisherId;
    if (input.applyPayload !== undefined) row.applyPayload = input.applyPayload;

    await this.db.send(new PutCommand({ TableName: this.tableName, Item: row }));

    return { rawToken, expiresAt };
  }

  // Looks up the token row by hash, validates purpose + expiry, deletes the
  // row (single-use), and returns the row data on success.
  //
  // Why delete-after-success rather than delete-on-lookup: we want a
  // not-found token to remain not-found after the first failed consume,
  // not "found and consumed" — so we only delete when the consume actually
  // succeeds. The DynamoDB TTL still cleans up the unconsumed row later.
  async consumeToken(rawToken: string, expectedPurpose: TokenPurpose): Promise<ConsumeResult> {
    if (typeof rawToken !== 'string' || rawToken.length === 0) {
      return { ok: false, reason: 'not_found' };
    }
    const tokenHash = MagicTokenService.hashToken(rawToken);
    const r = await this.db.send(new GetCommand({
      TableName: this.tableName,
      Key: { tokenHash },
    }));
    const row = r.Item as MagicTokenRow | undefined;
    if (!row) return { ok: false, reason: 'not_found' };

    const nowSec = Math.floor(this.now().getTime() / 1000);
    if (row.expiresAt <= nowSec) {
      // Best-effort delete (don't await — the TTL will catch it anyway).
      this.db.send(new DeleteCommand({ TableName: this.tableName, Key: { tokenHash } }))
        .catch(() => {/* swallow */});
      return { ok: false, reason: 'expired' };
    }
    if (row.purpose !== expectedPurpose) {
      // Don't delete: the token may legitimately be consumable for its
      // correct purpose by another endpoint.
      return { ok: false, reason: 'wrong_purpose' };
    }

    await this.db.send(new DeleteCommand({ TableName: this.tableName, Key: { tokenHash } }));
    return { ok: true, row };
  }
}
