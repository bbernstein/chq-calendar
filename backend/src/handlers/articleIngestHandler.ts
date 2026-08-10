// backend/src/handlers/articleIngestHandler.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { ChqDailyClient } from '../services/chqDailyClient';
import { ArticleStore } from '../services/articleStore';
import { EventSnapshotLoader } from '../services/eventSnapshotLoader';
import { ArticleLinksPublisher } from '../services/articleLinksPublisher';
import { runArticleIngest } from '../services/articleIngestRunner';

/**
 * Hourly EventBridge entry point (see infrastructure/article-ingest.tf).
 * Manual invocation supports { year } to target a non-current season.
 */
export async function scheduledHandler(evt?: { year?: number }): Promise<void> {
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const s3 = new S3Client({});
  const now = new Date();
  await runArticleIngest({
    client: new ChqDailyClient(),
    store: new ArticleStore(ddb, process.env.ARTICLES_TABLE_NAME!),
    loader: new EventSnapshotLoader(s3, process.env.CACHE_S3_BUCKET!, process.env.CACHE_S3_KEY_PREFIX!),
    publisher: new ArticleLinksPublisher(
      s3,
      process.env.CACHE_S3_BUCKET!,
      process.env.CACHE_S3_KEY_PREFIX!,
      process.env.STATE_S3_KEY_PREFIX ?? 'internal/article-links',
      process.env.STATE_S3_BUCKET ?? process.env.CACHE_S3_BUCKET!,
    ),
    now,
    year: evt?.year ?? now.getFullYear(),
  });
}
