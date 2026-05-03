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

  async applyDiff(diff: ReconcileDiff): Promise<void> {
    const items = [
      ...diff.inserts.map(it => ({ Put: { TableName: this.tableName, Item: it } })),
      ...diff.updates.map(it => ({ Put: { TableName: this.tableName, Item: it } })),
      ...diff.removals.map(it => ({
        Delete: {
          TableName: this.tableName,
          Key: { publisherId: it.publisherId, eventId: it.eventId },
        },
      })),
    ];
    if (items.length === 0) return;
    for (let i = 0; i < items.length; i += TRANSACT_BATCH_SIZE) {
      await this.db.send(new TransactWriteCommand({
        TransactItems: items.slice(i, i + TRANSACT_BATCH_SIZE),
      }));
    }
  }
}
