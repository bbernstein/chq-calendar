import { S3Client } from '@aws-sdk/client-s3';
import { AudienceAccessClient } from '../services/audienceAccessClient';
import { EventSnapshotLoader } from '../services/eventSnapshotLoader';
import { ProgramLinksPublisher } from '../services/programLinksPublisher';
import { runProgramIngest } from '../services/programIngestRunner';

/**
 * Hourly EventBridge entry point (see infrastructure/program-ingest.tf).
 * Manual invocation supports { year } to target a non-current season.
 */
export async function scheduledHandler(evt?: { year?: number }): Promise<void> {
  const s3 = new S3Client({});
  const now = new Date();
  await runProgramIngest({
    client: new AudienceAccessClient(),
    loader: new EventSnapshotLoader(s3, process.env.CACHE_S3_BUCKET!, process.env.CACHE_S3_KEY_PREFIX!),
    publisher: new ProgramLinksPublisher(
      s3,
      process.env.CACHE_S3_BUCKET!,
      process.env.CACHE_S3_KEY_PREFIX!,
      process.env.STATE_S3_KEY_PREFIX ?? 'internal/program-links',
      process.env.STATE_S3_BUCKET ?? process.env.CACHE_S3_BUCKET!,
    ),
    now,
    year: evt?.year ?? now.getFullYear(),
  });
}
