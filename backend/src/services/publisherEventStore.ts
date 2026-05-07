import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { ReconcileDiff, StoredPublisherEvent } from '../types/publisher';

const TRANSACT_BATCH_SIZE = 100;

export class PublisherEventStore {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async listForPublisher(publisherId: string): Promise<StoredPublisherEvent[]> {
    const out: StoredPublisherEvent[] = [];
    let last: Record<string, unknown> | undefined;
    do {
      const r = await this.db.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'publisherId = :p',
        ExpressionAttributeValues: { ':p': publisherId },
        ExclusiveStartKey: last,
      }));
      out.push(...((r.Items ?? []) as StoredPublisherEvent[]));
      last = r.LastEvaluatedKey;
    } while (last);
    return out;
  }

  // Count events for a publisher without loading their payloads. Uses DDB's
  // `Select: 'COUNT'` so the response carries only `Count` per page — no
  // item payloads ever cross the wire. This matters for the smoke's
  // events/count endpoint, which polls during ingest and would otherwise
  // pull every event row into Lambda memory just to call .length on it.
  // Pagination still applies (DDB caps each Query at ~1MB scanned), so
  // the loop sums Count across pages.
  async countForPublisher(publisherId: string): Promise<number> {
    let total = 0;
    let last: Record<string, unknown> | undefined;
    do {
      const r = await this.db.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'publisherId = :p',
        ExpressionAttributeValues: { ':p': publisherId },
        Select: 'COUNT',
        ExclusiveStartKey: last,
      }));
      total += r.Count ?? 0;
      last = r.LastEvaluatedKey;
    } while (last);
    return total;
  }

  async getEvent(
    publisherId: string,
    eventId: string,
  ): Promise<StoredPublisherEvent | undefined> {
    const r = await this.db.send(new GetCommand({
      TableName: this.tableName,
      Key: { publisherId, eventId },
    }));
    return r.Item as StoredPublisherEvent | undefined;
  }

  async listAllPublished(): Promise<StoredPublisherEvent[]> {
    const out: StoredPublisherEvent[] = [];
    let last: Record<string, unknown> | undefined;
    do {
      const r = await this.db.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: 'by-state',
        KeyConditionExpression: '#s = :s',
        ExpressionAttributeNames: { '#s': 'state' },
        ExpressionAttributeValues: { ':s': 'published' },
        ExclusiveStartKey: last,
      }));
      out.push(...((r.Items ?? []) as StoredPublisherEvent[]));
      last = r.LastEvaluatedKey;
    } while (last);
    return out;
  }

  async listPending(): Promise<StoredPublisherEvent[]> {
    const out: StoredPublisherEvent[] = [];
    let last: Record<string, unknown> | undefined;
    do {
      const r = await this.db.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: 'by-state',
        KeyConditionExpression: '#s = :s',
        ExpressionAttributeNames: { '#s': 'state' },
        ExpressionAttributeValues: { ':s': 'pending' },
        ExclusiveStartKey: last,
      }));
      out.push(...((r.Items ?? []) as StoredPublisherEvent[]));
      last = r.LastEvaluatedKey;
    } while (last);
    return out;
  }

  async approveEvent(publisherId: string, eventId: string): Promise<void> {
    // Guard against UpdateItem's upsert behavior: without attribute_exists,
    // approving a stale/nonexistent event ID would create a phantom row with
    // only state + updatedAt set, which the next sidecar publish would emit
    // into the cache as a corrupt record. Also require state=pending so a
    // late /approve that races a /reject can't resurrect a deleted row.
    try {
      await this.db.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { publisherId, eventId },
        UpdateExpression: 'SET #s = :published, updatedAt = :now',
        ConditionExpression: 'attribute_exists(publisherId) AND #s = :pending',
        ExpressionAttributeNames: { '#s': 'state' },
        ExpressionAttributeValues: {
          ':published': 'published',
          ':pending': 'pending',
          ':now': new Date().toISOString(),
        },
      }));
    } catch (err) {
      if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
        throw new Error(`cannot approve ${publisherId}/${eventId}: not pending or no longer exists`);
      }
      throw err;
    }
  }

  // Returns true iff the row transitioned from 'pending' to 'rejected' on this
  // call. Returns false on the conditional-no-op path (row already non-pending
  // or already deleted) so callers can decide whether to fire side-effects
  // like notification emails.
  async rejectEvent(
    publisherId: string,
    eventId: string,
    reason?: string,
  ): Promise<boolean> {
    // Soft-delete: rows transition to state='rejected' (terminal) instead of
    // being deleted. Re-ingest preserves them via publisherReconciler.toStored.
    // The condition `#s = :pending` keeps approve/reject races atomic — same
    // semantics as the previous DeleteCommand. ConditionalCheckFailedException
    // is treated as a no-op (the row is in a state we can't reject from, e.g.
    // already-rejected, already-published, or already-deleted).
    const trimmed = reason?.trim();
    const setParts = ['#s = :rejected', 'rejectedAt = :now', 'updatedAt = :now'];
    const exprValues: Record<string, unknown> = {
      ':rejected': 'rejected',
      ':pending': 'pending',
      ':now': new Date().toISOString(),
    };
    if (trimmed && trimmed.length > 0) {
      setParts.push('rejectionReason = :reason');
      // Caller is responsible for the 500-char cap; defense in depth here.
      exprValues[':reason'] = trimmed.slice(0, 500);
    }
    try {
      await this.db.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { publisherId, eventId },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ConditionExpression: 'attribute_exists(publisherId) AND #s = :pending',
        ExpressionAttributeNames: { '#s': 'state' },
        ExpressionAttributeValues: exprValues,
      }));
      return true;
    } catch (err) {
      if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') return false;
      throw err;
    }
  }

  async deleteAllForPublisher(publisherId: string): Promise<number> {
    const events = await this.listForPublisher(publisherId);
    if (events.length === 0) return 0;
    const items = events.map(e => ({
      Delete: {
        TableName: this.tableName,
        Key: { publisherId: e.publisherId, eventId: e.eventId },
      },
    }));
    for (let i = 0; i < items.length; i += TRANSACT_BATCH_SIZE) {
      await this.db.send(new TransactWriteCommand({
        TransactItems: items.slice(i, i + TRANSACT_BATCH_SIZE),
      }));
    }
    return events.length;
  }

  // Thrown by applyDiff when the optional `requirePublisher` ConditionCheck
  // fails — the publisher row was deleted between snapshot and write, so we
  // refuse to apply the diff (would otherwise resurrect events for a
  // publisher that no longer exists). Caller's choice whether to retry
  // (the publisher might have been re-created) or skip silently.

  async applyDiff(
    diff: ReconcileDiff,
    opts: {
      // If supplied, every transaction batch will include a ConditionCheck
      // asserting `attribute_exists(id)` on the publisher row. This closes
      // the delete-during-ingest race: if the publisher was hard-deleted
      // between the ingest's snapshot and applyDiff's commit, the entire
      // transaction aborts atomically — no events are written.
      requirePublisher?: { tableName: string; id: string };
    } = {},
  ): Promise<void> {
    const eventOps = [
      ...diff.inserts.map(it => ({ Put: { TableName: this.tableName, Item: it } })),
      ...diff.updates.map(it => ({ Put: { TableName: this.tableName, Item: it } })),
      ...diff.removals.map(it => ({
        Delete: {
          TableName: this.tableName,
          Key: { publisherId: it.publisherId, eventId: it.eventId },
        },
      })),
    ];
    if (eventOps.length === 0) return;

    const requirePublisher = opts.requirePublisher;
    // TransactWriteItems caps at 100 items; if we prepend a ConditionCheck
    // every batch, we shrink the per-batch event budget by one.
    const perBatch = requirePublisher ? TRANSACT_BATCH_SIZE - 1 : TRANSACT_BATCH_SIZE;

    for (let i = 0; i < eventOps.length; i += perBatch) {
      const slice = eventOps.slice(i, i + perBatch);
      const items = requirePublisher
        ? [
            {
              ConditionCheck: {
                TableName: requirePublisher.tableName,
                Key: { id: requirePublisher.id },
                ConditionExpression: 'attribute_exists(id)',
              },
            },
            ...slice,
          ]
        : slice;
      try {
        await this.db.send(new TransactWriteCommand({ TransactItems: items }));
      } catch (err) {
        // DDB raises TransactionCanceledException for several distinct
        // reasons (ConditionalCheckFailed, TransactionConflict, capacity
        // exhaustion, etc.). We only want to wrap as
        // PublisherDeletedDuringApplyError when the FIRST item's reason
        // is `ConditionalCheckFailed` — that's our ConditionCheck on the
        // publisher row, the only condition we attached. Other reasons
        // (e.g. concurrent transaction conflict) are real failures the
        // caller needs to know about and potentially retry, not silent
        // skips.
        if (
          requirePublisher &&
          (err as { name?: string })?.name === 'TransactionCanceledException' &&
          firstReasonIsConditionalCheckFailed(err)
        ) {
          throw new PublisherDeletedDuringApplyError(requirePublisher.id);
        }
        throw err;
      }
    }
  }
}

export class PublisherDeletedDuringApplyError extends Error {
  constructor(public readonly publisherId: string) {
    super(`publisher ${publisherId} was deleted during applyDiff`);
    this.name = 'PublisherDeletedDuringApplyError';
  }
}

// Inspect a TransactionCanceledException's CancellationReasons array.
// Returns true iff the first cancellation reason is `ConditionalCheckFailed`
// — i.e. the publisher-existence ConditionCheck (which is always the first
// item we attach when requirePublisher is set) was the cause. Other reasons
// (TransactionConflict, ProvisionedThroughputExceeded, ItemCollectionSize-
// LimitExceeded, ValidationError, ThrottlingError) propagate up unchanged
// so the caller can distinguish "publisher deleted" from "retry me".
function firstReasonIsConditionalCheckFailed(err: unknown): boolean {
  const reasons = (err as { CancellationReasons?: Array<{ Code?: string }> })
    ?.CancellationReasons;
  if (!Array.isArray(reasons) || reasons.length === 0) return false;
  return reasons[0]?.Code === 'ConditionalCheckFailed';
}
