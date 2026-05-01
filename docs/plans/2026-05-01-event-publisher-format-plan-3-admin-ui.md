# Event Publisher Format — Plan 3: Admin UI (Registration, Review Queue, Threshold-Halt Approval)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins the controls needed to operate the publisher pipeline: register/edit/disable publishers, approve or reject pending events from `trustLevel: review` or `flagged` publishers, and approve/cancel threshold-halt incidents. All admin functionality is added to the existing `adminHandler` Lambda and the existing admin app at `/admin/`.

**Architecture:** Extend `backend/src/handlers/adminHandler.ts` with new authenticated routes under `/admin/publishers` and `/admin/publisher-events`. Add new admin pages under `frontend/src/app/admin/publishers/` and `frontend/src/app/admin/publisher-events/`, mirroring the existing `/admin/feedback` pattern. Reuse the existing OAuth + email-whitelist auth path. Auth checks remain in `adminHandler.ts`; no new auth surface.

**Tech Stack:** TypeScript, AWS Lambda, DynamoDB. Frontend: Preact + Vite + Tailwind, Vitest for tests. Reuses `auth.ts` and admin-page patterns already in the codebase.

**Spec reference:** `docs/plans/2026-05-01-event-publisher-format-design.md` §4.1 (registration), §4.4 (threshold halt approval), §4.5 (trust tiers).

**Prerequisite:** Plan 2 complete and deployed. Plan 3 reads from and writes to the `chq-publishers` and `chq-publisher-events` tables introduced in Plan 2.

---

## File Structure

```
backend/
├── src/
│   ├── handlers/
│   │   └── adminHandler.ts                     # MODIFY — add publisher routes
│   ├── services/
│   │   ├── publisherAdminService.ts            # NEW — high-level admin operations
│   │   └── publisherEventStore.ts              # MODIFY — add listPending(), approveEvent(), rejectEvent()
│   └── __tests__/
│       ├── publisherAdminService.test.ts       # NEW
│       └── publisherEventStore.adminOps.test.ts # NEW

frontend/
├── index-admin-publishers.html                 # NEW — entry HTML
├── index-admin-publisher-events.html           # NEW — entry HTML
├── vite.config.ts                              # MODIFY — add new entries
└── src/
    ├── entries/
    │   ├── admin-publishers.tsx                # NEW
    │   └── admin-publisher-events.tsx          # NEW
    ├── app/
    │   └── admin/
    │       ├── publishers/
    │       │   ├── page.tsx                    # NEW — list/create/edit publishers
    │       │   └── PublisherForm.tsx           # NEW — sub-component
    │       └── publisher-events/
    │           ├── page.tsx                    # NEW — pending queue + halt incidents
    │           └── PendingEventCard.tsx        # NEW — sub-component
    ├── lib/
    │   └── adminPublisherApi.ts                # NEW — typed fetch wrappers
    └── __tests__/
        ├── lib/adminPublisherApi.test.ts       # NEW
        └── components/admin/PendingEventCard.test.tsx # NEW

infrastructure/
└── publisher-ingest.tf                         # MODIFY — extend admin Lambda IAM to access new tables
```

## Why this layout

- The two admin surfaces (publisher CRUD vs. pending events) are different enough in shape — list/edit/create vs. queue/approve — that splitting them into two pages is cleaner than one giant page. Each entry/page combo is small and focused, matching the existing `/admin/feedback/` pattern.
- The `publisherAdminService` is a thin facade over the Plan-2 services, so the handler stays free of orchestration logic and routes are easy to test.

---

## Task 1: Extend admin Lambda IAM

**Files:**
- Modify: `infrastructure/main.tf` (locate the admin Lambda's IAM policy block) **OR** `infrastructure/publisher-ingest.tf` (cleaner — add a separate attachment).

Pick the cleaner path: append to `infrastructure/publisher-ingest.tf` so the publisher-related IAM stays grouped.

- [ ] **Step 1: Append to `publisher-ingest.tf`**

```hcl
# Existing admin Lambda role (created in main.tf as `lambda_role`) needs read/write
# access to the publisher tables for the admin endpoints in adminHandler.ts.
resource "aws_iam_role_policy" "admin_publisher_access" {
  name = "chq-admin-publisher-access"
  role = aws_iam_role.lambda_role.name
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect = "Allow",
      Action = [
        "dynamodb:Query","dynamodb:Scan","dynamodb:GetItem",
        "dynamodb:PutItem","dynamodb:UpdateItem","dynamodb:DeleteItem","dynamodb:TransactWriteItems"
      ],
      Resource = [
        aws_dynamodb_table.publishers.arn,
        aws_dynamodb_table.publisher_events.arn,
        "${aws_dynamodb_table.publisher_events.arn}/index/by-state"
      ]
    }]
  })
}
```

- [ ] **Step 2: Plan, apply, commit**

```bash
cd infrastructure && terraform plan -out=tfplan-admin-iam
terraform apply tfplan-admin-iam
git add infrastructure/publisher-ingest.tf
git commit -m "Plan 3, Task 1: grant admin Lambda role access to publisher tables"
```

---

## Task 2: Extend `PublisherEventStore` with admin operations

**Files:**
- Modify: `backend/src/services/publisherEventStore.ts`
- Test: `backend/src/__tests__/publisherEventStore.adminOps.test.ts`

Add three methods: `listPending()`, `approveEvent(publisherId, eventId)`, `rejectEvent(publisherId, eventId)`.

- [ ] **Step 1: Write the test**

```ts
import { PublisherEventStore } from '../services/publisherEventStore';

const mockClient = { send: jest.fn() };

describe('PublisherEventStore admin ops', () => {
  let store: PublisherEventStore;
  beforeEach(() => {
    jest.resetAllMocks();
    store = new PublisherEventStore(mockClient as any, 'chq-publisher-events');
  });

  it('listPending uses the by-state GSI with state=pending', async () => {
    mockClient.send.mockResolvedValue({ Items: [] });
    await store.listPending();
    const cmd: any = mockClient.send.mock.calls[0][0];
    expect(cmd.input.IndexName).toBe('by-state');
    expect(cmd.input.ExpressionAttributeValues[':s']).toBe('pending');
  });

  it('approveEvent updates state to published', async () => {
    mockClient.send.mockResolvedValue({});
    await store.approveEvent('p', 'e');
    const cmd: any = mockClient.send.mock.calls[0][0];
    expect(cmd.input.UpdateExpression).toContain('state');
    expect(cmd.input.ExpressionAttributeValues[':s']).toBe('published');
  });

  it('rejectEvent deletes the row', async () => {
    mockClient.send.mockResolvedValue({});
    await store.rejectEvent('p', 'e');
    const cmd: any = mockClient.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('DeleteCommand');
  });
});
```

- [ ] **Step 2: Implement**

Add to `publisherEventStore.ts`:
```ts
import { DeleteCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

// inside the class:
async listPending(): Promise<StoredPublisherEvent[]> {
  const out: StoredPublisherEvent[] = [];
  let last: any = undefined;
  do {
    const r: any = await this.db.send(new QueryCommand({
      TableName: this.tableName, IndexName: 'by-state',
      KeyConditionExpression: '#s = :s',
      ExpressionAttributeNames: { '#s': 'state' },
      ExpressionAttributeValues: { ':s': 'pending' },
      ExclusiveStartKey: last,
    }));
    out.push(...((r.Items ?? []) as StoredPublisherEvent[]));
    last = r.LastEvaluatedKey;
  } while (last);
  return out;
}

async approveEvent(publisherId: string, eventId: string): Promise<void> {
  await this.db.send(new UpdateCommand({
    TableName: this.tableName,
    Key: { publisherId, eventId },
    UpdateExpression: 'SET #s = :s, updatedAt = :now',
    ExpressionAttributeNames: { '#s': 'state' },
    ExpressionAttributeValues: { ':s': 'published', ':now': new Date().toISOString() },
  }));
}

async rejectEvent(publisherId: string, eventId: string): Promise<void> {
  await this.db.send(new DeleteCommand({ TableName: this.tableName, Key: { publisherId, eventId } }));
}
```

- [ ] **Step 3: Run, commit**

```bash
cd backend && npx jest publisherEventStore.adminOps.test.ts
git add backend/src/services/publisherEventStore.ts backend/src/__tests__/publisherEventStore.adminOps.test.ts
git commit -m "Plan 3, Task 2: admin ops on PublisherEventStore"
```

---

## Task 3: `publisherAdminService`

**Files:**
- Create: `backend/src/services/publisherAdminService.ts`
- Test: `backend/src/__tests__/publisherAdminService.test.ts`

This service composes registry + event-store operations into the verbs the admin UI needs:
- `listPublishers()`, `createPublisher(rec)`, `updatePublisher(id, patch)`, `disablePublisher(id)`, `enablePublisher(id)`
- `listPendingEvents()`, `approveEvent(publisherId, eventId)`, `rejectEvent(publisherId, eventId)`
- `listThresholdHalts()`, `approveThresholdHalt(publisherId)` (clears the halt and applies the held-back diff on next fetch — actually simpler: clears the field; the next scheduled fetch will re-evaluate, and if the publisher has gone back to a sane size it'll just apply normally), `cancelThresholdHalt(publisherId)` (clears the halt; if the publisher's feed is genuinely smaller intentionally, the admin can manually disable then re-enable to force a re-evaluation).

For Plan 3 v1, "approve threshold halt" simply clears the `pendingThresholdHalt` field and re-runs the reconciler against the held-back feed payload, then applies the diff. This keeps the UX simple.

- [ ] **Step 1: Write the test**

```ts
import { PublisherAdminService } from '../services/publisherAdminService';

const reg = { listEnabled: jest.fn(), get: jest.fn(), upsert: jest.fn(), recordFetchOutcome: jest.fn(), setThresholdHalt: jest.fn() };
const store = { listForPublisher: jest.fn(), applyDiff: jest.fn(), listAllPublished: jest.fn(), listPending: jest.fn(), approveEvent: jest.fn(), rejectEvent: jest.fn() };

describe('PublisherAdminService', () => {
  let svc: PublisherAdminService;
  beforeEach(() => {
    jest.resetAllMocks();
    svc = new PublisherAdminService(reg as any, store as any);
  });

  it('createPublisher upserts a record with createdAt and trustLevel=review default', async () => {
    await svc.createPublisher({ id: 'p', name: 'P', contactEmail: 'a@b', sourceUrl: 'https://x', sourceType: 'json' });
    const arg = reg.upsert.mock.calls[0][0];
    expect(arg.trustLevel).toBe('review');
    expect(arg.enabled).toBe(true);
    expect(typeof arg.createdAt).toBe('string');
  });

  it('approveEvent delegates to the store', async () => {
    await svc.approveEvent('p', 'e');
    expect(store.approveEvent).toHaveBeenCalledWith('p', 'e');
  });
});
```

- [ ] **Step 2: Implement**

```ts
import type { PublisherRegistryService } from './publisherRegistryService';
import type { PublisherEventStore } from './publisherEventStore';
import type { PublisherRecord, StoredPublisherEvent } from '../types/publisher';
import { reconcile } from './publisherReconciler';

export interface CreatePublisherInput {
  id: string;
  name: string;
  contactEmail: string;
  sourceUrl: string;
  sourceType: 'json' | 'html';
  trustLevel?: PublisherRecord['trustLevel'];
}

export class PublisherAdminService {
  constructor(private readonly registry: PublisherRegistryService, private readonly store: PublisherEventStore) {}

  async listPublishers(): Promise<PublisherRecord[]> {
    return this.registry.listEnabled(); // For admin v1, list enabled. Add scan-all if needed.
  }

  async createPublisher(input: CreatePublisherInput): Promise<PublisherRecord> {
    const rec: PublisherRecord = {
      ...input,
      trustLevel: input.trustLevel ?? 'review',
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    await this.registry.upsert(rec);
    return rec;
  }

  async updatePublisher(id: string, patch: Partial<PublisherRecord>): Promise<PublisherRecord> {
    const ex = await this.registry.get(id);
    if (!ex) throw new Error(`unknown publisher ${id}`);
    const next = { ...ex, ...patch, id };
    await this.registry.upsert(next);
    return next;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.updatePublisher(id, { enabled });
  }

  async listPendingEvents(): Promise<StoredPublisherEvent[]> {
    return this.store.listPending();
  }

  approveEvent(publisherId: string, eventId: string): Promise<void> {
    return this.store.approveEvent(publisherId, eventId);
  }

  rejectEvent(publisherId: string, eventId: string): Promise<void> {
    return this.store.rejectEvent(publisherId, eventId);
  }

  async listThresholdHalts(): Promise<PublisherRecord[]> {
    const all = await this.registry.listEnabled();
    return all.filter(p => p.pendingThresholdHalt != null);
  }

  /**
   * Admin approves the halted change set. We re-run the reconciler against
   * the held-back feed payload + the current stored events. This is necessary
   * because storage may have changed since the halt was recorded.
   */
  async approveThresholdHalt(publisherId: string, now: Date = new Date()): Promise<{ inserted: number; updated: number; removed: number }> {
    const rec = await this.registry.get(publisherId);
    if (!rec || !rec.pendingThresholdHalt) throw new Error(`no pending halt for ${publisherId}`);
    const stored = await this.store.listForPublisher(publisherId);
    const result = reconcile({
      stored, now, trustLevel: rec.trustLevel,
      feed: { formatVersion: '1.0', publisher: rec.pendingThresholdHalt.incomingFeed.publisher, events: rec.pendingThresholdHalt.incomingFeed.events },
    });
    // Admin approval bypasses the threshold guard: even if it halts again here, force-apply.
    await this.store.applyDiff(result.diff);
    await this.registry.setThresholdHalt(publisherId, undefined);
    return { inserted: result.diff.inserts.length, updated: result.diff.updates.length, removed: result.diff.removals.length };
  }

  async cancelThresholdHalt(publisherId: string): Promise<void> {
    await this.registry.setThresholdHalt(publisherId, undefined);
  }
}
```

- [ ] **Step 3: Run, commit**

```bash
cd backend && npx jest publisherAdminService.test.ts
git add backend/src/services/publisherAdminService.ts backend/src/__tests__/publisherAdminService.test.ts
git commit -m "Plan 3, Task 3: PublisherAdminService"
```

---

## Task 4: Add admin handler routes

**Files:**
- Modify: `backend/src/handlers/adminHandler.ts`

Routes (all require existing admin OAuth/whitelist; reuse the auth check pattern already in this handler):

| Method | Path | Action |
|---|---|---|
| GET    | `/admin/publishers` | list |
| POST   | `/admin/publishers` | create |
| PATCH  | `/admin/publishers/{id}` | update |
| GET    | `/admin/publisher-events/pending` | list pending |
| POST   | `/admin/publisher-events/{publisherId}/{eventId}/approve` | approve |
| POST   | `/admin/publisher-events/{publisherId}/{eventId}/reject` | reject |
| GET    | `/admin/publisher-halts` | list threshold halts |
| POST   | `/admin/publisher-halts/{publisherId}/approve` | approve halt |
| POST   | `/admin/publisher-halts/{publisherId}/cancel` | cancel halt |

- [ ] **Step 1: Locate the existing route-dispatch block in `adminHandler.ts`**

Use `grep -n "event.path\|httpMethod" backend/src/handlers/adminHandler.ts` to find the dispatch table. Add new branches in the same style after the existing admin endpoints, **before** the catch-all 404.

- [ ] **Step 2: Add a small route helper**

At the top of the file, after the existing imports:
```ts
import { PublisherAdminService } from '../services/publisherAdminService';
import { PublisherRegistryService } from '../services/publisherRegistryService';
import { PublisherEventStore } from '../services/publisherEventStore';

const publisherAdminLazy = (() => {
  let svc: PublisherAdminService | null = null;
  return () => {
    if (svc) return svc;
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    svc = new PublisherAdminService(
      new PublisherRegistryService(ddb, process.env.PUBLISHERS_TABLE_NAME!),
      new PublisherEventStore(ddb, process.env.PUBLISHER_EVENTS_TABLE_NAME!),
    );
    return svc;
  };
})();
```
(If `DynamoDBDocumentClient`/`DynamoDBClient` aren't already imported, add those imports.)

- [ ] **Step 3: Add the route handlers**

Inside the existing `if (path === '...' && httpMethod === '...')` cascade, add (after auth check is performed for admin paths):

```ts
if (path === '/admin/publishers' && httpMethod === 'GET') {
  const r = await publisherAdminLazy().listPublishers();
  return createResponse(200, r);
}
if (path === '/admin/publishers' && httpMethod === 'POST') {
  const r = await publisherAdminLazy().createPublisher(requestBody);
  return createResponse(201, r);
}
const matchPubPatch = path.match(/^\/admin\/publishers\/([^/]+)$/);
if (matchPubPatch && httpMethod === 'PATCH') {
  const r = await publisherAdminLazy().updatePublisher(matchPubPatch[1], requestBody);
  return createResponse(200, r);
}
if (path === '/admin/publisher-events/pending' && httpMethod === 'GET') {
  return createResponse(200, await publisherAdminLazy().listPendingEvents());
}
const matchApprove = path.match(/^\/admin\/publisher-events\/([^/]+)\/([^/]+)\/approve$/);
if (matchApprove && httpMethod === 'POST') {
  await publisherAdminLazy().approveEvent(matchApprove[1], matchApprove[2]);
  return createResponse(204, {});
}
const matchReject = path.match(/^\/admin\/publisher-events\/([^/]+)\/([^/]+)\/reject$/);
if (matchReject && httpMethod === 'POST') {
  await publisherAdminLazy().rejectEvent(matchApprove![1], matchApprove![2]);
  return createResponse(204, {});
}
if (path === '/admin/publisher-halts' && httpMethod === 'GET') {
  return createResponse(200, await publisherAdminLazy().listThresholdHalts());
}
const matchHaltApprove = path.match(/^\/admin\/publisher-halts\/([^/]+)\/approve$/);
if (matchHaltApprove && httpMethod === 'POST') {
  return createResponse(200, await publisherAdminLazy().approveThresholdHalt(matchHaltApprove[1]));
}
const matchHaltCancel = path.match(/^\/admin\/publisher-halts\/([^/]+)\/cancel$/);
if (matchHaltCancel && httpMethod === 'POST') {
  await publisherAdminLazy().cancelThresholdHalt(matchHaltCancel[1]);
  return createResponse(204, {});
}
```

- [ ] **Step 4: Add env vars to admin Lambda**

In `infrastructure/main.tf`, locate the admin Lambda's `environment.variables` block. Add:
```hcl
PUBLISHERS_TABLE_NAME       = aws_dynamodb_table.publishers.name
PUBLISHER_EVENTS_TABLE_NAME = aws_dynamodb_table.publisher_events.name
```

- [ ] **Step 5: Build, plan, apply, commit**

```bash
cd backend && npm run build:prod && cd .. && cd backend && zip -r lambda-function.zip dist/ package.json node_modules/ && cd ..
cd infrastructure && terraform plan -out=tfplan-admin-routes && terraform apply tfplan-admin-routes
git add backend/src/handlers/adminHandler.ts infrastructure/main.tf
git commit -m "Plan 3, Task 4: admin routes for publisher CRUD + queue + halt approval"
```

---

## Task 5: Frontend — typed API client

**Files:**
- Create: `frontend/src/lib/adminPublisherApi.ts`
- Test: `frontend/src/__tests__/lib/adminPublisherApi.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listPublishers, createPublisher, approveEvent } from '../../lib/adminPublisherApi';

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ([]), text: async () => '', status: 200 } as any));
});

describe('adminPublisherApi', () => {
  it('listPublishers GETs /admin/publishers', async () => {
    await listPublishers();
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/admin\/publishers$/), expect.any(Object));
  });

  it('createPublisher POSTs JSON', async () => {
    await createPublisher({ id: 'p', name: 'P', contactEmail: 'a@b', sourceUrl: 'https://x', sourceType: 'json' });
    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[1].method).toBe('POST');
    expect(call[1].body).toContain('"id":"p"');
  });

  it('approveEvent POSTs to .../approve', async () => {
    await approveEvent('p', 'e');
    expect((globalThis.fetch as any).mock.calls[0][0]).toMatch(/\/admin\/publisher-events\/p\/e\/approve$/);
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { getAuthToken } from './auth';

const API = import.meta.env.VITE_API_URL ?? '';

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

export interface PublisherRecord { id: string; name: string; contactEmail: string; sourceUrl: string; sourceType: 'json' | 'html'; trustLevel: 'auto' | 'review' | 'flagged'; enabled: boolean; lastFetchedAt?: string; lastFetchStatus?: string; lastFetchMessage?: string; }
export interface PendingEvent { publisherId: string; eventId: string; payload: { title: string; startDate: string; endDate: string; category: string; sourcePublisherName: string; }; }

export const listPublishers = () => req<PublisherRecord[]>('/admin/publishers');
export const createPublisher = (rec: Omit<PublisherRecord, 'enabled' | 'trustLevel'> & { trustLevel?: PublisherRecord['trustLevel'] }) =>
  req<PublisherRecord>('/admin/publishers', { method: 'POST', body: JSON.stringify(rec) });
export const updatePublisher = (id: string, patch: Partial<PublisherRecord>) =>
  req<PublisherRecord>(`/admin/publishers/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const listPending = () => req<PendingEvent[]>('/admin/publisher-events/pending');
export const approveEvent = (publisherId: string, eventId: string) => req<void>(`/admin/publisher-events/${encodeURIComponent(publisherId)}/${encodeURIComponent(eventId)}/approve`, { method: 'POST' });
export const rejectEvent = (publisherId: string, eventId: string) => req<void>(`/admin/publisher-events/${encodeURIComponent(publisherId)}/${encodeURIComponent(eventId)}/reject`, { method: 'POST' });

export const listHalts = () => req<PublisherRecord[]>('/admin/publisher-halts');
export const approveHalt = (publisherId: string) => req<{ inserted: number; updated: number; removed: number }>(`/admin/publisher-halts/${encodeURIComponent(publisherId)}/approve`, { method: 'POST' });
export const cancelHalt = (publisherId: string) => req<void>(`/admin/publisher-halts/${encodeURIComponent(publisherId)}/cancel`, { method: 'POST' });
```

- [ ] **Step 3: Run, commit**

```bash
cd frontend && npm test -- adminPublisherApi
git add frontend/src/lib/adminPublisherApi.ts frontend/src/__tests__/lib/adminPublisherApi.test.ts
git commit -m "Plan 3, Task 5: typed admin publisher API client"
```

---

## Task 6: Frontend — `/admin/publishers` page

**Files:**
- Create: `frontend/index-admin-publishers.html`
- Create: `frontend/src/entries/admin-publishers.tsx`
- Create: `frontend/src/app/admin/publishers/page.tsx`
- Create: `frontend/src/app/admin/publishers/PublisherForm.tsx`
- Modify: `frontend/vite.config.ts`

- [ ] **Step 1: Add the entry HTML**

Copy the structure of an existing admin entry HTML (e.g., `frontend/index-admin-feedback.html` if it exists, otherwise look at how the existing admin pages do their entries). The `<script>` tag should reference `/src/entries/admin-publishers.tsx`. Title: "CHQ — Admin: Publishers".

- [ ] **Step 2: Add a Vite entry**

In `frontend/vite.config.ts`, locate `rollupOptions.input` and add:
```ts
'admin-publishers': resolve(__dirname, 'index-admin-publishers.html'),
```

- [ ] **Step 3: Implement the entry**

`frontend/src/entries/admin-publishers.tsx` — mirror the existing entry pattern (one-liner that mounts the page component into `#root`). Look at `frontend/src/entries/admin-feedback.tsx` for the template.

- [ ] **Step 4: Implement the page**

`frontend/src/app/admin/publishers/page.tsx` — list of publishers with: `id`, `name`, `sourceUrl`, `trustLevel`, `enabled`, `lastFetchStatus`. Above the list: a "New publisher" button that opens `PublisherForm`. Each row has "Edit" (opens form prefilled), "Disable"/"Enable" toggle. The form collects: id, name, contactEmail, sourceUrl, sourceType (radio: json/html), trustLevel (default review). Submit calls `createPublisher` or `updatePublisher`.

Keep it minimal — Tailwind classes, no design system. Use existing admin pages as the visual template.

- [ ] **Step 5: Smoke test in dev**

```bash
cd frontend && npm run dev
```
Visit `http://localhost:3000/admin/publishers/`. Authenticate via existing OAuth. Confirm: list loads (empty initially), New form works (creates a publisher), refresh shows it.

- [ ] **Step 6: Commit**

```bash
git add frontend/index-admin-publishers.html frontend/src/entries/admin-publishers.tsx frontend/src/app/admin/publishers/ frontend/vite.config.ts
git commit -m "Plan 3, Task 6: /admin/publishers page (list + create + edit)"
```

---

## Task 7: Frontend — `/admin/publisher-events` page

**Files:**
- Create: `frontend/index-admin-publisher-events.html`
- Create: `frontend/src/entries/admin-publisher-events.tsx`
- Create: `frontend/src/app/admin/publisher-events/page.tsx`
- Create: `frontend/src/app/admin/publisher-events/PendingEventCard.tsx`
- Test: `frontend/src/__tests__/components/admin/PendingEventCard.test.tsx`
- Modify: `frontend/vite.config.ts`

The page has two sections, stacked:

1. **Pending events** — list of `PendingEvent` from `listPending()`. Each `PendingEventCard` shows title, date, publisher name, category, and two buttons: Approve / Reject.
2. **Threshold halts** — list of publishers with `pendingThresholdHalt`. Each row: publisher name, halt reason, two buttons: "Approve & apply" / "Cancel".

- [ ] **Step 1: Write a component test for `PendingEventCard`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { PendingEventCard } from '../../../app/admin/publisher-events/PendingEventCard';

const ev = {
  publisherId: 'p', eventId: 'e',
  payload: { title: 'My Event', startDate: '2026-07-04T18:00:00-04:00', endDate: '2026-07-04T19:00:00-04:00', category: 'Lecture', sourcePublisherName: 'Source Pub' },
};

describe('PendingEventCard', () => {
  it('renders title and publisher', () => {
    render(<PendingEventCard event={ev as any} onApprove={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText('My Event')).toBeInTheDocument();
    expect(screen.getByText(/Source Pub/)).toBeInTheDocument();
  });

  it('calls onApprove when Approve clicked', () => {
    const fn = vi.fn();
    render(<PendingEventCard event={ev as any} onApprove={fn} onReject={vi.fn()} />);
    fireEvent.click(screen.getByText('Approve'));
    expect(fn).toHaveBeenCalledWith('p', 'e');
  });
});
```

- [ ] **Step 2: Implement `PendingEventCard.tsx`**

```tsx
import type { PendingEvent } from '../../../lib/adminPublisherApi';

interface Props {
  event: PendingEvent;
  onApprove: (publisherId: string, eventId: string) => void;
  onReject: (publisherId: string, eventId: string) => void;
}

export function PendingEventCard({ event, onApprove, onReject }: Props) {
  return (
    <div class="border rounded p-3 mb-2 flex justify-between items-start">
      <div>
        <div class="font-semibold">{event.payload.title}</div>
        <div class="text-sm text-gray-600">{event.payload.startDate}{' — '}{event.payload.category}</div>
        <div class="text-xs text-gray-500">via {event.payload.sourcePublisherName}</div>
      </div>
      <div class="flex gap-2">
        <button class="px-3 py-1 bg-green-600 text-white rounded" onClick={() => onApprove(event.publisherId, event.eventId)}>Approve</button>
        <button class="px-3 py-1 bg-red-600 text-white rounded" onClick={() => onReject(event.publisherId, event.eventId)}>Reject</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement the page (`page.tsx`), entry, HTML**

Mirror Task 6's pattern. The page component:
- On mount, calls `listPending()` and `listHalts()`.
- Renders the two stacked sections.
- Approve/reject calls re-fetch the list.

For the threshold-halts section, each row:
```tsx
<div class="border rounded p-3 mb-2">
  <div class="font-semibold">{halt.name}</div>
  <div class="text-sm text-red-700">{halt.pendingThresholdHalt!.detectedAt}: held back, would have removed too many events</div>
  <div class="flex gap-2 mt-2">
    <button onClick={() => approveHalt(halt.id).then(refresh)}>Approve & apply</button>
    <button onClick={() => cancelHalt(halt.id).then(refresh)}>Cancel</button>
  </div>
</div>
```

- [ ] **Step 4: Add the Vite entry**

In `vite.config.ts` `rollupOptions.input`:
```ts
'admin-publisher-events': resolve(__dirname, 'index-admin-publisher-events.html'),
```

- [ ] **Step 5: Smoke test, commit**

```bash
cd frontend && npm run dev
# manual check at /admin/publisher-events/
git add frontend/index-admin-publisher-events.html frontend/src/entries/admin-publisher-events.tsx frontend/src/app/admin/publisher-events/ frontend/src/__tests__/components/admin/PendingEventCard.test.tsx frontend/vite.config.ts
git commit -m "Plan 3, Task 7: /admin/publisher-events page (pending queue + halts)"
```

---

## Task 8: Smoke test against deployed backend

**Files:** none (manual verification)

- [ ] **Step 1: Deploy backend changes**

Use whatever the project's normal deploy path is (check `backend/deploy-calendar-lambda.sh` or terraform).

- [ ] **Step 2: End-to-end smoke**

1. Open `/admin/publishers/`. Create a test publisher with `trustLevel: review`, pointing at a small JSON feed you've hosted somewhere.
2. Manually invoke the `chq-publisher-ingest` Lambda: `aws lambda invoke --function-name chq-publisher-ingest /tmp/out.json`.
3. Open `/admin/publisher-events/`. The fetched events should appear in the pending queue.
4. Click Approve on one. Refresh — that event is gone from the pending list.
5. Re-invoke the Lambda. The approved event stays put (state already `published`, no diff).
6. Promote the publisher to `trustLevel: auto` via the edit form. Re-invoke. Subsequent events arrive directly as published, never hitting the pending queue.
7. Re-run `scripts/verify-primary-cache-unchanged.sh` (from Plan 2 Task 11) — must still PASS.

- [ ] **Step 3: Commit any fixes from smoke testing**

If smoke tests reveal bugs, fix them and commit. If everything works on the first try, no commit needed — add a note in the plan that smoke passed.

---

## Plan 3 self-review

- [ ] §4.1 publisher registration: Tasks 4, 5, 6.
- [ ] §4.5 trust tier promotion (admin can change `trustLevel`): Task 6 edit form.
- [ ] §4.4 threshold halt approval/cancel: Tasks 3, 4, 7.
- [ ] §4.5 review-tier queue: Tasks 2, 3, 4, 7.
- [ ] No primary-pipeline files modified (verify via `git diff main -- backend/src/handlers/syncHandler.ts backend/src/services/eventTransformationService.ts frontend/src/hooks/useEventData.ts` — should be empty).
- [ ] No placeholders, all paths and code complete.
