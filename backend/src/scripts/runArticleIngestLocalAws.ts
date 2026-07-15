/**
 * Full-fidelity local integration run of the Chautauquan Daily article-links
 * pipeline against LOCAL AWS engines (DynamoDB Local + LocalStack S3), so the
 * REAL ArticleStore / EventSnapshotLoader / ArticleLinksPublisher AWS-SDK code
 * is exercised — DynamoDB marshalling + Scan pagination, S3 Get/Put, the
 * NoSuchKey discrimination, and the public/private two-bucket split.
 *
 * This complements runArticleIngestLocal.ts (which file-backs those services
 * for a zero-infra run). Nothing here touches production: DynamoDB is the
 * in-memory docker container, S3 is LocalStack, and the only real network call
 * is the read-only fetch of chqdaily.com's public WordPress API.
 *
 * Prereqs (from repo root):
 *   docker compose up -d dynamodb localstack
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/runArticleIngestLocalAws.ts          # current year
 *   npx ts-node src/scripts/runArticleIngestLocalAws.ts 2026     # explicit year
 *
 * After the run it downloads the generated sidecar from local S3 and writes it
 * to frontend/public/data/article-links-<year>.json so `npm run dev` shows it.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  S3Client,
  CreateBucketCommand,
  ListBucketsCommand,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { ChqDailyClient } from '../services/chqDailyClient';
import { ArticleStore } from '../services/articleStore';
import { EventSnapshotLoader } from '../services/eventSnapshotLoader';
import { ArticleLinksPublisher } from '../services/articleLinksPublisher';
import { runArticleIngest } from '../services/articleIngestRunner';
import type { ArticleLinksFile } from '../types/articles';

const DATA_DIR = path.resolve(__dirname, '../../../frontend/public/data');
const DDB_ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://localhost:4566';
const CREDS = { accessKeyId: 'test', secretAccessKey: 'test' };
const REGION = 'us-east-1';

const TABLE = 'chq-local-articles';
const PUBLIC_BUCKET = 'chq-local-public'; // mirrors the world-readable frontend bucket
const PRIVATE_BUCKET = 'chq-local-private'; // mirrors the OAC-private cache bucket
const CACHE_PREFIX = 'cache/calendar-cache';
const STATE_PREFIX = 'internal/article-links';

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ endpoint: DDB_ENDPOINT, region: REGION, credentials: CREDS }),
);
const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: REGION,
  credentials: CREDS,
  forcePathStyle: true, // required for LocalStack/MinIO (no virtual-host DNS)
});

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function waitForS3(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      await s3.send(new ListBucketsCommand({}));
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`LocalStack S3 not reachable at ${S3_ENDPOINT} — is \`docker compose up -d localstack\` running?`);
}

async function ensureTable(): Promise<void> {
  try {
    await ddb.send(new DescribeTableCommand({ TableName: TABLE }));
    return;
  } catch (err) {
    if ((err as { name?: string }).name !== 'ResourceNotFoundException') throw err;
  }
  await ddb.send(
    new CreateTableCommand({
      TableName: TABLE,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
    }),
  );
  console.log(`   created DynamoDB table ${TABLE}`);
}

async function ensureBucket(bucket: string): Promise<void> {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`   created bucket ${bucket}`);
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw err;
  }
}

async function seedEvents(year: number): Promise<void> {
  const key = `${CACHE_PREFIX}/all-events-${year}.json`;
  const file = path.join(DATA_DIR, `all-events-${year}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${file} — need the season's all-events-${year}.json to seed local S3.`);
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: PUBLIC_BUCKET,
      Key: key,
      Body: fs.readFileSync(file),
      ContentType: 'application/json',
    }),
  );
  console.log(`   seeded s3://${PUBLIC_BUCKET}/${key}`);
}

async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function downloadSidecarToDisk(year: number): Promise<ArticleLinksFile | undefined> {
  const key = `${CACHE_PREFIX}/article-links-${year}.json`;
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: PUBLIC_BUCKET, Key: key }));
    const body = await out.Body!.transformToString();
    fs.writeFileSync(path.join(DATA_DIR, `article-links-${year}.json`), body);
    return JSON.parse(body) as ArticleLinksFile;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const year = Number(process.argv[2]) || new Date().getFullYear();
  console.log(`\n📰 Local AWS-backed article-links ingest for ${year}`);
  console.log(`   DynamoDB: ${DDB_ENDPOINT}   S3: ${S3_ENDPOINT}\n`);

  await waitForS3();
  await ensureTable();
  await ensureBucket(PUBLIC_BUCKET);
  await ensureBucket(PRIVATE_BUCKET);
  await seedEvents(year);

  const summary = await runArticleIngest({
    client: new ChqDailyClient(),
    store: new ArticleStore(ddb, TABLE),
    loader: new EventSnapshotLoader(s3, PUBLIC_BUCKET, CACHE_PREFIX),
    publisher: new ArticleLinksPublisher(
      s3,
      PUBLIC_BUCKET,
      CACHE_PREFIX,
      STATE_PREFIX,
      PRIVATE_BUCKET, // state goes to the private bucket, not the public one
    ),
    now: new Date(),
    year,
  });

  console.log('\nSummary:', JSON.stringify(summary, null, 2));

  const sidecar = await downloadSidecarToDisk(year);
  const links = sidecar?.links ?? {};
  const eventIds = Object.keys(links);
  console.log(`\n${eventIds.length} event(s) matched. Sample:`);
  for (const eventId of eventIds.slice(0, 6)) {
    console.log(`  event ${eventId}:`);
    for (const l of links[eventId]) console.log(`    [${l.kind}] ${l.title}`);
  }

  // Prove the two-bucket security split: state exists in the PRIVATE bucket and
  // NOT in the PUBLIC (world-readable) bucket.
  const stateKey = `${STATE_PREFIX}/article-links-state-${year}.json`;
  const inPrivate = await objectExists(PRIVATE_BUCKET, stateKey);
  const inPublic = await objectExists(PUBLIC_BUCKET, stateKey);
  console.log(
    `\nMatch-state location check: private=${inPrivate} public=${inPublic} ` +
      `(want private=true public=false — scores/reasons stay off the public bucket)`,
  );

  console.log(
    `\n✅ Wrote frontend/public/data/article-links-${year}.json from local S3 — run the frontend dev server to view it.\n`,
  );
}

main().catch(err => {
  console.error('\n❌ Local AWS ingest failed:', err);
  process.exit(1);
});
