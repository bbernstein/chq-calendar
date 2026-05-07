import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { IngestRunRow } from '../types/publisherIngestRun';

const NINETY_DAYS_S = 90 * 24 * 60 * 60;

export class PublisherIngestRunStore {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async recordRun(row: IngestRunRow): Promise<void> {
    const ttl = Math.floor(Date.parse(row.runAt) / 1000) + NINETY_DAYS_S;
    await this.db.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { ...row, ttl },
      }),
    );
  }

  async getMostRecentRun(publisherId: string): Promise<IngestRunRow | undefined> {
    const out = await this.db.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'publisherId = :p',
        ExpressionAttributeValues: { ':p': publisherId },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );
    return (out.Items?.[0] as IngestRunRow | undefined) ?? undefined;
  }

  async listRecentRuns(publisherId: string, limit = 30): Promise<IngestRunRow[]> {
    const out = await this.db.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'publisherId = :p',
        ExpressionAttributeValues: { ':p': publisherId },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (out.Items ?? []) as IngestRunRow[];
  }
}
