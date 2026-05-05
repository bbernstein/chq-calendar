import {
  DeleteCommand,
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

  async rejectEvent(publisherId: string, eventId: string): Promise<void> {
    // Guard against deleting an already-published event if /reject races a
    // /approve or arrives after publication. ConditionalCheckFailedException
    // is treated as a no-op — the row exists in a state we cannot reject from.
    try {
      await this.db.send(new DeleteCommand({
        TableName: this.tableName,
        Key: { publisherId, eventId },
        ConditionExpression: '#s = :pending',
        ExpressionAttributeNames: { '#s': 'state' },
        ExpressionAttributeValues: { ':pending': 'pending' },
      }));
    } catch (err) {
      if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') return;
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
