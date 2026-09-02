import { EventsCalendarDataSyncService } from '../services/eventsCalendarDataSyncService';
import { MultiLayerCacheService } from '../services/multiLayerCacheService';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../../.env') });

/**
 * Which season to sync, matching the season the frontend will ask for.
 *
 * The turnover is October 1, not January 1 — the same rule as
 * `EventsCalendarDataSyncService.getDefaultYear` (private, hence restated
 * here) and `frontend/src/lib/constants.ts:getDefaultYear`. A plain
 * `getFullYear()` would sync 2026 all through October while the frontend
 * requested `all-events-2027.json`, reproducing #286's empty calendar three
 * months after it was fixed.
 *
 * `--year=<n>` overrides it. That is how you get a second season on disk to
 * exercise year switching, the off-season landing and previewNextSeason
 * against a realistic local dataset.
 */
function resolveYear(): number {
  const flag = process.argv.find((a) => a.startsWith('--year='));
  if (flag) {
    const parsed = Number(flag.slice('--year='.length));
    if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
      console.error(`Invalid --year value: ${flag}. Expected a year like --year=2027.`);
      process.exit(1);
    }
    return parsed;
  }
  const now = new Date();
  return now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
}

/**
 * Refresh `frontend/public/data/years.json` from the published manifest.
 *
 * This file is tracked, and it is the one artifact of local-data mode that
 * nothing regenerates — it sat six months stale at `[2025, 2026]` while
 * production served `[2025, 2026, 2027]`, so no local checkout could reach
 * 2027 or exercise year switching, the off-season landing or
 * previewNextSeason (#286). Resetting it by hand only restarts that clock;
 * syncing it here is what stops it.
 *
 * Fetched over plain HTTPS from the CDN rather than through the S3 client
 * above: the manifest is public, so this works with no credentials, and it is
 * the same bytes the browser would get. A failure here is a warning, not an
 * error — the feed is what the calendar cannot render without.
 */
async function refreshYearsManifest(): Promise<void> {
  const url = process.env.YEARS_MANIFEST_URL
    || 'https://www.chqcal.org/cache/calendar-cache/years.json';
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`Could not refresh years.json: HTTP ${res.status} from ${url}`);
      return;
    }
    const manifest = await res.json() as { years?: number[]; defaultYear?: number };
    if (!Array.isArray(manifest.years) || typeof manifest.defaultYear !== 'number') {
      console.warn(`Could not refresh years.json: unexpected shape from ${url}`);
      return;
    }
    const outputPath = path.join(__dirname, '../../../../frontend/public/data/years.json');
    await fs.writeFile(outputPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Refreshed years.json (${manifest.years.join(', ')}) at: ${outputPath}`);
  } catch (error) {
    console.warn('Could not refresh years.json:', error instanceof Error ? error.message : error);
  }
}

async function main() {
  // Initialize DynamoDB client
  const dynamoClient = new DynamoDBClient({
    region: process.env.DYNAMODB_REGION || 'us-east-1',
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
    }),
  });

  const docClient = DynamoDBDocumentClient.from(dynamoClient, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });

  const syncService = new EventsCalendarDataSyncService(undefined, docClient);
  
  console.log('Starting data sync...');
  
  try {
    const forceUpdate = process.argv.includes('--force');
    const saveLocal = process.argv.includes('--save-local');
    const year = resolveYear();
    
    let result;
    if (forceUpdate) {
      console.log(`Performing full season sync for ${year}...`);
      result = await syncService.syncAllSeasonEvents(year);
    } else {
      console.log('Performing incremental sync...');
      result = await syncService.performIncrementalSync();
    }
    
    console.log('Sync completed:');
    console.log(`  Success: ${result.success}`);
    console.log(`  Events processed: ${result.eventsProcessed}`);
    console.log(`  Events created: ${result.eventsCreated}`);
    console.log(`  Events updated: ${result.eventsUpdated}`);
    console.log(`  Events deleted: ${result.eventsDeleted}`);
    console.log(`  Errors: ${result.errors.length}`);
    
    if (result.errors.length > 0) {
      console.log('Errors encountered:');
      result.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      });
    }
    
    console.log(`  Duration: ${result.duration}ms`);

    // Now fetch the cached feed the frontend actually reads.
    //
    // The name matters. The frontend requests `all-events-<year>.json`
    // (frontend/src/hooks/useEventData.ts), while the cache also holds a
    // legacy unversioned `all-events.json` — every year at once, ~10MB, and
    // read by nothing. This script wrote that one, under that name, so
    // `npm run sync:local` produced a file the app never requested and the
    // developer was left with an empty calendar and no clue why (#286).
    if (saveLocal || process.argv.includes('--fetch-cache')) {
      console.log(`\nFetching all-events-${year}.json from cache...`);
      
      // Initialize cache service to retrieve the data
      const cacheService = new MultiLayerCacheService({
        memoryTtlMinutes: parseInt(process.env.CACHE_MEMORY_TTL_MINUTES || '60'),
        s3TtlMinutes: parseInt(process.env.CACHE_S3_TTL_MINUTES || '60'),
        s3BucketName: process.env.CACHE_S3_BUCKET || 'chautauqua-calendar-cache',
        s3KeyPrefix: process.env.CACHE_S3_KEY_PREFIX || 'calendar-cache'
      });

      // Get all events (empty filter means all events)
      const allEvents = await cacheService.get({ filters: {}, year });
      
      if (allEvents && allEvents.data) {
        console.log(`Retrieved ${allEvents.data.length} events from cache`);
        
        if (saveLocal) {
          // Save to local file system
          const outputDir = path.join(__dirname, '../../../../frontend/public/data');
          const outputPath = path.join(outputDir, `all-events-${year}.json`);
          
          // Ensure directory exists
          await fs.mkdir(outputDir, { recursive: true });
          
          // Write the file
          await fs.writeFile(outputPath, JSON.stringify(allEvents, null, 2));
          console.log(`\nSaved all-events-${year}.json to: ${outputPath}`);
          await refreshYearsManifest();
          console.log('Set VITE_LOCAL_DATA=true to make the frontend read it; see backend/README-LOCAL-SYNC.md.');
        }
      } else {
        console.log('No events found in cache');
      }
    }

    // Alternative: Direct S3 fetch if cache service doesn't work
    if (process.argv.includes('--fetch-s3-direct')) {
      console.log('\nFetching directly from S3...');
      
      const s3Client = new S3Client({
        region: process.env.AWS_REGION || 'us-east-1',
        ...(process.env.S3_ENDPOINT && {
          endpoint: process.env.S3_ENDPOINT,
          forcePathStyle: true,
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
          },
        }),
      });

      const s3Key = `${process.env.CACHE_S3_KEY_PREFIX || 'calendar-cache'}/all-events-${year}.json`;
      
      try {
        const command = new GetObjectCommand({
          Bucket: process.env.CACHE_S3_BUCKET || 'chautauqua-calendar-cache',
          Key: s3Key,
        });

        const response = await s3Client.send(command);
        const bodyString = await response.Body?.transformToString();
        
        if (bodyString) {
          const cachedData = JSON.parse(bodyString);
          console.log(`Retrieved ${cachedData.data.length} events directly from S3`);
          
          // Save to local file system
          const outputDir = path.join(__dirname, '../../../../frontend/public/data');
          const outputPath = path.join(outputDir, `all-events-${year}.json`);
          
          // Ensure directory exists
          await fs.mkdir(outputDir, { recursive: true });
          
          // Write the file (just the data part, not the cache metadata)
          await fs.writeFile(outputPath, JSON.stringify(cachedData, null, 2));
          console.log(`\nSaved all-events-${year}.json to: ${outputPath}`);
          // Same refresh as the --save-local branch above. This fallback
          // writes the same local files, so it has the same reason to keep
          // years.json current; skipping it here would leave the manifest
          // stale for anyone who reaches for --fetch-s3-direct when the cache
          // service fails, which is the drift this change exists to stop.
          await refreshYearsManifest();
          console.log('Set VITE_LOCAL_DATA=true to make the frontend read it; see backend/README-LOCAL-SYNC.md.');
        }
      } catch (error) {
        console.error('Failed to fetch from S3:', error);
      }
    }
    
  } catch (error) {
    console.error('Sync failed:', error);
    process.exit(1);
  }
}

main();