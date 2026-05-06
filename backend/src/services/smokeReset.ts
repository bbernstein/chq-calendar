// Idempotent reset of the bbtest publisher's state for the post-deploy
// publisher-lifecycle smoke test.
//
// Why a dedicated reset path (instead of running the smoke against a fresh
// publisher each time): bbtest already exists in production and survives
// across deploys. Provisioning a fresh publisher per smoke run would add
// real DDB rows and SES traffic for what is fundamentally a deploy
// verification — and would force the smoke to invent a different email
// every run. Instead, the smoke asserts that bbtest's lifecycle works
// end-to-end starting from a known baseline.
//
// Baseline (after reset): bbtest publisher row exists with
//   { enabled: true, applicationStatus: 'approved', trustLevel: 'auto',
//     paused: false, selfPausedAt: null, selfDisabledAt: null }
// ...and zero events for the publisher, zero application rows, zero
// magic-token rows for the bbtest email.
//
// Idempotency: every step is a delete-or-no-op. Running reset twice in a
// row (e.g. afterAll fires while beforeAll is still running on a retry) is
// always safe — the second invocation just sees nothing to clean up.
//
// Why not piggy-back on PublisherAdminService.deletePublisher: that method
// hard-deletes the row, which would break our "bbtest always exists"
// invariant. We reset state in place instead.

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
  publishersResetInPlace: number;
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
 *   1. Delete events first (cheap, doesn't depend on publisher row state).
 *   2. Reset publisher row in place (preserves the row's identity so
 *      smoke assertions like `expect(listPublishers).toContain(bbtest)`
 *      remain meaningful).
 *   3. Delete pending application rows for the email (these are different
 *      DDB rows in the publishers table — applications-as-pending-publishers
 *      that were never approved).
 *   4. Delete magic-token rows last — if a magic token survives a row
 *      cleanup, the next smoke run might pick up a stale token.
 */
export async function resetBbtest(
  deps: SmokeResetDeps,
  bbtestEmail: string,
): Promise<SmokeResetResult> {
  const result: SmokeResetResult = {
    rowsAffected: 0,
    applicationsDeleted: 0,
    publishersResetInPlace: 0,
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
  const rowsForEmail = await deps.registry.getByEmail(normalizedEmail);

  for (const row of rowsForEmail) {
    if (row.applicationStatus === 'pending' || row.applicationStatus === 'rejected') {
      // Pending/rejected application: hard-delete. The smoke's apply
      // step needs an unused email to issue a fresh application against.
      await deps.registry.delete(row.id);
      result.applicationsDeleted += 1;
      result.rowsAffected += 1;
      continue;
    }

    // Approved row (or legacy row with no applicationStatus): reset in
    // place to baseline. Delete its events first.
    const deleted = await deps.eventStore.deleteAllForPublisher(row.id);
    result.eventsDeleted += deleted;
    result.rowsAffected += deleted;

    await deps.registry.upsert({
      ...row,
      applicationStatus: 'approved',
      enabled: true,
      trustLevel: 'auto',
      paused: false,
      // Clear self-pause / self-disable / email-change-lock markers. We
      // keep tokenVersion as-is because bumping it would invalidate any
      // legitimate session (not relevant to smoke, but cheap to preserve).
      selfPausedAt: undefined,
      selfDisabledAt: undefined,
      emailChangeLockedUntil: undefined,
      pendingThresholdHalt: undefined,
      lastFetchStatus: undefined,
      lastFetchMessage: undefined,
    });
    result.publishersResetInPlace += 1;
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
