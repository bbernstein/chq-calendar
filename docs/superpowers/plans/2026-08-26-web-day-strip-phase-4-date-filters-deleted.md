# #274 Phase 4 — Date Filters Deleted Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the date filters and the render window from the web app, so
the list is the whole year and the day strip is the only date navigation.

**Architecture:** The view window and the render window both disappear. Every
day group the year produces is mounted at once; the list subtree is memoized so
scroll-derived state cannot re-render it, and each day section carries
`content-visibility: auto` so the browser skips what is off screen. Date
narrowing leaves `useFilterState` entirely; the filter panel keeps search,
venue, category and favourites. The off-season landing stops being an emergent
property of an empty result set and becomes a stated branch on
`determineLandingState`.

**Tech Stack:** Vite 7, Preact 10 (`preact/compat` aliased to `react`),
TypeScript 5, Tailwind 4, Vitest, Playwright (`frontend/e2e/`).

**Spec:** `docs/superpowers/specs/2026-08-25-web-day-strip-date-navigation-design.md`
— read the "Phase 4" section and its **Addendum, 2026-08-26 — the gating
measurement** before starting. The addendum is not background: tasks 1, 2 and 7
exist because of what it measured, and the decision it records ("delete the
render window outright") is the premise of tasks 4 and 5.

## Global Constraints

- **Never commit to `main`.** Branch first: `git checkout -b feat/274-phase-4-date-filters` off `main`.
- **This branch does not start from the spike.** `spike/274-phase-4-render-window` (`f606a73`) holds throwaway URL flags (`?spikeFullMount=1`, `?spikeMemoList=1`, `?spikeCV=1`) and render counters in `EventCard`/`EventListView`. **None of that is merged.** Read it for reference; implement afresh.
- Verification before every commit: `cd frontend && npm run build` (runs `validate` + the unit suite), then `npm run validate --workspace=backend` only if backend files changed (they will not on this branch).
- Coverage floor is `.coverage-floor.json` at **74.3** lines; this branch deletes a lot of well-covered code, so re-check after task 5 and do not let it fall below the floor.
- Imports use the `@/` alias. Hooks and React-shaped types are imported from `'react'` — that is house style here, not an accident (`@preact/preset-vite` aliases it to `preact/compat`, which installs the `onChange` → `onInput` normalization form components need).
- `eslint-plugin-react-hooks` is **not installed**. A literal `// eslint-disable-next-line react-hooks/...` is a hard ESLint error. Explain an intentional dependency array in a prose `NOTE:` comment instead.
- Every new guard is proven by breaking the code first. When falsifying a **browser** check, build with `npx vite build` (not `npm run build`, which gates the bundle on the unit suite and will silently serve the previous bundle) and grep the output to confirm the injection landed. **Grep for a prop key or string literal, never a local identifier** — esbuild's minifier drops identifier names but keeps property names and string literals.
- When a falsification unexpectedly *passes*, suspect the harness and re-run it against the old code before believing it.
- No iOS files are touched, so `.github/workflows/app-store-assets.yml` does not apply.

---

## File Structure

**Deleted outright:**
- `frontend/src/components/filters/DateFilter.tsx` and its test
- `frontend/src/components/filters/WeekSelector.tsx` and its test
- `frontend/src/components/calendar/EventList.tsx` and its test (task 5 — the file survives task 4 as a two-line shell)
- `frontend/src/lib/utils/renderWindow.ts` and its test
- `frontend/src/__tests__/hooks/useFilterState.window.test.ts`
- `frontend/src/__tests__/hooks/useWeekDragSelection.test.ts`

**Created:**
- `frontend/src/lib/utils/landingDay.ts` — where the reader lands on load (task 6)
- `frontend/src/hooks/useInitialLanding.ts` — fires that landing once per year (task 6)
- `frontend/src/__tests__/lib/utils/landingDay.test.ts`
- `frontend/src/__tests__/hooks/useInitialLanding.test.tsx`
- `frontend/src/__tests__/components/calendar/EventListView.memo.test.tsx`
- `frontend/src/__tests__/components/calendar/EventListView.contentVisibility.test.tsx`
- `frontend/e2e/verify-full-list.mjs` — the phase 4 browser suite (task 7)

**Heavily modified:**
- `frontend/src/app/page.tsx` — the centre of every task
- `frontend/src/hooks/useFilterState.ts` — loses scope, weeks, window
- `frontend/src/lib/utils/filterHelpers.ts` — loses the date and week stages
- `frontend/src/lib/utils/dayWindow.ts` — loses `viewWindow`/`baseWindow`/`clampToBounds`/`WindowOptions`/`navigationTargets`/`windowContains`/`ViewWindow`
- `frontend/src/components/calendar/EventListView.tsx` — memoized, content-visibility
- `frontend/src/components/filters/buildActiveChips.ts` — loses `date` and `week`
- `frontend/src/components/filters/ActiveFilters.tsx` — one Clear, not two
- `frontend/src/components/calendar/DayRail.tsx` — loses `scopeHasWindow`
- `frontend/src/app/dayRailNavigation.ts` — `railTarget` loses expansion planning; `shouldAbandonScroll` is deleted
- `frontend/src/hooks/useScrollState.ts` — `useWeekDragSelection` deleted

---

### Task 1: The list stops re-rendering on every scroll

The addendum's central finding: `useDayAnchor` holds `anchorDay` in
`page.tsx`, so every rAF-throttled anchor update re-renders the page and every
mounted `EventCard` with it, each re-running its `Intl` date formatting. A
forty-gesture scroll cost **26,992 card renders** at full mount and 3,378 as
the app ships today. This task is worth landing on its own merits — it
improves today's windowed code — and tasks 4 and 5 are not viable without it.

**Files:**
- Modify: `frontend/src/components/calendar/EventListView.tsx`
- Test: `frontend/src/__tests__/components/calendar/EventListView.memo.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `EventListView` is a memoized component with an unchanged props contract (`EventListViewProps`). Callers need no change. Later tasks rely on the memo holding — task 5 makes `page.tsx` render it directly.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/components/calendar/EventListView.memo.test.tsx`:

```tsx
import { render } from '@testing-library/preact';
import { useState } from 'react';
import { EventListView } from '@/components/calendar/EventListView';
import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { Event } from '@/lib/types';

function event(id: string): Event {
  return {
    id, title: `Event ${id}`, startDate: '2026-07-04T10:00:00',
    location: 'Amphitheater', tags: [], categories: [],
  } as unknown as Event;
}

const GROUPS: DayGroup[] = [
  { key: '2026-07-04', baseLabel: 'Saturday, July 4, 2026', weekNumbers: [1], events: [event('a')] },
];

// Stable identities, exactly as `page.tsx` hands them down. Declared at module
// scope so nothing about the harness can make a prop change by accident — the
// test would then pass for the wrong reason.
const EXPANDED = new Set<string>();
const FAVOURITES = new Set<string>();
const NOOP = () => {};
const NEVER = () => false;

let themeLookups = 0;

/**
 * A render counter that needs no instrumentation inside the component.
 *
 * `WeekBadge` — a child of every day section — indexes `themes[weekNumber]`
 * during its render, and it is not memoized itself, so it renders exactly when
 * the list subtree renders. The Proxy counts those reads. Nothing in the
 * component tree knows it is being measured.
 */
const COUNTING_THEMES = new Proxy({} as Record<number, never>, {
  get(target, prop) { themeLookups += 1; return Reflect.get(target, prop); },
});

function Harness() {
  const [anchor, setAnchor] = useState(0);
  return (
    <div>
      <button type="button" onClick={() => setAnchor(a => a + 1)}>anchor {anchor}</button>
      <EventListView
        groups={GROUPS}
        expandedDescriptions={EXPANDED}
        onToggleDescription={NOOP}
        onToggleTag={NOOP}
        isTagSelected={NEVER}
        favoriteIds={FAVOURITES}
        onToggleFavorite={NOOP}
        weeklyThemes={COUNTING_THEMES}
      />
    </div>
  );
}

test('a scroll-derived state change in the parent does not re-render the list', () => {
  themeLookups = 0;
  const { container } = render(<Harness />);

  // The counter has to be observing something, or the assertion below is
  // vacuous — this is the guard against a test that can only pass.
  const afterMount = themeLookups;
  expect(afterMount).toBeGreaterThan(0);

  // Two parent state changes with every list prop unchanged. This is what a
  // scroll does: `useDayAnchor` moves `anchorDay` in `page.tsx` on a
  // rAF-throttled scroll listener, many times per gesture.
  const button = container.querySelector('button')!;
  button.click();
  button.click();

  expect(themeLookups).toBe(afterMount);
});

test('a real change to the list still re-renders it', () => {
  // The other half of the claim: a memo that never re-renders is a bug, not a
  // fix. Falsifying the test above by removing `memo` must not be the only way
  // to break this file.
  themeLookups = 0;
  const { rerender } = render(
    <EventListView
      groups={GROUPS}
      expandedDescriptions={EXPANDED}
      onToggleDescription={NOOP}
      onToggleTag={NOOP}
      isTagSelected={NEVER}
      favoriteIds={FAVOURITES}
      onToggleFavorite={NOOP}
      weeklyThemes={COUNTING_THEMES}
    />
  );
  const afterMount = themeLookups;

  const grown: DayGroup[] = [
    ...GROUPS,
    { key: '2026-07-05', baseLabel: 'Sunday, July 5, 2026', weekNumbers: [1], events: [event('b')] },
  ];
  rerender(
    <EventListView
      groups={grown}
      expandedDescriptions={EXPANDED}
      onToggleDescription={NOOP}
      onToggleTag={NOOP}
      isTagSelected={NEVER}
      favoriteIds={FAVOURITES}
      onToggleFavorite={NOOP}
      weeklyThemes={COUNTING_THEMES}
    />
  );

  expect(themeLookups).toBeGreaterThan(afterMount);
  expect(document.querySelectorAll('[data-day-key]')).toHaveLength(2);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend
npx vitest run src/__tests__/components/calendar/EventListView.memo.test.tsx
```

Expected: FAIL — the counter grows on the parent's re-renders, because
`EventListView` is not memoized yet. **If it passes, the counter is not
observing a render; fix the test before touching the component.**

- [ ] **Step 3: Memoize the component**

In `frontend/src/components/calendar/EventListView.tsx`, import `memo` from
`preact/compat` and wrap the existing function:

```tsx
import { memo } from 'preact/compat';

function EventListViewInner({
  groups, expandedDescriptions, onToggleDescription, onToggleTag, isTagSelected,
  favoriteIds, onToggleFavorite, weeklyThemes, articleLinks, programLinks,
}: EventListViewProps) {
  // ...unchanged body...
}

/**
 * Memoized, and that is a performance *contract*, not an optimization.
 *
 * `useDayAnchor` holds the anchored day in `page.tsx`, so every rAF-throttled
 * scroll measurement that moves the anchor re-renders the page — and without
 * this, the whole mounted list with it, each card re-running its `Intl` date
 * formatting. Measured on the phase 4 spike at 4x CPU throttle: a forty-gesture
 * scroll over the full season cost 26,992 card renders unmemoized and 0
 * memoized, taking the 95th-percentile frame from 192ms to 32ms.
 *
 * The props `page.tsx` hands down are already stable across an anchor-only
 * change. **Anything that makes one of them unstable — an inline arrow, a Set
 * rebuilt per render — silently removes the memo without failing a single
 * behavioural test.** `EventListView.memo.test.tsx` is the guard.
 */
export const EventListView = memo(EventListViewInner);
```

- [ ] **Step 4: Run the test and the suites it could disturb**

```bash
cd frontend
npx vitest run src/__tests__/components/calendar/EventListView.memo.test.tsx
npx vitest run src/__tests__/components/calendar src/__tests__/integration
```

Expected: PASS, and no regressions. A memo changes when children re-render, so
any test that mutates a prop in place (rather than replacing it) will now fail
— that is the memo correctly reporting a pre-existing bug in the caller or the
test. Fix the caller, not the memo.

- [ ] **Step 5: Full verification and commit**

```bash
cd frontend && npm run build
git add src/components/calendar/EventListView.tsx src/__tests__/components/calendar/EventListView.memo.test.tsx
git commit -m "perf(web): the day list stops re-rendering on every scroll (#274 phase 4)"
```

---

### Task 2: Day sections skip their own layout when off screen

The second half of what the measurement found necessary. With the whole year
mounted, `content-visibility: auto` took the 95th-percentile frame from 32ms to
17ms and frames over 50ms from 5-in-192 to **0-in-253** at 4x throttle — better
than the app ships today.

**Files:**
- Modify: `frontend/src/components/calendar/EventListView.tsx`
- Create: `frontend/src/lib/utils/daySectionSize.ts`
- Test: `frontend/src/__tests__/lib/utils/daySectionSize.test.ts` (create), `frontend/src/__tests__/components/calendar/EventListView.contentVisibility.test.tsx` (create)

**Interfaces:**
- Consumes: task 1's memoized `EventListView`.
- Produces: `estimatedDaySectionHeight(eventCount: number): number` from `@/lib/utils/daySectionSize`, and each day section rendering `style={{ contentVisibility: 'auto', containIntrinsicSize: \`auto ${estimatedDaySectionHeight(n)}px\` }}` alongside its existing `scrollMarginTop`.

- [ ] **Step 1: Write the failing test for the estimate**

Create `frontend/src/__tests__/lib/utils/daySectionSize.test.ts`:

```ts
import { estimatedDaySectionHeight, DAY_HEADER_ESTIMATE_PX, EVENT_CARD_ESTIMATE_PX } from '@/lib/utils/daySectionSize';

test('a day with no events is just its header', () => {
  expect(estimatedDaySectionHeight(0)).toBe(DAY_HEADER_ESTIMATE_PX);
});

test('each event adds one card', () => {
  expect(estimatedDaySectionHeight(3)).toBe(DAY_HEADER_ESTIMATE_PX + 3 * EVENT_CARD_ESTIMATE_PX);
});

test('a negative or non-finite count cannot produce a negative size', () => {
  // `contain-intrinsic-size` with a negative length is invalid and the
  // declaration is dropped whole — which silently takes `content-visibility`
  // with it, so the failure would be a performance regression with no error.
  expect(estimatedDaySectionHeight(-1)).toBe(DAY_HEADER_ESTIMATE_PX);
  expect(estimatedDaySectionHeight(Number.NaN)).toBe(DAY_HEADER_ESTIMATE_PX);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend && npx vitest run src/__tests__/lib/utils/daySectionSize.test.ts
```

Expected: FAIL — "Failed to resolve import '@/lib/utils/daySectionSize'".

- [ ] **Step 3: Write the estimate**

Create `frontend/src/lib/utils/daySectionSize.ts`:

```ts
/**
 * How tall a day section probably is, before the browser has laid it out.
 *
 * **These are estimates and nothing enforces them.** They feed
 * `contain-intrinsic-size`, which is what the browser uses for the scrollbar
 * and for the geometry of sections it has skipped under
 * `content-visibility: auto`. Being wrong costs accuracy in the scrollbar and
 * a little document-height churn as real sizes replace estimates — it does
 * NOT cost navigation accuracy, because `useDayAnchor.scrollToDay` scrolls by
 * a *relative* delta read from the target's own rect, which forces that
 * element's real layout. (Measured on the phase 4 spike: jumps to the day at
 * 25%, 50% and 75% of the year each landed at the sticky offset to the pixel,
 * with 0px of drift, while the document shrank ~600px as estimates were
 * replaced. Never compute an absolute scroll offset by summing these.)
 *
 * Measured at 390pt in August 2026 against the live feed. `verify-full-list.mjs`
 * check "intrinsic size is in the right order of magnitude" is what notices if
 * the card design drifts far from them.
 */
export const DAY_HEADER_ESTIMATE_PX = 44;
export const EVENT_CARD_ESTIMATE_PX = 92;

export function estimatedDaySectionHeight(eventCount: number): number {
  const n = Number.isFinite(eventCount) && eventCount > 0 ? Math.floor(eventCount) : 0;
  return DAY_HEADER_ESTIMATE_PX + n * EVENT_CARD_ESTIMATE_PX;
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd frontend && npx vitest run src/__tests__/lib/utils/daySectionSize.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for the section style**

Create `frontend/src/__tests__/components/calendar/EventListView.contentVisibility.test.tsx`. Render `EventListView` with two day groups of different event counts (reuse the fixture shape from task 1) and assert:

```tsx
test('each day section skips its own layout off screen, sized by its event count', () => {
  const { container } = render(<EventListView {...props} />);
  const one = container.querySelector('[data-day-key="2026-07-04"]') as HTMLElement;
  const two = container.querySelector('[data-day-key="2026-07-05"]') as HTMLElement;

  expect(one.style.contentVisibility).toBe('auto');
  expect(two.style.contentVisibility).toBe('auto');

  // `auto` in the keyword position, so the browser remembers the real size
  // once it has rendered the section — without it, every section re-collapses
  // to the estimate the moment it leaves the viewport.
  expect(one.style.containIntrinsicSize).toBe(`auto ${44 + 1 * 92}px`);
  expect(two.style.containIntrinsicSize).toBe(`auto ${44 + 3 * 92}px`);

  // The property that was already there must survive.
  expect(one.style.scrollMarginTop).not.toBe('');
});
```

- [ ] **Step 6: Run it and watch it fail**

```bash
cd frontend && npx vitest run src/__tests__/components/calendar/EventListView.contentVisibility.test.tsx
```

Expected: FAIL — `contentVisibility` is `''`.

- [ ] **Step 7: Add the style**

In `EventListViewInner`, replace the day section's `style` prop:

```tsx
style={{
  scrollMarginTop: dayHeaderTop(),
  // The browser skips layout and paint for sections that are off screen,
  // which is what makes mounting the whole year affordable — measured on
  // the phase 4 spike as 0 frames over 50ms across a forty-gesture scroll,
  // against 5 without it and 6 for the render-window build it replaces.
  //
  // Off-screen sections are consequently absent from the accessibility tree
  // until they render. That is not a regression against the render window
  // this replaces — those days were not in the DOM at all — but it is the
  // one thing full mount could have bought and this gives back. Recorded as
  // a decision in the spec's addendum, not an oversight.
  contentVisibility: 'auto',
  containIntrinsicSize: `auto ${estimatedDaySectionHeight(dayGroup.events.length)}px`,
}}
```

- [ ] **Step 8: Run it, then the calendar suites**

```bash
cd frontend
npx vitest run src/__tests__/components/calendar/EventListView.contentVisibility.test.tsx
npx vitest run src/__tests__/components/calendar
```

Expected: PASS.

- [ ] **Step 9: Verify and commit**

```bash
cd frontend && npm run build
git add src/lib/utils/daySectionSize.ts src/components/calendar/EventListView.tsx src/__tests__/lib/utils/daySectionSize.test.ts src/__tests__/components/calendar/EventListView.contentVisibility.test.tsx
git commit -m "perf(web): day sections skip their own layout off screen (#274 phase 4)"
```

---

### Task 3: The off-season landing stops depending on an empty list

**This task exists to stop tasks 4 and 5 silently regressing #269.** Today
`OffSeasonLanding` and `CountdownBanner` appear because `dateFilter: 'next'`
yields zero events and `page.tsx`'s empty-list branch fires. Once the year is
always listed, the list is never empty out of season and the landing would
vanish for good — with no test failing, because every test that covers it seeds
an empty result set. Landing this **before** the deletion means the deletion has
a guard to break.

**Files:**
- Modify: `frontend/src/app/page.tsx:600-615` (the `loading ? ... : filteredEvents.length === 0 ? ...` branch)
- Test: `frontend/src/__tests__/integration/offSeasonLanding.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the render branch reads `showLanding = landingState.kind !== 'in-season' && !filters.hasNonDefaultFilters`, evaluated **before** and independently of `filteredEvents.length`. Task 5 renames `hasNonDefaultFilters` to `hasFilters`; nothing else changes here.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/__tests__/integration/offSeasonLanding.test.tsx`:

```tsx
test('the landing shows out of season even when the year has events to list', async () => {
  // The phase 4 world, reachable today by seeding the widest scope: a
  // post-season visit with a full feed. The list is NOT empty, and the
  // landing must still be what the reader sees.
  seedUserState({ dateFilter: 'all' });
  pinNow('2026-09-20T14:00:00Z');
  renderHome();

  expect(await screen.findByTestId('off-season-landing')).toBeInTheDocument();
  expect(document.querySelectorAll('[data-day-key]')).toHaveLength(0);
});
```

Use the file's existing helpers for seeding storage, pinning the clock and
rendering — read the top of `offSeasonLanding.test.tsx` and match them exactly
rather than inventing `seedUserState`/`pinNow`/`renderHome` if they are named
differently there.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend && npx vitest run src/__tests__/integration/offSeasonLanding.test.tsx
```

Expected: FAIL — day sections render and no landing appears, because the branch
is still gated on an empty list.

- [ ] **Step 3: Make the branch a stated rule**

In `page.tsx`, replace the nested ternary with:

```tsx
{/*
  Out of season with no filters, the reader gets the landing INSTEAD of the
  list — a stated branch, not a side effect of an empty result set.

  It used to be the latter: `dateFilter: 'next'` yielded nothing out of
  season, so the empty-list branch fired and the landing appeared. Phase 4
  lists the whole year, so the list is never empty out of season and that
  mechanism would have removed the landing (#269) with no test failing.

  `EmptyState` keeps its own, different job: a filter that matches nothing.
*/}
{loading ? (
  <LoadingSpinner />
) : showLanding ? (
  <OffSeasonLanding
    state={landingState}
    onPreviewNextSeason={previewNextSeason}
    onBrowseArchiveSeason={browseArchiveSeason}
  />
) : filteredEvents.length === 0 ? (
  <EmptyState />
) : (
  <EventList ... />
)}
```

and derive it above the return:

```tsx
// `hasNonDefaultFilters`, not `hasFilters`: the app still starts on the
// `next` scope until task 5 deletes it, and `hasFilters` is therefore true
// before the reader touches anything. Task 5 collapses the two.
const showLanding = landingState.kind !== 'in-season' && !filters.hasNonDefaultFilters;
```

- [ ] **Step 4: Run the landing and filter-header suites**

```bash
cd frontend
npx vitest run src/__tests__/integration/offSeasonLanding.test.tsx src/__tests__/integration/filterHeader.test.tsx
```

Expected: PASS. **One behaviour genuinely changes and must be checked against
the spec, not assumed:** a reader on "All Year" with a filter that matches
nothing used to get the landing out of season; now they get `EmptyState`, which
is what the spec asks for ("`EmptyState` keeps its own job: a filter that
matches nothing"). If an existing test asserts the old behaviour, that test
encodes the bug — change it, and say so in the commit message.

- [ ] **Step 5: Falsify the new guard**

Temporarily restore the old condition (`filteredEvents.length === 0 &&` in
front of `showLanding`), re-run, confirm the new test fails, then revert.

- [ ] **Step 6: Verify and commit**

```bash
cd frontend && npm run build
git add src/app/page.tsx src/__tests__/integration/offSeasonLanding.test.tsx
git commit -m "fix(web): the off-season landing is a stated branch, not an empty list (#274 phase 4)"
```

---

### Task 4: The render window is deleted

Everything that decided *which of the view window's days are mounted* goes.
The view window (the date scope) survives this task and dies in task 5 — the
split keeps each task compiling, testable and reviewable on its own.

**Files:**
- Modify: `frontend/src/components/calendar/EventList.tsx` (reduced to the "Show earlier" button plus `EventListView`)
- Delete: `frontend/src/lib/utils/renderWindow.ts`, `frontend/src/__tests__/lib/utils/renderWindow.test.ts`
- Modify: `frontend/src/app/page.tsx` (drop `resetKey`, `revealDay`, `listResetKey`, the `renderResetKey` import)
- Modify: `frontend/src/__tests__/components/calendar/EventList.test.tsx` (delete every render-window case; keep any that cover "Show earlier")

**Interfaces:**
- Consumes: tasks 1 and 2 (the list must be memoized and skipping layout before it mounts a whole scope at once).
- Produces: `EventListProps` reduced to `EventListViewProps` plus `earlierDay?: string | null` and `onShowEarlier?: () => void`. `pendingScroll` in `page.tsx` keeps its meaning — it now waits only on the *view* window's next commit.

- [ ] **Step 1: Write the failing test**

In `frontend/src/__tests__/components/calendar/EventList.test.tsx`, replace the
render-window cases with one that states the new contract:

```tsx
test('every day group the caller hands down is mounted, however many there are', () => {
  const groups = Array.from({ length: 40 }, (_, i) => dayGroup(`2026-07-${String(i + 1).padStart(2, '0')}`, 8));
  const { container } = render(<EventList groupedEvents={groups} {...viewProps} />);
  expect(container.querySelectorAll('[data-day-key]')).toHaveLength(40);
  expect(container.querySelectorAll('[data-event-id]')).toHaveLength(320);
});

test('there is no growth sentinel to observe', () => {
  const groups = Array.from({ length: 40 }, (_, i) => dayGroup(`2026-07-${String(i + 1).padStart(2, '0')}`, 8));
  const { container } = render(<EventList groupedEvents={groups} {...viewProps} />);
  expect(container.querySelector('[data-testid="event-list-sentinel"]')).toBeNull();
});
```

`dayGroup(key, n)` is a local helper returning `{ key, baseLabel: key, weekNumbers: [1], events: [...n events] }`; write it at the top of the file if the existing fixtures do not already provide one.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend && npx vitest run src/__tests__/components/calendar/EventList.test.tsx
```

Expected: FAIL — only the initial fill (the first ~50 events' worth of days) is mounted, and the sentinel is present.

- [ ] **Step 3: Collapse `EventList`**

Rewrite `frontend/src/components/calendar/EventList.tsx` as:

```tsx
import { useCallback } from 'react';
import type { DayGroup } from '@/lib/utils/eventHelpers';
import { formatDayLabel } from '@/lib/utils/dayWindow';
import { EventListView, type EventListViewProps } from './EventListView';

export interface EventListProps extends Omit<EventListViewProps, 'groups'> {
  groupedEvents: DayGroup[];
  /** The previous event day, or null at the navigable start. */
  earlierDay?: string | null;
  onShowEarlier?: () => void;
}

/**
 * The event list: every day the view window produced, mounted.
 *
 * There is no longer a second window here. The render window — a day-granular
 * subset of the view window's groups, grown forward by a bottom sentinel —
 * existed because mounting a whole scope at once was assumed to be
 * unaffordable. It was measured instead (#274 phase 4, the spec's addendum):
 * the cost was never the DOM's size but a whole-page re-render per scroll
 * anchor update, which `EventListView`'s memo removes, and
 * `content-visibility: auto` covers the rest. Everything the window needed —
 * the sentinel and its `IntersectionObserver`, `renderEndIndex`,
 * `extendRenderEndIndex`, `renderResetKey`, the anchor latch, the
 * upward-prepend correction, the settle window and its `ResizeObserver`
 * reassert, and `revealDay` — went with it.
 */
export function EventList({ groupedEvents, earlierDay, onShowEarlier, ...view }: EventListProps) {
  const handleShowEarlier = useCallback(() => { onShowEarlier?.(); }, [onShowEarlier]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {earlierDay && onShowEarlier && (
        <div className="text-center py-2">
          <button
            type="button"
            onClick={handleShowEarlier}
            className="px-4 py-2 text-sm bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400 rounded-md hover:bg-blue-100 dark:hover:bg-gray-600 transition-colors"
          >
            Show earlier ({formatDayLabel(earlierDay)})
          </button>
        </div>
      )}
      <EventListView groups={groupedEvents} {...view} />
    </div>
  );
}
```

Note what is deliberately gone besides the window: the prepend correction that
`handleShowEarlier` used to arm. Growing the view window backward still inserts
content above the reader — but every one of those days now mounts in the same
commit, so there is no second, later growth step for the correction to survive.
The `useDayAnchor` settle hold (which is a different mechanism, in a different
file) still covers the height change.

- [ ] **Step 4: Delete the render window module and its callers**

```bash
cd frontend
git rm src/lib/utils/renderWindow.ts src/__tests__/lib/utils/renderWindow.test.ts
```

In `page.tsx`: delete the `renderResetKey` import, the `listResetKey` memo, and
the `resetKey={listResetKey}` and `revealDay={pendingScroll}` props. Keep
`pendingScroll` itself and its effect — the effect's `daySectionElement` check
now waits only on a *view*-window expansion, which is still real. Update that
effect's comment, which currently explains the two-window distinction at
length; it should now say the wait is for the reducer's next commit and nothing
more.

- [ ] **Step 5: Run the calendar, hook and integration suites**

```bash
cd frontend
npx vitest run src/__tests__/components/calendar src/__tests__/hooks src/__tests__/integration
```

Expected: PASS. `dayRailIntegration.test.tsx` and `filterHeader.test.tsx` both
assert on which day sections are mounted — several will now legitimately see
*more* days than before. Each such change must be checked one at a time: "more
days mounted" is correct, "different days mounted" is a bug.

- [ ] **Step 6: Verify and commit**

```bash
cd frontend && npm run build
git add -A
git commit -m "refactor(web): delete the render window (#274 phase 4)"
```

---

### Task 5: The date filters are deleted

The large one. Scope, weeks and the window leave `useFilterState`; the date and
week stages leave `filterEvents`; `DateFilter` and `WeekSelector` are deleted;
the two full filter passes become one.

**Files:**
- Modify: `frontend/src/hooks/useFilterState.ts`
- Modify: `frontend/src/lib/utils/filterHelpers.ts`
- Modify: `frontend/src/lib/utils/dayWindow.ts`
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/src/app/dayRailNavigation.ts`
- Modify: `frontend/src/components/calendar/DayRail.tsx` (drop `scopeHasWindow`)
- Modify: `frontend/src/components/filters/buildActiveChips.ts`, `ActiveFilters.tsx`
- Modify: `frontend/src/hooks/useScrollState.ts` (delete `useWeekDragSelection`)
- Delete: `frontend/src/components/filters/DateFilter.tsx`, `WeekSelector.tsx`, `frontend/src/components/calendar/EventList.tsx`, and the tests `DateFilter.test.tsx`, `WeekSelector.test.tsx`, `useWeekDragSelection.test.ts`, `useFilterState.window.test.ts`, `EventList.test.tsx`

**Interfaces:**
- Consumes: task 4's collapsed list.
- Produces:
  - `useFilterState()` returns, minus `dateFilter`, `setDateFilter`, `selectedWeeks`, `setSelectedWeeks`, `windowStartDay`, `windowEndDay`, `expandWindowStart`, `expandWindowEnd`, `resetWindow`, `hasDateFilters`, `hasNonDateFilters`, `clearNonDateFilters`, `hasNonDefaultFilters`. `hasFilters: boolean` becomes the single "the reader has narrowed the list" flag.
  - `FilterOptions` is `{ searchTerm, selectedTagsLowerSet, selectedLocationsLowerSet, showFavoritesOnly?, favoriteIds? }`.
  - `railTarget(target: DayKey, bounds: NavigableBounds): DayKey | null` — bounds check only.
  - `page.tsx` derives `filteredEvents` once; `navEventDays`/`navDayCounts` come from it.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/__tests__/hooks/useFilterState.test.ts`:

```ts
test('a payload written by the current version loads, and restores nothing date-shaped', () => {
  localStorage.setItem('chq-calendar-user-state', JSON.stringify({
    searchTerm: 'organ', selectedTags: ['Music'], selectedLocations: [],
    dateFilter: 'this-week', selectedWeeks: [3, 4],
    expandedDescriptions: [], recentLocations: [], recentCategories: [],
    showFavoritesOnly: false, lastSaved: Date.now(),
  }));

  const { result } = renderHook(() => useFilterState());

  expect(result.current.searchTerm).toBe('organ');
  expect(result.current.selectedTags).toEqual(['Music']);
  expect(result.current).not.toHaveProperty('dateFilter');
  expect(result.current).not.toHaveProperty('selectedWeeks');
  expect(result.current.hasFilters).toBe(true);
});

test('an untouched visit has no filters', () => {
  const { result } = renderHook(() => useFilterState());
  expect(result.current.hasFilters).toBe(false);
});
```

In `frontend/src/__tests__/lib/utils/filterHelpers.test.ts`:

```ts
test('every event in the year is admitted when nothing is filtered', () => {
  const events = [january, july, september];
  expect(filterEvents(events, { searchTerm: '', selectedTagsLowerSet: new Set(), selectedLocationsLowerSet: new Set() }))
    .toHaveLength(3);
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd frontend && npx vitest run src/__tests__/hooks/useFilterState.test.ts src/__tests__/lib/utils/filterHelpers.test.ts
```

Expected: FAIL — `dateFilter` is still on the returned object; `filterEvents` still demands `viewWindow` and `seasonWeeks`.

- [ ] **Step 3: Shrink `useFilterState`**

Delete from `FilterState`: `dateFilter`, `selectedWeeks`, `windowStartDay`, `windowEndDay`. Delete the actions `SET_DATE_FILTER`, `SET_SELECTED_WEEKS`, `EXPAND_WINDOW_START`, `EXPAND_WINDOW_END`, `RESET_WINDOW`, `CLEAR_NON_DATE_FILTERS` and their reducer cases and `useCallback` wrappers. `CLEAR_FILTERS` becomes:

```ts
case 'CLEAR_FILTERS':
  return { ...state, searchTerm: '', selectedTags: [], selectedLocations: [], showFavoritesOnly: false };
```

`RECONCILE_FILTERS` keeps reconciling categories and locations and stops
touching scope and weeks:

```ts
case 'RECONCILE_FILTERS': {
  const { availableCategories, availableLocations } = action.payload;
  const availCatsLower = new Set(availableCategories.map(c => c.toLowerCase()));
  const availLocsLower = new Set(availableLocations.map(l => l.toLowerCase()));
  return {
    ...state,
    selectedTags: state.selectedTags.filter(t => availCatsLower.has(t.toLowerCase())),
    selectedLocations: state.selectedLocations.filter(l => availLocsLower.has(l.toLowerCase())),
  };
}
```

Drop `isCurrentYear` from its payload and from `reconcileFilters`'s signature — it only ever chose a scope.

The three derived flags collapse to one:

```ts
// One flag now, where there were three. With no scope, "the reader has
// narrowed the list" and "a filter is in effect" are the same statement —
// `hasDateFilters`, `hasNonDateFilters` and `hasNonDefaultFilters` existed
// only because the app started on the `next` scope, so a date filter was
// always in effect and an indicator driven by it was lit before the reader
// touched anything. Trimmed rather than raw: a whitespace-only search emits
// no chip, so it must not count as a filter either.
const hasFilters: boolean = !!(
  state.searchTerm.trim() || state.selectedTags.length > 0 ||
  state.selectedLocations.length > 0 || state.showFavoritesOnly
);
```

`loadInitialState` simply stops reading `dateFilter` and `selectedWeeks`:

```ts
// An old payload's `dateFilter`/`selectedWeeks` are ignored, not migrated —
// there is no field left for them to mean anything in. The reverse direction
// is safe too and is why nothing needs a version bump: an old build reading a
// new payload finds `parsed.dateFilter === undefined` and falls back to
// `'next'` through its own `|| 'next'`, so a reader who downgrades gets the
// old default rather than a crash.
```

Remove `dateFilter` and `selectedWeeks` from the `localStorage.setItem` payload too.

- [ ] **Step 4: Shrink `filterEvents`**

In `frontend/src/lib/utils/filterHelpers.ts`: delete the `viewWindow`,
`selectedWeeks` and `seasonWeeks` fields from `FilterOptions`, the
`options.viewWindow === null` early return, the whole merged date/week pass
(and with it the `parseEventDate`, `calendarDaySpanOfWeek` and `windowContains`
imports), leaving search, location, tag and favourites. Add:

```ts
/**
 * There is no date stage. The list is the whole year, and which part of it the
 * reader is looking at is a scroll position, not a filter (#274 phase 4). The
 * merged date/week pass this replaced was the only thing in the pipeline that
 * needed `parseEventDate`, which is why that import is gone rather than
 * merely unused.
 */
```

- [ ] **Step 5: Prune `dayWindow.ts`**

Delete `ViewWindow`, `windowContains`, `WindowOptions`, `baseWindow`,
`viewWindow`, `clampToBounds`, `navigationTargets` and `lastDayCovered` if it
becomes unreferenced (check). Keep `DayKey`, `dayKeyOf`, `startOfDay`,
`dayAfter`, `addDays`, `dayKeys`, `NavigableBounds`, `navigableBounds`,
`eventDayKeys`, `formatDayLabel`, `spokenDayTitle`, `formatDayRange`,
`DayChip`, `eventCountsByDay`, `dayChips`. Delete `getAdaptiveEndDate` from
`dateHelpers.ts` and its tests.

`formatDayRange` loses its only caller when the "When: Jul 4 – Jul 12" chip
goes. **Delete it and its tests too** — the spec's list of survivors was
written before the chip's fate was settled; leaving a formatter with no caller
is how dead code accumulates. If a later task wants it, git has it.

- [ ] **Step 6: Rewire `page.tsx`**

- Delete `weekDrag`, `adaptiveEndDate`, `dateWindow`, `nonDateFilterOpts`/`filterOpts` (merge into one `filterOpts`), `navMatchingEvents` (becomes `filteredEvents`), `earlierDay`/`laterDay`/`expandEnd`/`showEarlier`, `isWeekHighlighted`, `pendingScroll` and its effect, and the `DateFilter` element.
- `navEventDays` and `navDayCounts` derive from `filteredEvents`.
- `goToDay` becomes navigation with nothing to plan:

```tsx
const goToDay = useCallback((target: string) => {
  // Every day of the year is mounted, so a chip tap is a scroll and nothing
  // else. `railTarget` is down to a bounds check: a target outside the
  // navigable bounds has no section and never will.
  if (railTarget(target, navBounds)) scrollToDay(target);
}, [navBounds, scrollToDay]);
```

- The favourites-only `★ N` button moves out of the deleted `DateFilter` and into the panel, above `LocationFilter`, keeping its label, title, `aria-pressed` and `aria-label` behaviour verbatim.
- `ActiveFilters` loses `hasDateFilters`, `hasNonDateFilters` and `onClearNonDateFilters`; delete `KeepDatesButton`, `CalendarKeepIcon`, the `showKeepDates` derivation and both of its render sites.
- `Header`'s `hasActiveFilters` becomes `filters.hasFilters`.
- `DayRail` loses `scopeHasWindow` (and the prop, its default and its guard go from `DayRail.tsx`) — the null-window case it guarded no longer exists.

- [ ] **Step 7: Prune `buildActiveChips`**

Delete the `date` and `week` branches, the `DATE_LABELS` map, the `viewWindow`,
`windowExpanded`, `resetWindow`, `dateFilter`, `setDateFilter`,
`selectedWeeks`, `setSelectedWeeks` inputs, and the `'date' | 'week'` members of
`ActiveChip['category']`. Update `buildActiveChips.test.ts` to match.

- [ ] **Step 8: Delete the components and their tests**

```bash
cd frontend
git rm src/components/filters/DateFilter.tsx src/components/filters/WeekSelector.tsx \
       src/components/calendar/EventList.tsx \
       src/__tests__/components/filters/DateFilter.test.tsx \
       src/__tests__/components/filters/WeekSelector.test.tsx \
       src/__tests__/components/calendar/EventList.test.tsx \
       src/__tests__/hooks/useWeekDragSelection.test.ts \
       src/__tests__/hooks/useFilterState.window.test.ts
```

Delete `useWeekDragSelection` from `src/hooks/useScrollState.ts` (leave
`useHorizontalScroll` and `useVerticalScroll`). `page.tsx` renders
`<EventListView groups={groupedEvents} ... />` directly now that `EventList`
holds nothing but a pass-through.

**Note on `WeekSelector`:** it is deleted outright rather than folded into the
chooser. Phase 2 built `WeekChooser` from `WeekSelector`'s *behaviour*
(extracted into `hooks/useWeekThemePopover.tsx`), not its markup — see the
spec's 2026-08-25 addendum — so nothing of the component itself survives, and
week themes stay reachable through `useWeekThemePopover` + `WeekThemePopover`
in the chooser and `WeekBadge` on the day header.

- [ ] **Step 9: Run everything**

```bash
cd frontend && npm run build
```

Expected: PASS. Work through the failures methodically — there will be many,
and most are tests that seeded a scope. For each one decide, and write down in
the commit message, whether it (a) seeded a scope purely as setup and should
drop the seed, or (b) asserted a scope's *behaviour* and should be deleted with
the feature.

- [ ] **Step 10: Check the coverage floor**

```bash
cd frontend && npx vitest run --coverage
```

Confirm lines coverage is still above the 74.3 floor in `.coverage-floor.json`.
Deleting well-covered code can move it in either direction.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(web): the list is the whole year — date filters deleted (#274 phase 4)"
```

---

### Task 6: Where the reader lands, and what a stale payload does

With no scope there is no "start at today" for free. Landing becomes an
explicit behaviour.

**Files:**
- Create: `frontend/src/lib/utils/landingDay.ts`, `frontend/src/hooks/useInitialLanding.ts`
- Test: `frontend/src/__tests__/lib/utils/landingDay.test.ts`, `frontend/src/__tests__/hooks/useInitialLanding.test.tsx`
- Modify: `frontend/src/app/page.tsx`

**Interfaces:**
- Consumes: task 5's `filteredEvents`/`navEventDays`, and `scrollToDay` from `useDayAnchor`.
- Produces: `landingDayKey({ now, isCurrentYear, eventDays, seasonStartDay }): DayKey | null` and `useInitialLanding({ targetDay, year, listMounted, scrollToDay })`.

- [ ] **Step 1: Write the failing test for the rule**

Create `frontend/src/__tests__/lib/utils/landingDay.test.ts`:

```ts
import { landingDayKey } from '@/lib/utils/landingDay';

const DAYS = ['2026-01-03', '2026-06-27', '2026-07-04', '2026-08-29'];

test('the current year lands on today when today has events', () => {
  expect(landingDayKey({
    now: new Date('2026-07-04T14:00:00Z'), isCurrentYear: true,
    eventDays: DAYS, seasonStartDay: '2026-06-27',
  })).toBe('2026-07-04');
});

test('the current year lands on the next day with events when today has none', () => {
  expect(landingDayKey({
    now: new Date('2026-06-30T14:00:00Z'), isCurrentYear: true,
    eventDays: DAYS, seasonStartDay: '2026-06-27',
  })).toBe('2026-07-04');
});

test('past the last event day, the current year lands on the last day rather than nowhere', () => {
  expect(landingDayKey({
    now: new Date('2026-09-20T14:00:00Z'), isCurrentYear: true,
    eventDays: DAYS, seasonStartDay: '2026-06-27',
  })).toBe('2026-08-29');
});

test('an archived year lands at the season start, not at January', () => {
  expect(landingDayKey({
    now: new Date('2026-07-04T14:00:00Z'), isCurrentYear: false,
    eventDays: DAYS, seasonStartDay: '2026-06-27',
  })).toBe('2026-06-27');
});

test('an archived year whose first event is after the season start lands on that event', () => {
  expect(landingDayKey({
    now: new Date('2026-07-04T14:00:00Z'), isCurrentYear: false,
    eventDays: ['2026-01-03', '2026-07-04'], seasonStartDay: '2026-06-27',
  })).toBe('2026-07-04');
});

test('a year with no events lands nowhere', () => {
  expect(landingDayKey({
    now: new Date('2026-07-04T14:00:00Z'), isCurrentYear: true,
    eventDays: [], seasonStartDay: '2026-06-27',
  })).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend && npx vitest run src/__tests__/lib/utils/landingDay.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the rule**

Create `frontend/src/lib/utils/landingDay.ts`:

```ts
import { dayKeyOf, type DayKey } from '@/lib/utils/dayWindow';

export interface LandingDayInput {
  now: Date;
  isCurrentYear: boolean;
  /** Ascending day keys that have at least one matching event. */
  eventDays: DayKey[];
  /** The selected year's season start, as a day key. */
  seasonStartDay: DayKey;
}

/**
 * The day the reader is put in front of on load.
 *
 * With the date scope gone this has to be stated: it used to fall out of
 * `dateFilter: 'next'` starting the list at today. Day keys are `YYYY-MM-DD`
 * in Institution time, so a lexical comparison is a calendar comparison.
 *
 * **A last-viewed day is deliberately never restored**, even inside the 30-day
 * `USER_STATE_EXPIRY_MS` window, and neither is scroll position — the same
 * reasoning `useFilterState` recorded for the session-only window days, and
 * what iOS does with `selectedDayKey`. A date pinned days ago and silently
 * restored on launch would be worse than no restore.
 */
export function landingDayKey({ now, isCurrentYear, eventDays, seasonStartDay }: LandingDayInput): DayKey | null {
  if (eventDays.length === 0) return null;
  const from = isCurrentYear ? dayKeyOf(now) : seasonStartDay;
  // The last day rather than null when everything is behind us: a
  // post-season visitor to the current year with filters applied (no
  // filters gets them the landing instead) should see the end of the season
  // they just had, not the January of a year that is over.
  return eventDays.find(d => d >= from) ?? eventDays[eventDays.length - 1];
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd frontend && npx vitest run src/__tests__/lib/utils/landingDay.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing test for the hook**

Create `frontend/src/__tests__/hooks/useInitialLanding.test.tsx`:

```tsx
import { renderHook } from '@testing-library/preact';
import { useInitialLanding } from '@/hooks/useInitialLanding';

function mountDay(key: string) {
  const el = document.createElement('div');
  el.setAttribute('data-day-key', key);
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.scrollY = 0;
});

test('scrolls to the target once the day has a section', () => {
  mountDay('2026-07-04');
  const scrollToDay = vi.fn();
  renderHook(() => useInitialLanding({ targetDay: '2026-07-04', year: 2026, listMounted: true, scrollToDay }));
  expect(scrollToDay).toHaveBeenCalledExactlyOnceWith('2026-07-04');
});

test('does not scroll again on a later render of the same year', () => {
  mountDay('2026-07-04');
  const scrollToDay = vi.fn();
  const { rerender } = renderHook(
    ({ target }) => useInitialLanding({ targetDay: target, year: 2026, listMounted: true, scrollToDay }),
    { initialProps: { target: '2026-07-04' } }
  );
  // A background feed refresh moves the landing day. The reader is already
  // looking at the list; nothing may move them.
  rerender({ target: '2026-07-05' });
  expect(scrollToDay).toHaveBeenCalledTimes(1);
});

test('scrolls again when the year changes', () => {
  mountDay('2026-07-04');
  mountDay('2025-07-04');
  const scrollToDay = vi.fn();
  const { rerender } = renderHook(
    ({ target, year }) => useInitialLanding({ targetDay: target, year, listMounted: true, scrollToDay }),
    { initialProps: { target: '2026-07-04', year: 2026 } }
  );
  rerender({ target: '2025-07-04', year: 2025 });
  expect(scrollToDay).toHaveBeenCalledTimes(2);
  expect(scrollToDay).toHaveBeenLastCalledWith('2025-07-04');
});

test('does not move a reader who has already scrolled', () => {
  mountDay('2026-07-04');
  window.scrollY = 4200;
  const scrollToDay = vi.fn();
  renderHook(() => useInitialLanding({ targetDay: '2026-07-04', year: 2026, listMounted: true, scrollToDay }));
  expect(scrollToDay).not.toHaveBeenCalled();
});

test('lands when the list appears later, not only on the first render', () => {
  const scrollToDay = vi.fn();
  const { rerender } = renderHook(
    ({ listMounted }) => useInitialLanding({ targetDay: '2026-07-04', year: 2026, listMounted, scrollToDay }),
    { initialProps: { listMounted: false } }
  );
  expect(scrollToDay).not.toHaveBeenCalled();

  // The off-season landing was on screen and the reader pressed "Browse this
  // season". The list mounts now, and the reader must arrive at the right day.
  mountDay('2026-07-04');
  rerender({ listMounted: true });
  expect(scrollToDay).toHaveBeenCalledExactlyOnceWith('2026-07-04');
});

test('a null target scrolls nowhere', () => {
  const scrollToDay = vi.fn();
  renderHook(() => useInitialLanding({ targetDay: null, year: 2026, listMounted: true, scrollToDay }));
  expect(scrollToDay).not.toHaveBeenCalled();
});
```

**The fifth test is the one that matters most, and it is why `listMounted` is
a parameter rather than something the hook infers.** An effect whose only
dependencies are `targetDay`, `year` and `scrollToDay` does not re-run when the
*list* appears — so a reader who was looking at the off-season landing and
pressed "Browse this season" would get the list scrolled to January, and a
reader whose feed had not arrived on the first render would get no landing at
all. Neither shows up as a failing test unless the transition is driven
explicitly, because the hook's early return leaves no trace. `listMounted` is
`!showLanding && !loading && groupedEvents.length > 0` at the call site.

- [ ] **Step 6: Run it and watch it fail, then write the hook**

Create `frontend/src/hooks/useInitialLanding.ts`:

```ts
import { useEffect, useRef } from 'react';
import { daySectionElement } from '@/lib/utils/daySections';
import type { DayKey } from '@/lib/utils/dayWindow';

/**
 * Puts the reader in front of `targetDay`, once per year, on load.
 *
 * Guarded on `window.scrollY === 0` as well as on the once-per-year ref: the
 * event feed refreshes in the background, and a refresh that changed
 * `targetDay` while the reader was 40,000px down the list must not teleport
 * them back to today.
 *
 * The scroll goes through `useDayAnchor.scrollToDay`, which computes a
 * *relative* delta from the target's own rect and then holds it there while
 * the page settles. That is load-bearing under `content-visibility: auto`:
 * sections above the target are sized by estimate until they render, so any
 * absolute offset computed by summing them would land near the day rather
 * than on it. Measured in the spec's addendum.
 */
export function useInitialLanding({ targetDay, year, listMounted, scrollToDay }: {
  targetDay: DayKey | null;
  year: number;
  /**
   * Whether the day list is on screen at all — `!showLanding && !loading &&
   * groupedEvents.length > 0` at the call site.
   *
   * A parameter rather than something this hook infers, and load-bearing:
   * without it the effect's dependencies never change between "the landing is
   * showing" and "the reader pressed Browse this season", so the list would
   * mount at January and stay there. The same gap swallows the first render,
   * where the feed has not arrived yet.
   */
  listMounted: boolean;
  scrollToDay: (key: DayKey) => void;
}): void {
  const landedFor = useRef<number | null>(null);

  useEffect(() => {
    if (landedFor.current === year) return;
    if (!targetDay || !listMounted) return;
    if (window.scrollY > 0) { landedFor.current = year; return; }
    if (!daySectionElement(targetDay)) return;
    landedFor.current = year;
    scrollToDay(targetDay);
  }, [targetDay, year, listMounted, scrollToDay]);
}
```

- [ ] **Step 7: Wire it into `page.tsx`**

```tsx
const landingDay = useMemo(() => landingDayKey({
  now: new Date(),
  isCurrentYear,
  eventDays: navEventDays,
  seasonStartDay: dayKeyOf(seasonWeeks[0].start),
}), [isCurrentYear, navEventDays, seasonWeeks]);

useInitialLanding({
  targetDay: landingDay,
  year: selectedYear,
  listMounted: !showLanding && !loading && groupedEvents.length > 0,
  scrollToDay,
});
```

The landing's two buttons re-express as navigation, since there is no scope to
set:

```tsx
// Sets the year and nothing else. It used to also set `dateFilter: 'all'`,
// because `next`'s adaptive window had nothing to adapt to that far ahead;
// with no scope there is nothing to open up, and `useInitialLanding` puts the
// reader at that season's start.
const previewNextSeason = useCallback((year: number) => { setSelectedYear(year); }, [setSelectedYear]);

// Deliberately does not change the year — the year on screen is already the
// one that ended. It used to set `dateFilter: 'season'`; it is now purely
// "show me the list", and the landing rule puts the reader at the season
// start.
const browseArchiveSeason = useCallback(() => { setBrowsingArchive(true); }, []);
```

`browseArchiveSeason` needs somewhere to record that the reader dismissed the
landing, since nothing about the *state* changes any more. Add
`const [browsingArchive, setBrowsingArchive] = useState(false);` and fold it
into task 3's branch: `const showLanding = landingState.kind !== 'in-season' && !filters.hasFilters && !browsingArchive;`. Reset it to
`false` whenever `selectedYear` changes, so switching years does not carry a
dismissal across.

- [ ] **Step 8: Test the dismissal**

Add to `offSeasonLanding.test.tsx`: pressing "Browse this season" replaces the
landing with the day list; switching years brings the landing back. Falsify by
removing the `selectedYear` reset and confirming the second assertion fails.

- [ ] **Step 9: Verify and commit**

```bash
cd frontend && npm run build
git add -A
git commit -m "feat(web): land on today, or the season start on an archived year (#274 phase 4)"
```

---

### Task 7: Browser checks, and re-measuring the thing the plan is built on

jsdom has no layout, no `content-visibility`, no scroll anchoring and no
compositor, so nothing above proves the shipped page behaves. This task is
where the phase is actually verified.

**Files:**
- Create: `frontend/e2e/verify-full-list.mjs`
- Modify: `frontend/e2e/verify-rail.mjs`, `verify-filter-reveal.mjs`, `verify-offseason.mjs`, `verify-header-reveal.mjs`, `verify-timezone.mjs`, `frontend/e2e/README.md`
- Modify: `frontend/package.json` (`test:browser` runs the new suite too)

**Interfaces:**
- Consumes: everything above.
- Produces: a suite that fails if the whole year is not mounted, if the landing is wrong, or if scrolling regresses.

- [ ] **Step 1: Fix the storage seeds the deletion invalidated**

Every suite seeds `chq-calendar-user-state` with `dateFilter`/`selectedWeeks`
(`verify-rail.mjs:206`, `:892`, `:1056`). Those keys are now ignored, so any
check that *depended* on them is silently proving nothing. Go through each:

- `verify-rail` check 3 ("a persisted `this-week` migration") has no subject any more — **delete it**, and delete the `currentRegime() === 'off-season'` skip that guards it.
- checks 18 and 21 seed `searchTerm: 'williamsburg'` *and* `dateFilter: 'all'`; drop only the date keys and confirm they still produce 1 reachable / 8 unreachable weeks against both the dev fixture and live production.
- The `18-pre` guard (a reachable week exists, so an all-zero term fails loudly) stays exactly as it is.

- [ ] **Step 2: Write the new suite**

Create `frontend/e2e/verify-full-list.mjs`. The skeleton and two of the checks
in full — the rest follow the same shape:

```js
/**
 * The list is the whole year (#274 phase 4).
 *
 * jsdom has no layout, no `content-visibility`, no scroll anchoring and no
 * compositor, so every claim this phase rests on is unreachable from the unit
 * suite. These are the checks that can fail.
 */
import { chromium } from 'playwright';
import { pinClock } from './fixedNow.mjs';
import { check, skip, finish } from './results.mjs';
import { enterList, currentRegime } from './regime.mjs';

const URL = process.env.URL || 'http://localhost:3000/';
const browser = await chromium.launch();

async function newPage({ width = 390, height = 844, storage, cpu } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, timezoneId: 'America/New_York' });
  const page = await ctx.newPage();
  await pinClock(page);
  page.once('close', () => { ctx.close().catch(() => {}); });
  if (storage) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), storage);
  if (cpu) {
    const client = await ctx.newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  }
  await page.goto(URL, { waitUntil: 'networkidle' });
  await enterList(page);
  return page;
}

// 1 — the whole year is mounted.
// Falsified by `groupedEvents.slice(0, 12)` in page.tsx: 12 sections, FAIL.
{
  const page = await newPage();
  const seen = await page.evaluate(async () => {
    const res = await fetch('/cache/calendar-cache/all-events.json');
    const { data } = await res.json();
    const year = new Date().getFullYear();
    const days = new Set(
      data.filter(e => e.startDate?.startsWith(String(year))).map(e => e.startDate.slice(0, 10))
    );
    return {
      expectedDays: days.size,
      mountedDays: document.querySelectorAll('[data-day-key]').length,
      mountedCards: document.querySelectorAll('[data-event-id]').length,
    };
  });
  check('1 every day of the year is mounted', seen.mountedDays === seen.expectedDays,
    `${seen.mountedDays} sections of ${seen.expectedDays} day-keys in the feed, ${seen.mountedCards} cards`);
  await page.close();
}

// 10 — scrolling the whole year does not jank, on a throttled phone CPU.
// The spike measured p95 17.4ms and 0 frames over 50ms, so these thresholds
// carry ~3x of headroom: this is a regression alarm, not a target.
// Falsified by removing `content-visibility` from the day section: p95 60ms,
// 10 frames over 100ms, FAIL.
{
  const page = await newPage({ cpu: 4 });
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = now => { window.__frames.push(now - last); last = now; if (!window.__stop) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(50); }
  const f = await page.evaluate(() => {
    window.__stop = true;
    const frames = window.__frames.slice(1).sort((a, b) => a - b);
    return {
      p95: Math.round(frames[Math.floor(frames.length * 0.95)] ?? 0),
      worst: Math.round(frames[frames.length - 1] ?? 0),
      over100: frames.filter(x => x > 100).length,
      count: frames.length,
      scrollY: Math.round(window.scrollY),
    };
  });
  check('10 forty gestures over the whole year stay smooth',
    f.over100 === 0 && f.p95 < 60,
    `p95 ${f.p95}ms, worst ${f.worst}ms, ${f.over100} frames over 100ms of ${f.count}, reached y=${f.scrollY}`);
  await page.close();
}

// ...checks 2-9 and 11 below, same shape...

finish();
```

The full list of checks, each printing its measured value:

1. **The whole year is mounted.** `[data-day-key]` count equals the number of distinct event days in the feed, and `[data-event-id]` count equals the feed's event count for the year. Falsify by slicing `groupedEvents` in `page.tsx`.
2. **There is no growth sentinel.** `[data-testid="event-list-sentinel"]` is absent at the top and after scrolling to the bottom.
3. **Day sections are skipping layout.** `getComputedStyle(section).contentVisibility === 'auto'` on the first section, and `containIntrinsicSize` is non-empty. Falsify by removing the style.
4. **The intrinsic size is in the right order of magnitude.** Scroll a mid-list section into view, read its real `offsetHeight`, and assert it is within ±60% of `estimatedDaySectionHeight(cardCount)`. This is the guard on the two magic numbers in `daySectionSize.ts`. Falsify by setting `EVENT_CARD_ESTIMATE_PX` to 8.
5. **The reader lands on today.** With the clock pinned mid-season, the day section under the sticky chrome after load is today's. Falsify by returning `eventDays[0]` from `landingDayKey`.
6. **An archived year lands at the season start**, via the year picker.
7. **Landing is relative, not absolute.** After the load landing, the target section's `getBoundingClientRect().top` equals `stickyOffset()` within 2px, and still does 2.5s later. This is the check that would catch someone replacing `scrollToDay` with an absolute `scrollTo`.
8. **A rail jump into the middle of the list lands to the pixel.** Jump to the day at 25%, 50% and 75%; assert top ≈ sticky offset and 0px drift after 2.5s. (This reproduces the spike measurement against the shipped build.)
9. **The slow-scroll check, re-run.** One wheel tick at a time, asserting steady progress, in Chromium **and** WebKit — a gesture is not one scroll event: WebKit on Linux delivers one tick as several frames, so drive real frames or it is green on macOS and broken in CI.
10. **Scrolling the whole year does not jank.** Forty 600px wheel gestures under 4x CPU throttling (`Emulation.setCPUThrottlingRate` over a CDP session); assert zero frames over 100ms and a 95th-percentile frame interval under 60ms. Print the numbers whatever the verdict, so a regression is legible rather than merely red. **The spike measured p95 17.4ms and 0 frames over 50ms, so this threshold has ~3x of headroom** — it is a regression alarm, not a target.
11. **An axe pass over the list**, specifically `aria-hidden-focus`, with the whole year mounted.

- [ ] **Step 3: Prove every new check by breaking the code**

For each of checks 1, 3, 4, 5, 7 and 10, inject the named defect, run
`npx vite build`, **grep the built bundle for a string literal or prop key from
the injection** to confirm it landed, run the check, confirm it fails, then
revert. Record the falsification result next to each check in a comment. If a
falsification unexpectedly passes, the check is measuring its own setup — the
phase 3 review found two of those.

- [ ] **Step 4: Run every suite, both engines**

```bash
cd frontend
npx vite build && npm run preview &
URL=http://localhost:3000/ npm run test:browser
E2E_ENGINE=webkit URL=http://localhost:3000/ node e2e/verify-header-reveal.mjs
E2E_NOW=2026-09-15 URL=http://localhost:3000/ node e2e/verify-full-list.mjs
```

**Check what is listening on port 3000 before trusting a result** — a stale dev
server from another session has cost this project a wrong diagnosis before
(`lsof -nP -iTCP:3000 -sTCP:LISTEN`).

- [ ] **Step 5: Re-measure, and write the result into the spec**

Adapt `measure-render-window.mjs` from the spike branch (`f606a73`) to the
shipped build — there are no URL flags any more, so it measures one
configuration — and run it at 4x and 6x against a production build. Append the
shipped numbers to the spec's addendum under **"Measured again on the shipped
build"**, alongside the spike's predictions. If they diverge by more than ~20%,
stop and find out why before merging: the plan's whole premise is that
measurement.

- [ ] **Step 6: Update the docs**

- `frontend/e2e/README.md` gains a paragraph on `verify-full-list.mjs` and what it is for.
- The spec's phase 4 section: mark it shipped, with the PR number.

- [ ] **Step 7: Commit and open the PR**

```bash
cd frontend && npm run build
git add -A
git commit -m "test(web): browser checks for a list that is the whole year (#274 phase 4)"
git push -u origin feat/274-phase-4-date-filters
gh pr create --title "feat(web): the day strip owns date navigation — phase 4 (#274)" --body "..."
```

Then iterate the PR per the repo's rules: address review comments (Copilot
routinely hides real findings in a collapsed **Suppressed comments** block
while its summary says it "generated no new comments" — open it every round,
and read inline comments as a separate surface from review summaries),
re-request reviews, wait for checks, and never merge without asking.

---

## Self-Review

**Spec coverage.** Every phase 4 requirement in the spec maps to a task: the
gated measurement → tasks 1, 2 and 7 step 5; "the collapse is larger than it
first appears" → task 5 steps 4-6; `useFilterState` shrinks → task 5 step 3;
localStorage migration → task 5 step 1; where the page lands → task 6; the
off-season landing re-expressed → tasks 3 and 6; the panel's final contents →
task 5 step 6; the deletions list → task 5 step 8; testing → tasks 1-7's tests
and task 7's browser suite.

**Two deliberate departures from the spec, both recorded above:**
`formatDayRange` is deleted rather than kept (its only caller was the "When"
chip), and `browseArchiveSeason` needs a small piece of new state
(`browsingArchive`) because with no scope to set it has nothing else to change
— the spec assumed it would still flip a filter.

**Known risk not covered by any test.** The `content-visibility` accessibility
trade in task 2 is a decision, not a defect, and no automated check asserts it
either way. If it turns out to matter to a real reader, the fallback is to drop
`content-visibility` and accept the middle column of the addendum's table —
scroll at rough parity with today rather than better.
