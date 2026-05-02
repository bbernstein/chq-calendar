# Event Publisher Format — Plan 2: Backend Ingest Pipeline

> **Status: COMPLETE** — merged in [PR #70](https://github.com/bbernstein/chq-calendar/pull/70) on 2026-05-02.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the publisher-feed ingest pipeline as a strictly additive layer that does not touch the existing chq.org primary pipeline. Produce `publisher-events-${year}.json` sidecar files in the same S3 prefix as the primary cache, plus a publishers DynamoDB table and a pending-events queue. Ship a verification gate that proves `all-events-${year}.json` is byte-equivalent to a pre-change baseline.

**Architecture:** New Lambda `publisherIngestHandler` (separate file, separate ESBuild target) runs on a CloudWatch schedule. Reads registered publishers from a new DynamoDB table (`chq-publishers`). For each enabled publisher: HTTP GET → JSON or HTML extraction (using `@chq-calendar/publisher-format`) → schema + business-rules validation → reconciliation against a per-publisher partition in a new `chq-publisher-events` DynamoDB table (NOT the existing `events` table) → threshold-halt check → trust-tier routing (auto / review / flagged) → write sidecar JSON to S3.

**Tech Stack:** TypeScript, AWS Lambda, DynamoDB, S3, esbuild. Reuses `@chq-calendar/publisher-format` from Plan 1. Tests with Jest (matching backend convention).

**Spec reference:** `docs/plans/2026-05-01-event-publisher-format-design.md` (esp. §1.1 isolation, §4 ingestion, §4.4 reconciliation, §4.5 trust tiers).

**Prerequisite:** Plan 1 complete. Plan 2 depends on `tools/publisher-format` being installed as a workspace dependency in `backend/`.

---

## File Structure

```
backend/
├── src/
│   ├── handlers/
│   │   └── publisherIngestHandler.ts            # NEW — Lambda entry
│   ├── services/
│   │   ├── publisherRegistryService.ts          # NEW — CRUD on publishers table
│   │   ├── publisherEventStore.ts               # NEW — read/write per-publisher events
│   │   ├── publisherFeedFetcher.ts              # NEW — HTTP GET + parse selection
│   │   ├── publisherReconciler.ts               # NEW — diff + threshold + trust routing
│   │   └── publisherSidecarPublisher.ts         # NEW — writes publisher-events-YYYY.json to S3
│   ├── types/
│   │   └── publisher.ts                         # NEW — domain types: PublisherRecord, StoredPublisherEvent, ReconcileResult
│   └── __tests__/
│       ├── publisherFeedFetcher.test.ts         # NEW
│       ├── publisherEventStore.test.ts          # NEW
│       ├── publisherReconciler.test.ts          # NEW
│       ├── publisherSidecarPublisher.test.ts    # NEW
│       ├── publisherIngestHandler.integration.test.ts # NEW
│       └── fixtures/
│           ├── valid-feed.json                  # NEW
│           ├── valid-feed-page.html             # NEW
│           └── invalid-feed.json                # NEW

infrastructure/
├── publisher-ingest.tf                          # NEW — DynamoDB tables, Lambda, IAM, schedule
└── (modify) main.tf                             # MODIFY — add IAM scoping for new tables

scripts/
└── verify-primary-cache-unchanged.sh            # NEW — verification gate
```

## Why this layout

- The Lambda is a single new handler file. The `services/` directory mirrors the existing pattern (one service per concern). Each service has a focused responsibility — fetching, storing, reconciling, publishing — so each is small enough to hold in context and test independently.
- Storage is two new DynamoDB tables (`chq-publishers` for registration, `chq-publisher-events` for the per-publisher event records). The existing `events` table is not modified, not even read, by the new pipeline.
- All new IAM scopes are additive. Plan 2 explicitly does NOT extend the existing `lambda_role` to access the new tables; instead it creates a new `publisher_ingest_role`. This is the strictest possible isolation.

---

## Task 1: Add `@chq-calendar/publisher-format` as a backend workspace dependency

**Files:**
- Modify: `backend/package.json`

- [x] **Step 1: Add dependency**

Edit `backend/package.json`, in the `dependencies` block:
```json
"@chq-calendar/publisher-format": "*"
```

- [x] **Step 2: Install**

```bash
cd /Users/bernard/src/chq/chq-calendar && npm install
```
Expected: workspace symlink created in `backend/node_modules/@chq-calendar/publisher-format`.

- [x] **Step 3: Smoke-test the import works**

Create a temp file `backend/src/__smoke__.ts`:
```ts
import { validateFeed } from '@chq-calendar/publisher-format';
console.log(typeof validateFeed);
```
Run:
```bash
cd backend && npx ts-node src/__smoke__.ts
```
Expected: `function`. Then delete `__smoke__.ts`.

- [x] **Step 4: Commit**

```bash
git add backend/package.json package-lock.json
git commit -m "Plan 2, Task 1: add publisher-format as backend workspace dep"
```

---

## Task 2: Define the backend domain types

**Files:**
- Create: `backend/src/types/publisher.ts`

- [x] **Step 1: Write the types**

```ts
import type { FeedEvent, PublisherInfo } from '@chq-calendar/publisher-format';

export type TrustLevel = 'auto' | 'review' | 'flagged';
export type SourceType = 'json' | 'html';
export type FetchStatus = 'ok' | 'parse_error' | 'validation_error' | 'network_error' | 'threshold_halt';

export interface PublisherRecord {
  id: string;
  name: string;
  contactEmail: string;
  sourceUrl: string;
  sourceType: SourceType;
  trustLevel: TrustLevel;
  enabled: boolean;
  createdAt: string;
  lastFetchedAt?: string;
  lastFetchStatus?: FetchStatus;
  lastFetchMessage?: string;
  /** Set when reconciliation is halted due to the §4.4 threshold; cleared on admin approval. */
  pendingThresholdHalt?: {
    detectedAt: string;
    incomingFeed: { events: FeedEvent[]; publisher: PublisherInfo };
  };
}

export interface StoredPublisherEvent {
  publisherId: string;        // partition key part 1
  eventId: string;            // partition key part 2 (composite)
  startDate: string;
  endDate: string;
  lastModified: string;
  /** The full validated FeedEvent payload, plus enrichment (resolved venue, etc.). */
  payload: FeedEvent & { sourcePublisherId: string; sourcePublisherName: string };
  /** "published" = visible to the public sidecar; "pending" = awaiting admin review. */
  state: 'published' | 'pending';
  updatedAt: string;
}

export interface ReconcileDiff {
  inserts: StoredPublisherEvent[];
  updates: StoredPublisherEvent[];
  removals: StoredPublisherEvent[]; // future events absent from the new feed
  unchanged: number;
}

export interface ReconcileResult {
  applied: boolean;
  diff: ReconcileDiff;
  /** If false, the threshold guard fired; storage was left untouched. */
  haltedByThreshold?: { reason: string };
}
```

- [x] **Step 2: Commit**

```bash
git add backend/src/types/publisher.ts
git commit -m "Plan 2, Task 2: backend domain types for publisher pipeline"
```

---

## Task 3: Provision DynamoDB tables (Terraform)

**Files:**
- Create: `infrastructure/publisher-ingest.tf`

- [x] **Step 1: Write the table definitions**

```hcl
resource "aws_dynamodb_table" "publishers" {
  name         = "chq-publishers"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute { name = "id" type = "S" }
}

resource "aws_dynamodb_table" "publisher_events" {
  name         = "chq-publisher-events"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "publisherId"
  range_key    = "eventId"

  attribute { name = "publisherId" type = "S" }
  attribute { name = "eventId"     type = "S" }
  attribute { name = "state"       type = "S" }

  global_secondary_index {
    name            = "by-state"
    hash_key        = "state"
    range_key       = "publisherId"
    projection_type = "ALL"
  }
}
```

- [x] **Step 2: Plan and review**

```bash
cd infrastructure && terraform plan -out=tfplan-publisher-tables
```
Expected: only the two new resources are added. **The plan must NOT show any change to `aws_dynamodb_table.events`, `data_sources`, `sync_status`, or `feedback`.** If it does, something is wrong — abort and investigate.

- [x] **Step 3: Apply**

```bash
terraform apply tfplan-publisher-tables
```

- [x] **Step 4: Commit**

```bash
git add infrastructure/publisher-ingest.tf
git commit -m "Plan 2, Task 3: provision chq-publishers and chq-publisher-events tables"
```

---

## Task 4: Publisher registry service (DynamoDB CRUD)

**Files:**
- Create: `backend/src/services/publisherRegistryService.ts`
- Test: `backend/src/__tests__/publisherRegistryService.test.ts`

- [x] **Step 1: Write a failing test**

```ts
import { PublisherRegistryService } from '../services/publisherRegistryService';
import type { PublisherRecord } from '../types/publisher';

const mockClient = {
  get: jest.fn(),
  put: jest.fn(),
  scan: jest.fn(),
  update: jest.fn(),
};

describe('PublisherRegistryService', () => {
  let svc: PublisherRegistryService;
  beforeEach(() => {
    jest.resetAllMocks();
    svc = new PublisherRegistryService(mockClient as any, 'chq-publishers');
  });

  it('list() returns all enabled publishers', async () => {
    mockClient.scan.mockResolvedValue({ Items: [
      { id: 'a', enabled: true, name: 'A', contactEmail: 'a@b', sourceUrl: 'x', sourceType: 'json', trustLevel: 'auto', createdAt: 't' },
      { id: 'b', enabled: false, name: 'B', contactEmail: 'b@b', sourceUrl: 'y', sourceType: 'json', trustLevel: 'auto', createdAt: 't' },
    ] });
    const r = await svc.listEnabled();
    expect(r.map(p => p.id)).toEqual(['a']);
  });

  it('recordFetchOutcome updates lastFetchedAt and status', async () => {
    mockClient.update.mockResolvedValue({});
    await svc.recordFetchOutcome('a', { status: 'ok' });
    expect(mockClient.update).toHaveBeenCalledTimes(1);
    const call = mockClient.update.mock.calls[0][0];
    expect(call.Key).toEqual({ id: 'a' });
    expect(call.ExpressionAttributeValues[':status']).toBe('ok');
  });
});
```

- [x] **Step 2: Run — fails (no implementation)**

```bash
cd backend && npx jest publisherRegistryService.test.ts
```
Expected: FAIL.

- [x] **Step 3: Implement `publisherRegistryService.ts`**

```ts
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { FetchStatus, PublisherRecord } from '../types/publisher';

export class PublisherRegistryService {
  constructor(private readonly db: DynamoDBDocumentClient, private readonly tableName: string) {}

  async get(id: string): Promise<PublisherRecord | null> {
    const r = await this.db.send(new GetCommand({ TableName: this.tableName, Key: { id } }));
    return (r.Item as PublisherRecord) ?? null;
  }

  async listEnabled(): Promise<PublisherRecord[]> {
    const r = await this.db.send(new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'enabled = :t',
      ExpressionAttributeValues: { ':t': true },
    }));
    return (r.Items ?? []) as PublisherRecord[];
  }

  async upsert(rec: PublisherRecord): Promise<void> {
    await this.db.send(new PutCommand({ TableName: this.tableName, Item: rec }));
  }

  async recordFetchOutcome(id: string, outcome: { status: FetchStatus; message?: string }): Promise<void> {
    await this.db.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { id },
      UpdateExpression: 'SET lastFetchedAt = :now, lastFetchStatus = :status, lastFetchMessage = :msg',
      ExpressionAttributeValues: {
        ':now': new Date().toISOString(),
        ':status': outcome.status,
        ':msg': outcome.message ?? null,
      },
    }));
  }

  async setThresholdHalt(id: string, halt: PublisherRecord['pendingThresholdHalt']): Promise<void> {
    await this.db.send(new UpdateCommand({
      TableName: this.tableName, Key: { id },
      UpdateExpression: 'SET pendingThresholdHalt = :h',
      ExpressionAttributeValues: { ':h': halt ?? null },
    }));
  }
}
```

- [x] **Step 4: Run — passes**

```bash
cd backend && npx jest publisherRegistryService.test.ts
```
Expected: 2 passing.

- [x] **Step 5: Commit**

```bash
git add backend/src/services/publisherRegistryService.ts backend/src/__tests__/publisherRegistryService.test.ts
git commit -m "Plan 2, Task 4: PublisherRegistryService"
```

---

## Task 5: Publisher event store (per-publisher DynamoDB partition)

**Files:**
- Create: `backend/src/services/publisherEventStore.ts`
- Test: `backend/src/__tests__/publisherEventStore.test.ts`

The store persists `StoredPublisherEvent` records and supports: read all events for a publisher, write/update/delete one event, transactional batch apply.

- [x] **Step 1: Write the test first**

```ts
import { PublisherEventStore } from '../services/publisherEventStore';
import type { StoredPublisherEvent } from '../types/publisher';

const mockClient = { send: jest.fn() };

describe('PublisherEventStore', () => {
  let store: PublisherEventStore;
  beforeEach(() => {
    jest.resetAllMocks();
    store = new PublisherEventStore(mockClient as any, 'chq-publisher-events');
  });

  it('listForPublisher queries by publisherId', async () => {
    mockClient.send.mockResolvedValue({ Items: [{ publisherId: 'p', eventId: 'e1', state: 'published' }] });
    const r = await store.listForPublisher('p');
    expect(r).toHaveLength(1);
    expect(r[0].eventId).toBe('e1');
  });

  it('applyDiff issues one TransactWriteItems with inserts + updates + deletes', async () => {
    mockClient.send.mockResolvedValue({});
    const ins: StoredPublisherEvent = {
      publisherId: 'p', eventId: 'i1', startDate: 's', endDate: 'e', lastModified: 'm',
      payload: {} as any, state: 'published', updatedAt: 'u',
    };
    await store.applyDiff({ inserts: [ins], updates: [], removals: [], unchanged: 0 });
    expect(mockClient.send).toHaveBeenCalledTimes(1);
    const cmd: any = mockClient.send.mock.calls[0][0];
    expect(cmd.input.TransactItems).toHaveLength(1);
  });
});
```

- [x] **Step 2: Implement `publisherEventStore.ts`**

```ts
import { QueryCommand, TransactWriteCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { ReconcileDiff, StoredPublisherEvent } from '../types/publisher';

export class PublisherEventStore {
  constructor(private readonly db: DynamoDBDocumentClient, private readonly tableName: string) {}

  async listForPublisher(publisherId: string): Promise<StoredPublisherEvent[]> {
    const out: StoredPublisherEvent[] = [];
    let last: any = undefined;
    do {
      const r: any = await this.db.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'publisherId = :p',
        ExpressionAttributeValues: { ':p': publisherId },
        ExclusiveStartKey: last,
      }));
      out.push(...((r.Items ?? []) as StoredPublisherEvent[]));
      last = r.LastEvaluatedKey;
    } while (last);
    return out;
  }

  async applyDiff(diff: ReconcileDiff): Promise<void> {
    const items = [
      ...diff.inserts.map(it => ({ Put: { TableName: this.tableName, Item: it } })),
      ...diff.updates.map(it => ({ Put: { TableName: this.tableName, Item: it } })),
      ...diff.removals.map(it => ({ Delete: { TableName: this.tableName, Key: { publisherId: it.publisherId, eventId: it.eventId } } })),
    ];
    if (items.length === 0) return;
    // DynamoDB transact-write supports up to 100 items per call; chunk.
    for (let i = 0; i < items.length; i += 100) {
      await this.db.send(new TransactWriteCommand({ TransactItems: items.slice(i, i + 100) }));
    }
  }
}
```

- [x] **Step 3: Run tests, commit**

```bash
cd backend && npx jest publisherEventStore.test.ts
git add backend/src/services/publisherEventStore.ts backend/src/__tests__/publisherEventStore.test.ts
git commit -m "Plan 2, Task 5: PublisherEventStore"
```

---

## Task 6: Reconciler (the core §4.4 logic)

**Files:**
- Create: `backend/src/services/publisherReconciler.ts`
- Test: `backend/src/__tests__/publisherReconciler.test.ts`

The reconciler takes (storedEvents, incomingFeed, now) and produces a `ReconcileResult` with the diff and whether the threshold halt fired. It does NOT do any I/O.

- [x] **Step 1: Write the test**

```ts
import { reconcile } from '../services/publisherReconciler';
import type { StoredPublisherEvent } from '../types/publisher';
import type { FeedDocument } from '@chq-calendar/publisher-format';

const NOW = new Date('2026-06-01T00:00:00Z');

function ev(id: string, start: string, lastMod: string, state: 'published' | 'pending' = 'published'): StoredPublisherEvent {
  return {
    publisherId: 'p', eventId: id,
    startDate: start, endDate: start, lastModified: lastMod,
    payload: { id, title: id, startDate: start, endDate: start, category: 'Lecture', lastModified: lastMod, sourcePublisherId: 'p', sourcePublisherName: 'P' } as any,
    state, updatedAt: lastMod,
  };
}

function feed(events: any[]): FeedDocument {
  return { formatVersion: '1.0', publisher: { id: 'p', name: 'P', contactEmail: 'a@b' }, events };
}

describe('reconcile', () => {
  it('inserts new events', () => {
    const r = reconcile({ stored: [], feed: feed([{ id: 'a', title: 'A', startDate: '2026-07-01T00:00:00-04:00', endDate: '2026-07-01T01:00:00-04:00', category: 'Lecture', lastModified: '2026-05-01T00:00:00-04:00' }]), now: NOW, trustLevel: 'auto' });
    expect(r.applied).toBe(true);
    expect(r.diff.inserts).toHaveLength(1);
  });

  it('updates an event when lastModified is newer', () => {
    const stored = [ev('a', '2026-07-01T00:00:00-04:00', '2026-04-01T00:00:00-04:00')];
    const r = reconcile({ stored, feed: feed([{ id: 'a', title: 'A', startDate: '2026-07-01T00:00:00-04:00', endDate: '2026-07-01T01:00:00-04:00', category: 'Lecture', lastModified: '2026-05-01T00:00:00-04:00' }]), now: NOW, trustLevel: 'auto' });
    expect(r.diff.updates).toHaveLength(1);
  });

  it('does NOT remove past stored events absent from the feed', () => {
    const stored = [ev('past', '2026-04-01T00:00:00-04:00', '2026-03-01T00:00:00-04:00')];
    const r = reconcile({ stored, feed: feed([]), now: NOW, trustLevel: 'auto' });
    expect(r.diff.removals).toHaveLength(0);
  });

  it('removes future stored events absent from the feed', () => {
    const stored = [ev('future', '2026-08-01T00:00:00-04:00', '2026-04-01T00:00:00-04:00')];
    const r = reconcile({ stored, feed: feed([]), now: NOW, trustLevel: 'auto' });
    expect(r.diff.removals).toHaveLength(1);
  });

  it('halts when removals exceed max(50% of future, 5)', () => {
    const stored = Array.from({ length: 20 }, (_, i) => ev(`f${i}`, '2026-08-01T00:00:00-04:00', '2026-04-01T00:00:00-04:00'));
    const r = reconcile({ stored, feed: feed([]), now: NOW, trustLevel: 'auto' });
    expect(r.applied).toBe(false);
    expect(r.haltedByThreshold).toBeDefined();
  });

  it('does NOT halt when removals stay below threshold', () => {
    const stored = Array.from({ length: 20 }, (_, i) => ev(`f${i}`, '2026-08-01T00:00:00-04:00', '2026-04-01T00:00:00-04:00'));
    // Re-publish 18 of 20 — only 2 missing, well under 5 (the floor).
    const incoming = stored.slice(0, 18).map(s => ({
      id: s.eventId, title: 'T', startDate: s.startDate, endDate: s.endDate,
      category: 'Lecture', lastModified: '2026-04-01T00:00:00-04:00',
    }));
    const r = reconcile({ stored, feed: feed(incoming), now: NOW, trustLevel: 'auto' });
    expect(r.applied).toBe(true);
    expect(r.diff.removals).toHaveLength(2);
  });

  it('routes to pending when trustLevel is review', () => {
    const r = reconcile({ stored: [], feed: feed([{ id: 'a', title: 'A', startDate: '2026-07-01T00:00:00-04:00', endDate: '2026-07-01T01:00:00-04:00', category: 'Lecture', lastModified: '2026-05-01T00:00:00-04:00' }]), now: NOW, trustLevel: 'review' });
    expect(r.diff.inserts[0].state).toBe('pending');
  });
});
```

- [x] **Step 2: Implement `publisherReconciler.ts`**

```ts
import type { FeedDocument, FeedEvent } from '@chq-calendar/publisher-format';
import type { ReconcileDiff, ReconcileResult, StoredPublisherEvent, TrustLevel } from '../types/publisher';

export interface ReconcileInput {
  stored: StoredPublisherEvent[];
  feed: FeedDocument;
  now: Date;
  trustLevel: TrustLevel;
}

const REMOVAL_MIN = 5;
const REMOVAL_RATIO = 0.5;

function toStored(ev: FeedEvent, publisher: FeedDocument['publisher'], trustLevel: TrustLevel, nowIso: string): StoredPublisherEvent {
  return {
    publisherId: publisher.id,
    eventId: ev.id,
    startDate: ev.startDate,
    endDate: ev.endDate,
    lastModified: ev.lastModified,
    payload: { ...ev, sourcePublisherId: publisher.id, sourcePublisherName: publisher.name },
    state: trustLevel === 'auto' ? 'published' : 'pending',
    updatedAt: nowIso,
  };
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  const { stored, feed, now, trustLevel } = input;
  const nowIso = now.toISOString();
  const storedById = new Map(stored.map(s => [s.eventId, s]));
  const incomingById = new Map(feed.events.map(e => [e.id, e]));

  const inserts: StoredPublisherEvent[] = [];
  const updates: StoredPublisherEvent[] = [];
  let unchanged = 0;

  for (const inc of feed.events) {
    const ex = storedById.get(inc.id);
    const newRec = toStored(inc, feed.publisher, trustLevel, nowIso);
    if (!ex) inserts.push(newRec);
    else if (Date.parse(inc.lastModified) > Date.parse(ex.lastModified)) updates.push(newRec);
    else unchanged++;
  }

  const removals: StoredPublisherEvent[] = [];
  for (const ex of stored) {
    if (incomingById.has(ex.eventId)) continue;
    if (Date.parse(ex.startDate) < now.getTime()) continue; // past — historical, never auto-removed
    removals.push(ex);
  }

  const futureCount = stored.filter(s => Date.parse(s.startDate) >= now.getTime()).length;
  const threshold = Math.max(REMOVAL_MIN, Math.floor(REMOVAL_RATIO * futureCount));
  if (removals.length > threshold) {
    return {
      applied: false,
      diff: { inserts, updates, removals, unchanged },
      haltedByThreshold: { reason: `Would remove ${removals.length} of ${futureCount} future events (threshold ${threshold}).` },
    };
  }

  return { applied: true, diff: { inserts, updates, removals, unchanged } };
}
```

- [x] **Step 3: Run, commit**

```bash
cd backend && npx jest publisherReconciler.test.ts
git add backend/src/services/publisherReconciler.ts backend/src/__tests__/publisherReconciler.test.ts
git commit -m "Plan 2, Task 6: reconciler with §4.4 absent-vs-cancelled and threshold halt"
```

---

## Task 7: Feed fetcher (HTTP + JSON/HTML dispatch)

**Files:**
- Create: `backend/src/services/publisherFeedFetcher.ts`
- Test: `backend/src/__tests__/publisherFeedFetcher.test.ts`
- Create: `backend/src/__tests__/fixtures/valid-feed.json`
- Create: `backend/src/__tests__/fixtures/valid-feed-page.html`

- [x] **Step 1: Write the test**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { fetchAndParseFeed } from '../services/publisherFeedFetcher';

const fix = (n: string) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

const mockFetch = (body: string, contentType: string, ok = true) =>
  jest.fn(async () => ({ ok, status: ok ? 200 : 500, text: async () => body, headers: { get: () => contentType } }));

describe('fetchAndParseFeed', () => {
  it('parses a JSON feed', async () => {
    const r = await fetchAndParseFeed({
      url: 'https://x/feed.json', sourceType: 'json', registeredPublisherId: 'test-pub',
    }, mockFetch(fix('valid-feed.json'), 'application/json') as any);
    expect(r.report.ok).toBe(true);
    expect(r.feed?.events.length).toBeGreaterThan(0);
  });

  it('parses an HTML page with embedded comments', async () => {
    const r = await fetchAndParseFeed({
      url: 'https://x/page.html', sourceType: 'html', registeredPublisherId: 'test-pub',
    }, mockFetch(fix('valid-feed-page.html'), 'text/html') as any);
    expect(r.report.ok).toBe(true);
    expect(r.feed?.events.length).toBeGreaterThan(0);
  });

  it('returns network_error on non-ok response', async () => {
    const r = await fetchAndParseFeed({
      url: 'https://x/feed.json', sourceType: 'json', registeredPublisherId: 'test-pub',
    }, mockFetch('', 'application/json', false) as any);
    expect(r.fetchStatus).toBe('network_error');
  });
});
```

- [x] **Step 2: Author fixture files**

`backend/src/__tests__/fixtures/valid-feed.json` and `valid-feed-page.html`: copy from `tools/publisher-format/__tests__/fixtures/` (real categories/venues, publisher.id = `test-pub`).

- [x] **Step 3: Implement `publisherFeedFetcher.ts`**

```ts
import { extractFromHtml, validateFeed } from '@chq-calendar/publisher-format';
import type { FeedDocument, ValidationReport } from '@chq-calendar/publisher-format';
import type { FetchStatus, SourceType } from '../types/publisher';

export interface FetchFeedInput {
  url: string;
  sourceType: SourceType;
  registeredPublisherId: string;
}

export interface FetchFeedOutput {
  fetchStatus: FetchStatus;
  feed: FeedDocument | null;
  report: ValidationReport;
}

type FetchFn = typeof fetch;

export async function fetchAndParseFeed(input: FetchFeedInput, fetchFn: FetchFn = fetch): Promise<FetchFeedOutput> {
  let res: Response;
  try {
    res = await fetchFn(input.url, { method: 'GET', headers: { Accept: input.sourceType === 'json' ? 'application/json' : 'text/html' } });
  } catch (e) {
    return { fetchStatus: 'network_error', feed: null, report: { ok: false, errors: [{ path: '/', message: (e as Error).message }], warnings: [] } };
  }
  if (!res.ok) {
    return { fetchStatus: 'network_error', feed: null, report: { ok: false, errors: [{ path: '/', message: `HTTP ${res.status}` }], warnings: [] } };
  }
  const body = await res.text();

  if (input.sourceType === 'html') {
    const ex = extractFromHtml(body, { registeredPublisherId: input.registeredPublisherId });
    if (ex.errors.length > 0 || !ex.feed) {
      return { fetchStatus: 'parse_error', feed: null, report: { ok: false, errors: ex.errors, warnings: [] } };
    }
    if (ex.feed.publisher.id !== input.registeredPublisherId) {
      return { fetchStatus: 'validation_error', feed: null, report: { ok: false, errors: [{ path: '/publisher/id', message: 'mismatch' }], warnings: [] } };
    }
    const report = validateFeed(ex.feed);
    return {
      fetchStatus: report.ok ? 'ok' : 'validation_error',
      feed: report.ok ? ex.feed : null, report,
    };
  }

  let parsed: unknown;
  try { parsed = JSON.parse(body); }
  catch (e) {
    return { fetchStatus: 'parse_error', feed: null, report: { ok: false, errors: [{ path: '/', message: (e as Error).message }], warnings: [] } };
  }
  const report = validateFeed(parsed);
  if (!report.ok || !report.feed) {
    return { fetchStatus: 'validation_error', feed: null, report };
  }
  if (report.feed.publisher.id !== input.registeredPublisherId) {
    return { fetchStatus: 'validation_error', feed: null, report: { ok: false, errors: [{ path: '/publisher/id', message: 'mismatch' }], warnings: [] } };
  }
  return { fetchStatus: 'ok', feed: report.feed, report };
}
```

- [x] **Step 4: Run, commit**

```bash
cd backend && npx jest publisherFeedFetcher.test.ts
git add backend/src/services/publisherFeedFetcher.ts backend/src/__tests__/publisherFeedFetcher.test.ts backend/src/__tests__/fixtures/valid-feed.json backend/src/__tests__/fixtures/valid-feed-page.html
git commit -m "Plan 2, Task 7: publisher feed fetcher (JSON + HTML)"
```

---

## Task 8: Sidecar S3 publisher

**Files:**
- Create: `backend/src/services/publisherSidecarPublisher.ts`
- Test: `backend/src/__tests__/publisherSidecarPublisher.test.ts`

This service writes `publisher-events-${year}.json` to the same S3 bucket and prefix as the primary cache. Shape: `{ data: StoredPublisherEvent['payload'][] }` to match the existing `{ data: [...] }` envelope the frontend already understands.

- [x] **Step 1: Write the test**

```ts
import { PublisherSidecarPublisher } from '../services/publisherSidecarPublisher';
import type { StoredPublisherEvent } from '../types/publisher';

const mockS3 = { send: jest.fn() };

const ev = (id: string, year = 2026): StoredPublisherEvent => ({
  publisherId: 'p', eventId: id, startDate: `${year}-07-04T18:00:00-04:00`,
  endDate: `${year}-07-04T19:00:00-04:00`, lastModified: 't',
  payload: { id, title: id, startDate: `${year}-07-04T18:00:00-04:00`, endDate: `${year}-07-04T19:00:00-04:00`, category: 'Lecture', lastModified: 't', sourcePublisherId: 'p', sourcePublisherName: 'P' } as any,
  state: 'published', updatedAt: 't',
});

describe('PublisherSidecarPublisher', () => {
  it('groups by year and writes one object per year', async () => {
    const pub = new PublisherSidecarPublisher(mockS3 as any, 'bucket', 'cache/calendar-cache');
    await pub.publish([ev('a', 2026), ev('b', 2026), ev('c', 2027)]);
    expect(mockS3.send).toHaveBeenCalledTimes(2);
  });

  it('writes nothing for empty input', async () => {
    const pub = new PublisherSidecarPublisher(mockS3 as any, 'bucket', 'cache/calendar-cache');
    await pub.publish([]);
    expect(mockS3.send).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Implement**

```ts
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { StoredPublisherEvent } from '../types/publisher';

export class PublisherSidecarPublisher {
  constructor(private readonly s3: S3Client, private readonly bucket: string, private readonly keyPrefix: string) {}

  async publish(events: StoredPublisherEvent[]): Promise<void> {
    const published = events.filter(e => e.state === 'published');
    if (published.length === 0) return;
    const byYear = new Map<number, StoredPublisherEvent[]>();
    for (const e of published) {
      const y = Number(e.startDate.slice(0, 4));
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y)!.push(e);
    }
    for (const [year, group] of byYear) {
      const body = JSON.stringify({ data: group.map(g => g.payload) });
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: `${this.keyPrefix}/publisher-events-${year}.json`,
        Body: body,
        ContentType: 'application/json',
        CacheControl: 'public, max-age=300',
      }));
    }
  }
}
```

- [x] **Step 3: Run, commit**

```bash
cd backend && npx jest publisherSidecarPublisher.test.ts
git add backend/src/services/publisherSidecarPublisher.ts backend/src/__tests__/publisherSidecarPublisher.test.ts
git commit -m "Plan 2, Task 8: PublisherSidecarPublisher writes per-year sidecar to S3"
```

---

## Task 9: The Lambda handler

**Files:**
- Create: `backend/src/handlers/publisherIngestHandler.ts`
- Test: `backend/src/__tests__/publisherIngestHandler.integration.test.ts`

The handler wires together everything. Pseudocode:

```
list enabled publishers
for each:
  fetch+parse → if not ok, recordFetchOutcome and continue
  list stored events for publisher
  reconcile (stored, feed, now, trustLevel)
  if halted by threshold:
    setThresholdHalt(record)
    recordFetchOutcome(threshold_halt)
    continue
  applyDiff(diff)
  recordFetchOutcome(ok)
after all publishers:
  read all stored events with state='published' across all publishers
  write sidecar (per-year)
```

- [x] **Step 1: Write integration test**

```ts
import { runIngest } from '../handlers/publisherIngestHandler';

describe('runIngest (integration)', () => {
  it('processes one auto publisher end to end', async () => {
    const registry = {
      listEnabled: jest.fn().mockResolvedValue([{ id: 'test-pub', name: 'X', contactEmail: 'a@b', sourceUrl: 'https://x', sourceType: 'json', trustLevel: 'auto', enabled: true, createdAt: 't' }]),
      recordFetchOutcome: jest.fn().mockResolvedValue(undefined),
      setThresholdHalt: jest.fn().mockResolvedValue(undefined),
    };
    const fetcher = jest.fn().mockResolvedValue({
      fetchStatus: 'ok',
      report: { ok: true, errors: [], warnings: [] },
      feed: { formatVersion: '1.0', publisher: { id: 'test-pub', name: 'X', contactEmail: 'a@b' }, events: [
        { id: 'e1', title: 'E', startDate: '2026-07-04T18:00:00-04:00', endDate: '2026-07-04T19:00:00-04:00', category: 'Lecture', lastModified: '2026-05-01T00:00:00-04:00' },
      ] },
    });
    const store = {
      listForPublisher: jest.fn().mockResolvedValue([]),
      applyDiff: jest.fn().mockResolvedValue(undefined),
      listAllPublished: jest.fn().mockResolvedValue([
        { publisherId: 'test-pub', eventId: 'e1', state: 'published', startDate: '2026-07-04T18:00:00-04:00', endDate: '2026-07-04T19:00:00-04:00', lastModified: 't', payload: { id: 'e1', title: 'E', startDate: '2026-07-04T18:00:00-04:00', endDate: '2026-07-04T19:00:00-04:00', category: 'Lecture', lastModified: 't', sourcePublisherId: 'test-pub', sourcePublisherName: 'X' }, updatedAt: 't' },
      ]),
    };
    const sidecar = { publish: jest.fn().mockResolvedValue(undefined) };

    await runIngest({ registry: registry as any, store: store as any, sidecar: sidecar as any, fetcher: fetcher as any, now: new Date('2026-06-01T00:00:00Z') });

    expect(store.applyDiff).toHaveBeenCalledTimes(1);
    expect(sidecar.publish).toHaveBeenCalledTimes(1);
    expect(registry.recordFetchOutcome).toHaveBeenCalledWith('test-pub', { status: 'ok' });
  });
});
```

- [x] **Step 2: Add `listAllPublished` to `PublisherEventStore`**

In `publisherEventStore.ts`, add:
```ts
async listAllPublished(): Promise<StoredPublisherEvent[]> {
  // Uses the GSI by-state defined in Task 3.
  const out: StoredPublisherEvent[] = [];
  let last: any = undefined;
  do {
    const r: any = await this.db.send(new (require('@aws-sdk/lib-dynamodb').QueryCommand)({
      TableName: this.tableName, IndexName: 'by-state',
      KeyConditionExpression: '#s = :s',
      ExpressionAttributeNames: { '#s': 'state' },
      ExpressionAttributeValues: { ':s': 'published' },
      ExclusiveStartKey: last,
    }));
    out.push(...((r.Items ?? []) as StoredPublisherEvent[]));
    last = r.LastEvaluatedKey;
  } while (last);
  return out;
}
```

- [x] **Step 3: Implement `publisherIngestHandler.ts`**

```ts
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
    const f = await deps.fetcher({ url: p.sourceUrl, sourceType: p.sourceType, registeredPublisherId: p.id });
    if (f.fetchStatus !== 'ok' || !f.feed) {
      await deps.registry.recordFetchOutcome(p.id, { status: f.fetchStatus, message: f.report.errors.map(e => e.message).join('; ').slice(0, 500) });
      continue;
    }
    const stored = await deps.store.listForPublisher(p.id);
    const result = reconcile({ stored, feed: f.feed, now: deps.now, trustLevel: p.trustLevel });
    if (!result.applied) {
      await deps.registry.setThresholdHalt(p.id, { detectedAt: deps.now.toISOString(), incomingFeed: { events: f.feed.events, publisher: f.feed.publisher } });
      await deps.registry.recordFetchOutcome(p.id, { status: 'threshold_halt', message: result.haltedByThreshold!.reason });
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
    sidecar: new PublisherSidecarPublisher(new S3Client({}), process.env.CACHE_S3_BUCKET!, process.env.CACHE_S3_KEY_PREFIX!),
    fetcher: fetchAndParseFeed,
    now: new Date(),
  });
}
```

- [x] **Step 4: Run integration test, commit**

```bash
cd backend && npx jest publisherIngestHandler.integration.test.ts
git add backend/src/handlers/publisherIngestHandler.ts backend/src/services/publisherEventStore.ts backend/src/__tests__/publisherIngestHandler.integration.test.ts
git commit -m "Plan 2, Task 9: publisherIngestHandler Lambda entry"
```

---

## Task 10: Add esbuild target and Terraform Lambda resource

**Files:**
- Modify: `backend/package.json` (extend `build:prod` to also bundle `publisherIngestHandler.ts`)
- Modify: `infrastructure/publisher-ingest.tf`

- [x] **Step 1: Extend `backend/package.json` `build:prod`**

Append to the existing single-line `build:prod` script (preserve all existing entries; just add the bundling step for the new handler at the end before `cp -r src/services dist/`):

```
&& npx esbuild src/handlers/publisherIngestHandler.ts --bundle --platform=node --target=node22 --outfile=dist/publisherIngestHandler.js --external:@aws-sdk/client-dynamodb --external:@aws-sdk/client-s3 --external:@aws-sdk/lib-dynamodb
```

- [x] **Step 2: Add Lambda + IAM + schedule to `infrastructure/publisher-ingest.tf`**

Append:

```hcl
resource "aws_iam_role" "publisher_ingest_role" {
  name = "chq-publisher-ingest-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "publisher_ingest_basic" {
  role       = aws_iam_role.publisher_ingest_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "publisher_ingest_scoped" {
  role = aws_iam_role.publisher_ingest_role.name
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "dynamodb:Query","dynamodb:Scan","dynamodb:GetItem","dynamodb:PutItem",
          "dynamodb:UpdateItem","dynamodb:DeleteItem","dynamodb:TransactWriteItems"
        ],
        Resource = [
          aws_dynamodb_table.publishers.arn,
          aws_dynamodb_table.publisher_events.arn,
          "${aws_dynamodb_table.publisher_events.arn}/index/by-state"
        ]
      },
      {
        Effect = "Allow",
        Action = ["s3:PutObject"],
        Resource = "${aws_s3_bucket.frontend_bucket.arn}/cache/calendar-cache/publisher-events-*.json"
      }
    ]
  })
}

resource "aws_lambda_function" "publisher_ingest" {
  filename      = "../backend/lambda-function.zip"
  function_name = "chq-publisher-ingest"
  role          = aws_iam_role.publisher_ingest_role.arn
  handler       = "dist/publisherIngestHandler.scheduledHandler"
  runtime       = "nodejs22.x"
  timeout       = 600
  memory_size   = 512
  environment {
    variables = {
      PUBLISHERS_TABLE_NAME       = aws_dynamodb_table.publishers.name
      PUBLISHER_EVENTS_TABLE_NAME = aws_dynamodb_table.publisher_events.name
      CACHE_S3_BUCKET             = aws_s3_bucket.frontend_bucket.bucket
      CACHE_S3_KEY_PREFIX         = "cache/calendar-cache"
    }
  }
  source_code_hash = filebase64sha256("../backend/lambda-function.zip")
}

resource "aws_cloudwatch_event_rule" "publisher_ingest_schedule" {
  name                = "chq-publisher-ingest-hourly"
  schedule_expression = "rate(1 hour)"
}

resource "aws_cloudwatch_event_target" "publisher_ingest_target" {
  rule = aws_cloudwatch_event_rule.publisher_ingest_schedule.name
  arn  = aws_lambda_function.publisher_ingest.arn
}

resource "aws_lambda_permission" "publisher_ingest_allow_events" {
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.publisher_ingest.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.publisher_ingest_schedule.arn
}
```

- [x] **Step 3: Build, deploy package, plan**

```bash
cd /Users/bernard/src/chq/chq-calendar/backend && npm run package:terraform
cd /Users/bernard/src/chq/chq-calendar/infrastructure && terraform plan -out=tfplan-publisher-lambda
```
Expected: only the new Lambda + IAM + EventBridge resources are added. **No change to `aws_lambda_function.data_sync`, `manual_sync`, `calendarHandler`, `adminHandler`, or to `aws_iam_role.lambda_role`.** If any of those appear in the plan, abort and fix.

- [x] **Step 4: Apply**

```bash
terraform apply tfplan-publisher-lambda
```

- [x] **Step 5: Commit**

```bash
git add backend/package.json infrastructure/publisher-ingest.tf
git commit -m "Plan 2, Task 10: deploy publisherIngestHandler Lambda + EventBridge schedule"
```

---

## Task 11: Verification gate — `all-events.json` byte-equivalence

**Files:**
- Create: `scripts/verify-primary-cache-unchanged.sh`

This script grabs the current primary cache from S3, waits a primary-sync cycle, grabs again, and confirms byte-equivalence. The publisher pipeline being live during this window is part of the test — proves the new pipeline does not touch the primary file.

- [x] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
set -euo pipefail

BUCKET="${1:?usage: verify-primary-cache-unchanged.sh <bucket>}"
KEY_PREFIX="cache/calendar-cache"
YEAR="${2:-2026}"
KEY="$KEY_PREFIX/all-events-$YEAR.json"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "Snapshot 1 of s3://$BUCKET/$KEY..."
aws s3 cp "s3://$BUCKET/$KEY" "$WORK/before.json"

echo "Triggering primary sync..."
aws lambda invoke --function-name chq-calendar-manual-sync "$WORK/primary.out" >/dev/null

echo "Triggering publisher ingest (the thing we're testing)..."
aws lambda invoke --function-name chq-publisher-ingest "$WORK/publisher.out" >/dev/null

# Give S3 a moment to be eventually-consistent.
sleep 10

echo "Snapshot 2..."
aws s3 cp "s3://$BUCKET/$KEY" "$WORK/after.json"

if cmp -s "$WORK/before.json" "$WORK/after.json"; then
  echo "PASS: $KEY is byte-equivalent before and after the publisher-ingest run."
else
  echo "FAIL: $KEY changed during the publisher-ingest run."
  diff <(jq -S . "$WORK/before.json") <(jq -S . "$WORK/after.json") | head -50
  exit 1
fi
```

- [x] **Step 2: Run it against the deployed environment**

```bash
chmod +x scripts/verify-primary-cache-unchanged.sh
./scripts/verify-primary-cache-unchanged.sh "$(grep -h frontend_bucket infrastructure/main.tf | head -1 | awk '{print $3}' | tr -d '\"')"
```
Expected: `PASS`. If it fails, **stop** — there is unexpected coupling between the two pipelines and Plan 2 must be revised before any further work proceeds.

- [x] **Step 3: Commit**

```bash
git add scripts/verify-primary-cache-unchanged.sh
git commit -m "Plan 2, Task 11: verification gate proving primary cache untouched"
```

---

## Plan 2 self-review

- [x] §1.1 isolation: separate Lambda ✅, separate DynamoDB tables ✅, separate sidecar key ✅, separate IAM role ✅, no edits to existing primary-pipeline Tasks files (verify with `git diff main -- backend/src/handlers/syncHandler.ts backend/src/services/eventTransformationService.ts` — should be empty).
- [x] §4.4 reconciliation, including absent-vs-cancelled and threshold halt: covered by Tasks 6 + 9 + 11.
- [x] §4.5 trust tiers (auto vs review/flagged → state=published vs pending): covered by Task 6.
- [x] §4.3 validation (matching publisher.id): covered by Task 7.
- [x] §1.1 verification gate: covered by Task 11.
- [x] No placeholders, all paths and commands concrete.

---

## Follow-ups deferred from PR #70

Three LOW-severity items were identified in the final review and intentionally left for follow-up issues — they do not block the pipeline being live and are not required for Plans 3 or 4 to proceed.

- **SSRF guard on publisher `sourceUrl`** — `publisherFeedFetcher.ts` accepts whatever URL the admin records. A misconfigured record pointing at `http://169.254.169.254/` (IMDS) or an internal VPC service would be fetched without restriction. Add a scheme/hostname allowlist (require `https`, reject RFC-1918 / link-local) as a defense-in-depth backstop against operator error.
- **`by-state` GSI hot partition awareness** — nearly all reads hit `state='published'`. DynamoDB handles this fine at current publisher volume, but as event counts grow this may need re-partitioning (e.g. compose the hash with a year shard).
- **Lambda DLQ / Errors alarm** — `aws_cloudwatch_event_target.publisher_ingest_target` has no `retry_policy` block (so EventBridge uses its defaults: up to 185 attempts over 24 hours), the Lambda has no `dead_letter_config`, and there is no `aws_cloudwatch_metric_alarm` on the function's `Errors` metric. The CloudWatch log group makes failures inspectable but nothing actively surfaces them. A `dead_letter_config` SQS queue plus an Errors-metric alarm would page on repeated failures rather than letting them burn through the retry budget unnoticed.
