# Publisher Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bundle three publisher-experience features — ingest history timeline, per-event status grid, and email notifications — so a publisher can self-diagnose feed problems and learn about admin actions without contacting an admin.

**Architecture:** New DDB table for ingest-run history (last 30 per publisher, 90-day TTL); soft-delete reject (`state='rejected'`) preserved across re-ingest; inline `notificationService` with 2s SES timeout that swallows email failures. Two new collapsible panels on `/publish/status/`. One new opt-out flag on the publisher row.

**Tech Stack:** TypeScript, AWS Lambda + DynamoDB + SES, Vite + Preact, Terraform, Jest (backend), Vitest + @testing-library/preact (frontend).

**Spec:** [docs/superpowers/specs/2026-05-06-publisher-observability-design.md](../specs/2026-05-06-publisher-observability-design.md)

**Branch:** Work on `spec/publisher-observability` (the spec lives there). Each task commits to that branch. Open one PR after the full plan completes.

---

## File map

### Backend — new files
- `backend/src/types/publisherIngestRun.ts` — `IngestRunRow`, `IngestRunCounts`, `IngestRunTrigger`
- `backend/src/services/publisherIngestRunStore.ts` — DDB wrapper for the new table
- `backend/src/services/publisherNotificationService.ts` — streak detection + dispatch to mailService
- `backend/src/__tests__/publisherIngestRunStore.test.ts`
- `backend/src/__tests__/publisherNotificationService.test.ts`
- `backend/src/__tests__/integration/publisherRunsAndEvents.test.ts`

### Backend — modified files
- `backend/src/types/publisher.ts` — extend `StoredPublisherEvent.state`; add `rejectionReason`, `rejectedAt`; add `notificationsEnabled` to `PublisherRecord`
- `backend/src/services/publisherEventStore.ts` — `rejectEvent` becomes soft-delete; `listForPublisher` already returns all (no change)
- `backend/src/services/publisherReconciler.ts` — `toStored` preserves rejected state + reason + rejectedAt
- `backend/src/services/publisherSidecarPublisher.ts` — sidecar filters out `state === 'rejected'`
- `backend/src/services/mailService.ts` — three new methods (failure, recovery, eventRejected) + bodies
- `backend/src/services/publisherProfileService.ts` — accept `notificationsEnabled` in update patch
- `backend/src/services/publisherRegistryService.ts` — `updateProfile` allow-list adds `notificationsEnabled`
- `backend/src/handlers/publisherIngestHandler.ts` — wire run-store + notifier
- `backend/src/handlers/publisherPortalHandler.ts` — `GET /publisher-runs`, `GET /publisher-events`; profile patch passes through `notificationsEnabled`
- `backend/src/handlers/adminHandler.ts` — accept reason on reject; call notifier
- `backend/src/__tests__/publisherEventStore.test.ts` — soft-delete reject pins
- `backend/src/__tests__/publisherReconciler.test.ts` — preserve rejected pins
- `backend/src/__tests__/publisherIngestHandler.integration.test.ts` — runs recorded + notifier fires on transitions
- `backend/src/__tests__/publisherSidecarPublisher.test.ts` — rejected filter pin
- `backend/src/__tests__/mailService.test.ts` — three new bodies
- `backend/src/__tests__/publisherProfileService.test.ts` — notificationsEnabled patch
- `backend/src/__tests__/adminHandler.publishers.test.ts` (or new `adminHandler.publisherEvents.test.ts`) — reason parsing

### Frontend — new files
- `frontend/src/app/publish/status/IngestHistoryPanel.tsx`
- `frontend/src/app/publish/status/PublisherEventsPanel.tsx`
- `frontend/src/app/publish/status/__tests__/IngestHistoryPanel.test.tsx`
- `frontend/src/app/publish/status/__tests__/PublisherEventsPanel.test.tsx`

### Frontend — modified files
- `frontend/src/lib/publisherStatusApi.ts` — `getPublisherRuns`, `getPublisherEvents`; `patchPublisherProfile` types extended
- `frontend/src/app/publish/status/page.tsx` — mount panels + notifications checkbox
- `frontend/src/app/publish/status/__tests__/page.test.tsx` — extend for new panels + toggle
- `frontend/src/app/admin/publisher-events/page.tsx` — reason textarea on reject

### Infrastructure — modified files
- `infrastructure/publisher-ingest.tf` — new DDB table + IAM grants

### Smoke / scripts — modified files
- `scripts/post-deploy-publisher-smoke.ts` (or wherever the existing smoke harness lives) — assert `GET /publisher-runs` + `GET /publisher-events` for bbtest; assert at least one run row appears after invoke

---

## Phase 1 — Foundation: types, ingest-run store, soft-delete reject

### Task 1: Type additions

**Files:**
- Modify: `backend/src/types/publisher.ts`
- Create: `backend/src/types/publisherIngestRun.ts`

- [ ] **Step 1: Extend `StoredPublisherEvent` and `PublisherRecord` in `backend/src/types/publisher.ts`**

Edit the `StoredPublisherEvent` interface so `state` accepts `'rejected'`, and add the two new optional fields. Edit `PublisherRecord` to add `notificationsEnabled?: boolean`.

```ts
// in PublisherRecord (insert near `paused?: boolean;`):
  // Single opt-out switch for the publisher-observability email notifications
  // (ingest-failure, ingest-recovery, event-rejected). Operational emails
  // (magic link, email-change verify, self-disable confirmation) are unaffected.
  // Absent → treated as true (default-on for legacy rows).
  notificationsEnabled?: boolean;
```

```ts
// replace the existing StoredPublisherEvent.state line and append two fields:
export interface StoredPublisherEvent {
  publisherId: string;
  eventId: string;
  startDate: string;
  endDate: string;
  lastModified: string;
  payload: FeedEvent & { sourcePublisherId: string; sourcePublisherName: string };
  state: 'published' | 'pending' | 'rejected';
  // Set when admin rejects. Optional so blank reasons are simply absent.
  // Cap at 500 chars in the handler that sets it.
  rejectionReason?: string;
  // ISO 8601 timestamp at which admin rejected. Sidecar/UI uses this to
  // sort rejected items and to show "Rejected on …" in the publisher portal.
  rejectedAt?: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Create `backend/src/types/publisherIngestRun.ts`**

```ts
import type { FetchStatus } from './publisher';

export type IngestRunTrigger = 'schedule' | 'admin' | 'publisher-fetch-now';

export interface IngestRunCounts {
  added: number;
  updated: number;
  retracted: number;
  unchanged: number;
}

export interface IngestRunRow {
  publisherId: string;
  // ISO 8601. Sort key.
  runAt: string;
  status: FetchStatus;
  // Capped at 500 chars by the writer. Optional so OK runs omit it.
  message?: string;
  // Only populated when status === 'ok'.
  counts?: IngestRunCounts;
  triggeredBy: IngestRunTrigger;
  // Unix seconds. ~90 days from runAt. Auto-expires the row.
  ttl?: number;
}
```

- [ ] **Step 3: Run typecheck**

Run: `cd backend && npm run typecheck`
Expected: PASS (no source consumers of the new fields yet)

- [ ] **Step 4: Commit**

```bash
git add backend/src/types/publisher.ts backend/src/types/publisherIngestRun.ts
git commit -m "feat(publisher): add IngestRunRow type, extend StoredPublisherEvent with rejected state"
```

---

### Task 2: PublisherIngestRunStore service

**Files:**
- Create: `backend/src/services/publisherIngestRunStore.ts`
- Test: `backend/src/__tests__/publisherIngestRunStore.test.ts`

Pattern: mirror `publisherRegistryService.ts` (DDB DocumentClient wrapper). Look at it for the `import { DynamoDBDocumentClient, … }` set.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/__tests__/publisherIngestRunStore.test.ts`:

```ts
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { PublisherIngestRunStore } from '../services/publisherIngestRunStore';
import type { IngestRunRow } from '../types/publisherIngestRun';

const TABLE = 'test-runs-table';

function row(overrides: Partial<IngestRunRow> = {}): IngestRunRow {
  return {
    publisherId: 'pub-1',
    runAt: '2026-05-06T12:00:00.000Z',
    status: 'ok',
    triggeredBy: 'schedule',
    counts: { added: 1, updated: 0, retracted: 0, unchanged: 5 },
    ...overrides,
  };
}

describe('PublisherIngestRunStore', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient);
  const docClient = DynamoDBDocumentClient.from({} as never);
  const store = new PublisherIngestRunStore(docClient, TABLE);

  beforeEach(() => ddbMock.reset());

  test('recordRun writes the row with a 90-day TTL', async () => {
    ddbMock.on(PutCommand).resolves({});
    const r = row();
    await store.recordRun(r);
    const call = ddbMock.commandCalls(PutCommand)[0]!;
    expect(call.args[0].input.TableName).toBe(TABLE);
    const item = call.args[0].input.Item as IngestRunRow;
    expect(item.publisherId).toBe('pub-1');
    expect(item.runAt).toBe(r.runAt);
    expect(item.ttl).toBeGreaterThan(Math.floor(Date.parse(r.runAt) / 1000));
    // ~90 days = 7,776,000s
    expect(item.ttl! - Math.floor(Date.parse(r.runAt) / 1000)).toBeGreaterThanOrEqual(7_776_000 - 60);
  });

  test('getMostRecentRun queries with Limit=1, ScanIndexForward=false', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [row()] });
    const got = await store.getMostRecentRun('pub-1');
    expect(got?.publisherId).toBe('pub-1');
    const call = ddbMock.commandCalls(QueryCommand)[0]!;
    expect(call.args[0].input.Limit).toBe(1);
    expect(call.args[0].input.ScanIndexForward).toBe(false);
    expect(call.args[0].input.KeyConditionExpression).toContain('publisherId');
  });

  test('getMostRecentRun returns undefined when table empty', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    expect(await store.getMostRecentRun('pub-1')).toBeUndefined();
  });

  test('listRecentRuns returns at most `limit` rows newest-first', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [row({ runAt: '2026-05-06T12:00:00.000Z' })] });
    const out = await store.listRecentRuns('pub-1', 30);
    expect(out).toHaveLength(1);
    const call = ddbMock.commandCalls(QueryCommand)[0]!;
    expect(call.args[0].input.Limit).toBe(30);
    expect(call.args[0].input.ScanIndexForward).toBe(false);
  });

  test('listRecentRuns defaults limit to 30', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    await store.listRecentRuns('pub-1');
    expect(ddbMock.commandCalls(QueryCommand)[0]!.args[0].input.Limit).toBe(30);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd backend && npx jest publisherIngestRunStore -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `backend/src/services/publisherIngestRunStore.ts`:

```ts
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { IngestRunRow } from '../types/publisherIngestRun';

const NINETY_DAYS_S = 90 * 24 * 60 * 60;

export class PublisherIngestRunStore {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async recordRun(row: IngestRunRow): Promise<void> {
    const ttl = Math.floor(Date.parse(row.runAt) / 1000) + NINETY_DAYS_S;
    await this.db.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { ...row, ttl },
      }),
    );
  }

  async getMostRecentRun(publisherId: string): Promise<IngestRunRow | undefined> {
    const out = await this.db.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'publisherId = :p',
        ExpressionAttributeValues: { ':p': publisherId },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );
    return (out.Items?.[0] as IngestRunRow | undefined) ?? undefined;
  }

  async listRecentRuns(publisherId: string, limit = 30): Promise<IngestRunRow[]> {
    const out = await this.db.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'publisherId = :p',
        ExpressionAttributeValues: { ':p': publisherId },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (out.Items ?? []) as IngestRunRow[];
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd backend && npx jest publisherIngestRunStore -v`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/publisherIngestRunStore.ts backend/src/__tests__/publisherIngestRunStore.test.ts
git commit -m "feat(publisher): PublisherIngestRunStore — record/list ingest runs with 90-day TTL"
```

---

### Task 3: Soft-delete reject in PublisherEventStore

**Files:**
- Modify: `backend/src/services/publisherEventStore.ts:121-137`
- Modify (extend tests): `backend/src/__tests__/publisherEventStore.test.ts`

- [ ] **Step 1: Add failing tests for soft-delete reject**

Open `backend/src/__tests__/publisherEventStore.test.ts` and copy the mock setup from the existing `rejectEvent` test (likely uses `aws-sdk-client-mock` against `DynamoDBDocumentClient`). Replace the existing `rejectEvent` test block with:

```ts
describe('PublisherEventStore.rejectEvent (soft-delete)', () => {
  // Reuse the file's existing `mockClient`, `docClient`, `store`, and `TABLE` constants
  // from the harness above.
  beforeEach(() => ddbMock.reset());

  test('updates state to rejected with reason and rejectedAt', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await store.rejectEvent('pub-1', 'ev-1', 'duplicate of upstream feed');
    const call = ddbMock.commandCalls(UpdateCommand)[0]!;
    const input = call.args[0].input;
    expect(input.UpdateExpression).toContain('SET #s = :rejected');
    expect(input.UpdateExpression).toContain('rejectedAt = :now');
    expect(input.UpdateExpression).toContain('rejectionReason = :reason');
    expect(input.ExpressionAttributeValues![':reason']).toBe('duplicate of upstream feed');
    expect(input.ConditionExpression).toContain('#s = :pending');
  });

  test('omits rejectionReason when reason is undefined', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await store.rejectEvent('pub-1', 'ev-1');
    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.UpdateExpression).not.toContain('rejectionReason');
    expect(input.ExpressionAttributeValues![':reason']).toBeUndefined();
  });

  test('omits rejectionReason when reason is whitespace-only', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await store.rejectEvent('pub-1', 'ev-1', '   ');
    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.UpdateExpression).not.toContain('rejectionReason');
  });

  test('caps reason at 500 chars defensively', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await store.rejectEvent('pub-1', 'ev-1', 'x'.repeat(600));
    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect((input.ExpressionAttributeValues![':reason'] as string).length).toBe(500);
  });

  test('swallows ConditionalCheckFailedException (state !== pending)', async () => {
    const err = Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
    ddbMock.on(UpdateCommand).rejects(err);
    await expect(store.rejectEvent('pub-1', 'ev-1', 'r')).resolves.toBeUndefined();
  });

  test('rethrows other DDB errors', async () => {
    ddbMock.on(UpdateCommand).rejects(new Error('throttle'));
    await expect(store.rejectEvent('pub-1', 'ev-1', 'r')).rejects.toThrow('throttle');
  });

  test('approve-after-reject still fails (existing approve condition rejects state=rejected)', async () => {
    const err = Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
    ddbMock.on(UpdateCommand).rejects(err);
    await expect(store.approveEvent('pub-1', 'ev-1')).rejects.toThrow(/cannot approve/);
  });
});
```

If the existing test file uses an in-memory DDB harness instead of `aws-sdk-client-mock`, mirror that pattern: seed a row, call the method, read the row back, assert fields.

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd backend && npx jest publisherEventStore.test -v`
Expected: FAIL — soft-delete tests fail because the current implementation deletes.

- [ ] **Step 3: Replace `rejectEvent` with soft-delete**

In `backend/src/services/publisherEventStore.ts`, replace the existing `rejectEvent` method (lines 121–137) with:

```ts
async rejectEvent(
  publisherId: string,
  eventId: string,
  reason?: string,
): Promise<void> {
  // Soft-delete: rows transition to state='rejected' (terminal) instead of
  // being deleted. Re-ingest preserves them via publisherReconciler.toStored.
  // The condition `#s = :pending` keeps approve/reject races atomic — same
  // semantics as the previous DeleteCommand. ConditionalCheckFailedException
  // is treated as a no-op (the row is in a state we can't reject from, e.g.
  // already-rejected, already-published, or already-deleted).
  const trimmed = reason?.trim();
  const setParts = ['#s = :rejected', 'rejectedAt = :now', 'updatedAt = :now'];
  const exprValues: Record<string, unknown> = {
    ':rejected': 'rejected',
    ':pending': 'pending',
    ':now': new Date().toISOString(),
  };
  if (trimmed && trimmed.length > 0) {
    setParts.push('rejectionReason = :reason');
    // Caller (adminHandler) is responsible for the 500-char cap; defense in
    // depth here keeps a misbehaving caller from writing huge values.
    exprValues[':reason'] = trimmed.slice(0, 500);
  }
  try {
    await this.db.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { publisherId, eventId },
      UpdateExpression: `SET ${setParts.join(', ')}`,
      ConditionExpression: 'attribute_exists(publisherId) AND #s = :pending',
      ExpressionAttributeNames: { '#s': 'state' },
      ExpressionAttributeValues: exprValues,
    }));
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') return;
    throw err;
  }
}
```

You'll need `UpdateCommand` imported at the top of the file (it's likely already there; if not, add it to the existing `@aws-sdk/lib-dynamodb` import).

- [ ] **Step 4: Run all event-store tests**

Run: `cd backend && npx jest publisherEventStore -v`
Expected: PASS — all soft-delete tests + existing approve tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/publisherEventStore.ts backend/src/__tests__/publisherEventStore.test.ts
git commit -m "feat(publisher): rejectEvent now soft-deletes (state='rejected' + optional reason)"
```

---

### Task 4: Reconciler preserves rejected state across re-ingest

**Files:**
- Modify: `backend/src/services/publisherReconciler.ts:19-47`
- Modify: `backend/src/__tests__/publisherReconciler.test.ts`

- [ ] **Step 1: Add failing test**

Append to `backend/src/__tests__/publisherReconciler.test.ts`:

```ts
describe('reconcile preserves admin-rejected state', () => {
  const fixedNow = new Date('2026-05-06T12:00:00.000Z');

  test('a rejected stored row stays rejected when feed event is unchanged', () => {
    const existing: StoredPublisherEvent = {
      publisherId: 'pub-1',
      eventId: 'ev-1',
      startDate: '2026-07-01T18:00:00.000Z',
      endDate: '2026-07-01T20:00:00.000Z',
      lastModified: '2026-05-01T09:00:00.000Z',
      payload: { /* … */ } as never,
      state: 'rejected',
      rejectionReason: 'duplicate of city-hall keynote',
      rejectedAt: '2026-05-02T10:00:00.000Z',
      updatedAt: '2026-05-02T10:00:00.000Z',
    };
    const feedEvent = {
      id: 'ev-1',
      title: 'Test',
      startDate: existing.startDate,
      endDate: existing.endDate,
      lastModified: '2026-05-05T09:00:00.000Z', // newer
    } as never;
    const feed = { publisher: { id: 'pub-1', name: 'Pub' }, events: [feedEvent] } as never;

    const result = reconcile({ stored: [existing], feed, now: fixedNow, trustLevel: 'review' });
    expect(result.applied).toBe(true);
    // The reconciler's update path triggers because lastModified is newer; we expect
    // the rebuilt row to retain `state='rejected'` AND the reason+rejectedAt fields.
    const updated = result.diff.updates[0]!;
    expect(updated.state).toBe('rejected');
    expect(updated.rejectionReason).toBe('duplicate of city-hall keynote');
    expect(updated.rejectedAt).toBe('2026-05-02T10:00:00.000Z');
  });

  test('publisher dropping a rejected event from feed deletes the row (normal removal)', () => {
    const existing: StoredPublisherEvent = {
      publisherId: 'pub-1',
      eventId: 'ev-1',
      startDate: '2026-07-01T18:00:00.000Z',
      endDate: '2026-07-01T20:00:00.000Z',
      lastModified: '2026-05-01T09:00:00.000Z',
      payload: {} as never,
      state: 'rejected',
      updatedAt: '2026-05-02T10:00:00.000Z',
    };
    const feed = { publisher: { id: 'pub-1', name: 'Pub' }, events: [] } as never;

    const result = reconcile({ stored: [existing], feed, now: fixedNow, trustLevel: 'review' });
    expect(result.applied).toBe(true);
    expect(result.diff.removals).toHaveLength(1);
    expect(result.diff.removals[0]!.eventId).toBe('ev-1');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd backend && npx jest publisherReconciler -v -t "preserves admin-rejected"`
Expected: FAIL — `state` comes back as `'pending'` because `toStored` only checks for `'published'`.

- [ ] **Step 3: Update `toStored` in `publisherReconciler.ts`**

Replace the existing `toStored` function (lines 19–47):

```ts
function toStored(
  ev: FeedEvent,
  publisher: FeedDocument['publisher'],
  trustLevel: TrustLevel,
  nowIso: string,
  existing?: StoredPublisherEvent,
): StoredPublisherEvent {
  // Terminal admin-set states are preserved across re-ingest:
  //  - 'published': admin explicitly approved (or trustLevel='auto' set it)
  //  - 'rejected':  admin explicitly rejected; preserved with reason+rejectedAt
  // The only ways out of these states are admin reset (not implemented) or
  // removal due to feed-absence (handled outside toStored as a normal removal).
  const preserveExisting =
    existing?.state === 'published' || existing?.state === 'rejected';
  const state: StoredPublisherEvent['state'] = preserveExisting
    ? existing!.state
    : trustLevel === 'auto'
      ? 'published'
      : 'pending';

  const out: StoredPublisherEvent = {
    publisherId: publisher.id,
    eventId: ev.id,
    startDate: ev.startDate,
    endDate: ev.endDate,
    lastModified: ev.lastModified,
    payload: { ...ev, sourcePublisherId: publisher.id, sourcePublisherName: publisher.name },
    state,
    updatedAt: nowIso,
  };
  if (existing?.state === 'rejected') {
    if (existing.rejectionReason !== undefined) out.rejectionReason = existing.rejectionReason;
    if (existing.rejectedAt !== undefined) out.rejectedAt = existing.rejectedAt;
  }
  return out;
}
```

- [ ] **Step 4: Run all reconciler tests**

Run: `cd backend && npx jest publisherReconciler -v`
Expected: PASS — all existing tests plus the two new ones.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/publisherReconciler.ts backend/src/__tests__/publisherReconciler.test.ts
git commit -m "feat(publisher): reconciler preserves rejected state + reason across re-ingest"
```

---

### Task 5: Sidecar publisher filters out rejected events

**Files:**
- Modify: `backend/src/services/publisherSidecarPublisher.ts`
- Modify: `backend/src/__tests__/publisherSidecarPublisher.test.ts`

- [ ] **Step 1: Find the existing pending-state filter**

Run: `grep -n "state" backend/src/services/publisherSidecarPublisher.ts`

You're looking for a line that filters or skips events whose `state !== 'published'` (or `state === 'pending'`). The change is to ensure rejected events are also excluded from the public sidecar payload.

- [ ] **Step 2: Add a failing test**

Append to `backend/src/__tests__/publisherSidecarPublisher.test.ts` a test that puts a `state='rejected'` row in the input set and asserts it's excluded from the sidecar output. Mirror the existing pending-state exclusion test.

```ts
test('rejected events are excluded from sidecar payload', () => {
  const rows: StoredPublisherEvent[] = [
    { /* …published row… */, state: 'published' },
    { /* …same shape… */, state: 'rejected' },
  ];
  // Call the sidecar publish function (look at existing tests for the signature)
  const out = buildSidecar(rows /* or whatever the existing test calls */);
  expect(out.events).toHaveLength(1);
  expect(out.events[0].state).toBe('published');
});
```

- [ ] **Step 3: Run failing test**

Run: `cd backend && npx jest publisherSidecarPublisher -v -t "rejected"`
Expected: FAIL — current filter keeps `state !== 'pending'` rows, which lets `'rejected'` through.

- [ ] **Step 4: Tighten the filter**

In `backend/src/services/publisherSidecarPublisher.ts`, change the filter from `state !== 'pending'` (or equivalent) to `state === 'published'`. The exact line depends on the implementation; a positive include is clearer than chasing additional negatives if the union grows again.

```ts
// Before: e.state !== 'pending'
// After:
e.state === 'published'
```

- [ ] **Step 5: Run all sidecar tests**

Run: `cd backend && npx jest publisherSidecarPublisher -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/publisherSidecarPublisher.ts backend/src/__tests__/publisherSidecarPublisher.test.ts
git commit -m "fix(publisher): sidecar excludes rejected events (positive published-only filter)"
```

---

## Phase 2 — Notifications: mail templates and notification service

### Task 6: Three new mail templates

**Files:**
- Modify: `backend/src/services/mailService.ts`
- Modify: `backend/src/__tests__/mailService.test.ts`

- [ ] **Step 1: Define the three new option interfaces and method signatures**

In `backend/src/services/mailService.ts`, after the existing `RejectionEmailOpts` interface, add:

```ts
export interface IngestFailureEmailOpts {
  toEmail: string;
  publisherName: string;
  status: 'parse_error' | 'validation_error' | 'network_error' | 'threshold_halt';
  message: string;
  portalUrl: string; // absolute URL to /publish/status/
}

export interface IngestRecoveryEmailOpts {
  toEmail: string;
  publisherName: string;
  counts: { added: number; updated: number; retracted: number; unchanged: number };
  portalUrl: string;
}

export interface EventRejectedEmailOpts {
  toEmail: string;
  publisherName: string;
  eventTitle: string;
  eventStartDate: string; // ISO 8601
  reason?: string;        // undefined/empty → generic line
  portalUrl: string;
}
```

Add to the `MailService` interface:

```ts
sendIngestFailureEmail(opts: IngestFailureEmailOpts): Promise<{ messageId: string }>;
sendIngestRecoveryEmail(opts: IngestRecoveryEmailOpts): Promise<{ messageId: string }>;
sendEventRejectedEmail(opts: EventRejectedEmailOpts): Promise<{ messageId: string }>;
```

Add corresponding methods to `SesMailService` that delegate to private body-builder functions (mirror the existing `sendApprovalEmail` shape).

- [ ] **Step 2: Add tests for the bodies**

Append to `backend/src/__tests__/mailService.test.ts`:

```ts
describe('SesMailService — observability emails', () => {
  // Reuse the existing SES-mock harness from this file. Each test should
  // capture the SendEmailCommand input and assert on Subject + Body.

  test('sendIngestFailureEmail subject and body include publisher name and error', async () => {
    // Capture call. Assert subject contains 'feed' and 'broke' (or "broken"),
    // contains publisherName and the message string, and contains portalUrl.
    // Body uses <pre> for monospace error blocks (Outlook compat — see PR #88).
  });

  test('sendIngestRecoveryEmail subject signals success and body shows counts', async () => {
    // counts.added etc. should appear in body.
  });

  test('sendEventRejectedEmail with reason includes the reason verbatim', async () => {});

  test('sendEventRejectedEmail without reason shows the generic line', async () => {
    // body should NOT include "Reason:" header line; should include something
    // like "An admin removed this event from the calendar."
  });
});
```

Pattern: look at the existing `sendApprovalEmail` test in the same file for the exact mock + assertion pattern.

- [ ] **Step 3: Run tests to confirm failure**

Run: `cd backend && npx jest mailService -v -t "observability"`
Expected: FAIL — methods not defined yet.

- [ ] **Step 4: Implement bodies**

Add three private body-builder functions and wire each `send…` method through `this.sendEmail(...)` like the existing approval/rejection methods. Use `<pre>` blocks for monospace error messages (per PR #88 and the existing approval template). Subject line guidelines:

- Failure: `[Chautauqua Calendar] Your feed broke`
- Recovery: `[Chautauqua Calendar] Your feed is working again`
- Event rejected: `[Chautauqua Calendar] Event removed: <event title>` (truncate title to 80 chars to keep subject reasonable)

Body shape (text + HTML; mirror existing patterns). Footer link must point to `opts.portalUrl`. The email body must include a one-line "If you don't want these notifications, sign in and turn off email alerts." pointer to the toggle.

- [ ] **Step 5: Run all mail tests**

Run: `cd backend && npx jest mailService -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/mailService.ts backend/src/__tests__/mailService.test.ts
git commit -m "feat(mail): three new templates — ingest-failure, ingest-recovery, event-rejected"
```

---

### Task 7: PublisherNotificationService

**Files:**
- Create: `backend/src/services/publisherNotificationService.ts`
- Test: `backend/src/__tests__/publisherNotificationService.test.ts`

- [ ] **Step 1: Write failing tests**

Create `backend/src/__tests__/publisherNotificationService.test.ts`:

```ts
import { PublisherNotificationService } from '../services/publisherNotificationService';
import type { PublisherRecord } from '../types/publisher';
import type { IngestRunRow } from '../types/publisherIngestRun';

function publisher(overrides: Partial<PublisherRecord> = {}): PublisherRecord {
  return {
    id: 'pub-1',
    name: 'Test Pub',
    contactEmail: 'pub@example.com',
    sourceUrl: 'https://example.com/feed.json',
    sourceType: 'json',
    trustLevel: 'review',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function run(overrides: Partial<IngestRunRow> = {}): IngestRunRow {
  return {
    publisherId: 'pub-1',
    runAt: '2026-05-06T12:00:00.000Z',
    status: 'ok',
    triggeredBy: 'schedule',
    counts: { added: 1, updated: 0, retracted: 0, unchanged: 5 },
    ...overrides,
  };
}

describe('PublisherNotificationService.notifyIngestRunRecorded', () => {
  let mail: { sendIngestFailureEmail: jest.Mock; sendIngestRecoveryEmail: jest.Mock; sendEventRejectedEmail: jest.Mock };
  let svc: PublisherNotificationService;
  beforeEach(() => {
    mail = {
      sendIngestFailureEmail: jest.fn().mockResolvedValue({ messageId: 'm1' }),
      sendIngestRecoveryEmail: jest.fn().mockResolvedValue({ messageId: 'm2' }),
      sendEventRejectedEmail: jest.fn().mockResolvedValue({ messageId: 'm3' }),
    };
    svc = new PublisherNotificationService({ mail: mail as never, portalUrl: 'https://chqcal.org/publish/status/' });
  });

  test('first failure after OK streak sends failure email', async () => {
    await svc.notifyIngestRunRecorded({
      publisher: publisher(),
      prevRun: run({ status: 'ok' }),
      newRun: run({ status: 'parse_error', message: 'expected }', counts: undefined }),
    });
    expect(mail.sendIngestFailureEmail).toHaveBeenCalledTimes(1);
    expect(mail.sendIngestRecoveryEmail).not.toHaveBeenCalled();
  });

  test('first OK after failure streak sends recovery email', async () => {
    await svc.notifyIngestRunRecorded({
      publisher: publisher(),
      prevRun: run({ status: 'network_error', message: 'timeout', counts: undefined }),
      newRun: run({ status: 'ok' }),
    });
    expect(mail.sendIngestRecoveryEmail).toHaveBeenCalledTimes(1);
    expect(mail.sendIngestFailureEmail).not.toHaveBeenCalled();
  });

  test('OK→OK is silent', async () => {
    await svc.notifyIngestRunRecorded({
      publisher: publisher(),
      prevRun: run({ status: 'ok' }),
      newRun: run({ status: 'ok' }),
    });
    expect(mail.sendIngestFailureEmail).not.toHaveBeenCalled();
    expect(mail.sendIngestRecoveryEmail).not.toHaveBeenCalled();
  });

  test('failure→failure is silent (consecutive failures suppress repeat email)', async () => {
    await svc.notifyIngestRunRecorded({
      publisher: publisher(),
      prevRun: run({ status: 'parse_error' }),
      newRun: run({ status: 'network_error' }),
    });
    expect(mail.sendIngestFailureEmail).not.toHaveBeenCalled();
  });

  test('first ever run that fails sends failure email (prevRun undefined treated as OK)', async () => {
    await svc.notifyIngestRunRecorded({
      publisher: publisher(),
      prevRun: undefined,
      newRun: run({ status: 'parse_error' }),
    });
    expect(mail.sendIngestFailureEmail).toHaveBeenCalledTimes(1);
  });

  test('first ever run that succeeds is silent', async () => {
    await svc.notifyIngestRunRecorded({
      publisher: publisher(),
      prevRun: undefined,
      newRun: run({ status: 'ok' }),
    });
    expect(mail.sendIngestFailureEmail).not.toHaveBeenCalled();
    expect(mail.sendIngestRecoveryEmail).not.toHaveBeenCalled();
  });

  test('notificationsEnabled === false short-circuits', async () => {
    await svc.notifyIngestRunRecorded({
      publisher: publisher({ notificationsEnabled: false }),
      prevRun: run({ status: 'ok' }),
      newRun: run({ status: 'parse_error' }),
    });
    expect(mail.sendIngestFailureEmail).not.toHaveBeenCalled();
  });

  test('mail throw is swallowed and logged (does not propagate)', async () => {
    mail.sendIngestFailureEmail.mockRejectedValueOnce(new Error('SES down'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(svc.notifyIngestRunRecorded({
      publisher: publisher(),
      prevRun: run({ status: 'ok' }),
      newRun: run({ status: 'parse_error' }),
    })).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  test('mail timeout (>2s) is swallowed', async () => {
    mail.sendIngestFailureEmail.mockImplementation(() => new Promise(() => {})); // never resolves
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.useFakeTimers();
    const promise = svc.notifyIngestRunRecorded({
      publisher: publisher(),
      prevRun: run({ status: 'ok' }),
      newRun: run({ status: 'parse_error' }),
    });
    jest.advanceTimersByTime(2_001);
    await expect(promise).resolves.toBeUndefined();
    jest.useRealTimers();
    errSpy.mockRestore();
  });
});

describe('PublisherNotificationService.notifyEventRejected', () => {
  test('sends rejection email with reason verbatim', async () => {
    const mail = { sendEventRejectedEmail: jest.fn().mockResolvedValue({ messageId: 'x' }) };
    const svc = new PublisherNotificationService({ mail: mail as never, portalUrl: 'https://chqcal.org/publish/status/' });
    await svc.notifyEventRejected({
      publisher: publisher(),
      event: { eventId: 'ev-1', startDate: '2026-07-01T18:00:00Z', payload: { title: 'Symphony' } } as never,
      reason: 'duplicate',
    });
    expect(mail.sendEventRejectedEmail).toHaveBeenCalledWith(expect.objectContaining({
      eventTitle: 'Symphony',
      reason: 'duplicate',
    }));
  });

  test('reason undefined still sends email (body shows generic line)', async () => {
    const mail = { sendEventRejectedEmail: jest.fn().mockResolvedValue({ messageId: 'x' }) };
    const svc = new PublisherNotificationService({ mail: mail as never, portalUrl: 'https://chqcal.org/publish/status/' });
    await svc.notifyEventRejected({
      publisher: publisher(),
      event: { eventId: 'ev-1', startDate: '2026-07-01T18:00:00Z', payload: { title: 'Symphony' } } as never,
      reason: undefined,
    });
    expect(mail.sendEventRejectedEmail).toHaveBeenCalledWith(expect.objectContaining({
      reason: undefined,
    }));
  });

  test('notificationsEnabled === false short-circuits', async () => {
    const mail = { sendEventRejectedEmail: jest.fn() };
    const svc = new PublisherNotificationService({ mail: mail as never, portalUrl: 'https://chqcal.org/publish/status/' });
    await svc.notifyEventRejected({
      publisher: publisher({ notificationsEnabled: false }),
      event: { eventId: 'ev-1', startDate: '2026-07-01T18:00:00Z', payload: { title: 'X' } } as never,
      reason: 'r',
    });
    expect(mail.sendEventRejectedEmail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `cd backend && npx jest publisherNotificationService -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `backend/src/services/publisherNotificationService.ts`:

```ts
import type { MailService } from './mailService';
import type { PublisherRecord } from '../types/publisher';
import type { IngestRunRow } from '../types/publisherIngestRun';
import type { StoredPublisherEvent } from '../types/publisher';

const MAIL_TIMEOUT_MS = 2_000;

export interface NotifyIngestRunArgs {
  publisher: PublisherRecord;
  prevRun: IngestRunRow | undefined;
  newRun: IngestRunRow;
}

export interface NotifyEventRejectedArgs {
  publisher: PublisherRecord;
  event: StoredPublisherEvent;
  reason: string | undefined;
}

export interface PublisherNotificationServiceDeps {
  mail: MailService;
  // Absolute URL to the publisher portal status page; used in email bodies.
  portalUrl: string;
}

export class PublisherNotificationService {
  constructor(private readonly deps: PublisherNotificationServiceDeps) {}

  async notifyIngestRunRecorded(args: NotifyIngestRunArgs): Promise<void> {
    if (args.publisher.notificationsEnabled === false) return;

    const prevOk = args.prevRun === undefined || args.prevRun.status === 'ok';
    const newOk = args.newRun.status === 'ok';

    if (prevOk && !newOk) {
      await this.guarded(() =>
        this.deps.mail.sendIngestFailureEmail({
          toEmail: args.publisher.contactEmail,
          publisherName: args.publisher.name,
          status: args.newRun.status as Exclude<IngestRunRow['status'], 'ok'>,
          message: args.newRun.message ?? '(no message)',
          portalUrl: this.deps.portalUrl,
        }),
      );
      return;
    }
    if (!prevOk && newOk) {
      await this.guarded(() =>
        this.deps.mail.sendIngestRecoveryEmail({
          toEmail: args.publisher.contactEmail,
          publisherName: args.publisher.name,
          counts: args.newRun.counts ?? { added: 0, updated: 0, retracted: 0, unchanged: 0 },
          portalUrl: this.deps.portalUrl,
        }),
      );
      return;
    }
    // ok→ok or fail→fail: silent.
  }

  async notifyEventRejected(args: NotifyEventRejectedArgs): Promise<void> {
    if (args.publisher.notificationsEnabled === false) return;
    const title = (args.event.payload as { title?: string } | undefined)?.title ?? '(untitled)';
    await this.guarded(() =>
      this.deps.mail.sendEventRejectedEmail({
        toEmail: args.publisher.contactEmail,
        publisherName: args.publisher.name,
        eventTitle: title,
        eventStartDate: args.event.startDate,
        reason: args.reason && args.reason.trim().length > 0 ? args.reason.trim() : undefined,
        portalUrl: this.deps.portalUrl,
      }),
    );
  }

  // Bound failure-mode wrapper. Email is best-effort; a failed/late mail call
  // must NOT cause the caller (ingest loop, admin handler) to fail. Errors and
  // timeouts are logged and swallowed.
  private async guarded(fn: () => Promise<unknown>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<'__timeout__'>(resolve => {
        timer = setTimeout(() => resolve('__timeout__'), MAIL_TIMEOUT_MS);
      });
      const result = await Promise.race([fn(), timeout]);
      if (result === '__timeout__') {
        console.error('[notification] mail send timed out after 2s');
      }
    } catch (err) {
      console.error('[notification] mail send failed:', err);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd backend && npx jest publisherNotificationService -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/publisherNotificationService.ts backend/src/__tests__/publisherNotificationService.test.ts
git commit -m "feat(publisher): PublisherNotificationService with streak-transition rule + 2s mail timeout"
```

---

## Phase 3 — Wire ingest pipeline

### Task 8: Wire run-store + notifier into runIngest

**Files:**
- Modify: `backend/src/handlers/publisherIngestHandler.ts`
- Modify: `backend/src/__tests__/publisherIngestHandler.integration.test.ts`

- [ ] **Step 1: Extend ingest deps with the new collaborators**

Find the `IngestDeps` interface in `publisherIngestHandler.ts` (search the file). Add:

```ts
runStore: PublisherIngestRunStore;
notifier: PublisherNotificationService;
// Where the ingest invocation came from. Default 'schedule' from
// scheduledHandler. /publisher-fetch-now passes 'publisher-fetch-now'.
// Admin /publishers/run-ingest passes 'admin'. Recorded onto each run row.
trigger?: IngestRunTrigger;
```

Update `scheduledHandler` in the same file to construct both new deps from environment variables. The new env var:

- `PUBLISHER_INGEST_RUNS_TABLE_NAME` (Terraform task adds it)
- `PORTAL_URL` (already passed to other publisher Lambdas; reuse)

- [ ] **Step 2: Add a failing integration test**

Append to `backend/src/__tests__/publisherIngestHandler.integration.test.ts`:

```ts
describe('runIngest records run rows + fires notifications on transitions', () => {
  test('OK run records row with counts and does not email when prev was OK', async () => {
    // Set up: registry with one publisher pub-1; runStore.getMostRecentRun → run({status:'ok'}).
    // fetcher returns ok feed with 1 new event.
    // Expect: runStore.recordRun called once with status='ok' and counts.added=1; notifier.notifyIngestRunRecorded called once with prevRun.status='ok' and newRun.status='ok' (no email actually sent — that's notifier's decision, not the test's).
  });

  test('OK→failure transition triggers failure email', async () => {
    // Set up: runStore.getMostRecentRun → run({status:'ok'}).
    // fetcher returns parse_error.
    // Mock mailService directly. Expect sendIngestFailureEmail called.
  });

  test('threshold_halt records a run row and marks halt; first transition emails', async () => {
    // Set up: fetcher returns a feed that triggers the reconciler threshold halt.
    // Expect: runStore.recordRun called with status='threshold_halt'; existing setThresholdHalt also called.
  });

  test('mail failure does not break ingest', async () => {
    // mailService.sendIngestFailureEmail rejects. runIngest still resolves; runStore.recordRun still called.
  });
});
```

- [ ] **Step 3: Run failing test**

Run: `cd backend && npx jest publisherIngestHandler.integration -v`
Expected: FAIL.

- [ ] **Step 4: Wire the calls in `runIngest`**

Inside the `for (const p of publishers)` loop in `runIngest`, after the existing logic that calls `recordFetchOutcome`, add (in each branch):

```ts
// After: deps.registry.recordFetchOutcome(p.id, { status: f.fetchStatus, message }) for fetch failures
const prevRun = await deps.runStore.getMostRecentRun(p.id).catch(() => undefined);
const newRun: IngestRunRow = {
  publisherId: p.id,
  runAt: deps.now.toISOString(),
  status: f.fetchStatus,
  message,
  triggeredBy: deps.trigger ?? 'schedule',
};
await deps.runStore.recordRun(newRun).catch(err => {
  console.error(`[publisher-ingest] failed to record run for ${p.id}:`, err);
});
await deps.notifier.notifyIngestRunRecorded({ publisher: p, prevRun, newRun });
continue;
```

For the threshold-halt branch, the row's `status` is `'threshold_halt'` and `message` is `result.haltedByThreshold!.reason`.

For the OK branch (after `applyDiff` succeeds), the row carries `counts` derived from `result.diff`:

```ts
const counts: IngestRunCounts = {
  added: result.diff.inserts.length,
  updated: result.diff.updates.length,
  retracted: result.diff.removals.length,
  unchanged: result.diff.unchanged,
};
const prevRun = await deps.runStore.getMostRecentRun(p.id).catch(() => undefined);
const newRun: IngestRunRow = {
  publisherId: p.id,
  runAt: deps.now.toISOString(),
  status: 'ok',
  counts,
  triggeredBy: deps.trigger ?? 'schedule',
};
await deps.runStore.recordRun(newRun).catch(err => {
  console.error(`[publisher-ingest] failed to record run for ${p.id}:`, err);
});
await deps.notifier.notifyIngestRunRecorded({ publisher: p, prevRun, newRun });
```

For the unhandled-throw catch block (network errors, DDB errors), also record a run row with `status: 'network_error'` and the same swallow-on-failure pattern.

- [ ] **Step 5: Run integration tests**

Run: `cd backend && npx jest publisherIngestHandler.integration -v`
Expected: PASS.

- [ ] **Step 6: Run full backend test suite**

Run: `cd backend && npm test`
Expected: PASS — full suite green; coverage at or above existing floor.

- [ ] **Step 7: Commit**

```bash
git add backend/src/handlers/publisherIngestHandler.ts backend/src/__tests__/publisherIngestHandler.integration.test.ts
git commit -m "feat(publisher): record ingest runs + fire notifications in runIngest loop"
```

---

## Phase 4 — Wire admin reject

### Task 9: Admin reject accepts reason and notifies

**Files:**
- Modify: `backend/src/handlers/adminHandler.ts:765-774`
- Modify: `backend/src/services/publisherAdminService.ts` (the `rejectEvent` method that calls into `publisherEventStore.rejectEvent`)
- Modify: `backend/src/__tests__/adminHandler.publishers.test.ts` (or create `adminHandler.publisherEvents.test.ts` — pick whichever matches existing layout)

- [ ] **Step 1: Add failing tests**

Find the existing test that covers `POST /publisher-events/<pid>/<eid>/reject` and extend it. The new pins:

```ts
test('reject with body { reason } passes reason through to eventStore', async () => {
  const mockReject = jest.fn().mockResolvedValue(undefined);
  // Wire the admin path through; supply request body { reason: 'duplicate of upstream' }.
  // Assert eventStore.rejectEvent called with ('pub-1', 'ev-1', 'duplicate of upstream').
  // Assert notifier.notifyEventRejected called with the same reason.
});

test('reject with empty body succeeds and passes undefined reason', async () => {
  // body {} or no body.
  // Assert eventStore.rejectEvent called with ('pub-1', 'ev-1', undefined).
});

test('reject caps reason at 500 chars before passing through', async () => {
  // body { reason: 'x'.repeat(600) }
  // Assert eventStore.rejectEvent received a 500-char string.
});

test('reject returns 204 on success', async () => {});

test('reject returns 500 if eventStore throws', async () => {});
```

- [ ] **Step 2: Run failing tests**

Run: `cd backend && npx jest adminHandler -v -t "reject"`
Expected: FAIL.

- [ ] **Step 3: Update admin reject path**

In `adminHandler.ts` around line 765 replace the existing block with:

```ts
const matchReject = path.match(/^\/publisher-events\/([^/]+)\/([^/]+)\/reject$/);
if (matchReject && httpMethod === 'POST') {
  try {
    const publisherId = decodeURIComponent(matchReject[1]);
    const eventId = decodeURIComponent(matchReject[2]);
    const body = parseJsonBody(event.body) as { reason?: unknown } | null;
    const rawReason = typeof body?.reason === 'string' ? body.reason : undefined;
    const trimmed = rawReason?.trim();
    const reason = trimmed && trimmed.length > 0 ? trimmed.slice(0, 500) : undefined;
    const event_ = await publisherAdmin().getEvent(publisherId, eventId); // for notifier
    await publisherAdmin().rejectEvent(publisherId, eventId, reason);
    if (event_) {
      const publisher = await publisherRegistry().get(publisherId);
      if (publisher) {
        await notifier().notifyEventRejected({ publisher, event: event_, reason });
      }
    }
    return createResponse(204, {});
  } catch (error) {
    console.error('Error rejecting publisher event:', error);
    return createResponse(500, { error: 'Failed to reject event' });
  }
}
```

You'll need to:
- Add a `getEvent(publisherId, eventId)` method on `publisherAdminService` that returns the `StoredPublisherEvent` or `undefined`. Mirror existing `getApplication` shape.
- Add a `notifier()` factory function near the top of `adminHandler.ts` mirroring `publisherAdmin()` / `publisherRegistry()` (lazy-construct from env vars; cache the instance).
- Update `publisherAdmin().rejectEvent(publisherId, eventId, reason?)` signature to forward the third arg to `eventStore.rejectEvent(publisherId, eventId, reason)`.
- `parseJsonBody` likely exists already; if not, write `function parseJsonBody(b: string | null): unknown { try { return b ? JSON.parse(b) : null; } catch { return null; } }`.

The `notifier.notifyEventRejected` call is `await`ed but its internal `guarded()` swallows failures, so it cannot fail this handler.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd backend && npx jest adminHandler -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/handlers/adminHandler.ts backend/src/services/publisherAdminService.ts backend/src/__tests__/adminHandler.publishers.test.ts
git commit -m "feat(admin): reject endpoint accepts optional reason; notifier emails publisher"
```

---

## Phase 5 — New endpoints

### Task 10: GET /publisher-runs

**Files:**
- Modify: `backend/src/handlers/publisherPortalHandler.ts`
- Modify: `backend/src/__tests__/publisherPortalHandler.status.test.ts` (or create `publisherPortalHandler.runs.test.ts`)

- [ ] **Step 1: Failing test**

Append (or new file):

```ts
describe('GET /publisher-runs', () => {
  test('returns last 30 runs for the JWT publisher', async () => {
    // Mock requirePublisherSession to return { publisherId: 'pub-1', tokenVersion: 0 }
    // Mock runStore.listRecentRuns → an array of 30 IngestRunRow.
    // Call handler with method=GET path=/publisher-runs.
    // Expect 200 + JSON { runs: [...] } where runs.length === 30.
    // Expect runStore.listRecentRuns called with ('pub-1', 30).
  });

  test('401 when no session', async () => {});
  test('returns empty array when no runs', async () => {});
});
```

- [ ] **Step 2: Run failing test**

Run: `cd backend && npx jest publisherPortalHandler -v -t "publisher-runs"`
Expected: FAIL.

- [ ] **Step 3: Add the endpoint**

In `publisherPortalHandler.ts`, add a new route handler near `/publisher-status`:

```ts
// ─── GET /publisher-runs (publisher JWT) ─────────────────────────────────
//
// Returns the caller's own ingest-run history (last 30, newest-first). Used by
// the IngestHistoryPanel on /publish/status/. Pending/rejected applicants get
// the same 401 path as /publisher-status — only approved publishers see runs.
export async function handlePublisherRuns(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  try {
    const session = await requirePublisherSession(event);
    if (session.kind !== 'ok') return session.response;
    const runs = await runStore().listRecentRuns(session.publisherId, 30);
    return createResponse(200, { runs });
  } catch (err) {
    console.error('Error in /publisher-runs:', err);
    return createResponse(500, { error: 'Internal server error' });
  }
}
```

Add `runStore()` factory near the existing `statusRegistry()` / `publisherProfile()` factories. Read the table name from `PUBLISHER_INGEST_RUNS_TABLE_NAME`.

Wire the route in the handler dispatcher (alongside `case '/publisher-status'` etc.):

```ts
if (path === '/publisher-runs' && httpMethod === 'GET') {
  return handlePublisherRuns(event);
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npx jest publisherPortalHandler -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/handlers/publisherPortalHandler.ts backend/src/__tests__/publisherPortalHandler.runs.test.ts
git commit -m "feat(publisher): GET /publisher-runs endpoint"
```

---

### Task 11: GET /publisher-events

**Files:**
- Modify: `backend/src/handlers/publisherPortalHandler.ts`
- Test: alongside Task 10 tests

- [ ] **Step 1: Failing test**

```ts
describe('GET /publisher-events', () => {
  test('returns event summaries for the JWT publisher', async () => {
    // Mock eventStore.listForPublisher → 3 rows: published, pending, rejected.
    // Call handler with method=GET path=/publisher-events.
    // Expect 200 + JSON { events: [...] } with three items.
    // Each item has eventId, title, startDate, endDate, state. Rejected one has rejectionReason + rejectedAt. payload is NOT included.
  });

  test('401 when no session', async () => {});

  test('cross-publisher isolation: scoped to JWT publisherId', async () => {
    // listForPublisher should be called with the JWT publisherId, never another value.
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `cd backend && npx jest publisherPortalHandler -v -t "publisher-events"`
Expected: FAIL.

- [ ] **Step 3: Add the endpoint**

```ts
// ─── GET /publisher-events (publisher JWT) ───────────────────────────────
export interface PublisherEventSummary {
  eventId: string;
  title: string;
  startDate: string;
  endDate: string;
  state: 'published' | 'pending' | 'rejected';
  rejectionReason?: string;
  rejectedAt?: string;
  updatedAt: string;
}

function toSummary(e: StoredPublisherEvent): PublisherEventSummary {
  const out: PublisherEventSummary = {
    eventId: e.eventId,
    title: (e.payload as { title?: string }).title ?? '(untitled)',
    startDate: e.startDate,
    endDate: e.endDate,
    state: e.state,
    updatedAt: e.updatedAt,
  };
  if (e.rejectionReason) out.rejectionReason = e.rejectionReason;
  if (e.rejectedAt) out.rejectedAt = e.rejectedAt;
  return out;
}

export async function handlePublisherEvents(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  try {
    const session = await requirePublisherSession(event);
    if (session.kind !== 'ok') return session.response;
    const rows = await eventStore().listForPublisher(session.publisherId);
    return createResponse(200, { events: rows.map(toSummary) });
  } catch (err) {
    console.error('Error in /publisher-events:', err);
    return createResponse(500, { error: 'Internal server error' });
  }
}
```

Wire the route:

```ts
if (path === '/publisher-events' && httpMethod === 'GET') {
  return handlePublisherEvents(event);
}
```

Note: `/publisher-events/pending` already exists on the *admin* handler. The new `/publisher-events` here is on the *portal* handler (different Lambda, different IAM, different auth gate). API Gateway routing must point `GET /publisher-events` (no suffix) to the portal Lambda. Verify the Terraform routing assignment when wiring infra.

- [ ] **Step 4: Run tests**

Run: `cd backend && npx jest publisherPortalHandler -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/handlers/publisherPortalHandler.ts backend/src/__tests__/publisherPortalHandler.runs.test.ts
git commit -m "feat(publisher): GET /publisher-events endpoint (publisher-scoped event summaries)"
```

---

### Task 12: PATCH /publisher-profile accepts notificationsEnabled

**Files:**
- Modify: `backend/src/services/publisherProfileService.ts`
- Modify: `backend/src/services/publisherRegistryService.ts`
- Modify: `backend/src/handlers/publisherPortalHandler.ts` (the existing PATCH /publisher-profile path, around line 538)
- Modify: `backend/src/__tests__/publisherProfileService.test.ts` and `backend/src/__tests__/publisherPortalHandler.profile.test.ts`

- [ ] **Step 1: Failing tests**

In `publisherProfileService.test.ts`:

```ts
test('updateProfile accepts notificationsEnabled boolean', async () => {
  // Call svc.updateProfile('pub-1', { notificationsEnabled: false }).
  // Assert registry.updateProfile called with { notificationsEnabled: false }.
});

test('updateProfile rejects non-boolean notificationsEnabled with validation error', async () => {
  await expect(svc.updateProfile('pub-1', { notificationsEnabled: 'yes' as never }))
    .rejects.toThrow();
});
```

In `publisherPortalHandler.profile.test.ts` (extend existing tests):

```ts
test('PATCH /publisher-profile { notificationsEnabled: false } persists', async () => {
  // Hit handler with body { notificationsEnabled: false }.
  // Expect 200; the returned PublisherStatusRecord includes notificationsEnabled: false.
});
```

- [ ] **Step 2: Run failing tests**

Run: `cd backend && npx jest publisherProfileService publisherPortalHandler.profile -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `publisherProfileService.ts`, extend the patch input type / validator to allow `notificationsEnabled?: boolean`. Look at the existing field allow-list and mirror.

In `publisherRegistryService.ts` `updateProfile` method (around line 211), include `notificationsEnabled` in the `setParts` builder allow-list. Skip if `undefined`; allow explicit `false`.

In `publisherPortalHandler.ts` PATCH handler around line 538, surface `notificationsEnabled` in the returned `PublisherStatusRecord` payload (it's just a passthrough of the field).

- [ ] **Step 4: Run tests**

Run: `cd backend && npx jest -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/publisherProfileService.ts backend/src/services/publisherRegistryService.ts backend/src/handlers/publisherPortalHandler.ts backend/src/__tests__/publisherProfileService.test.ts backend/src/__tests__/publisherPortalHandler.profile.test.ts
git commit -m "feat(publisher): PATCH /publisher-profile accepts notificationsEnabled toggle"
```

---

## Phase 6 — Frontend

### Task 13: publisherStatusApi additions

**Files:**
- Modify: `frontend/src/lib/publisherStatusApi.ts`

- [ ] **Step 1: Add types and fetchers**

Append:

```ts
export interface IngestRunCounts {
  added: number;
  updated: number;
  retracted: number;
  unchanged: number;
}

export type IngestRunStatus = 'ok' | 'parse_error' | 'validation_error' | 'network_error' | 'threshold_halt';

export interface IngestRunSummary {
  publisherId: string;
  runAt: string;
  status: IngestRunStatus;
  message?: string;
  counts?: IngestRunCounts;
  triggeredBy: 'schedule' | 'admin' | 'publisher-fetch-now';
}

export interface PublisherEventSummary {
  eventId: string;
  title: string;
  startDate: string;
  endDate: string;
  state: 'published' | 'pending' | 'rejected';
  rejectionReason?: string;
  rejectedAt?: string;
  updatedAt: string;
}

export async function getPublisherRuns(): Promise<IngestRunSummary[]> {
  const res = await authedFetch('/publisher-runs');
  if (!res.ok) throw new Error(`Failed to load runs: ${res.status}`);
  const body = (await res.json()) as { runs: IngestRunSummary[] };
  return body.runs;
}

export async function getPublisherEvents(): Promise<PublisherEventSummary[]> {
  const res = await authedFetch('/publisher-events');
  if (!res.ok) throw new Error(`Failed to load events: ${res.status}`);
  const body = (await res.json()) as { events: PublisherEventSummary[] };
  return body.events;
}
```

Extend `PublisherStatusRecord` to include `notificationsEnabled?: boolean`. Extend `patchPublisherProfile` input type to allow `{ notificationsEnabled?: boolean }`.

- [ ] **Step 2: Lint/typecheck**

Run: `cd frontend && npm run validate`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/publisherStatusApi.ts
git commit -m "feat(publisher-frontend): API helpers for runs, events, notifications toggle"
```

---

### Task 14: IngestHistoryPanel component

**Files:**
- Create: `frontend/src/app/publish/status/IngestHistoryPanel.tsx`
- Test: `frontend/src/app/publish/status/__tests__/IngestHistoryPanel.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { render, screen, waitFor } from '@testing-library/preact';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { IngestHistoryPanel } from '../IngestHistoryPanel';

vi.mock('@/lib/publisherStatusApi', () => ({
  getPublisherRuns: vi.fn(),
}));
import { getPublisherRuns } from '@/lib/publisherStatusApi';

describe('IngestHistoryPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  test('renders empty state when no runs', async () => {
    (getPublisherRuns as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<IngestHistoryPanel />);
    await waitFor(() => expect(screen.getByText(/No ingest runs yet/i)).toBeInTheDocument());
  });

  test('renders OK run with counts', async () => {
    (getPublisherRuns as ReturnType<typeof vi.fn>).mockResolvedValue([
      { publisherId: 'p1', runAt: '2026-05-06T12:00:00Z', status: 'ok', counts: { added: 12, updated: 3, retracted: 1, unchanged: 5 }, triggeredBy: 'schedule' },
    ]);
    render(<IngestHistoryPanel />);
    await waitFor(() => expect(screen.getByText(/\+12/)).toBeInTheDocument());
    expect(screen.getByText(/~3/)).toBeInTheDocument();
    expect(screen.getByText(/-1/)).toBeInTheDocument();
  });

  test('renders failure run with message', async () => {
    (getPublisherRuns as ReturnType<typeof vi.fn>).mockResolvedValue([
      { publisherId: 'p1', runAt: '2026-05-06T12:00:00Z', status: 'parse_error', message: 'unexpected token }', triggeredBy: 'schedule' },
    ]);
    render(<IngestHistoryPanel />);
    await waitFor(() => expect(screen.getByText(/unexpected token/)).toBeInTheDocument());
    // status badge text should match
    expect(screen.getByText(/parse error|failed/i)).toBeInTheDocument();
  });

  test('renders error state on API failure', async () => {
    (getPublisherRuns as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    render(<IngestHistoryPanel />);
    await waitFor(() => expect(screen.getByText(/Failed to load|Error/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `cd frontend && npx vitest run IngestHistoryPanel`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { getPublisherRuns, type IngestRunSummary } from '@/lib/publisherStatusApi';

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; runs: IngestRunSummary[] }
  | { kind: 'error'; message: string };

function statusLabel(s: IngestRunSummary['status']): string {
  switch (s) {
    case 'ok': return 'OK';
    case 'parse_error': return 'Parse error';
    case 'validation_error': return 'Validation error';
    case 'network_error': return 'Network error';
    case 'threshold_halt': return 'Threshold halt';
  }
}

function statusBadgeClasses(s: IngestRunSummary['status']): string {
  if (s === 'ok') return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
  if (s === 'threshold_halt') return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
  return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
}

function relativeTime(iso: string, now = new Date()): string {
  const ms = now.getTime() - Date.parse(iso);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function IngestHistoryPanel() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getPublisherRuns()
      .then(runs => { if (!cancelled) setState({ kind: 'ok', runs }); })
      .catch(err => {
        if (!cancelled) setState({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load runs' });
      });
    return () => { cancelled = true; };
  }, []);

  if (state.kind === 'loading') {
    return <div className="text-sm text-gray-500 dark:text-gray-400">Loading ingest history…</div>;
  }
  if (state.kind === 'error') {
    return <div className="text-sm text-red-700 dark:text-red-300">Failed to load ingest history: {state.message}</div>;
  }
  if (state.runs.length === 0) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400">
        No ingest runs yet — your first scheduled fetch will appear here within an hour.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-xs uppercase text-gray-500 dark:text-gray-400">
          <tr>
            <th className="text-left py-2 pr-4">When</th>
            <th className="text-left py-2 pr-4">Status</th>
            <th className="text-left py-2 pr-4">Counts</th>
            <th className="text-left py-2 pr-4">Trigger</th>
            <th className="text-left py-2">Message</th>
          </tr>
        </thead>
        <tbody>
          {state.runs.map(r => (
            <tr key={r.runAt} className="border-t border-gray-200 dark:border-gray-700">
              <td className="py-2 pr-4" title={r.runAt}>{relativeTime(r.runAt)}</td>
              <td className="py-2 pr-4">
                <span className={`inline-block px-2 py-0.5 rounded text-xs ${statusBadgeClasses(r.status)}`}>
                  {statusLabel(r.status)}
                </span>
              </td>
              <td className="py-2 pr-4 font-mono text-xs">
                {r.counts ? `+${r.counts.added} ~${r.counts.updated} -${r.counts.retracted}` : '—'}
              </td>
              <td className="py-2 pr-4 text-xs text-gray-500 dark:text-gray-400">{r.triggeredBy}</td>
              <td className="py-2 text-xs text-gray-700 dark:text-gray-300">
                {r.message ? <span className="break-words">{r.message}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run IngestHistoryPanel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/publish/status/IngestHistoryPanel.tsx frontend/src/app/publish/status/__tests__/IngestHistoryPanel.test.tsx
git commit -m "feat(publisher-frontend): IngestHistoryPanel — last-30 runs with status badges + counts"
```

---

### Task 15: PublisherEventsPanel component

**Files:**
- Create: `frontend/src/app/publish/status/PublisherEventsPanel.tsx`
- Test: `frontend/src/app/publish/status/__tests__/PublisherEventsPanel.test.tsx`

- [ ] **Step 1: Failing tests**

```tsx
import { render, screen, waitFor } from '@testing-library/preact';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { PublisherEventsPanel } from '../PublisherEventsPanel';

vi.mock('@/lib/publisherStatusApi', () => ({ getPublisherEvents: vi.fn() }));
import { getPublisherEvents } from '@/lib/publisherStatusApi';

describe('PublisherEventsPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  test('empty state', async () => {
    (getPublisherEvents as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<PublisherEventsPanel />);
    await waitFor(() => expect(screen.getByText(/No events ingested yet/i)).toBeInTheDocument());
  });

  test('renders all three states with badges', async () => {
    (getPublisherEvents as ReturnType<typeof vi.fn>).mockResolvedValue([
      { eventId: 'a', title: 'Concert', startDate: '2026-07-01T18:00:00Z', endDate: '2026-07-01T20:00:00Z', state: 'published', updatedAt: 'x' },
      { eventId: 'b', title: 'Lecture', startDate: '2026-07-02T18:00:00Z', endDate: '2026-07-02T19:00:00Z', state: 'pending', updatedAt: 'x' },
      { eventId: 'c', title: 'Panel', startDate: '2026-07-03T18:00:00Z', endDate: '2026-07-03T19:00:00Z', state: 'rejected', rejectionReason: 'duplicate', rejectedAt: '2026-05-05T10:00:00Z', updatedAt: 'x' },
    ]);
    render(<PublisherEventsPanel />);
    await waitFor(() => expect(screen.getByText(/Concert/)).toBeInTheDocument());
    expect(screen.getByText(/Published/i)).toBeInTheDocument();
    expect(screen.getByText(/Pending review/i)).toBeInTheDocument();
    expect(screen.getByText(/Rejected/i)).toBeInTheDocument();
    expect(screen.getByText(/duplicate/)).toBeInTheDocument();
  });

  test('rejected without reason shows generic line', async () => {
    (getPublisherEvents as ReturnType<typeof vi.fn>).mockResolvedValue([
      { eventId: 'c', title: 'Panel', startDate: '2026-07-03T18:00:00Z', endDate: '2026-07-03T19:00:00Z', state: 'rejected', updatedAt: 'x' },
    ]);
    render(<PublisherEventsPanel />);
    await waitFor(() => expect(screen.getByText(/Removed by admin/i)).toBeInTheDocument());
  });

  test('error state', async () => {
    (getPublisherEvents as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    render(<PublisherEventsPanel />);
    await waitFor(() => expect(screen.getByText(/Failed to load|Error/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `cd frontend && npx vitest run PublisherEventsPanel`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { getPublisherEvents, type PublisherEventSummary } from '@/lib/publisherStatusApi';

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; events: PublisherEventSummary[] }
  | { kind: 'error'; message: string };

function badge(state: PublisherEventSummary['state']): { label: string; cls: string } {
  if (state === 'published')
    return { label: 'Published', cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' };
  if (state === 'pending')
    return { label: 'Pending review', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' };
  return { label: 'Rejected', cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' };
}

function sortEvents(es: PublisherEventSummary[], now = Date.now()): PublisherEventSummary[] {
  const future = es.filter(e => Date.parse(e.startDate) >= now).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = es.filter(e => Date.parse(e.startDate) < now).sort((a, b) => b.startDate.localeCompare(a.startDate));
  return [...future, ...past];
}

export function PublisherEventsPanel() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getPublisherEvents()
      .then(events => { if (!cancelled) setState({ kind: 'ok', events }); })
      .catch(err => { if (!cancelled) setState({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load events' }); });
    return () => { cancelled = true; };
  }, []);

  if (state.kind === 'loading') return <div className="text-sm text-gray-500 dark:text-gray-400">Loading events…</div>;
  if (state.kind === 'error') return <div className="text-sm text-red-700 dark:text-red-300">Failed to load events: {state.message}</div>;
  if (state.events.length === 0) return <div className="text-sm text-gray-500 dark:text-gray-400">No events ingested yet.</div>;

  const sorted = sortEvents(state.events);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-xs uppercase text-gray-500 dark:text-gray-400">
          <tr>
            <th className="text-left py-2 pr-4">Event</th>
            <th className="text-left py-2 pr-4">Start</th>
            <th className="text-left py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(e => {
            const b = badge(e.state);
            const showReason = e.state === 'rejected';
            const reasonLine = e.rejectionReason && e.rejectionReason.length > 0
              ? e.rejectionReason
              : 'Removed by admin.';
            return (
              <tr key={e.eventId} className="border-t border-gray-200 dark:border-gray-700">
                <td className="py-2 pr-4">
                  <div className="font-medium">{e.title}</div>
                  {showReason && (
                    <div className="text-xs italic text-gray-500 dark:text-gray-400">Reason: {reasonLine}</div>
                  )}
                </td>
                <td className="py-2 pr-4 text-xs text-gray-500 dark:text-gray-400">
                  {new Date(e.startDate).toLocaleString()}
                </td>
                <td className="py-2">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs ${b.cls}`}>{b.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run PublisherEventsPanel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/publish/status/PublisherEventsPanel.tsx frontend/src/app/publish/status/__tests__/PublisherEventsPanel.test.tsx
git commit -m "feat(publisher-frontend): PublisherEventsPanel — published/pending/rejected with reason"
```

---

### Task 16: Mount panels and notifications toggle on /publish/status/

**Files:**
- Modify: `frontend/src/app/publish/status/page.tsx`
- Modify: `frontend/src/app/publish/status/__tests__/page.test.tsx`

- [ ] **Step 1: Add a failing test**

In `page.test.tsx`, add cases that:
- Assert both new panels render when status is `'approved'` (mock the two API helpers).
- Assert toggling the notifications checkbox calls `patchPublisherProfile({ notificationsEnabled: false })`.

```tsx
test('approved publisher sees IngestHistoryPanel and PublisherEventsPanel', async () => {
  // status = approved with notificationsEnabled: true, id: 'pub-1', etc.
  // Mock getPublisherRuns / getPublisherEvents to return short arrays.
  // Render. Wait for headings 'Ingest history' and 'Your events' to appear.
});

test('toggling notifications calls patch and updates state', async () => {
  // approved status with notificationsEnabled: true.
  // Click the toggle. Expect patchPublisherProfile({ notificationsEnabled: false }).
});

test('pending applicants do NOT see panels', async () => {
  // status = pending. Assert panels' headings absent.
});
```

- [ ] **Step 2: Run failing tests**

Run: `cd frontend && npx vitest run page.test`
Expected: FAIL.

- [ ] **Step 3: Wire panels into the page**

In `page.tsx`, in the approved branch (after the existing `IngestControls` / `EmailChangePanel` blocks), add:

```tsx
<section className="bg-white dark:bg-gray-800 shadow rounded-lg p-6 mt-6">
  <h2 className="text-lg font-semibold mb-3">Ingest history</h2>
  <IngestHistoryPanel />
</section>

<section className="bg-white dark:bg-gray-800 shadow rounded-lg p-6 mt-6">
  <h2 className="text-lg font-semibold mb-3">Your events</h2>
  <PublisherEventsPanel />
</section>
```

In the existing profile/settings section, add the notifications toggle. Mirror the EditableField pattern. Specifically a labeled checkbox that calls `patchPublisherProfile({ notificationsEnabled: !current })` and on success calls `handleRecordUpdated(updatedRec)`.

```tsx
<label className="flex items-center gap-2 mt-4 text-sm">
  <input
    type="checkbox"
    checked={status.rec.notificationsEnabled !== false}
    onInput={async (e) => {
      const next = (e.currentTarget as HTMLInputElement).checked;
      const updated = await patchPublisherProfile({ notificationsEnabled: next });
      handleRecordUpdated(updated);
    }}
  />
  Email me when my feed breaks or an event is rejected
</label>
```

- [ ] **Step 4: Run tests + build**

Run: `cd frontend && npm run validate && npx vitest run`
Expected: PASS. Run `npm run build` to confirm no production-build regressions.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/publish/status/page.tsx frontend/src/app/publish/status/__tests__/page.test.tsx
git commit -m "feat(publisher-frontend): mount history + events panels and notifications toggle"
```

---

### Task 17: Admin reject UI — optional reason textarea

**Files:**
- Modify: `frontend/src/app/admin/publisher-events/page.tsx`
- Modify: matching test file (look for `frontend/src/app/admin/publisher-events/__tests__/page.test.tsx` or similar)

- [ ] **Step 1: Failing test**

Find the existing reject button test and extend:

```tsx
test('reject button opens textarea, submit POSTs body { reason }', async () => {
  // Render the admin events page with one pending event.
  // Click 'Reject'. Assert textarea appears.
  // Type 'duplicate'. Click 'Confirm reject'.
  // Assert fetch called with body.reason === 'duplicate'.
});

test('reject with empty textarea POSTs body { reason: undefined }', async () => {
  // Click 'Reject'. Don't type anything. Click 'Confirm reject'.
  // Assert fetch called with no reason or reason omitted.
});
```

- [ ] **Step 2: Run failing tests**

Run: `cd frontend && npx vitest run admin/publisher-events`
Expected: FAIL.

- [ ] **Step 3: Update the page**

Replace the inline reject button's click handler with a small inline form: clicking "Reject" reveals a `<textarea>` and a "Confirm reject" button. Submit posts JSON `{ reason }` to the existing endpoint. The textarea is optional; if empty, omit `reason` from the body. Match the existing component's styling patterns.

- [ ] **Step 4: Run tests + build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/admin/publisher-events/page.tsx frontend/src/app/admin/publisher-events/__tests__/page.test.tsx
git commit -m "feat(admin-frontend): optional rejection-reason textarea on publisher-events reject"
```

---

## Phase 7 — Infrastructure

### Task 18: Terraform — new DDB table + IAM grants

**Files:**
- Modify: `infrastructure/publisher-ingest.tf`
- Modify: any `*.tf` file that grants the publisher-portal Lambda DDB access (search for `publisher_events.arn` → mirror)

- [ ] **Step 1: Add the table**

Append to `infrastructure/publisher-ingest.tf`:

```hcl
resource "aws_dynamodb_table" "publisher_ingest_runs" {
  name         = "${var.app_name}-publisher-ingest-runs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "publisherId"
  range_key    = "runAt"

  attribute {
    name = "publisherId"
    type = "S"
  }

  attribute {
    name = "runAt"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name        = "${var.app_name}-publisher-ingest-runs"
    Environment = var.environment
  }
}
```

- [ ] **Step 2: Grant the publisher-ingest Lambda PutItem + Query**

In the Lambda's IAM policy (search for the `aws_dynamodb_table.publisher_events.arn` reference in the existing role policy and mirror), add a new statement:

```hcl
{
  Effect = "Allow"
  Action = [
    "dynamodb:PutItem",
    "dynamodb:Query",
  ]
  Resource = aws_dynamodb_table.publisher_ingest_runs.arn
}
```

- [ ] **Step 3: Grant the publisher-portal Lambda Query**

```hcl
{
  Effect = "Allow"
  Action = ["dynamodb:Query"]
  Resource = aws_dynamodb_table.publisher_ingest_runs.arn
}
```

- [ ] **Step 4: Pass the table name as an env var**

In every Lambda function definition that needs it (publisher-ingest and publisher-portal), add:

```hcl
PUBLISHER_INGEST_RUNS_TABLE_NAME = aws_dynamodb_table.publisher_ingest_runs.name
```

- [ ] **Step 5: API Gateway routing**

Confirm that `GET /publisher-runs` and `GET /publisher-events` route to the publisher-portal Lambda (not the admin Lambda or the ingest Lambda). If routes are defined explicitly, add them; if there's a catch-all proxy, no change needed.

- [ ] **Step 6: terraform validate / plan locally**

Run: `cd infrastructure && terraform fmt && terraform validate && terraform plan`
Expected: plan shows the new table + IAM additions; no destructive diffs.

- [ ] **Step 7: Commit (do NOT apply)**

```bash
git add infrastructure/publisher-ingest.tf infrastructure/main.tf  # or wherever the IAM policies live
git commit -m "infra(publisher): publisher-ingest-runs DDB table + IAM grants + env var"
```

The `terraform apply` is a manual step the user runs after merge.

---

## Phase 8 — Smoke + integration

### Task 19: Extend post-deploy publisher smoke

**Files:**
- Modify: `scripts/post-deploy-publisher-smoke.ts` (or wherever the existing harness lives — search for `SMOKE_BBTEST_EMAIL` consumers)

- [ ] **Step 1: Read the existing smoke harness**

Run: `grep -rn 'SMOKE_BBTEST_EMAIL\|smoke-magic-token-by-email\|smoke-reset-bbtest' scripts/ backend/ 2>/dev/null | head -20`

Identify the smoke driver entry point.

- [ ] **Step 2: Add new assertions**

After the existing "invoke publisher-ingest and assert event count" step, add:

1. `GET /publisher-runs` with the bbtest publisher's JWT — assert 200, response shape `{ runs: [...] }`, at least one row whose `status === 'ok'`.
2. `GET /publisher-events` with the bbtest publisher's JWT — assert 200, response shape `{ events: [...] }`, at least 2 events for bbtest.

The smoke runs after the explicit invoke step, so the new ingest-runs row will already exist.

- [ ] **Step 3: Run the smoke locally against a stack with the new endpoints**

(May not be possible from the dev box; CI will run it post-merge against prod.)

- [ ] **Step 4: Commit**

```bash
git add scripts/post-deploy-publisher-smoke.ts
git commit -m "test(smoke): assert publisher-runs and publisher-events return expected shape"
```

---

### Task 20: Backend integration test for new endpoints

**Files:**
- Create: `backend/src/__tests__/integration/publisherRunsAndEvents.test.ts`

Pattern: follow the existing `backend/src/__tests__/integration/` files (use `InMemoryDocClient` from PR #106's harness).

- [ ] **Step 1: Write the test**

```ts
import { handler } from '../../handlers/publisherPortalHandler';
import { InMemoryDocClient } from './support/inMemoryDocClient';
import { issueTestPublisherJwt } from './support/testJwt';

describe('publisher portal observability endpoints', () => {
  let docClient: InMemoryDocClient;
  beforeEach(() => {
    docClient = new InMemoryDocClient();
    // seed publishers table with pub-1 (approved, enabled, notificationsEnabled: true)
    // seed publisher-events table with three rows for pub-1: published, pending, rejected
    // seed publisher-ingest-runs table with two run rows for pub-1
    // wire portal handler with these tables via the existing _setXxxForTests injection
  });

  test('GET /publisher-runs returns last 30 newest-first', async () => {
    const jwt = issueTestPublisherJwt('pub-1');
    const res = await handler({
      httpMethod: 'GET',
      path: '/publisher-runs',
      headers: { Authorization: `Bearer ${jwt}` },
      body: null,
    } as never);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.runs.length).toBeGreaterThan(0);
    // Newest first: runs[0].runAt > runs[1].runAt
    expect(Date.parse(body.runs[0].runAt)).toBeGreaterThanOrEqual(Date.parse(body.runs[1]?.runAt ?? '1970'));
  });

  test('GET /publisher-events returns published + pending + rejected, scoped to JWT', async () => {
    const jwt = issueTestPublisherJwt('pub-1');
    const res = await handler({
      httpMethod: 'GET',
      path: '/publisher-events',
      headers: { Authorization: `Bearer ${jwt}` },
      body: null,
    } as never);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.events).toHaveLength(3);
    expect(new Set(body.events.map((e: any) => e.state))).toEqual(new Set(['published', 'pending', 'rejected']));
    // Rejected row carries the reason
    const rejected = body.events.find((e: any) => e.state === 'rejected');
    expect(rejected.rejectionReason).toBeDefined();
  });

  test('cross-publisher: pub-1 JWT cannot see pub-2 events', async () => {
    // Seed pub-2 with one event. pub-1 JWT calls /publisher-events. Result has only pub-1 rows.
  });

  test('PATCH /publisher-profile { notificationsEnabled: false } persists', async () => {
    // Initial state: notificationsEnabled === true.
    // Patch to false; re-GET /publisher-status; expect notificationsEnabled === false.
  });

  test('GET /publisher-runs without JWT returns 401', async () => {});
});
```

- [ ] **Step 2: Run the test**

Run: `cd backend && npx jest integration/publisherRunsAndEvents -v`
Expected: PASS.

- [ ] **Step 3: Coverage check**

Run: `cd backend && npm run coverage`
Expected: PASS — line coverage at or above the existing floor (`.coverage-floor.json`). If the floor barely budges down due to the new code being mostly covered already, that's fine. If it dips below the floor, write additional tests until it doesn't.

- [ ] **Step 4: Commit**

```bash
git add backend/src/__tests__/integration/publisherRunsAndEvents.test.ts
git commit -m "test(integration): publisher-runs + publisher-events scoping and notifications toggle"
```

---

## Final verification

- [ ] **Step 1: Full backend suite + coverage**

Run: `cd backend && npm test && npm run coverage`
Expected: PASS, coverage meets the floor.

- [ ] **Step 2: Full frontend suite + build + coverage**

Run: `cd frontend && npm run validate && npm run build && npx vitest run --coverage`
Expected: PASS, coverage at/above `.coverage-floor.json` floor.

- [ ] **Step 3: Open PR**

```bash
git push -u origin spec/publisher-observability
gh pr create --title "Publisher observability: ingest history, per-event status, notifications" --body "$(cat <<'EOF'
## Summary
- New `/publish/status/` panels: ingest history (last 30 runs) and per-event status (published / pending / rejected with reason).
- Smart-immediate emails on ingest streak transitions (OK→fail, fail→OK) and admin event rejection. Single opt-out toggle.
- New DDB table `${app_name}-publisher-ingest-runs` (90-day TTL).
- Admin reject path now soft-deletes events (state='rejected') with optional reason; reconciler preserves rejected state across re-ingest.

Spec: docs/superpowers/specs/2026-05-06-publisher-observability-design.md
Plan: docs/superpowers/plans/2026-05-06-publisher-observability-plan.md

## Test plan
- [ ] Backend `npm test` green; coverage at or above floor
- [ ] Frontend `npm run validate && npm run build` green; vitest coverage at or above floor
- [ ] `terraform plan` shows new table + IAM grants only (no destructive diffs)
- [ ] Post-deploy smoke step exercises `/publisher-runs` and `/publisher-events`
- [ ] Manual: log into bbtest publisher portal in prod after deploy; confirm both new panels render and the notifications toggle round-trips

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: After PR review and merge, manual ops**

The user runs `terraform apply` to provision the new DDB table + IAM updates. Verify in CloudWatch that publisher-ingest writes run rows on the next scheduled fetch.

---

## Coverage discipline reminder

Per `.coverage-floor.json` and the project CLAUDE.md, **every PR must maintain or improve line coverage** for both `backend` and `frontend` packages. Each task in this plan ships its own tests; the final verification step re-runs the full suites with coverage to confirm. If you find yourself committing source without tests, stop and add the tests first.
