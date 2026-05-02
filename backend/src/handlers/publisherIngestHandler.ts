import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
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
        incomingFeed: { events: f.feed.events, publisher: f.feed.publisher },
      });
      await deps.registry.recordFetchOutcome(p.id, {
        status: 'threshold_halt',
        message: result.haltedByThreshold!.reason,
      });
      continue;
    }
    await deps.store.applyDiff(result.diff);
    await deps.registry.recordFetchOutcome(p.id, { status: 'ok' });
  }
  const all = await deps.store.listAllPublished();
  await deps.sidecar.publish(all);
}

export async function scheduledHandler(): Promise<void> {
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  await runIngest({
    registry: new PublisherRegistryService(ddb, process.env.PUBLISHERS_TABLE_NAME!),
    store: new PublisherEventStore(ddb, process.env.PUBLISHER_EVENTS_TABLE_NAME!),
    sidecar: new PublisherSidecarPublisher(
      new S3Client({}),
      process.env.CACHE_S3_BUCKET!,
      process.env.CACHE_S3_KEY_PREFIX!,
    ),
    fetcher: fetchAndParseFeed,
    now: new Date(),
  });
}
