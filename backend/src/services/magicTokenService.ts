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
import { DeleteCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { createHash, randomBytes } from 'crypto';
import type { ApplyFormPayload } from '../types/publisher';

export type TokenPurpose =
  | 'apply'
  | 'login'
  // Phase 4 — email-change double-opt-in. Each pending change writes ONE row
  // per purpose, both keyed by tokenHash and both addressed to a different
  // email. The verify token goes to the new address; the cancel token to the
  // old address.
  | 'email_change_verify'
  | 'email_change_cancel';

export interface EmailChangePayload {
  publisherId: string;
  oldEmail: string;
  newEmail: string;
  requestedAt: string; // ISO 8601
}

export interface MagicTokenRow {
  tokenHash: string;
  purpose: TokenPurpose;
  email: string;
  publisherId?: string;
  applyPayload?: ApplyFormPayload;
  emailChangePayload?: EmailChangePayload;
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

  // ─── Phase 4 (email-change double-opt-in) ──────────────────────────────

  // Issues two tokens for one pending email change: a verify token addressed
  // to the new email and a cancel token addressed to the old email. Both
  // rows carry the same `emailChangePayload` so either side of the flow has
  // enough context to act without an extra registry read. 24h TTL.
  //
  // Atomicity: the two Puts are NOT in a transaction. If the second Put
  // fails, the first row will still TTL out within 24h. We log loudly so
  // ops can see the divergence; the caller should treat the second Put's
  // error as fatal and surface it to the user. In practice this is good
  // enough — orphans only delay any subsequent retry by up to 24h, and the
  // user will simply see the request fail and try again.
  async issueEmailChangePair(input: {
    publisherId: string;
    oldEmail: string;
    newEmail: string;
    ttlSeconds?: number;
  }): Promise<{ verifyRawToken: string; cancelRawToken: string; expiresAt: number; payload: EmailChangePayload }> {
    const ttl = input.ttlSeconds ?? 24 * 60 * 60; // 24h
    const nowMs = this.now().getTime();
    const expiresAt = Math.floor(nowMs / 1000) + ttl;
    const requestedAt = new Date(nowMs).toISOString();

    const payload: EmailChangePayload = {
      publisherId: input.publisherId,
      oldEmail: input.oldEmail.trim().toLowerCase(),
      newEmail: input.newEmail.trim().toLowerCase(),
      requestedAt,
    };

    const verifyRawToken = randomBytes(32).toString('base64url');
    const cancelRawToken = randomBytes(32).toString('base64url');

    const verifyRow: MagicTokenRow = {
      tokenHash: MagicTokenService.hashToken(verifyRawToken),
      purpose: 'email_change_verify',
      email: payload.newEmail,
      publisherId: input.publisherId,
      emailChangePayload: payload,
      createdAt: requestedAt,
      expiresAt,
    };
    const cancelRow: MagicTokenRow = {
      tokenHash: MagicTokenService.hashToken(cancelRawToken),
      purpose: 'email_change_cancel',
      email: payload.oldEmail,
      publisherId: input.publisherId,
      emailChangePayload: payload,
      createdAt: requestedAt,
      expiresAt,
    };

    await this.db.send(new PutCommand({ TableName: this.tableName, Item: verifyRow }));
    try {
      await this.db.send(new PutCommand({ TableName: this.tableName, Item: cancelRow }));
    } catch (err) {
      // Best-effort rollback. The verify row will TTL out within 24h
      // regardless; we log so ops can correlate.
      console.error(
        `[magic-tokens] email-change pair second Put failed for publisher=${input.publisherId}; ` +
          `verify row will be cleaned up via TTL. Original error follows.`,
        err,
      );
      try {
        await this.db.send(new DeleteCommand({
          TableName: this.tableName,
          Key: { tokenHash: verifyRow.tokenHash },
        }));
      } catch (rbErr) {
        console.error('[magic-tokens] rollback DeleteCommand also failed:', rbErr);
      }
      throw err;
    }

    return { verifyRawToken, cancelRawToken, expiresAt, payload };
  }

  // Atomically consumes a single email-change token. Mirrors `consumeToken`'s
  // semantics — single conditional Delete returns ALL_OLD so we can validate
  // expiry / purpose AFTER the row is gone. The caller is responsible for
  // also deleting the peer row (via deleteEmailChangePairByPublisher) once
  // the consume succeeds, so the other half of the pair can no longer be
  // used.
  async consumeEmailChangeToken(
    rawToken: string,
    expectedPurpose: 'email_change_verify' | 'email_change_cancel',
  ): Promise<ConsumeResult> {
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
      const name = (err as { name?: string } | null)?.name;
      if (name === 'ConditionalCheckFailedException') {
        return { ok: false, reason: 'not_found' };
      }
      throw err;
    }
    if (!row) return { ok: false, reason: 'not_found' };

    const nowSec = Math.floor(this.now().getTime() / 1000);
    if (row.expiresAt <= nowSec) return { ok: false, reason: 'expired' };
    if (row.purpose !== expectedPurpose) return { ok: false, reason: 'wrong_purpose' };
    return { ok: true, row };
  }

  // Scans for any rows with purpose 'email_change_verify' or
  // 'email_change_cancel' that match the given publisherId, and deletes them.
  // Used by:
  //   - the verify path (delete the peer cancel row + any orphans)
  //   - the cancel-by-old path (delete the peer verify row + any orphans)
  //   - the cancel-by-self path (delete both rows)
  //   - the supersede path on initiate (clear any prior pending pair before
  //     issuing a new one).
  //
  // Scan + delete is acceptable because the magic-token table is small (TTLs
  // out within 24h for these rows; 15 min for apply/login) and this method
  // is only called on email-change actions, which are rare per publisher.
  async deleteEmailChangePairByPublisher(publisherId: string): Promise<number> {
    const rows = await this.scanEmailChangeRowsByPublisher(publisherId);
    let deleted = 0;
    for (const row of rows) {
      try {
        await this.db.send(new DeleteCommand({
          TableName: this.tableName,
          Key: { tokenHash: row.tokenHash },
        }));
        deleted += 1;
      } catch (err) {
        // Tolerate per-row failures; we'll log and continue. The row will
        // TTL out within 24h regardless.
        console.error(
          `[magic-tokens] failed to delete email-change row for publisher=${publisherId}:`,
          err,
        );
      }
    }
    return deleted;
  }

  // Returns the active email_change_verify row for this publisher, if any.
  // "Active" = not yet TTL'd (expiresAt > now). Used by the status endpoint
  // to surface pending changes on the UI.
  async findActiveEmailChangeByPublisher(publisherId: string): Promise<MagicTokenRow | null> {
    const rows = await this.scanEmailChangeRowsByPublisher(publisherId);
    const nowSec = Math.floor(this.now().getTime() / 1000);
    const verify = rows.find(r => r.purpose === 'email_change_verify' && r.expiresAt > nowSec);
    return verify ?? null;
  }

  // Active pending-email-change row whose newEmail matches the input.
  // Used by the apply-form uniqueness gate so applicants can't claim an
  // address that's mid-change-flow.
  async queryActiveEmailChangeByNewEmail(email: string): Promise<MagicTokenRow | null> {
    const normalized = email.trim().toLowerCase();
    const nowSec = Math.floor(this.now().getTime() / 1000);
    let last: Record<string, unknown> | undefined;
    do {
      const r = await this.db.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression:
          'purpose = :p AND emailChangePayload.newEmail = :e AND expiresAt > :now',
        ExpressionAttributeValues: {
          ':p': 'email_change_verify' as TokenPurpose,
          ':e': normalized,
          ':now': nowSec,
        },
        ExclusiveStartKey: last,
      }));
      const items = (r.Items ?? []) as MagicTokenRow[];
      if (items.length > 0) return items[0];
      last = r.LastEvaluatedKey;
    } while (last);
    return null;
  }

  private async scanEmailChangeRowsByPublisher(publisherId: string): Promise<MagicTokenRow[]> {
    const out: MagicTokenRow[] = [];
    let last: Record<string, unknown> | undefined;
    do {
      const r = await this.db.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression:
          'publisherId = :pid AND (purpose = :pv OR purpose = :pc)',
        ExpressionAttributeValues: {
          ':pid': publisherId,
          ':pv': 'email_change_verify' as TokenPurpose,
          ':pc': 'email_change_cancel' as TokenPurpose,
        },
        ExclusiveStartKey: last,
      }));
      out.push(...((r.Items ?? []) as MagicTokenRow[]));
      last = r.LastEvaluatedKey;
    } while (last);
    return out;
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
