import { S3Client } from '@aws-sdk/client-s3';
import { ClassesSearchClient } from '../services/classesSearchClient';
import { catalogForSeason } from '../services/seasonCatalog';
import { ClassesPublisher } from '../services/classesPublisher';
import {
  institutionSeasonYear,
  runClassesIngest,
  type ClassesIngestMode,
  type ClassesIngestSummary,
} from '../services/classesIngestRunner';

const MODES: ClassesIngestMode[] = ['full', 'spots'];

export interface ClassesIngestEvent {
  /** Which pass to run. Each EventBridge rule sends its own. */
  mode?: string;
  /** Manual invocation can target a season other than the current one. */
  year?: number;
}

/**
 * EventBridge entry point for both class passes (see
 * infrastructure/classes-ingest.tf). One function, two rules: the hourly
 * rule sends `full`, the frequent one sends `spots`.
 *
 * An unrecognized mode is rejected rather than defaulted. Falling back to
 * `full` would turn a typo in a Terraform input into a 466-page crawl on the
 * frequent schedule, against someone else's site — the expensive direction
 * to be wrong in.
 */
export async function scheduledHandler(evt?: ClassesIngestEvent): Promise<ClassesIngestSummary> {
  const mode = (evt?.mode ?? 'full') as ClassesIngestMode;
  if (!MODES.includes(mode)) {
    throw new Error(`[classes-ingest] unknown mode ${JSON.stringify(evt?.mode)} — expected one of ${MODES.join(', ')}`);
  }

  const bucket = process.env.CACHE_S3_BUCKET;
  if (!bucket) {
    throw new Error('[classes-ingest] CACHE_S3_BUCKET is not set');
  }

  const now = new Date();
  const year = evt?.year ?? institutionSeasonYear(now);
  return runClassesIngest({
    client: new ClassesSearchClient(),
    sink: new ClassesPublisher(
      new S3Client({}),
      bucket,
      process.env.CACHE_S3_KEY_PREFIX ?? 'cache/calendar-cache',
    ),
    now,
    year,
    mode,
    catalog: catalogForSeason(year),
  });
}
