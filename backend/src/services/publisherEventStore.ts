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
    await this.db.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { publisherId, eventId },
      UpdateExpression: 'SET #s = :s, updatedAt = :now',
      ExpressionAttributeNames: { '#s': 'state' },
      ExpressionAttributeValues: { ':s': 'published', ':now': new Date().toISOString() },
    }));
  }

  async rejectEvent(publisherId: string, eventId: string): Promise<void> {
    await this.db.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { publisherId, eventId },
    }));
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
