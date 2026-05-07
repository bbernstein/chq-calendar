// Idempotent reset of the bbtest publisher's state for the post-deploy
// publisher-lifecycle smoke test.
//
// Why a dedicated reset path (instead of running the smoke against a fresh
// publisher each time): the smoke walks the bbtest email through a full
// apply → approve → publish → ... lifecycle. Without an idempotent reset,
// killed runs would leave half-baked state (a pending application, an
// approved-but-paused publisher row, half-ingested events) that the next
// run would trip over.
//
// Baseline (after reset): there are NO publisher rows for the bbtest
// email — neither approved nor pending. This is required for the smoke's
// step 1 (apply): PublisherApplicationService.requestApply() rejects any
// email that already maps to a publisher row regardless of its
// applicationStatus, so the row MUST be gone for the next apply to
// succeed. Magic-token rows for the email are also fully cleaned.
//
// Idempotency: every step is a delete-or-no-op. Running reset twice in a
// row (e.g. afterAll fires while beforeAll is still running on a retry) is
// always safe — the second invocation just sees nothing to clean up.
//
// Why not piggy-back on PublisherAdminService.deletePublisher: that
// method's signature requires us to know the publisher's id (we look it
// up by email here), and it has admin-side concerns (audit trail, etc.)
// that aren't relevant to a smoke teardown. We hard-delete via the
// registry directly instead.

import {
  ScanCommand,
  DeleteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { PublisherRegistryService } from './publisherRegistryService';
import type { PublisherEventStore } from './publisherEventStore';

export interface SmokeResetResult {
  // Total number of DDB rows touched. Useful for log-based assertions in
  // the smoke ("expect first reset to clean up >0 rows after a half-failed
  // run; second reset to be 0").
  rowsAffected: number;
  // Per-domain counters for observability.
  applicationsDeleted: number;
  // Publisher rows deleted (any applicationStatus). Renamed from
  // publishersResetInPlace because we now hard-delete approved rows too —
  // requestApply rejects any email already attached to ANY publisher row.
  publishersDeleted: number;
  eventsDeleted: number;
  magicTokensDeleted: number;
}

export interface SmokeResetDeps {
  registry: PublisherRegistryService;
  eventStore: PublisherEventStore;
  // Raw DDB client for ad-hoc scan-and-delete on the magic-tokens table.
  // We don't add a deleteByEmail method to MagicTokenService because that
  // signature would tempt non-test callers; smoke needs a sledgehammer
  // tied to a single test email.
  db: DynamoDBDocumentClient;
  magicTokensTableName: string;
}

/**
 * Resets bbtest state to baseline. See file header for the contract.
 *
 * Step order matters:
 *   1. For each publisher row matching the email, delete its events first
 *      (cheap, doesn't depend on the publisher row state) and then
 *      hard-delete the publisher row itself. We delete approved rows too
 *      (not just pending/rejected) — PublisherApplicationService
 *      .requestApply() refuses to issue a magic link for any email that
 *      already maps to ANY publisher row, so leaving an approved row
 *      around would break the smoke's apply step on the very next run.
 *   2. Delete magic-token rows last — if a magic token survives a row
 *      cleanup, the next smoke run might pick up a stale token.
 */
export async function resetBbtest(
  deps: SmokeResetDeps,
  bbtestEmail: string,
): Promise<SmokeResetResult> {
  const result: SmokeResetResult = {
    rowsAffected: 0,
    applicationsDeleted: 0,
    publishersDeleted: 0,
    eventsDeleted: 0,
    magicTokensDeleted: 0,
  };

  const normalizedEmail = bbtestEmail.trim().toLowerCase();
  if (!normalizedEmail) {
    // Defensive: an empty email would scan-delete every magic-token row
    // (FilterExpression `email = ""` matches nothing in practice, but we
    // refuse to even attempt it).
    throw new Error('resetBbtest: bbtestEmail must be a non-empty string');
  }

  // ─── Publishers and applications by email ────────────────────────────
  //
  // Both approved publisher rows AND pending application rows live in the
  // same `publishers` table — applications are publisher rows with
  // applicationStatus='pending' and enabled=false. getByEmail returns both.
  // We hard-delete every match regardless of applicationStatus so the next
  // /publisher-apply/request can issue a fresh application against this
  // email (the requestApply uniqueness gate refuses any email already
  // attached to a publisher row).
  const rowsForEmail = await deps.registry.getByEmail(normalizedEmail);

  for (const row of rowsForEmail) {
    if (row.applicationStatus === 'pending' || row.applicationStatus === 'rejected') {
      // Pending/rejected application — no events to clean up (these rows
      // were never approved + ingested). Hard-delete the row.
      await deps.registry.delete(row.id);
      result.applicationsDeleted += 1;
      result.rowsAffected += 1;
      continue;
    }

    // Approved row (or legacy row with no applicationStatus): delete its
    // events first, then the publisher row itself.
    const deleted = await deps.eventStore.deleteAllForPublisher(row.id);
    result.eventsDeleted += deleted;
    result.rowsAffected += deleted;

    await deps.registry.delete(row.id);
    result.publishersDeleted += 1;
    result.rowsAffected += 1;
  }

  // ─── Magic tokens by email ───────────────────────────────────────────
  //
  // Magic-token rows are keyed by tokenHash, so we can't get-by-email — we
  // scan with a FilterExpression. The table is small (TTL deletes rows
  // within ~minutes of expiry, so steady-state size is bounded by
  // unconsumed-and-unexpired tokens, typically <100).
  let last: Record<string, unknown> | undefined;
  const tokensToDelete: string[] = [];
  do {
    const r = await deps.db.send(new ScanCommand({
      TableName: deps.magicTokensTableName,
      FilterExpression: 'email = :e',
      ExpressionAttributeValues: { ':e': normalizedEmail },
      ExclusiveStartKey: last,
    }));
    for (const item of (r.Items ?? []) as { tokenHash?: string }[]) {
      if (item.tokenHash) tokensToDelete.push(item.tokenHash);
    }
    last = r.LastEvaluatedKey;
  } while (last);

  for (const tokenHash of tokensToDelete) {
    await deps.db.send(new DeleteCommand({
      TableName: deps.magicTokensTableName,
      Key: { tokenHash },
    }));
    result.magicTokensDeleted += 1;
    result.rowsAffected += 1;
  }

  return result;
}
