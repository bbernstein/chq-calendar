import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { loadReferences, type VenueReference } from '@chq-calendar/publisher-format';
import { PublisherRegistryService } from '../services/publisherRegistryService';
import { PublisherEventStore } from '../services/publisherEventStore';
import { PublisherSidecarPublisher } from '../services/publisherSidecarPublisher';
import { fetchAndParseFeed } from '../services/publisherFeedFetcher';
import { reconcile } from '../services/publisherReconciler';

export interface IngestDeps {
  registry: PublisherRegistryService;
  store: PublisherEventStore;
  sidecar: PublisherSidecarPublisher;
  fetcher: typeof fetchAndParseFeed;
  now: Date;
}

export async function runIngest(deps: IngestDeps): Promise<void> {
  const publishers = await deps.registry.listEnabled();
  for (const p of publishers) {
    try {
      const f = await deps.fetcher({
        url: p.sourceUrl,
        sourceType: p.sourceType,
        registeredPublisherId: p.id,
      });
      if (f.fetchStatus !== 'ok' || !f.feed) {
        const message = f.report.errors.map(e => e.message).join('; ').slice(0, 500);
        await deps.registry.recordFetchOutcome(p.id, { status: f.fetchStatus, message });
        continue;
      }
      const stored = await deps.store.listForPublisher(p.id);
      const result = reconcile({ stored, feed: f.feed, now: deps.now, trustLevel: p.trustLevel });
      if (!result.applied) {
        await deps.registry.setThresholdHalt(p.id, {
          detectedAt: deps.now.toISOString(),
          incomingFeed: {
            eventCount: f.feed.events.length,
            publisherId: f.feed.publisher.id,
          },
        });
        await deps.registry.recordFetchOutcome(p.id, {
          status: 'threshold_halt',
          message: result.haltedByThreshold!.reason,
        });
        continue;
      }
      await deps.store.applyDiff(result.diff);
      if (p.pendingThresholdHalt) {
        await deps.registry.setThresholdHalt(p.id, undefined);
      }
      await deps.registry.recordFetchOutcome(p.id, { status: 'ok' });
    } catch (err) {
      console.error(`[publisher-ingest] publisher ${p.id} failed:`, err);
      try {
        await deps.registry.recordFetchOutcome(p.id, {
          status: 'network_error',
          message: `unhandled error: ${(err as Error).message ?? String(err)}`.slice(0, 500),
        });
      } catch (recordErr) {
        console.error(`[publisher-ingest] failed to record outcome for ${p.id}:`, recordErr);
      }
    }
  }
  const all = await deps.store.listAllPublished();
  await deps.sidecar.publish(all);
}

export async function scheduledHandler(): Promise<void> {
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  // Don't let a missing/malformed refs bundle take down the whole Lambda —
  // unknown venueIds already gracefully pass through unchanged in the
  // sidecar publisher. Worst case: events render with venueId but no name.
  let venuesById = new Map<string, VenueReference>();
  try {
    const refs = loadReferences();
    venuesById = new Map(refs.venues.map(v => [v.id, v]));
  } catch (err) {
    console.warn('[publisher-ingest] failed to load venue refs, venue enrichment disabled:', err);
  }
  await runIngest({
    registry: new PublisherRegistryService(ddb, process.env.PUBLISHERS_TABLE_NAME!),
    store: new PublisherEventStore(ddb, process.env.PUBLISHER_EVENTS_TABLE_NAME!),
    sidecar: new PublisherSidecarPublisher(
      new S3Client({}),
      process.env.CACHE_S3_BUCKET!,
      process.env.CACHE_S3_KEY_PREFIX!,
      venuesById,
    ),
    fetcher: fetchAndParseFeed,
    now: new Date(),
  });
}
