import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { FetchStatus, PublisherRecord } from '../types/publisher';

export class PublisherRegistryService {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get(id: string): Promise<PublisherRecord | null> {
    const r = await this.db.send(new GetCommand({ TableName: this.tableName, Key: { id } }));
    return (r.Item as PublisherRecord) ?? null;
  }

  async listEnabled(): Promise<PublisherRecord[]> {
    const r = await this.db.send(new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'enabled = :t',
      ExpressionAttributeValues: { ':t': true },
    }));
    return (r.Items ?? []) as PublisherRecord[];
  }

  async upsert(rec: PublisherRecord): Promise<void> {
    await this.db.send(new PutCommand({ TableName: this.tableName, Item: rec }));
  }

  async recordFetchOutcome(id: string, outcome: { status: FetchStatus; message?: string }): Promise<void> {
    await this.db.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { id },
      UpdateExpression: 'SET lastFetchedAt = :now, lastFetchStatus = :status, lastFetchMessage = :msg',
      ExpressionAttributeValues: {
        ':now': new Date().toISOString(),
        ':status': outcome.status,
        ':msg': outcome.message ?? null,
      },
    }));
  }

  async setThresholdHalt(id: string, halt: PublisherRecord['pendingThresholdHalt']): Promise<void> {
    await this.db.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { id },
      UpdateExpression: 'SET pendingThresholdHalt = :h',
      ExpressionAttributeValues: { ':h': halt ?? null },
    }));
  }
}
