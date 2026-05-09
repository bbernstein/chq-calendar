import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { loadReferences, type VenueReference } from '@chq-calendar/publisher-format';
import { PublisherRegistryService } from '../services/publisherRegistryService';
import { PublisherEventStore, PublisherDeletedDuringApplyError } from '../services/publisherEventStore';
import { PublisherSidecarPublisher } from '../services/publisherSidecarPublisher';
import { fetchAndParseFeed } from '../services/publisherFeedFetcher';
import { reconcile } from '../services/publisherReconciler';
import { PublisherIngestRunStore } from '../services/publisherIngestRunStore';
import { PublisherNotificationService } from '../services/publisherNotificationService';
import { SesMailService } from '../services/mailService';
import type { PublisherRecord } from '../types/publisher';
import type { IngestRunRow, IngestRunCounts, IngestRunTrigger } from '../types/publisherIngestRun';

export interface IngestDeps {
  registry: PublisherRegistryService;
  store: PublisherEventStore;
  sidecar: PublisherSidecarPublisher;
  fetcher: typeof fetchAndParseFeed;
  now: Date;
  // Name of the publishers DynamoDB table. Used by applyDiff's transactional
  // ConditionCheck to atomically refuse the diff if the publisher row was
  // deleted between snapshot and commit.
  publishersTableName: string;
  // Persists per-iteration run rows. Used for the publisher-portal history
  // panel and for streak-detection feeding the notifier.
  runStore: PublisherIngestRunStore;
  // Sends ingest-failure / ingest-recovery / event-rejected emails.
  // Internally bounded by a 2s mail timeout; never propagates failures.
  notifier: PublisherNotificationService;
}

export interface RunIngestOpts {
  // When set, runIngest only processes the named publisher. Used by the
  // self-service `/publisher-fetch-now` endpoint so a publisher can re-pull
  // their own feed without forcing a global scan. The single publisher is
  // routed through the same active/paused/disabled buckets — paused or
  // disabled publishers in single-publisher mode behave the same as in a
  // full scan (paused → skipped, disabled → retracted).
  singlePublisherId?: string;
  // Defaults to 'schedule' on the EventBridge cron path. /publisher-fetch-now
  // passes 'publisher-fetch-now'; the admin "Run ingest now" button passes
  // 'admin'. Recorded onto each run row.
  trigger?: IngestRunTrigger;
}

async function recordRunAndNotify(
  deps: IngestDeps,
  p: PublisherRecord,
  opts: RunIngestOpts,
  newRun: IngestRunRow,
): Promise<void> {
  // We need prevRun to detect streak transitions. If the read throws, we
  // can't tell whether this run is a transition — and a fall-through to
  // `prevRun=undefined` would be interpreted as "first ever run" by the
  // notifier (treats prevRun=undefined as OK), producing a spurious
  // "feed broke" email on every flaky-DDB ingest. Skip the notification
  // entirely on read failure; the run row is still recorded for history.
  let prevRun: IngestRunRow | undefined;
  let prevRunReadOk = true;
  try {
    prevRun = await deps.runStore.getMostRecentRun(p.id);
  } catch (err) {
    console.error(`[publisher-ingest] failed to read most-recent run for ${p.id}; skipping notification:`, err);
    prevRunReadOk = false;
  }
  try {
    await deps.runStore.recordRun(newRun);
  } catch (err) {
    console.error(`[publisher-ingest] failed to record run for ${p.id}:`, err);
  }
  if (prevRunReadOk) {
    await deps.notifier.notifyIngestRunRecorded({ publisher: p, prevRun, newRun });
  }
}

// Belt-and-suspenders: if a CI runner died between the deploy workflow's
// enable step and its cleanup step, the ci-e2e-test publisher could still be
// enabled with [CI-E2E] events live on the public sidecar. This threshold is
// the cutoff after which the next ingest run auto-disables it. Set well above
// the workflow's expected runtime (~5min); the EventBridge ingest rule fires
// hourly so worst-case recovery is ~2h (a runner that dies just after one
// ingest run won't trip the threshold for the next one — the run after that
// catches it).
//
// We compare against `enabledAt` (the timestamp the workflow writes
// alongside enabled=true), NOT lastFetchedAt — lastFetchedAt persists
// across CI runs, so an enabled-true row at the start of a fresh CI test
// always shows a stale lastFetchedAt from the previous deploy. Using
// enabledAt makes "fresh CI run" and "abandoned runner" actually
// distinguishable: a fresh run has enabledAt = ~now; an abandoned runner
// has enabledAt = >threshold ago.
//
// If enabledAt is missing entirely (legacy rows enabled before the
// workflow started writing it) we deliberately do nothing — better to
// leak a row across one safety-net cycle than to disable a publisher
// that's actively being tested by an in-flight runner. Same policy
// applies if enabledAt is present but unparseable: NaN compares as
// false against the threshold, so without an explicit guard the function
// would proceed to disable on garbage input.
export const CI_E2E_PUBLISHER_ID = 'ci-e2e-test';
export const CI_E2E_STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

async function autoDisableStaleCiE2e(
  deps: IngestDeps,
  publishers: PublisherRecord[],
): Promise<void> {
  const ciE2e = publishers.find(p => p.id === CI_E2E_PUBLISHER_ID);
  if (!ciE2e || !ciE2e.enabled || !ciE2e.enabledAt) return;
  const enabledAtMs = new Date(ciE2e.enabledAt).getTime();
  if (Number.isNaN(enabledAtMs)) {
    console.warn(
      `[publisher-ingest] ci-e2e-safety: ignoring unparseable enabledAt=${JSON.stringify(ciE2e.enabledAt)} on ${CI_E2E_PUBLISHER_ID}`,
    );
    return;
  }
  const ageMs = deps.now.getTime() - enabledAtMs;
  if (ageMs <= CI_E2E_STALE_THRESHOLD_MS) return;
  const ageMin = Math.round(ageMs / 60_000);
  console.warn(
    `[publisher-ingest] ci-e2e-safety: disabling ${CI_E2E_PUBLISHER_ID}: enabled=true and enabledAt is ${ageMin}m old`,
  );
  try {
    await deps.registry.setEnabledFlag(CI_E2E_PUBLISHER_ID, false);
    // Mirror onto the in-memory copy so the rest of this run treats it as
    // disabled (retract bucket) without re-reading from DynamoDB.
    ciE2e.enabled = false;
  } catch (err) {
    console.error('[publisher-ingest] ci-e2e-safety: setEnabledFlag failed:', err);
  }
}

export async function runIngest(deps: IngestDeps, opts: RunIngestOpts = {}): Promise<void> {
  // Single Scan: DynamoDB Scan reads every row regardless of FilterExpression,
  // so two scans (listEnabled + listDisabled) doubles RCU for no benefit. The
  // in-memory split also catches publishers whose `enabled` attribute is
  // missing (treated as falsy → disabled), which a `enabled = :f` filter
  // would silently skip.
  let allPublishers;
  if (opts.singlePublisherId) {
    const one = await deps.registry.get(opts.singlePublisherId);
    if (one == null) {
      console.log(
        `[publisher-ingest] singlePublisherId ${opts.singlePublisherId} not found; skipping`,
      );
      // Still re-publish the sidecar — a single-publisher request that hits a
      // missing row is harmless, but skipping the sidecar republish would
      // diverge from the all-publishers branch's contract that every run
      // refreshes the global view.
      const all = await deps.store.listAllPublished();
      await deps.sidecar.publish(all);
      return;
    }
    allPublishers = [one];
  } else {
    allPublishers = await deps.registry.listAll();
    // Run the safety net only on full scans. /publisher-fetch-now and the
    // single-publisher path explicitly target one row; auto-disabling a
    // different publisher there would surprise the caller.
    await autoDisableStaleCiE2e(deps, allPublishers);
  }
  // Three buckets:
  //   - active   (enabled && !paused): re-fetch and reconcile
  //   - paused   (enabled &&  paused): skip entirely; existing events stay
  //   - disabled (!enabled):           retract all events on this run
  const publishers = allPublishers.filter(p => p.enabled && !p.paused);
  const disabled = allPublishers.filter(p => !p.enabled);

  for (const p of publishers) {
    try {
      const f = await deps.fetcher({
        url: p.sourceUrl,
        sourceType: p.sourceType,
        registeredPublisherId: p.id,
      });
      if (f.fetchStatus !== 'ok' || !f.feed) {
        // Prefix each error with its path when it's more specific than the
        // root ("/") so admins can see which field failed validation. For
        // network/JSON errors with path === "/", the path is noise — drop it.
        const message = f.report.errors
          .map(e => (e.path && e.path !== '/' ? `${e.path}: ${e.message}` : e.message))
          .join('; ')
          .slice(0, 500);
        await deps.registry.recordFetchOutcome(p.id, { status: f.fetchStatus, message });
        await recordRunAndNotify(deps, p, opts, {
          publisherId: p.id,
          runAt: deps.now.toISOString(),
          status: f.fetchStatus,
          message,
          triggeredBy: opts.trigger ?? 'schedule',
        });
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
        await recordRunAndNotify(deps, p, opts, {
          publisherId: p.id,
          runAt: deps.now.toISOString(),
          status: 'threshold_halt',
          message: result.haltedByThreshold!.reason.slice(0, 500),
          triggeredBy: opts.trigger ?? 'schedule',
        });
        continue;
      }
      // Defend against a delete-during-ingest race. allPublishers was
      // snapshotted at the top of runIngest, so an admin who deletes a
      // publisher mid-run could otherwise have applyDiff re-insert the
      // publisher's events. The pre-check below catches the obvious case
      // (publisher already gone). The transactional ConditionCheck wired
      // into applyDiff's `requirePublisher` option is the authoritative
      // close — it makes the publisher-row existence check and the events-
      // table writes atomic, so a delete that lands between the get() and
      // the transaction is reliably rejected with TransactionCanceled-
      // Exception (re-thrown as PublisherDeletedDuringApplyError).
      const stillExists = await deps.registry.get(p.id);
      if (stillExists == null) {
        console.log(`[publisher-ingest] publisher ${p.id} was deleted during ingest; skipping applyDiff`);
        continue;
      }
      try {
        await deps.store.applyDiff(result.diff, {
          requirePublisher: { tableName: deps.publishersTableName, id: p.id },
        });
      } catch (err) {
        if (err instanceof PublisherDeletedDuringApplyError) {
          console.log(
            `[publisher-ingest] publisher ${p.id} was deleted between get() and applyDiff; transaction aborted, no events written`,
          );
          continue;
        }
        throw err;
      }
      if (p.pendingThresholdHalt) {
        await deps.registry.setThresholdHalt(p.id, undefined);
      }
      await deps.registry.recordFetchOutcome(p.id, { status: 'ok' });
      const counts: IngestRunCounts = {
        added: result.diff.inserts.length,
        updated: result.diff.updates.length,
        retracted: result.diff.removals.length,
        unchanged: result.diff.unchanged,
      };
      await recordRunAndNotify(deps, p, opts, {
        publisherId: p.id,
        runAt: deps.now.toISOString(),
        status: 'ok',
        counts,
        triggeredBy: opts.trigger ?? 'schedule',
      });
    } catch (err) {
      console.error(`[publisher-ingest] publisher ${p.id} failed:`, err);
      const message = `unhandled error: ${(err as Error).message ?? String(err)}`.slice(0, 500);
      try {
        // This catch fires for unhandled throws from the loop body — DDB
        // errors, reconcile assertion failures, etc. fetchAndParseFeed
        // already returns network_error with cause-unwrapped messages on
        // its own, so don't replicate that logic here; just surface the
        // raw error message.
        await deps.registry.recordFetchOutcome(p.id, {
          status: 'network_error',
          message,
        });
      } catch (recordErr) {
        console.error(`[publisher-ingest] failed to record outcome for ${p.id}:`, recordErr);
      }
      await recordRunAndNotify(deps, p, opts, {
        publisherId: p.id,
        runAt: deps.now.toISOString(),
        status: 'network_error',
        message,
        triggeredBy: opts.trigger ?? 'schedule',
      });
    }
  }
  // Retract events for disabled publishers. Disabling a publisher (enabled=false)
  // is the moderation lever — their previously-published events must disappear
  // from the sidecar on the next ingest run, not linger until manual cleanup.
  // We hard-delete instead of going through the reconciler because the reconciler
  // would skip past events and trip the threshold halt on a 100% removal.
  for (const p of disabled) {
    try {
      const n = await deps.store.deleteAllForPublisher(p.id);
      if (n > 0) {
        console.log(`[publisher-ingest] retracted ${n} event(s) for disabled publisher ${p.id}`);
      }
    } catch (err) {
      console.error(`[publisher-ingest] failed to retract events for disabled publisher ${p.id}:`, err);
    }
  }

  const all = await deps.store.listAllPublished();
  await deps.sidecar.publish(all);
}

export async function scheduledHandler(
  evt?: { singlePublisherId?: string; source?: string; triggeredBy?: string; triggeredAt?: string },
): Promise<void> {
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
  await runIngest(
    {
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
      publishersTableName: process.env.PUBLISHERS_TABLE_NAME!,
      runStore: new PublisherIngestRunStore(ddb, process.env.PUBLISHER_INGEST_RUNS_TABLE_NAME!),
      notifier: new PublisherNotificationService({
        mail: new SesMailService(),
        // Strip a trailing slash from SITE_BASE_URL before joining so the
        // resulting URL doesn't double-slash if the env var is set with a
        // trailing slash. Matches the pattern in publisherAdminService.ts.
        portalUrl: `${(process.env.SITE_BASE_URL ?? 'https://www.chqcal.org').replace(/\/$/, '')}/publish/status/`,
      }),
    },
    { singlePublisherId: evt?.singlePublisherId },
  );
}
