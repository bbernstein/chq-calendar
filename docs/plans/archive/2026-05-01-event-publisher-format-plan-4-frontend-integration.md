# Event Publisher Format — Plan 4: Frontend Integration (Sidecar Fetch, Merge, Attribution, Status UI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface publisher-feed events on the public calendar by fetching the `publisher-events-${year}.json` sidecar in addition to the primary `all-events-${year}.json`, merging the two lists at render time, and rendering attribution + cancellation/reschedule UI for publisher-sourced events. The integration is gated behind a build-time flag so it can be disabled at any time without rebuilding the publisher pipeline.

**Architecture:** Modify `useEventData` to fetch both files concurrently, merge in memory (primary first; publisher events appended with `sourcePublisherId` already present in the data). Add a small attribution badge and status treatment to `EventCard`. Feature gate via `import.meta.env.VITE_ENABLE_PUBLISHER_FEEDS`. When the flag is off, only the primary fetch runs, behavior is byte-equivalent to today.

**Tech Stack:** Preact, Vite, Vitest, Tailwind. No new runtime dependencies.

**Spec reference:** `docs/plans/2026-05-01-event-publisher-format-design.md` §1.1 (frontend isolation), §2.4 (status), §4.6 (mapping).

**Prerequisite:** Plan 2 deployed (sidecar file is being produced). Plan 4 can run in parallel with Plan 3 — it does not depend on the admin UI.

---

## File Structure

```
frontend/
├── .env.example                                # MODIFY — document VITE_ENABLE_PUBLISHER_FEEDS
└── src/
    ├── lib/
    │   └── types.ts                            # MODIFY — add sourcePublisher fields, status to Event
    ├── hooks/
    │   └── useEventData.ts                     # MODIFY — fetch sidecar, merge
    ├── components/
    │   └── calendar/
    │       └── EventCard.tsx                   # MODIFY — render attribution badge + status treatment
    └── __tests__/
        ├── hooks/useEventData.publisherFeed.test.ts # NEW
        └── components/calendar/EventCard.publisherSource.test.tsx # NEW
```

## Why this layout

- The hook (`useEventData`) is the single boundary where data enters the app, so it is the right place to add the second fetch and merge. No component above it needs to know there are two sources.
- The card is the only UI surface that needs to *display* attribution and status. All other components (filters, list, calendar) treat publisher events as just events.
- The feature flag wraps both the fetch and the UI tweaks in one place each, so disabling it is a one-line change.

---

## Task 1: Extend `Event` type with publisher-source and status fields

**Files:**
- Modify: `frontend/src/lib/types.ts`

- [ ] **Step 1: Add fields**

Open `frontend/src/lib/types.ts`. After the existing fields in the `Event` interface, add:

```ts
  /** Set on events that came from a registered publisher feed (not chq.org). */
  sourcePublisherId?: string;
  sourcePublisherName?: string;
  /** Optional status from the publisher; primary events leave this undefined. */
  status?: 'scheduled' | 'cancelled' | 'rescheduled';
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npm run type-check
```
Expected: clean. (Existing usages of `Event` will be unaffected because the new fields are optional.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/types.ts
git commit -m "Plan 4, Task 1: add sourcePublisher fields and status to Event type"
```

---

## Task 2: Document the feature flag

**Files:**
- Modify: `frontend/.env.example` (or create one if it doesn't exist)

- [ ] **Step 1: Add the flag**

Append to `frontend/.env.example`:
```
# Enable fetching and rendering of events from registered publisher feeds.
# When unset or "false", only chq.org primary events are loaded.
VITE_ENABLE_PUBLISHER_FEEDS=false
```

- [ ] **Step 2: Commit**

```bash
git add frontend/.env.example
git commit -m "Plan 4, Task 2: document VITE_ENABLE_PUBLISHER_FEEDS feature flag"
```

---

## Task 3: Modify `useEventData` to fetch and merge the sidecar

**Files:**
- Modify: `frontend/src/hooks/useEventData.ts`
- Test: `frontend/src/__tests__/hooks/useEventData.publisherFeed.test.ts`

The current code fetches `/cache/calendar-cache/all-events-${year}.json` (or `/data/...` in dev). Add a second fetch for `publisher-events-${year}.json` ONLY when the flag is enabled, and merge.

**Critical isolation rule:** if the publisher fetch fails (404, parse error, network), the primary fetch result MUST still be used. Publisher data is purely additive; its absence falls back to today's behavior.

- [ ] **Step 1: Write a failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/preact';
import { useEventData } from '../../hooks/useEventData';

const PRIMARY_BODY = { data: [{ id: 'p1', title: 'Primary', startDate: '2026-07-04T00:00:00Z', endDate: '2026-07-04T01:00:00Z' }] };
const PUBLISHER_BODY = { data: [{ id: 'pub1', title: 'Publisher', startDate: '2026-07-05T00:00:00Z', endDate: '2026-07-05T01:00:00Z', sourcePublisherId: 'pub-x', sourcePublisherName: 'Pub X' }] };

beforeEach(() => {
  vi.stubEnv('VITE_ENABLE_PUBLISHER_FEEDS', 'true');
  globalThis.localStorage?.clear?.();
});

describe('useEventData with publisher feeds enabled', () => {
  it('merges primary and publisher events', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async (url: any) => {
      calls++;
      if (String(url).includes('publisher-events')) return { ok: true, json: async () => PUBLISHER_BODY } as any;
      return { ok: true, json: async () => PRIMARY_BODY } as any;
    });
    const { result } = renderHook(() => useEventData(2026));
    await waitFor(() => expect(result.current.events?.length).toBe(2));
    expect(result.current.events!.map(e => e.id).sort()).toEqual(['p1', 'pub1']);
  });

  it('falls back to primary when publisher fetch fails', async () => {
    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url).includes('publisher-events')) return { ok: false, status: 404 } as any;
      return { ok: true, json: async () => PRIMARY_BODY } as any;
    });
    const { result } = renderHook(() => useEventData(2026));
    await waitFor(() => expect(result.current.events?.length).toBe(1));
    expect(result.current.events![0].id).toBe('p1');
  });

  it('skips the sidecar fetch when flag is off', async () => {
    vi.stubEnv('VITE_ENABLE_PUBLISHER_FEEDS', 'false');
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => PRIMARY_BODY } as any));
    globalThis.fetch = fetchMock;
    const { result } = renderHook(() => useEventData(2026));
    await waitFor(() => expect(result.current.events?.length).toBe(1));
    const sidecarCalls = fetchMock.mock.calls.filter(c => String(c[0]).includes('publisher-events'));
    expect(sidecarCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Modify `useEventData.ts`**

Find the existing fetch block (around line 67-95 in the current file, which fetches `/cache/calendar-cache/all-events-${year}.json` then sets state). Replace the single-fetch logic with a parallel fetch of primary + sidecar (sidecar gated by flag). Approximate diff:

Replace the block that does:
```ts
const response = await fetch(/* primary URL */, { ... });
if (response.ok) {
  const data = await response.json();
  const rawEvents = data.data || [];
  ...
}
```

with:

```ts
const primaryUrl = import.meta.env.DEV
  ? `/data/all-events-${year}.json`
  : `/cache/calendar-cache/all-events-${year}.json`;
const sidecarEnabled = String(import.meta.env.VITE_ENABLE_PUBLISHER_FEEDS) === 'true';
const sidecarUrl = sidecarEnabled
  ? (import.meta.env.DEV
      ? `/data/publisher-events-${year}.json`
      : `/cache/calendar-cache/publisher-events-${year}.json`)
  : null;

const [primaryResp, sidecarResp] = await Promise.all([
  fetch(primaryUrl, { method: 'GET', headers: { Accept: 'application/json' } }),
  sidecarUrl
    ? fetch(sidecarUrl, { method: 'GET', headers: { Accept: 'application/json' } }).catch(() => null)
    : Promise.resolve(null),
]);

if (primaryResp.ok) {
  const primaryJson = await primaryResp.json();
  const primaryEvents = (primaryJson.data || []).map(decodeEventHtmlEntities);

  let publisherEvents: Event[] = [];
  if (sidecarResp && sidecarResp.ok) {
    try {
      const sidecarJson = await sidecarResp.json();
      publisherEvents = (sidecarJson.data || []).map(decodeEventHtmlEntities);
    } catch {
      // Sidecar parse error: ignore; primary remains intact.
      publisherEvents = [];
    }
  }

  const fetchedEvents: Event[] = [...primaryEvents, ...publisherEvents];
  setEvents(fetchedEvents);
  setDataLoaded(true);

  // ... existing category/location/tag aggregation continues unchanged on `fetchedEvents` ...
```

(Preserve all other existing logic — localStorage caching, error handling, the trailing aggregation passes that build category/location/tags lists. The merge does not change downstream code paths.)

- [ ] **Step 3: Run the new tests**

```bash
cd frontend && npm test -- useEventData.publisherFeed
```
Expected: 3 passing.

- [ ] **Step 4: Run all existing tests**

```bash
cd frontend && npm test
```
Expected: every previously-passing test still passes. If anything regresses, the change must be reworked — primary fetch must remain identical when the flag is off.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useEventData.ts frontend/src/__tests__/hooks/useEventData.publisherFeed.test.ts
git commit -m "Plan 4, Task 3: fetch + merge publisher sidecar in useEventData"
```

---

## Task 4: EventCard — attribution badge and status treatment

**Files:**
- Modify: `frontend/src/components/calendar/EventCard.tsx`
- Test: `frontend/src/__tests__/components/calendar/EventCard.publisherSource.test.tsx`

Behaviors:
1. If `event.sourcePublisherName` is set, show a small badge with the publisher name (e.g., `via Everett Jewish Life Center`).
2. If `event.status === 'cancelled'`, render the title with strike-through and a "Cancelled" badge; suppress any "register" / "buy ticket" CTAs the card may otherwise show.
3. If `event.status === 'rescheduled'`, show a "Rescheduled" badge in the corner.
4. Primary events (no `sourcePublisherName`, no `status`) render exactly as today.

- [ ] **Step 1: Write component test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { EventCard } from '../../../components/calendar/EventCard';

const baseEvent: any = {
  id: 'e', title: 'Test',
  startDate: '2026-07-04T18:00:00Z', endDate: '2026-07-04T19:00:00Z',
};

describe('EventCard publisher attribution and status', () => {
  it('renders the publisher name when sourcePublisherName is present', () => {
    render(<EventCard event={{ ...baseEvent, sourcePublisherName: 'Source Pub' }} />);
    expect(screen.getByText(/Source Pub/)).toBeInTheDocument();
  });

  it('renders Cancelled badge and strike-through when status=cancelled', () => {
    render(<EventCard event={{ ...baseEvent, sourcePublisherName: 'Source Pub', status: 'cancelled' }} />);
    expect(screen.getByText(/Cancelled/i)).toBeInTheDocument();
    const title = screen.getByText('Test');
    expect(title.className).toMatch(/line-through/);
  });

  it('renders Rescheduled badge when status=rescheduled', () => {
    render(<EventCard event={{ ...baseEvent, sourcePublisherName: 'Source Pub', status: 'rescheduled' }} />);
    expect(screen.getByText(/Rescheduled/i)).toBeInTheDocument();
  });

  it('renders nothing extra for a primary event', () => {
    render(<EventCard event={baseEvent} />);
    expect(screen.queryByText(/via /)).toBeNull();
    expect(screen.queryByText(/Cancelled/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Modify `EventCard.tsx`**

Locate the title rendering block. Add status-aware className for the title:

```tsx
const titleClass = event.status === 'cancelled' ? 'line-through text-gray-500' : '';
// in the JSX:
<h3 class={`existing-classes-here ${titleClass}`}>{event.title}</h3>
```

Add a badge area near the top-right or next to the title:

```tsx
{event.status === 'cancelled' && (
  <span class="ml-2 inline-block px-2 py-0.5 rounded bg-red-100 text-red-800 text-xs font-semibold">Cancelled</span>
)}
{event.status === 'rescheduled' && (
  <span class="ml-2 inline-block px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 text-xs font-semibold">Rescheduled</span>
)}
```

Add an attribution line below the title or in the metadata footer:

```tsx
{event.sourcePublisherName && (
  <div class="text-xs text-gray-500 italic mt-1">via {event.sourcePublisherName}</div>
)}
```

(Adapt the exact placement to the existing card layout — match the typography of nearby small text.)

- [ ] **Step 3: Run tests**

```bash
cd frontend && npm test -- EventCard
```
Expected: all pass.

- [ ] **Step 4: Smoke test in dev**

```bash
cd frontend && VITE_ENABLE_PUBLISHER_FEEDS=true npm run dev
```
Place a sample sidecar file at `frontend/public/data/publisher-events-2026.json` with at least one event using `sourcePublisherName: 'Test Pub'` and one with `status: 'cancelled'`. Visit the calendar; confirm:
- Publisher events render with `via Test Pub`.
- Cancelled events show strike-through + badge.
- Existing primary events look unchanged.

Then remove the test sidecar file.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/calendar/EventCard.tsx frontend/src/__tests__/components/calendar/EventCard.publisherSource.test.tsx
git commit -m "Plan 4, Task 4: publisher attribution + status treatment on EventCard"
```

---

## Task 5: Production rollout — enable the flag

**Files:**
- Modify: deployment configuration (likely `.github/workflows/*.yml` and/or `infrastructure/`)

This task is gated on the verification gate from Plan 2 still passing.

- [ ] **Step 1: Re-run the verification gate**

```bash
./scripts/verify-primary-cache-unchanged.sh "$(grep -h frontend_bucket infrastructure/main.tf | head -1 | awk '{print $3}' | tr -d '\"')"
```
Expected: PASS. If FAIL, stop and fix before enabling the flag.

- [ ] **Step 2: Confirm the sidecar file actually exists and is reasonable**

```bash
aws s3 ls s3://<frontend-bucket>/cache/calendar-cache/ | grep publisher-events
aws s3 cp s3://<frontend-bucket>/cache/calendar-cache/publisher-events-2026.json - | head -c 1000
```
Expected: file exists, valid JSON with `data: [...]`. If empty (no auto-trust publishers yet), ship the flag anyway — the sidecar fetch will 404 gracefully and the calendar will look unchanged.

- [ ] **Step 3: Enable the flag in the production build**

Find the GitHub Actions deploy workflow (e.g., `.github/workflows/deploy.yml`). Add the env var to the build step:
```yaml
env:
  VITE_ENABLE_PUBLISHER_FEEDS: 'true'
```

- [ ] **Step 4: Push and watch the deploy**

```bash
git add .github/workflows/<deploy-workflow>.yml
git commit -m "Plan 4, Task 5: enable VITE_ENABLE_PUBLISHER_FEEDS in production"
git push
```

Watch the deploy. Once live:
1. Open `https://www.chqcal.org/` — the calendar must look unchanged when no publishers are configured.
2. Re-run the verification gate one more time. Must still PASS.
3. Once you onboard your first `auto`-trust publisher (via Plan 3's admin UI), their events should appear with the `via <name>` attribution after the next ingest cycle (~1 hour).

---

## Plan 4 self-review

- [ ] §1.1 frontend isolation: build-time flag (Tasks 2, 3, 5), primary fetch unchanged when flag is off (Task 3 step 4), sidecar failure does not break primary (Task 3 test 2).
- [ ] §2.4 status rendering: Task 4 covers cancelled and rescheduled.
- [ ] §4.6 attribution fields: Task 4 renders `sourcePublisherName`.
- [ ] No backend or pipeline files modified (verify with `git diff main -- backend/ infrastructure/` — should be empty for this plan).
- [ ] No placeholders.
