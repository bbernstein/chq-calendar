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
import { DeleteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
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

  // Atomically consumes the token: a single conditional DeleteCommand both
  // validates existence AND removes the row, returning the deleted Attributes
  // for purpose/expiry checks.
  //
  // Why atomic delete (not Get-then-Delete): two concurrent requests with the
  // same raw token could both pass a non-atomic GetCommand check and both
  // proceed to issue a JWT before either DeleteCommand lands — a TOCTOU race
  // that allows double-use of a single-use token. With a conditional
  // DeleteCommand only one writer can succeed; the loser sees
  // ConditionalCheckFailedException and is treated as `not_found`.
  //
  // Trade-off: a token rejected for `wrong_purpose` is now also deleted (we
  // can't unilaterally NOT delete because the delete already happened). This
  // is acceptable — apply and login token paths are disjoint by URL, and a
  // user who reaches the wrong endpoint with the wrong token has likely
  // misclicked or been redirected; making them request a fresh token is fine.
  // An expired token is also deleted, same logic — TTL would have removed it
  // soon anyway.
  async consumeToken(rawToken: string, expectedPurpose: TokenPurpose): Promise<ConsumeResult> {
    if (typeof rawToken !== 'string' || rawToken.length === 0) {
      return { ok: false, reason: 'not_found' };
    }
    const tokenHash = MagicTokenService.hashToken(rawToken);

    let row: MagicTokenRow | undefined;
    try {
      const r = await this.db.send(new DeleteCommand({
        TableName: this.tableName,
        Key: { tokenHash },
        ConditionExpression: 'attribute_exists(tokenHash)',
        ReturnValues: 'ALL_OLD',
      }));
      row = r.Attributes as MagicTokenRow | undefined;
    } catch (err) {
      // ConditionalCheckFailedException: row didn't exist (already consumed,
      // never issued, or hash mismatch). Treat as not_found, not as a 5xx.
      const name = (err as { name?: string } | null)?.name;
      if (name === 'ConditionalCheckFailedException') {
        return { ok: false, reason: 'not_found' };
      }
      throw err;
    }
    if (!row) return { ok: false, reason: 'not_found' };

    const nowSec = Math.floor(this.now().getTime() / 1000);
    if (row.expiresAt <= nowSec) {
      return { ok: false, reason: 'expired' };
    }
    if (row.purpose !== expectedPurpose) {
      return { ok: false, reason: 'wrong_purpose' };
    }
    return { ok: true, row };
  }
}
