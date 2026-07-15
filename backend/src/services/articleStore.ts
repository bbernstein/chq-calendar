import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import type { StoredArticle } from '../types/articles';

const WATERMARK_PK = 'META#watermark';

/**
 * Durable season archive of chqdaily articles plus the ingest watermark.
 * Single-table, string hash key `pk`: `ARTICLE#<wpPostId>` | `META#watermark`.
 */
export class ArticleStore {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async upsertArticle(a: StoredArticle): Promise<void> {
    await this.db.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { pk: `ARTICLE#${a.wpPostId}`, ...a },
      }),
    );
  }

  async listAllArticles(): Promise<StoredArticle[]> {
    const out: StoredArticle[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await this.db.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: 'begins_with(pk, :p)',
          ExpressionAttributeValues: { ':p': 'ARTICLE#' },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of page.Items ?? []) {
        // Copy-then-delete instead of rest-destructuring: the discarded `pk`
        // binding would trip no-unused-vars under --max-warnings=0.
        const copy = { ...(item as StoredArticle & { pk?: string }) };
        delete copy.pk;
        out.push(copy as StoredArticle);
      }
      startKey = page.LastEvaluatedKey;
    } while (startKey);
    return out;
  }

  async getWatermark(): Promise<string | undefined> {
    const out = await this.db.send(
      new GetCommand({ TableName: this.tableName, Key: { pk: WATERMARK_PK } }),
    );
    return (out.Item as { value?: string } | undefined)?.value;
  }

  async setWatermark(iso: string): Promise<void> {
    await this.db.send(
      new PutCommand({ TableName: this.tableName, Item: { pk: WATERMARK_PK, value: iso } }),
    );
  }
}
