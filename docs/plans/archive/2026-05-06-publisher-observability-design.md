# Publisher Observability — Design

**Date:** 2026-05-06
**Status:** Approved (brainstorm)
**Author:** Brainstormed with Claude (session 2026-05-06)

## Goal

Turn `/publish/status/` from a configuration screen into an operations dashboard. A publisher should be able to answer three questions without contacting an admin:

1. **Is my feed actually being ingested?** (history of fetch runs with counts)
2. **Which of my events are live, pending review, or rejected — and why?** (per-event status grid)
3. **Will I find out if something breaks?** (email notifications on failure, recovery, and rejection)

## Non-goals

- Threshold-halt as a separate notification category (folded into "feed broke")
- Per-category notification toggles (single on/off switch only)
- Approval-on-each-event emails (seam exists, no-op for now)
- Rate-limiting changes on new endpoints (existing publisher-JWT entry rate-limit covers them)
- Backfill of historical ingest data (day-one history starts at deploy time)
- Pagination on the events grid (acceptable to return all of a publisher's events; revisit if any single publisher exceeds ~500 events)

## Architectural fork chosen

**Approach A — inline `notificationService`.** Email dispatch happens in the ingest Lambda's request path (with a 2s SES timeout that swallows failures). No SQS, no separate notifier Lambda. Volume is small, the existing `mailService` is already used inline for magic-link emails. Refactor to SQS-decoupled later if SES latency or failure rate ever matters.

## Data model

### New DDB table — `chautauqua-calendar-publisher-ingest-runs`

| Field | Type | Notes |
|---|---|---|
| `publisherId` | S, partition key | |
| `runAt` | S, sort key | ISO 8601; descending sort gives newest-first |
| `status` | S | `'ok' \| 'parse_error' \| 'validation_error' \| 'network_error' \| 'threshold_halt'` (matches existing `FetchStatus`) |
| `message` | S, optional | Error/halt reason; same 500-char cap as existing `lastFetchMessage` |
| `counts` | M, optional | `{ added, updated, retracted, unchanged }` — only set when `status === 'ok'` |
| `triggeredBy` | S | `'schedule' \| 'admin' \| 'publisher-fetch-now'` |
| `ttl` | N, optional | Unix seconds, ~90 days out — every row auto-expires; bounds storage without a cleanup job |

Reads use `Query(publisherId)` with `ScanIndexForward=false`. UI listing is `Limit=30`; streak detection is `Limit=1`. No GSIs.

The new ingest-runs row is the single source of truth for the timeline and for streak detection. The existing `lastFetchedAt` / `lastFetchStatus` / `lastFetchMessage` fields on the publisher row stay (they're cheap and used for at-a-glance display in the admin index).

### Reconciler / event-store changes for soft-delete reject

- `StoredPublisherEvent.state` becomes `'published' \| 'pending' \| 'rejected'` (extension of the existing union; absent rows still parse)
- `StoredPublisherEvent.rejectionReason?: string`
- `StoredPublisherEvent.rejectedAt?: string`

`publisherReconciler.toStored` already preserves admin-set `state` (PR #100). Extend that merge so when the existing row has `state === 'rejected'`, both `rejectionReason` and `rejectedAt` are also preserved. If the publisher *removes* the event from their feed, the reconciler treats it as a normal removal and `applyDiff` deletes it — matches the agreed lifetime ("kept until publisher feed drops the event").

The sidecar publisher (`publisherSidecarPublisher.ts`) currently filters out `state === 'pending'`. Extend the filter to also drop `state === 'rejected'` so rejected events never appear on the public calendar.

### `PublisherRecord` additions

- `notificationsEnabled?: boolean` — default-treated-as-true. Toggled in the existing `/publish/status/` profile section.

## Backend services

### New — `publisherIngestRunStore.ts`

Thin wrapper around the new DDB table.

```ts
export interface PublisherIngestRunStore {
  recordRun(row: IngestRunRow): Promise<void>;
  getMostRecentRun(publisherId: string): Promise<IngestRunRow | undefined>;
  listRecentRuns(publisherId: string, limit?: number): Promise<IngestRunRow[]>;
}
```

`recordRun` failure must be caught + logged in the caller; the run already happened, the audit row is best-effort (same posture as `recordFetchOutcome`).

### New — `notificationService.ts`

```ts
export interface PublisherNotificationService {
  notifyIngestRunRecorded(args: {
    publisher: PublisherRecord;
    prevRun: IngestRunRow | undefined;
    newRun: IngestRunRow;
  }): Promise<void>;

  notifyEventRejected(args: {
    publisher: PublisherRecord;
    event: StoredPublisherEvent;
    reason: string | undefined;
  }): Promise<void>;
}
```

**Streak rule** for `notifyIngestRunRecorded`:

| `prevRun.status` | `newRun.status` | Action |
|---|---|---|
| `'ok'` (or undefined) | non-`'ok'` | send `sendIngestFailureEmail` |
| non-`'ok'` | `'ok'` | send `sendIngestRecoveryEmail` |
| any other | any other | no-op |

Each notify call:
1. Short-circuits if `publisher.notificationsEnabled === false`.
2. `await mailService.sendX(...)` with a `Promise.race` 2s timeout.
3. Catches and logs any error or timeout. **A failed notification never fails the caller.**

### Existing service changes

`publisherEventStore.rejectEvent(publisherId, eventId, reason?)` — semantics change:
- Today: `DeleteCommand` with condition `state = pending`.
- New: `UpdateCommand` setting `state = 'rejected'`, `rejectionReason` (omitted when blank/undefined), `rejectedAt = now`. Same `attribute_exists + state = pending` condition.
- Approve-after-reject must continue to fail. The `approveEvent` ConditionExpression `state = pending` already enforces this.

`publisherIngestHandler.runIngest` — per-iteration changes:
1. Read `prevRun = runStore.getMostRecentRun(p.id)` once, before recording the new outcome.
2. Compute `counts` from `result.diff` (today they're computed and dropped on the floor).
3. Build `newRun: IngestRunRow` and call `runStore.recordRun(newRun)`.
4. Continue to call `registry.recordFetchOutcome(...)` (preserves at-a-glance fields and is what the admin index reads).
5. `await notificationService.notifyIngestRunRecorded({ publisher: p, prevRun, newRun })`.

`adminHandler` reject path:
- Parse `reason?: string` from request body. Trim. If non-empty, cap to 500 chars; if empty/missing, pass `undefined`.
- Call `eventStore.rejectEvent(publisherId, eventId, reason)`.
- Call `notificationService.notifyEventRejected({ publisher, event, reason })`.

## Endpoints

| Method | Path | Auth | Returns |
|---|---|---|---|
| `GET` | `/publisher-runs` | Publisher JWT (`requirePublisherSession`) | `{ runs: IngestRunRow[] }` (last 30, newest first) |
| `GET` | `/publisher-events` | Publisher JWT | `{ events: PublisherEventSummary[] }` (all events for the caller's publisher) |
| `PATCH` | `/publisher-profile` | Publisher JWT | (existing) — extended to accept `notificationsEnabled` |

Both new GETs scope to the JWT's `publisherId` claim. A request that tries to read another publisher's data should never even reach the data layer — the existing `requirePublisherSession` already pins identity.

`PublisherEventSummary` shape (excludes the raw feed payload to keep response size reasonable):

```ts
interface PublisherEventSummary {
  eventId: string;
  title: string;
  startDate: string;
  endDate: string;
  state: 'published' | 'pending' | 'rejected';
  rejectionReason?: string;
  rejectedAt?: string;
  updatedAt: string;
}
```

`IngestRunRow` is the same shape that lives in the table.

## Admin UI changes

`/admin/publisher-events/` — reject action gains an optional reason textarea (placeholder: "Why was this rejected? (optional, will be shown to the publisher)"). Submit calls the existing reject endpoint with the reason field. Existing approve action is unchanged.

## Frontend — `/publish/status/` additions

Two new collapsible panels rendered after the existing portal sections:

1. **`IngestHistoryPanel.tsx`** — table of last 30 runs:
   - Columns: timestamp (relative + absolute on hover), status badge (green/red/amber), counts (`+12 ~3 -1`) when present, `triggeredBy`, error message (truncated, expand-on-click).
   - Loaded via new `getPublisherRuns()` in `frontend/src/lib/publisherStatusApi.ts`.
   - Empty state: "No ingest runs yet — your first scheduled fetch will appear here within an hour."

2. **`PublisherEventsPanel.tsx`** — table of the publisher's own events:
   - Columns: title, start date, status badge (`Published` / `Pending review` / `Rejected`), rejection reason (italic muted text under the title when present and non-empty; generic "Removed by admin" when status is rejected and reason is empty).
   - Sort: future events ascending, then past events descending (matches the admin event table pattern).
   - Loaded via new `getPublisherEvents()`.
   - Empty state: "No events ingested yet."

3. **Notifications toggle** added to the existing profile section: a single checkbox "Email me when my feed breaks or an event is rejected" wired through the existing `EditableField`/`patchPublisherProfile` flow.

Both panels follow the existing skeleton/loading/error patterns used elsewhere in `/publish/status/`.

## Email templates

Three new methods on `MailService` and three new bodies in `mailService.ts`:

| Method | Trigger | Subject | Body summary |
|---|---|---|---|
| `sendIngestFailureEmail` | first failure after OK streak | "Your feed broke" | Status, error message, "What to do" line, link to `/publish/status/` |
| `sendIngestRecoveryEmail` | first OK after failure streak | "Your feed is working again" | Counts from this run, link to `/publish/status/` |
| `sendEventRejectedEmail` | admin reject | "Event removed: <title>" | Event title/date, reason (or generic line if blank), link to `/publish/status/` |

All three follow the existing `<pre>`-for-monospace pattern (Outlook 2010–2016 strips font-family from `<p>`). All three are gated by `publisher.notificationsEnabled !== false`.

## Error handling

- Email send failures: caught and logged inside `notificationService`, never propagated.
- New ingest-runs DDB write failure: caught and logged in the caller; the ingest run itself is still considered successful.
- Race — admin deletes publisher mid-ingest: `runIngest` already snapshots `allPublishers` at top. The `notificationService` call uses that snapshot's `notificationsEnabled` value. If SES then fails because the publisher row is gone, the catch-and-log absorbs it.
- Approve-after-reject: still fails, because `approveEvent` requires `state = pending`. The condition's error message becomes user-visible to admin: "cannot approve … not pending or no longer exists."

## Testing

Coverage discipline: this change must maintain or improve the per-package line coverage floors (`backend` 81.1, `frontend` 74.3, enforced via `.coverage-floor.json`). Each new module ships with tests that hit happy path and at least one failure mode.

Backend (jest):
- `notificationService.test.ts` — streak transitions (ok→fail, fail→ok, ok→ok no-op, fail→fail no-op), `notificationsEnabled === false` short-circuit, mail timeout swallow, mail throw swallow.
- `publisherIngestRunStore.test.ts` — record + list ordering + 30-row cap + TTL set.
- `publisherIngestHandler.test.ts` — extend existing tests to assert run rows are written with correct counts and notifications fire on transitions and only on transitions.
- `publisherReconciler.test.ts` — extend the PR #100 preserve-state test to also pin `state='rejected'` + `rejectionReason` + `rejectedAt` survival across re-ingest of unchanged feed events; pin removal-from-feed deletes a rejected row.
- `publisherEventStore.test.ts` — `rejectEvent` now soft-deletes; pin that approve-after-reject fails; pin that the row carries `rejectionReason` and `rejectedAt`.
- `adminHandler.test.ts` — reject body parsing for present/blank/missing/oversized reason.
- Integration: `integration/publisherRunsAndEvents.test.ts` — new GETs scoped to publisher JWT; cross-publisher 403; `notificationsEnabled` toggle persists; ingest-run history populates after a single ingest.

Frontend (vitest + @testing-library/preact):
- `IngestHistoryPanel.test.tsx`, `PublisherEventsPanel.test.tsx` — happy path, empty state, error state, badge mapping, expand-on-click for long error messages.
- Extend `frontend/src/app/publish/status/__tests__/page.test.tsx` to assert the new panels mount and the notifications toggle round-trips through `patchPublisherProfile`.

Smoke test extension: `scripts/post-deploy-publisher-smoke.ts` — add steps that assert `GET /publisher-runs` and `GET /publisher-events` respond 200 with the bbtest publisher's JWT, and that the bbtest publisher accumulates at least one ingest-run row after the smoke's invoke step.

## Migration / rollout

- Terraform — add the new DDB table (`chautauqua-calendar-publisher-ingest-runs`) and grant publisher-ingest Lambda + admin Lambda + portal Lambda read/write as appropriate. TTL attribute = `ttl`.
- IAM — extend the existing publisher-portal Lambda's policy with `dynamodb:Query` on the new table.
- No backfill: the table starts empty and accumulates from the first ingest after deploy. The frontend handles "no runs yet" as a normal empty state, not an error.
- The reject semantic change (delete → soft-delete) is one-way. After deploy any new rejection lands as `state='rejected'`. Pre-existing rejected events were already deleted and don't come back. No data migration needed.
- The `notificationsEnabled` field is optional and absent on existing rows; treated as true. No migration.

## Open questions

None remaining. All design forks resolved during brainstorming:
- Soft-delete with optional reason (not required) — chosen
- New DDB table for ingest runs with last-30 visibility — chosen
- Smart immediate emails (transition-only, single opt-out) — chosen
- Two separate panels, not unified feed — chosen
- Rejected events linger until publisher drops them from feed — chosen
- Inline `notificationService` (not SQS) — chosen
