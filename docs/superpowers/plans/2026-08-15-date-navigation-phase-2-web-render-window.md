# Date navigation phase 2 — web bidirectional render window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the web list grow past the edges of the current scope — forward
automatically as you scroll, backward through an explicit "Show earlier"
control — without ever losing scroll position, all behind a build-time flag
that is off by default.

**Architecture:** Phase 1a already replaced four date predicates with one
derived `ViewWindow` (`frontend/src/lib/utils/dayWindow.ts`) plus session-only
`windowStartDay`/`windowEndDay` state. Phase 2 adds the second window — the
**render window**, a purely visual, day-granular slice of the day groups the
view window already produced. `EventList` splits into a presentational
`EventListView` and two containers: `EventListLegacy` (today's
`visibleCount`-of-events behaviour, untouched) and `EventListWindowed` (the
new path). A bottom sentinel does two jobs in strict order — extend the render
window if more loaded days remain (cheap, no refilter), otherwise expand the
*view* window by one event day (a refilter). A top "Show earlier" button
expands the view window backward and restores scroll position across the
resulting DOM prepend.

**Tech Stack:** Vite 7, Preact 10 (imported as `react` via `preact/compat`),
TypeScript 5, Tailwind 4, Vitest + @testing-library/preact (jsdom).

**Spec:** `docs/superpowers/specs/2026-08-15-cross-platform-date-navigation-design.md`
(phase 2 is defined in "Phasing"; the machinery is specified in "Web surface").

## Global Constraints

- **The view window is HALF-OPEN**: `start <= x < endExclusive`. Never
  inclusive with a subtracted epsilon. This is already true of
  `dayWindow.ts`; nothing in this phase may reintroduce an epsilon.
- **Clamp expansion INPUTS, never the merged window.** `viewWindow()` already
  does this. Do not move the clamp.
- **`windowStartDay` / `windowEndDay` are session-only** — never written to
  `localStorage`, cleared by `SET_DATE_FILTER`, `RESET_WINDOW`,
  `RECONCILE_FILTERS`, `CLEAR_FILTERS`. Phase 2 adds no persistence.
- **Everything new is behind `VITE_NAV_V2`**, default off. With the flag
  unset, the rendered output and every observable behaviour must be
  byte-identical to `main`. The flag is read as
  `String(import.meta.env.VITE_NAV_V2) === 'true'` **inside a function**, never
  at module scope, so `vi.stubEnv` works in tests.
- **Day keys are `yyyy-mm-dd` local-time strings** whose lexicographic order is
  chronological. Never compare dates by parsing when a key comparison will do.
- **Date arithmetic goes through `addDays`** (date parts + `setDate`). Never
  `+ n * 86400000` — the vitest run is pinned to `TZ=America/New_York`
  (`frontend/vitest.config.ts`) specifically so DST regressions fail.
- **Hooks and React-shaped types are imported from `'react'`** in files that
  render JSX (project convention — `preact/compat` installs the
  `onChange`→`onInput` normalisation).
- **Coverage floors are enforced**: `frontend.lines` 74.3 in
  `.coverage-floor.json`. `npm run build --workspace=frontend` runs
  `vitest run --coverage` before `vite build`, so a coverage regression fails
  the build.
- **Never commit to `main`.** Work happens on
  `feat/date-nav-phase-2-web-render-window`.
- All commands below run from `frontend/` unless the step says otherwise.

---

## What phase 2 is NOT

Do not build these; they are phase 3 and will be rejected in review if they
appear here:

- The day rail (`DayRail.tsx`, `useDayAnchor.ts`, scrollspy, `⟳ Now`).
- The scope-set change (drop "This Week", add "All Season").
- The active-filter date chip naming the actual window
  (`buildActiveChips.ts`). Under the flag, "Today" can show two days and the
  chip will still say "Today". That mismatch is the reason phase 2 ships
  dark.
- About-guide copy changes (`aboutContent.ts`).
- Any change to `iOS/**`.
- Virtualization or eviction from the render window. It is **grow-only**.

Known limitation, deliberately accepted: when the current window matches zero
events, `page.tsx` renders `<EmptyState />` instead of the list, so there is no
sentinel and no "Show earlier" button — an empty scope is still a dead end.
Phase 3's rail is scope-independent and fixes this. Do not work around it here.

---

## File structure

**New**

| File | Responsibility |
|---|---|
| `frontend/src/lib/utils/renderWindow.ts` | Pure day-group slice arithmetic: initial fill, forward extension, the reset key. No DOM, no React. |
| `frontend/src/lib/featureFlags.ts` | `isNavV2Enabled()`. One function, read at call time. |
| `frontend/src/components/calendar/EventListView.tsx` | Presentational: renders a list of day groups. No state, no observers. |
| `frontend/src/components/calendar/EventListLegacy.tsx` | Today's `visibleCount`-of-events container, moved verbatim. Deleted in phase 3. |
| `frontend/src/components/calendar/EventListWindowed.tsx` | The new container: day-granular render window, bottom sentinel, "Show earlier", prepend scroll preservation. |
| `frontend/src/__tests__/helpers/intersectionObserver.ts` | Test-only controllable `IntersectionObserver` mock. |

**Modified**

| File | Change |
|---|---|
| `frontend/src/lib/utils/dayWindow.ts` | `dayKeys` termination guard; new `eventDayKeys`, `navigationTargets`, `formatDayLabel`. |
| `frontend/src/lib/utils/filterHelpers.ts` | Rename the local `window` that shadows the DOM global. |
| `frontend/src/components/calendar/EventList.tsx` | Becomes a dispatcher: legacy vs windowed. |
| `frontend/src/app/page.tsx` | Flag read, navigation targets, reset key, new `EventList` props. |
| `frontend/.env.example` | Document `VITE_NAV_V2`. |

**Tests**

| File | Covers |
|---|---|
| `frontend/src/__tests__/lib/utils/dayWindow.test.ts` (extend) | Task 1 |
| `frontend/src/__tests__/lib/utils/renderWindow.test.ts` (new) | Task 2 |
| `frontend/src/__tests__/components/calendar/EventList.legacy.test.tsx` (new) | Task 3 |
| `frontend/src/__tests__/components/calendar/EventListWindowed.test.tsx` (new) | Tasks 4, 5 |
| `frontend/src/lib/__tests__/featureFlags.test.ts` (new) | Task 6 |

---

## Task 1: `dayWindow` hardening and navigation targets

The three items the phase 1a review deferred to "phase 2's first task", plus
the two derivations phase 2's controls need. All pure, all in one file.

**Files:**
- Modify: `frontend/src/lib/utils/dayWindow.ts`
- Modify: `frontend/src/lib/utils/filterHelpers.ts:38-39`
- Test: `frontend/src/__tests__/lib/utils/dayWindow.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `eventDayKeys(events: Event[]): DayKey[]` — sorted, unique, unparseable
    dates dropped.
  - `navigationTargets(eventDays: DayKey[], w: ViewWindow | null): { earlierDay: DayKey | null; laterDay: DayKey | null }`
  - `formatDayLabel(key: DayKey): string` — e.g. `"Saturday, Aug 15"`.
  - `dayKeys(from, through)` gains a termination guard (same signature).

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/__tests__/lib/utils/dayWindow.test.ts`. Add the new
names to the existing import block at the top of that file
(`eventDayKeys`, `navigationTargets`, `formatDayLabel`).

```ts
describe('dayKeys termination', () => {
  it('returns an empty list when either endpoint is not a real day key', () => {
    // 'NaN-NaN-NaN' is what groupEventsByDay produces for an unparseable
    // startDate, and 'N' > '2' lexicographically — so the naive
    // `while (cursor <= through)` loop never terminates. This is not
    // hypothetical: navigableBounds used to be able to hand out such a key.
    expect(dayKeys('2026-07-05', 'NaN-NaN-NaN')).toEqual([]);
    expect(dayKeys('NaN-NaN-NaN', '2026-07-05')).toEqual([]);
    expect(dayKeys('', '2026-07-05')).toEqual([]);
  });

  it('still enumerates a normal range inclusively', () => {
    expect(dayKeys('2026-07-05', '2026-07-07')).toEqual([
      '2026-07-05', '2026-07-06', '2026-07-07',
    ]);
    expect(dayKeys('2026-07-05', '2026-07-05')).toEqual(['2026-07-05']);
    expect(dayKeys('2026-07-07', '2026-07-05')).toEqual([]);
  });
});

describe('start-direction expansion', () => {
  // Phase 1a had no coverage in this direction at all: every expansion test
  // widened the end. Phase 2's "Show earlier" is the first caller that
  // widens the start, so these are the tests that make it safe.
  // The real 2026 season: week 1 starts Saturday June 27 at noon, week 9
  // ends Saturday August 29 at noon.
  const bounds = { startDay: '2026-06-27', endDay: '2026-08-29' };
  const base = {
    seasonWeeks,
    currentWeekNumber: 2,
    now: new Date(2026, 6, 5, 12, 0),
    bounds,
  } as const;

  it('widens the start to the expansion day and takes that day from midnight', () => {
    const w = viewWindow({ ...base, dateFilter: 'today', expandedStartDay: '2026-07-03' })!;
    expect(w.startDay).toBe('2026-07-03');
    expect(w.endDay).toBe('2026-07-05');
    expect(w.start).toEqual(new Date(2026, 6, 3, 0, 0, 0, 0));
  });

  it('ignores an expansion day that would narrow the window', () => {
    const w = viewWindow({ ...base, dateFilter: 'today', expandedStartDay: '2026-07-09' })!;
    expect(w.startDay).toBe('2026-07-05');
    expect(w.start).toEqual(new Date(2026, 6, 5, 0, 0, 0, 0));
  });

  it('clamps an expansion day that reaches past the navigable start', () => {
    const w = viewWindow({ ...base, dateFilter: 'today', expandedStartDay: '2026-01-01' })!;
    expect(w.startDay).toBe('2026-06-27');
  });

  it('does not invert the window when the base sits entirely after the bounds', () => {
    // Off-season 'today' in December: the base window is outside `bounds` in
    // the *other* direction, so an expansion day can be both earlier than
    // the base and later than anything navigation may reach. It clamps to
    // the nearest reachable day — the navigable END, because that is the
    // edge it overshot. Clamping the merged result instead of the expansion
    // input would produce startDay > endDay here.
    const december = { ...base, now: new Date(2026, 11, 1, 12, 0), currentWeekNumber: null };
    const w = viewWindow({ ...december, dateFilter: 'today', expandedStartDay: '2026-11-01' })!;
    expect(w.startDay).toBe('2026-08-29');
    expect(w.endDay).toBe('2026-12-01');
    expect(w.startDay <= w.endDay).toBe(true);
  });

  it('clamps to the near edge, never across the range', () => {
    // A clamp moves a value to the boundary it overshot. Snapping an
    // overshoot of the *end* down to the *start* would silently open the
    // whole season, which is a different operation wearing a clamp's name.
    const december = { ...base, now: new Date(2026, 11, 1, 12, 0), currentWeekNumber: null };
    expect(viewWindow({ ...december, dateFilter: 'today', expandedStartDay: '2026-11-01' })!.startDay)
      .not.toBe('2026-06-27');
  });

  it('widens both ends at once', () => {
    const w = viewWindow({
      ...base,
      dateFilter: 'today',
      expandedStartDay: '2026-07-03',
      expandedEndDay: '2026-07-08',
    })!;
    expect(w.startDay).toBe('2026-07-03');
    expect(w.endDay).toBe('2026-07-08');
    expect(w.start).toEqual(new Date(2026, 6, 3, 0, 0, 0, 0));
    expect(w.endExclusive).toEqual(new Date(2026, 6, 9, 0, 0, 0, 0));
  });
});

describe('eventDayKeys', () => {
  it('returns each event day once, in chronological order', () => {
    const events = [
      makeEvent('c', new Date(2026, 6, 7, 9, 0)),
      makeEvent('a', new Date(2026, 6, 5, 20, 0)),
      makeEvent('b', new Date(2026, 6, 5, 8, 0)),
    ];
    expect(eventDayKeys(events)).toEqual(['2026-07-05', '2026-07-07']);
  });

  it('drops events whose startDate does not parse', () => {
    const events = [
      makeEvent('a', new Date(2026, 6, 5, 8, 0)),
      { id: 'bad', title: 'bad', startDate: 'not a date' } as Event,
    ];
    expect(eventDayKeys(events)).toEqual(['2026-07-05']);
  });

  it('returns an empty list for no events', () => {
    expect(eventDayKeys([])).toEqual([]);
  });
});

describe('navigationTargets', () => {
  const days = ['2026-07-03', '2026-07-05', '2026-07-06', '2026-07-09'];
  const w = (startDay: string, endDay: string) => ({
    startDay, endDay, start: startOfDay(startDay), endExclusive: dayAfter(endDay),
  });

  it('names the nearest event day outside each edge', () => {
    expect(navigationTargets(days, w('2026-07-05', '2026-07-06')))
      .toEqual({ earlierDay: '2026-07-03', laterDay: '2026-07-09' });
  });

  it('skips days with no events rather than stepping one calendar day', () => {
    // 2026-07-04 and 2026-07-07/08 have no events. A calendar-day step would
    // expand the window and add nothing to the list — a control that looks
    // broken. The target is always a day that will actually render.
    expect(navigationTargets(days, w('2026-07-05', '2026-07-06')).earlierDay).toBe('2026-07-03');
    expect(navigationTargets(days, w('2026-07-05', '2026-07-06')).laterDay).toBe('2026-07-09');
  });

  it('returns null on an edge with nothing beyond it', () => {
    expect(navigationTargets(days, w('2026-07-03', '2026-07-09')))
      .toEqual({ earlierDay: null, laterDay: null });
  });

  it('returns nulls for a null window', () => {
    expect(navigationTargets(days, null)).toEqual({ earlierDay: null, laterDay: null });
  });

  it('returns nulls when there are no event days at all', () => {
    expect(navigationTargets([], w('2026-07-05', '2026-07-06')))
      .toEqual({ earlierDay: null, laterDay: null });
  });

  it('finds a target even when the whole window sits outside the event range', () => {
    expect(navigationTargets(days, w('2026-12-01', '2026-12-01')))
      .toEqual({ earlierDay: '2026-07-09', laterDay: null });
  });
});

describe('formatDayLabel', () => {
  it('names the weekday, abbreviated month and day', () => {
    expect(formatDayLabel('2026-07-05')).toBe('Sunday, Jul 5');
    expect(formatDayLabel('2026-08-15')).toBe('Saturday, Aug 15');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/__tests__/lib/utils/dayWindow.test.ts`
Expected: FAIL — `eventDayKeys is not a function` (and friends). The
`dayKeys('2026-07-05', 'NaN-NaN-NaN')` case **hangs** rather than failing;
that hang is the bug. If the run does not terminate, kill it and continue —
Step 3 fixes it.

- [ ] **Step 3: Implement**

In `frontend/src/lib/utils/dayWindow.ts`, replace `dayKeys` and append the new
functions:

```ts
/** A `yyyy-mm-dd` key with a real calendar date behind it. */
function isDayKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = partsOf(key);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/**
 * Every day from `from` through `through`, inclusive. Empty if inverted.
 *
 * Both endpoints are validated first. Without that, a `'NaN-NaN-NaN'` key —
 * what `groupEventsByDay` produces for an unparseable `startDate` — makes the
 * loop non-terminating, because `'N'` sorts above every digit and the cursor
 * can never reach it.
 */
export function dayKeys(from: DayKey, through: DayKey): DayKey[] {
  if (!isDayKey(from) || !isDayKey(through)) return [];
  const out: DayKey[] = [];
  let cursor = from;
  while (cursor <= through) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/**
 * Every day that has at least one event, sorted, each listed once.
 *
 * This is the set navigation steps through: expanding the window to a day
 * with no events would move the edge and add nothing to the list, which
 * reads as a broken control. Unparseable dates are dropped, matching every
 * other call site in the app.
 */
export function eventDayKeys(events: Event[]): DayKey[] {
  const keys = new Set<DayKey>();
  for (const event of events) {
    const parsed = new Date(event.startDate);
    if (Number.isNaN(parsed.getTime())) continue;
    keys.add(dayKeyOf(parsed));
  }
  return [...keys].sort();
}

/** The nearest event day beyond each edge of `w`, or `null` if there is none. */
export function navigationTargets(
  eventDays: DayKey[],
  w: ViewWindow | null
): { earlierDay: DayKey | null; laterDay: DayKey | null } {
  if (!w) return { earlierDay: null, laterDay: null };
  let earlierDay: DayKey | null = null;
  let laterDay: DayKey | null = null;
  for (const key of eventDays) {
    if (key < w.startDay) earlierDay = key;          // eventDays is sorted, so
    else if (key > w.endDay && laterDay === null) laterDay = key;  // last wins / first wins
  }
  return { earlierDay, laterDay };
}

/** `"Saturday, Aug 15"` — how a navigation control names its target. */
export function formatDayLabel(key: DayKey): string {
  return startOfDay(key).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}
```

Also make both clamps in `viewWindow` two-sided, which is what the spec's
`clamp(expandedStart, to: navigableBounds)` says and what phase 1a implemented
only half of. Each side is inert in the common case — expansion only ever
grows the window — but the halves being different sizes is how an out-of-range
value ends up snapping across the range instead of to the edge it overshot:

```ts
/** `key` moved to the nearest end of `bounds` if it falls outside them. */
function clampToBounds(key: DayKey, bounds: NavigableBounds): DayKey {
  if (key < bounds.startDay) return bounds.startDay;
  if (key > bounds.endDay) return bounds.endDay;
  return key;
}
```

```ts
  const expandedStartDay = o.expandedStartDay ? clampToBounds(o.expandedStartDay, o.bounds) : null;
  const expandedEndDay = o.expandedEndDay ? clampToBounds(o.expandedEndDay, o.bounds) : null;
```

Leave the merge below it exactly as it is. The clamp stays on the inputs.

In `frontend/src/lib/utils/filterHelpers.ts:38-39`, rename the local that
shadows the DOM global:

```ts
  const dateWindow = options.viewWindow;
  filtered = filtered.filter((event) => windowContains(dateWindow, new Date(event.startDate)));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/__tests__/lib/utils/dayWindow.test.ts src/__tests__/lib/utils/filterHelpers.test.ts`
Expected: PASS, and the run terminates promptly.

- [ ] **Step 5: Prove the guard by breaking the code**

Temporarily change `isDayKey` to `return true;`, re-run only the termination
test, and confirm it hangs (kill it after ~10s). Restore the real
implementation and re-run. A guard nobody has seen fail is not a guard.

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/dayWindow.ts src/lib/utils/filterHelpers.ts src/__tests__/lib/utils/dayWindow.test.ts
git commit -m "fix(web): terminate dayKeys on a non-date key, and derive navigation targets"
```

---

## Task 2: The render-window module

Pure arithmetic over `DayGroup[]`. No React, no DOM — everything the new
container needs to decide *what* to render, testable without a renderer.

**Files:**
- Create: `frontend/src/lib/utils/renderWindow.ts`
- Test: `frontend/src/__tests__/lib/utils/renderWindow.test.ts`

**Interfaces:**
- Consumes: `DayGroup` from `@/lib/utils/eventHelpers`.
- Produces:
  - `RENDER_BATCH_EVENTS = 50`
  - `renderEndIndex(groups: DayGroup[], lastKey: string | null, minEvents?: number): number`
  - `extendRenderEndIndex(groups: DayGroup[], fromIdx: number, minEvents?: number): number`
  - `renderResetKey(o: RenderResetInput): string`
  - `interface RenderResetInput { searchTerm: string; selectedTags: string[]; selectedLocations: string[]; showFavoritesOnly: boolean; favoriteCount: number; dateFilter: string; selectedWeeks: number[]; year: number }`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/lib/utils/renderWindow.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  RENDER_BATCH_EVENTS,
  renderEndIndex,
  extendRenderEndIndex,
  renderResetKey,
} from '@/lib/utils/renderWindow';
import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { Event } from '@/lib/types';

/** A day group with `count` placeholder events. */
function group(key: string, count: number): DayGroup {
  const events = Array.from({ length: count }, (_, i) => ({
    id: `${key}-${i}`, title: `${key}-${i}`, startDate: `${key}T12:00:00`,
  } as Event));
  return { key, baseLabel: key, weekNumbers: [], events };
}

describe('renderEndIndex', () => {
  it('walks forward from the top until it has at least a batch of events', () => {
    const groups = [group('d1', 20), group('d2', 20), group('d3', 20), group('d4', 20)];
    // 20 + 20 = 40 < 50, 20 + 20 + 20 = 60 >= 50 → index 2.
    expect(renderEndIndex(groups, null)).toBe(2);
  });

  it('stops at the first day when that day alone fills the batch', () => {
    expect(renderEndIndex([group('d1', 80), group('d2', 10)], null)).toBe(0);
  });

  it('renders everything when the whole window is smaller than a batch', () => {
    expect(renderEndIndex([group('d1', 3), group('d2', 4)], null)).toBe(1);
  });

  it('returns -1 for no groups', () => {
    expect(renderEndIndex([], null)).toBe(-1);
    expect(renderEndIndex([], 'd1')).toBe(-1);
  });

  it('honours a remembered last key instead of re-running the initial fill', () => {
    const groups = [group('d1', 20), group('d2', 20), group('d3', 20), group('d4', 20)];
    expect(renderEndIndex(groups, 'd1')).toBe(0);
    expect(renderEndIndex(groups, 'd4')).toBe(3);
  });

  it('keeps the same tail rendered after earlier days are prepended', () => {
    // This is the whole reason the render window is anchored on a key and
    // not on an index: a prepend shifts every index by one, and an
    // index-based window would silently drop the last rendered day.
    const before = [group('d3', 20), group('d4', 20)];
    const after = [group('d1', 20), group('d2', 20), ...before];
    expect(renderEndIndex(before, 'd4')).toBe(1);
    expect(renderEndIndex(after, 'd4')).toBe(3);
  });

  it('falls back to the initial fill when the remembered key is gone', () => {
    const groups = [group('d1', 20), group('d2', 20), group('d3', 20)];
    expect(renderEndIndex(groups, 'vanished')).toBe(2);
  });

  it('takes a custom batch size', () => {
    const groups = [group('d1', 5), group('d2', 5), group('d3', 5)];
    expect(renderEndIndex(groups, null, 6)).toBe(1);
  });

  it('defaults its batch size to RENDER_BATCH_EVENTS', () => {
    expect(RENDER_BATCH_EVENTS).toBe(50);
    const groups = [group('d1', 49), group('d2', 1), group('d3', 1)];
    expect(renderEndIndex(groups, null)).toBe(1);
  });
});

describe('extendRenderEndIndex', () => {
  it('adds whole days until it has added at least a batch of events', () => {
    // Counts *added*, not counts total: 20 then 20 + 40 = 60 >= 50, so the
    // step lands on index 2 and day four stays unmounted.
    const groups = [group('d1', 60), group('d2', 20), group('d3', 40), group('d4', 20)];
    expect(extendRenderEndIndex(groups, 0)).toBe(2);
  });

  it('stops at the last group', () => {
    const groups = [group('d1', 60), group('d2', 1)];
    expect(extendRenderEndIndex(groups, 0)).toBe(1);
  });

  it('is a no-op when already at the end', () => {
    const groups = [group('d1', 60)];
    expect(extendRenderEndIndex(groups, 0)).toBe(0);
    expect(extendRenderEndIndex([], -1)).toBe(-1);
  });

  it('always adds at least one day, even when that day is huge', () => {
    const groups = [group('d1', 10), group('d2', 500)];
    expect(extendRenderEndIndex(groups, 0)).toBe(1);
  });
});

describe('renderResetKey', () => {
  const base = {
    searchTerm: 'organ', selectedTags: ['Music'], selectedLocations: ['Amphitheater'],
    showFavoritesOnly: false, favoriteCount: 3, dateFilter: 'next',
    selectedWeeks: [2], year: 2026,
  };

  it('is stable across calls with the same filters', () => {
    expect(renderResetKey(base)).toBe(renderResetKey({ ...base }));
  });

  it('changes when any non-window filter changes', () => {
    const variants = [
      { searchTerm: 'brass' },
      { selectedTags: ['Music', 'Lecture'] },
      { selectedLocations: [] },
      { showFavoritesOnly: true },
      { dateFilter: 'today' },
      { selectedWeeks: [2, 3] },
      { year: 2025 },
    ];
    for (const patch of variants) {
      expect(renderResetKey({ ...base, ...patch })).not.toBe(renderResetKey(base));
    }
  });

  it('ignores the favorite count while favorites-only is off', () => {
    // Starring an event changes nothing about which events are listed, so it
    // must not reset the render window and throw the reader back to the top.
    expect(renderResetKey({ ...base, favoriteCount: 99 })).toBe(renderResetKey(base));
  });

  it('tracks the favorite count while favorites-only is on', () => {
    // Here un-starring genuinely removes an event — possibly the last one of
    // the anchor day — so a reset is the correct response.
    const on = { ...base, showFavoritesOnly: true };
    expect(renderResetKey({ ...on, favoriteCount: 2 })).not.toBe(renderResetKey(on));
  });

  it('ignores window state even when it is handed some', () => {
    // Reaching into the window fields is the single mistake that would make
    // every auto-expand reset scroll position. Assigning to a variable
    // first is deliberate: TypeScript's excess-property check applies to an
    // object literal at the call site, not to a variable, so this compiles
    // while still proving the function ignores what it was not given.
    const withWindow = { ...base, windowStartDay: '2026-07-01', windowEndDay: '2026-07-09' };
    expect(renderResetKey(withWindow)).toBe(renderResetKey(base));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/__tests__/lib/utils/renderWindow.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/utils/renderWindow"`.

- [ ] **Step 3: Implement**

Create `frontend/src/lib/utils/renderWindow.ts`:

```ts
import type { DayGroup } from '@/lib/utils/eventHelpers';

/**
 * How many events one growth step of the render window aims to add.
 *
 * The render window is a *view* concern: which of the day groups the view
 * window already produced are mounted in the DOM. Growing it costs a render
 * and no refilter, which is what makes it the cheap half of the two-step
 * the bottom sentinel performs.
 */
export const RENDER_BATCH_EVENTS = 50;

/** Index of the last group whose events reach `minEvents`, walking from `startIdx`. */
function fillFrom(groups: DayGroup[], startIdx: number, minEvents: number): number {
  let total = 0;
  for (let i = startIdx; i < groups.length; i++) {
    total += groups[i].events.length;
    if (total >= minEvents) return i;
  }
  return groups.length - 1;
}

/**
 * The index of the last day group to render.
 *
 * The render window is anchored on a **day key**, not an index, because
 * expanding the view window backward prepends groups and shifts every index.
 * An index-based window would keep the same numeric bounds over different
 * content and silently unmount the day the reader was looking at.
 *
 * `lastKey === null` (first render, or a filter change) runs the initial
 * fill from the top. A `lastKey` that is no longer present falls back to the
 * same fill — reachable when the anchor day's last event is un-starred while
 * favourites-only is on, which `renderResetKey` deliberately treats as a
 * reset anyway.
 */
export function renderEndIndex(
  groups: DayGroup[],
  lastKey: string | null,
  minEvents: number = RENDER_BATCH_EVENTS
): number {
  if (groups.length === 0) return -1;
  if (lastKey !== null) {
    const idx = groups.findIndex(g => g.key === lastKey);
    if (idx >= 0) return idx;
  }
  return fillFrom(groups, 0, minEvents);
}

/**
 * The render window grown by roughly one batch of events, in whole days.
 *
 * Always advances by at least one day when one is available, so a single
 * day larger than the batch can never stall growth.
 */
export function extendRenderEndIndex(
  groups: DayGroup[],
  fromIdx: number,
  minEvents: number = RENDER_BATCH_EVENTS
): number {
  if (fromIdx + 1 >= groups.length) return fromIdx;
  return fillFrom(groups, fromIdx + 1, minEvents);
}

export interface RenderResetInput {
  searchTerm: string;
  selectedTags: string[];
  selectedLocations: string[];
  showFavoritesOnly: boolean;
  favoriteCount: number;
  dateFilter: string;
  selectedWeeks: number[];
  year: number;
}

/**
 * Identity of the *non-window* filters.
 *
 * `EventList` resets its render window when this changes and only when this
 * changes. The window fields are deliberately absent: a window that merely
 * grew is not a new question, and resetting on it would throw the reader
 * back to the top of the list on every auto-expand — the gotcha the design
 * calls out by name.
 *
 * `favoriteCount` participates only while favourites-only is on, because
 * that is the only mode in which starring changes which events are listed.
 */
export function renderResetKey(o: RenderResetInput): string {
  return [
    o.searchTerm,
    o.selectedTags.join(','),
    o.selectedLocations.join(','),
    String(o.showFavoritesOnly),
    o.showFavoritesOnly ? String(o.favoriteCount) : 'off',
    o.dateFilter,
    o.selectedWeeks.join(','),
    String(o.year),
  ].join('|');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/__tests__/lib/utils/renderWindow.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/renderWindow.ts src/__tests__/lib/utils/renderWindow.test.ts
git commit -m "feat(web): add the render-window module, keyed on day keys not indices"
```

---

## Task 3: Split `EventList`, with the legacy path pinned first

`EventList` has **no tests today**. Before any of its behaviour moves, freeze
it. The characterization tests here must keep passing unchanged for the rest
of the phase — if a later task needs one of them edited, that is a signal the
flag-off path changed, which is not allowed.

**Files:**
- Create: `frontend/src/__tests__/helpers/intersectionObserver.ts`
- Create: `frontend/src/__tests__/components/calendar/EventList.legacy.test.tsx`
- Create: `frontend/src/components/calendar/EventListView.tsx`
- Create: `frontend/src/components/calendar/EventListLegacy.tsx`
- Modify: `frontend/src/components/calendar/EventList.tsx`

**Interfaces:**
- Consumes: nothing from tasks 1–2.
- Produces:
  - `interface EventListViewProps { groups: DayGroup[]; expandedDescriptions: Set<string>; onToggleDescription: (id: string) => void; onToggleTag: (tag: string) => void; isTagSelected: (tag: string) => boolean; favoriteIds: Set<string>; onToggleFavorite: (id: string) => void; weeklyThemes?: Record<number, WeekTheme>; articleLinks?: Record<string, ArticleLink[]>; programLinks?: Record<string, ProgramLink[]> }`
  - `EventListView(props: EventListViewProps)` — returns a fragment of day
    sections, no wrapper element.
  - `EventListLegacy(props: EventListProps)` — today's behaviour.
  - `EventList(props: EventListProps)` — dispatches on `props.navV2`.
  - `EventListProps` gains: `navV2?: boolean`, `resetKey?: string`,
    `earlierDay?: string | null`, `onShowEarlier?: () => void`,
    `canExpandEnd?: boolean`, `onExpandEnd?: () => void`. All optional; the
    windowed container is added in Task 4, so for now `navV2` selects nothing
    yet.
  - `installIntersectionObserverMock(): { trigger(isIntersecting?: boolean): void; liveCount: number; totalCreated: number }`

- [ ] **Step 1: Write the IntersectionObserver test helper**

jsdom implements no `IntersectionObserver` at all, so every test touching a
sentinel needs this. Create
`frontend/src/__tests__/helpers/intersectionObserver.ts`:

```ts
import { vi } from 'vitest';
import { act } from '@testing-library/preact';

type Entry = { isIntersecting: boolean };
type Callback = (entries: Entry[]) => void;

interface Instance {
  callback: Callback;
  disconnected: boolean;
}

/**
 * A controllable `IntersectionObserver`.
 *
 * jsdom ships none, and the component under test grows its render window
 * from the observer callback — so the tests drive intersection by hand.
 * `trigger()` fires the newest observer that has not been disconnected,
 * which is the one the current render installed.
 *
 * Call `vi.unstubAllGlobals()` in `afterEach` (or let the suite's own
 * teardown do it) to remove the stub.
 */
export function installIntersectionObserverMock() {
  const instances: Instance[] = [];

  class MockIntersectionObserver {
    private instance: Instance;
    constructor(callback: Callback) {
      this.instance = { callback, disconnected: false };
      instances.push(this.instance);
    }
    observe() {}
    unobserve() {}
    takeRecords(): Entry[] { return []; }
    disconnect() { this.instance.disconnected = true; }
  }

  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

  return {
    trigger(isIntersecting = true) {
      const live = instances.filter(i => !i.disconnected);
      const newest = live[live.length - 1];
      if (!newest) throw new Error('no live IntersectionObserver to trigger');
      act(() => { newest.callback([{ isIntersecting }]); });
    },
    get liveCount() { return instances.filter(i => !i.disconnected).length; },
    get totalCreated() { return instances.length; },
  };
}
```

- [ ] **Step 2: Write the characterization tests**

Create
`frontend/src/__tests__/components/calendar/EventList.legacy.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { EventList } from '@/components/calendar/EventList';
import { installIntersectionObserverMock } from '@/__tests__/helpers/intersectionObserver';
import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { Event } from '@/lib/types';

function group(key: string, label: string, count: number, hour = 12): DayGroup {
  const events = Array.from({ length: count }, (_, i) => ({
    id: `${key}-${i}`,
    title: `Event ${key}-${i}`,
    startDate: new Date(`${key}T${String(hour).padStart(2, '0')}:00:00`).toISOString(),
    endDate: new Date(`${key}T${String(hour + 1).padStart(2, '0')}:00:00`).toISOString(),
  } as Event));
  return { key, baseLabel: label, weekNumbers: [], events };
}

const noop = () => {};
const baseProps = {
  expandedDescriptions: new Set<string>(),
  onToggleDescription: noop,
  onToggleTag: noop,
  isTagSelected: () => false,
  favoriteIds: new Set<string>(),
  onToggleFavorite: noop,
};

describe('EventList (legacy path, flag off)', () => {
  let io: ReturnType<typeof installIntersectionObserverMock>;

  beforeEach(() => { io = installIntersectionObserverMock(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders day headers and the first 50 events', () => {
    const groups = [group('2026-07-05', 'Sunday, July 5, 2026', 30), group('2026-07-06', 'Monday, July 6, 2026', 30)];
    render(<EventList {...baseProps} groupedEvents={groups} dateFilter="all" />);

    expect(screen.getByText('Sunday, July 5, 2026')).toBeInTheDocument();
    expect(screen.getByText('Event 2026-07-05-0')).toBeInTheDocument();
    expect(screen.getByText('Event 2026-07-06-19')).toBeInTheDocument();
    // 51st event onwards is not mounted.
    expect(screen.queryByText('Event 2026-07-06-20')).not.toBeInTheDocument();
    expect(screen.getByText('Loading more events...')).toBeInTheDocument();
  });

  it('loads another 50 events when the sentinel intersects', () => {
    const groups = [group('2026-07-05', 'Sunday, July 5, 2026', 120)];
    render(<EventList {...baseProps} groupedEvents={groups} dateFilter="all" />);
    expect(screen.queryByText('Event 2026-07-05-50')).not.toBeInTheDocument();

    io.trigger();

    expect(screen.getByText('Event 2026-07-05-50')).toBeInTheDocument();
    expect(screen.getByText('Event 2026-07-05-99')).toBeInTheDocument();
    expect(screen.queryByText('Event 2026-07-05-100')).not.toBeInTheDocument();
  });

  it('drops the sentinel once everything is mounted', () => {
    const groups = [group('2026-07-05', 'Sunday, July 5, 2026', 10)];
    render(<EventList {...baseProps} groupedEvents={groups} dateFilter="all" />);
    expect(screen.queryByText('Loading more events...')).not.toBeInTheDocument();
  });

  it('resets to the first 50 when the grouped events change', () => {
    const groups = [group('2026-07-05', 'Sunday, July 5, 2026', 120)];
    const { rerender } = render(<EventList {...baseProps} groupedEvents={groups} dateFilter="all" />);
    io.trigger();
    expect(screen.getByText('Event 2026-07-05-50')).toBeInTheDocument();

    rerender(<EventList {...baseProps} groupedEvents={[...groups]} dateFilter="all" />);

    expect(screen.queryByText('Event 2026-07-05-50')).not.toBeInTheDocument();
  });

  it('offers "Show next day" only under the next scope, fully scrolled, with more days', () => {
    const groups = [group('2026-07-05', 'Sunday, July 5, 2026', 3)];
    const onShowNextDay = vi.fn();
    const { rerender } = render(
      <EventList {...baseProps} groupedEvents={groups} dateFilter="next"
        hasMoreDays onShowNextDay={onShowNextDay} />
    );
    const button = screen.getByRole('button', { name: /Show next day/ });
    expect(button).toHaveTextContent('Show next day (Monday, Jul 6)');

    rerender(
      <EventList {...baseProps} groupedEvents={groups} dateFilter="all"
        hasMoreDays onShowNextDay={onShowNextDay} />
    );
    expect(screen.queryByRole('button', { name: /Show next day/ })).not.toBeInTheDocument();

    rerender(
      <EventList {...baseProps} groupedEvents={groups} dateFilter="next"
        hasMoreDays={false} onShowNextDay={onShowNextDay} />
    );
    expect(screen.queryByRole('button', { name: /Show next day/ })).not.toBeInTheDocument();
  });

  it('renders nothing but an empty container for no groups', () => {
    const { container } = render(<EventList {...baseProps} groupedEvents={[]} dateFilter="all" />);
    expect(container.querySelectorAll('.event-card')).toHaveLength(0);
    expect(screen.queryByText('Loading more events...')).not.toBeInTheDocument();
  });

  it('renders the week badge and its separator for a day inside the season', () => {
    // Every `group()` above hardcodes `weekNumbers: []`, so without this case
    // the entire WeekBadge branch — the one piece of the day header with a
    // conditional in it — would be unpinned, on a task whose whole deliverable
    // is that the header did not change.
    // No `weeklyThemes`: WeekBadge then renders a plain labelled span, which
    // is the branch the day header actually reaches for most of the season.
    const inSeason = { ...group('2026-07-05', 'Sunday, July 5, 2026', 2), weekNumbers: [2] };
    render(<EventList {...baseProps} groupedEvents={[inSeason]} dateFilter="all" />);
    expect(screen.getByText('Sunday, July 5, 2026')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.getByText('Week 2')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the tests to verify they pass against today's code**

Run: `npm test -- src/__tests__/components/calendar/EventList.legacy.test.tsx`
Expected: PASS. These describe `EventList` as it already is — a failure here
means the description is wrong, not the code. Fix the test, not `EventList`.

Note on the "Show next day" label: the current code builds it from the last
event's own date + 1 day, formatted `weekday: 'long', month: 'short', day:
'numeric'`. With a single 2026-07-05 group, that is `Monday, Jul 6`.

- [ ] **Step 4: Commit the safety net before touching anything**

```bash
git add src/__tests__/helpers/intersectionObserver.ts src/__tests__/components/calendar/EventList.legacy.test.tsx
git commit -m "test(web): characterize EventList before the render-window split"
```

- [ ] **Step 5: Extract `EventListView`**

Create `frontend/src/components/calendar/EventListView.tsx` with the day-group
JSX moved **verbatim** out of `EventList.tsx` (same classes, same order, same
`WeekBadge` handling):

```tsx
import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';
import type { ArticleLink } from '@/hooks/useArticleLinks';
import type { ProgramLink } from '@/hooks/useProgramLinks';
import { downloadICS } from '@/lib/utils/icsHelpers';
import { EventCard } from './EventCard';
import { WeekBadge } from './WeekBadge';

export interface EventListViewProps {
  groups: DayGroup[];
  expandedDescriptions: Set<string>;
  onToggleDescription: (eventId: string) => void;
  onToggleTag: (tag: string) => void;
  isTagSelected: (tag: string) => boolean;
  favoriteIds: Set<string>;
  onToggleFavorite: (eventId: string) => void;
  weeklyThemes?: Record<number, WeekTheme>;
  articleLinks?: Record<string, ArticleLink[]>;
  programLinks?: Record<string, ProgramLink[]>;
}

/**
 * The day sections themselves — no state, no observers, no scroll.
 *
 * Returned as a fragment rather than a wrapper so each container owns the
 * spacing element its own sentinels and controls live in.
 */
export function EventListView({
  groups, expandedDescriptions, onToggleDescription, onToggleTag, isTagSelected,
  favoriteIds, onToggleFavorite, weeklyThemes, articleLinks, programLinks,
}: EventListViewProps) {
  return (
    <>
      {groups.map((dayGroup) => (
        <div key={dayGroup.key}>
          <div className="sticky top-0 bg-white dark:bg-gray-800 z-10 border-b border-gray-200 dark:border-gray-700 pb-1 sm:pb-2 mb-2 sm:mb-4">
            <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
              {dayGroup.baseLabel}
              {dayGroup.weekNumbers.length > 0 && (
                <>
                  <span> - </span>
                  <WeekBadge weekNumbers={dayGroup.weekNumbers} themes={weeklyThemes ?? {}} />
                </>
              )}
            </h3>
          </div>
          <div className="space-y-1">
            {dayGroup.events.map((event, index) => (
              <EventCard
                key={event.id}
                event={event}
                index={index}
                isExpanded={expandedDescriptions.has(event.id)}
                onToggleDescription={onToggleDescription}
                onToggleTag={onToggleTag}
                isTagSelected={isTagSelected}
                isFavorite={favoriteIds.has(event.id)}
                onToggleFavorite={onToggleFavorite}
                onDownloadICS={downloadICS}
                articleLinks={articleLinks?.[event.id]}
                programLinks={programLinks?.[event.id]}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
```

- [ ] **Step 6: Move the legacy container**

Create `frontend/src/components/calendar/EventListLegacy.tsx` holding today's
`visibleCount` state, its `IntersectionObserver` effect, its slicing loop and
its "Show next day" button — moved unchanged from `EventList.tsx`, now
rendering `<EventListView groups={visibleGroups} … />` inside the same
`<div className="space-y-4 sm:space-y-6">`:

```tsx
import { useState, useEffect, useRef, useMemo } from 'react';
import type { DayGroup } from '@/lib/utils/eventHelpers';
import { EventListView, type EventListViewProps } from './EventListView';

export interface EventListLegacyProps extends Omit<EventListViewProps, 'groups'> {
  groupedEvents: DayGroup[];
  dateFilter: string;
  onShowNextDay?: () => void;
  hasMoreDays?: boolean;
}

const BATCH_SIZE = 50;

/**
 * The pre-phase-2 list: a prefix of N *events*, grown 50 at a time, with a
 * manual "Show next day" button under the `next` scope.
 *
 * Kept intact behind `VITE_NAV_V2` so merging phase 2 changes nothing for
 * anyone. Deleted wholesale when the flag flips in phase 3.
 */
export function EventListLegacy({ groupedEvents, dateFilter, onShowNextDay, hasMoreDays, ...view }: EventListLegacyProps) {
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const totalEvents = useMemo(() => groupedEvents.reduce((sum, g) => sum + g.events.length, 0), [groupedEvents]);

  useEffect(() => { setVisibleCount(BATCH_SIZE); }, [groupedEvents]);

  useEffect(() => {
    if (visibleCount >= totalEvents) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleCount(prev => Math.min(prev + BATCH_SIZE, totalEvents));
      }
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, totalEvents]);

  let remaining = visibleCount;
  const visibleGroups: DayGroup[] = [];
  for (const group of groupedEvents) {
    if (remaining <= 0) break;
    if (group.events.length <= remaining) {
      visibleGroups.push(group);
      remaining -= group.events.length;
    } else {
      visibleGroups.push({ ...group, events: group.events.slice(0, remaining) });
      remaining = 0;
    }
  }

  const nextDayLabel = useMemo(() => {
    if (dateFilter !== 'next' || groupedEvents.length === 0) return '';
    const lastGroup = groupedEvents[groupedEvents.length - 1];
    const lastEvent = lastGroup?.events[lastGroup.events.length - 1];
    if (!lastEvent) return '';
    const lastDate = new Date(lastEvent.startDate);
    lastDate.setDate(lastDate.getDate() + 1);
    return ` (${lastDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })})`;
  }, [dateFilter, groupedEvents]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <EventListView groups={visibleGroups} {...view} />
      {visibleCount < totalEvents && (
        <div ref={sentinelRef} className="text-center py-4 text-sm text-gray-500 dark:text-gray-400">
          Loading more events...
        </div>
      )}
      {dateFilter === 'next' && visibleCount >= totalEvents && totalEvents > 0 && hasMoreDays && onShowNextDay && (
          <div className="text-center py-4">
            <button
              type="button"
              onClick={onShowNextDay}
              className="px-4 py-2 text-sm bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400 rounded-md hover:bg-blue-100 dark:hover:bg-gray-600 transition-colors"
            >
              Show next day{nextDayLabel}
            </button>
          </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Turn `EventList` into the dispatcher**

Replace `frontend/src/components/calendar/EventList.tsx` entirely:

```tsx
import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { EventListViewProps } from './EventListView';
import { EventListLegacy } from './EventListLegacy';

export interface EventListProps extends Omit<EventListViewProps, 'groups'> {
  groupedEvents: DayGroup[];
  dateFilter: string;
  /** Legacy path only. */
  onShowNextDay?: () => void;
  hasMoreDays?: boolean;
  /**
   * Phase 2's render window, gated on `VITE_NAV_V2`. Off by default, and
   * off means the legacy container below is the only thing that renders.
   */
  navV2?: boolean;
  /** Windowed path only — see EventListWindowed. */
  resetKey?: string;
  earlierDay?: string | null;
  onShowEarlier?: () => void;
  canExpandEnd?: boolean;
  onExpandEnd?: () => void;
}

// The windowed container arrives in the next task; until then the flag
// selects nothing and the legacy path is unconditional. The unused names are
// destructured so they do not reach `rest` and get spread onto a component
// whose props do not declare them. `@typescript-eslint/no-unused-vars` counts
// a destructured parameter as an argument, so this reports six warnings until
// Task 4 gives all six a use — accepted rather than suppressed, because a
// suppression would outlive the reason for it. Frontend lint does not fail on
// warnings; Task 4 must end with `npx eslint src/components/calendar/EventList.tsx`
// clean.
export function EventList({ navV2, resetKey, earlierDay, onShowEarlier, canExpandEnd, onExpandEnd, ...rest }: EventListProps) {
  return <EventListLegacy {...rest} />;
}
```

- [ ] **Step 8: Run the characterization tests and the full suite**

Run: `npm test -- src/__tests__/components/calendar/EventList.legacy.test.tsx`
Expected: PASS, **unedited**. If a test needed changing, the extraction was
not faithful — fix the component.

Run: `npm run type-check && npm run lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/components/calendar/EventList.tsx src/components/calendar/EventListView.tsx src/components/calendar/EventListLegacy.tsx
git commit -m "refactor(web): split EventList into a view and a legacy container"
```

---

## Task 4: `EventListWindowed` — the render window and forward expansion

The new container. This task builds everything except "Show earlier", which
is Task 5.

**Files:**
- Create: `frontend/src/components/calendar/EventListWindowed.tsx`
- Create: `frontend/src/__tests__/components/calendar/EventListWindowed.test.tsx`
- Modify: `frontend/src/components/calendar/EventList.tsx` (dispatch on `navV2`)

**Interfaces:**
- Consumes: `renderEndIndex`, `extendRenderEndIndex`, `RENDER_BATCH_EVENTS`
  (Task 2); `EventListView` (Task 3); `installIntersectionObserverMock`
  (Task 3).
- Produces:
  - `EventListWindowed(props: EventListWindowedProps)`
  - `interface EventListWindowedProps extends Omit<EventListViewProps, 'groups'> { groupedEvents: DayGroup[]; resetKey: string; canExpandEnd?: boolean; onExpandEnd?: () => void; earlierDay?: string | null; onShowEarlier?: () => void }`
    (`earlierDay` / `onShowEarlier` are wired in Task 5; declare them now so
    the prop type does not churn.)

**The two-step, stated once:** the bottom sentinel extends the **render**
window while loaded day groups remain (a render, no refilter), and only when
none remain does it ask the page to expand the **view** window (a refilter).
After that expansion the page hands down new day groups, the observer effect
re-subscribes, the sentinel is still in view, and step one runs — so one
scroll to the bottom produces one new day of content without any coordination
between the two windows.

**Why the observer is re-created per step rather than read from state:** the
callback performs one step and the effect's deps change, which disconnects and
re-observes. A still-intersecting target fires the fresh observer immediately,
so growth continues exactly as fast as the browser reports intersection.
Driving the same logic from a `sentinelVisible` state value instead would run
it once *per render*, and because intersection callbacks are asynchronous the
state would still say "visible" — blowing through the whole loaded window in
one synchronous burst.

- [ ] **Step 1: Write the failing tests**

Create
`frontend/src/__tests__/components/calendar/EventListWindowed.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { EventListWindowed } from '@/components/calendar/EventListWindowed';
import { installIntersectionObserverMock } from '@/__tests__/helpers/intersectionObserver';
import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { Event } from '@/lib/types';

function group(key: string, count: number): DayGroup {
  const events = Array.from({ length: count }, (_, i) => ({
    id: `${key}-${i}`,
    title: `Event ${key}-${i}`,
    startDate: new Date(`${key}T12:00:00`).toISOString(),
    endDate: new Date(`${key}T13:00:00`).toISOString(),
  } as Event));
  return { key, baseLabel: `Day ${key}`, weekNumbers: [], events };
}

const noop = () => {};
const baseProps = {
  expandedDescriptions: new Set<string>(),
  onToggleDescription: noop,
  onToggleTag: noop,
  isTagSelected: () => false,
  favoriteIds: new Set<string>(),
  onToggleFavorite: noop,
  resetKey: 'k1',
};

/** jsdom reports zero layout; the component only auto-expands a scrollable page. */
function setPageScrollable(scrollable: boolean) {
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    value: scrollable ? 5000 : 100,
  });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
}

describe('EventListWindowed', () => {
  let io: ReturnType<typeof installIntersectionObserverMock>;

  beforeEach(() => {
    io = installIntersectionObserverMock();
    setPageScrollable(true);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders whole days, filling to at least one batch of events', () => {
    const groups = [group('2026-07-05', 20), group('2026-07-06', 20), group('2026-07-07', 20), group('2026-07-08', 20)];
    render(<EventListWindowed {...baseProps} groupedEvents={groups} />);

    // 20 + 20 + 20 = 60 >= 50 → three whole days, never a partial one.
    expect(screen.getByText('Day 2026-07-07')).toBeInTheDocument();
    expect(screen.getByText('Event 2026-07-07-19')).toBeInTheDocument();
    expect(screen.queryByText('Day 2026-07-08')).not.toBeInTheDocument();
  });

  it('never splits a day across the render edge', () => {
    const groups = [group('2026-07-05', 80), group('2026-07-06', 5)];
    render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    expect(screen.getByText('Event 2026-07-05-79')).toBeInTheDocument();
    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();
  });

  it('extends the render window by whole days when the sentinel intersects', () => {
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20), group('2026-07-07', 40)];
    render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();

    io.trigger();

    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
    expect(screen.getByText('Day 2026-07-07')).toBeInTheDocument();
  });

  it('does not call onExpandEnd while loaded days remain', () => {
    const onExpandEnd = vi.fn();
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    render(<EventListWindowed {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={onExpandEnd} />);

    io.trigger();

    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
    expect(onExpandEnd).not.toHaveBeenCalled();
  });

  it('asks the page to expand the view window once the loaded days run out', () => {
    const onExpandEnd = vi.fn();
    const groups = [group('2026-07-05', 10)];
    render(<EventListWindowed {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={onExpandEnd} />);

    io.trigger();

    expect(onExpandEnd).toHaveBeenCalledTimes(1);
  });

  it('renders no sentinel when there is nothing left in either window', () => {
    const groups = [group('2026-07-05', 10)];
    const { container } = render(
      <EventListWindowed {...baseProps} groupedEvents={groups} canExpandEnd={false} />
    );
    expect(container.querySelector('[data-testid="event-list-sentinel"]')).toBeNull();
  });

  it('does not auto-expand a page that cannot scroll', () => {
    // Content shorter than the viewport means the reader never scrolled past
    // anything. Auto-expanding here would silently turn a three-event
    // "Today" into "Today and tomorrow" before the reader touched a thing.
    setPageScrollable(false);
    const onExpandEnd = vi.fn();
    render(<EventListWindowed {...baseProps} groupedEvents={[group('2026-07-05', 3)]} canExpandEnd onExpandEnd={onExpandEnd} />);

    io.trigger();

    expect(onExpandEnd).not.toHaveBeenCalled();
  });

  it('still mounts more loaded days on a page that cannot scroll', () => {
    // The scrollable-page guard belongs to the expensive step only. Without
    // this case, an implementation that wrapped BOTH steps in the guard would
    // pass every other test in this file, because they all force a scrollable
    // page — and the list would refuse to grow into days it had already
    // loaded whenever the viewport was taller than the content.
    setPageScrollable(false);
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();

    io.trigger();

    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
  });

  it('re-anchors on a filter change even when the day groups are rebuilt', () => {
    // The existing reset test reuses the same array reference, so it cannot
    // tell a derived anchor from an effect-synchronised one. Neither can this
    // one, in the end: `rerender` runs inside `act`, which flushes effects
    // before returning, so the extra frame an effect would paint is invisible
    // here. What this DOES pin is that re-anchoring survives the realistic
    // shape of a filter change — a brand-new array whose surviving day keys
    // overlap the old anchor — which is the state that makes the effect
    // version misbehave in a browser.
    //
    // The frame itself is verified in the browser pass, not here.
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    const { rerender } = render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    io.trigger();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();

    const rebuilt = [group('2026-07-05', 60), group('2026-07-06', 20)];
    rerender(<EventListWindowed {...baseProps} resetKey="k2" groupedEvents={rebuilt} />);

    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();
  });

  it('ignores a non-intersecting report', () => {
    const onExpandEnd = vi.fn();
    render(<EventListWindowed {...baseProps} groupedEvents={[group('2026-07-05', 3)]} canExpandEnd onExpandEnd={onExpandEnd} />);

    io.trigger(false);

    expect(onExpandEnd).not.toHaveBeenCalled();
  });

  it('keeps the rendered days when the window grows at the end', () => {
    const groups = [group('2026-07-05', 60)];
    const { rerender } = render(<EventListWindowed {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={noop} />);
    const grown = [...groups, group('2026-07-06', 20)];

    rerender(<EventListWindowed {...baseProps} groupedEvents={grown} canExpandEnd onExpandEnd={noop} />);

    // The appended day is not mounted until the sentinel asks for it, and
    // the day already on screen is untouched — no reset, no jump.
    expect(screen.getByText('Day 2026-07-05')).toBeInTheDocument();
    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();

    io.trigger();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
  });

  it('keeps the rendered tail when earlier days are prepended before any growth', () => {
    // The sibling test below triggers a growth step first, which sets the
    // anchor as a side effect — so it cannot catch an anchor that is still
    // null when the prepend lands. That is the ordinary case: pressing
    // "Show earlier" is a perfectly normal first action, and with a null
    // anchor the initial fill re-runs over the prepended array and unmounts
    // days that were already on screen.
    const groups = [group('2026-07-05', 30), group('2026-07-06', 30), group('2026-07-07', 30)];
    const { rerender } = render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();

    rerender(<EventListWindowed {...baseProps} groupedEvents={[group('2026-07-03', 30), ...groups]} />);

    expect(screen.getByText('Day 2026-07-03')).toBeInTheDocument();
    expect(screen.getByText('Day 2026-07-05')).toBeInTheDocument();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
  });

  it('keeps the rendered tail when earlier days are prepended', () => {
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    const { rerender } = render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    io.trigger();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();

    rerender(<EventListWindowed {...baseProps} groupedEvents={[group('2026-07-03', 10), ...groups]} />);

    expect(screen.getByText('Day 2026-07-03')).toBeInTheDocument();
    expect(screen.getByText('Day 2026-07-05')).toBeInTheDocument();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
  });

  it('resets the render window when the non-window filters change', () => {
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    const { rerender } = render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    io.trigger();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();

    rerender(<EventListWindowed {...baseProps} resetKey="k2" groupedEvents={groups} />);

    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();
  });

  it('renders nothing for no groups and asks for no expansion', () => {
    const onExpandEnd = vi.fn();
    const { container } = render(
      <EventListWindowed {...baseProps} groupedEvents={[]} canExpandEnd onExpandEnd={onExpandEnd} />
    );
    expect(container.querySelectorAll('.event-card')).toHaveLength(0);
    expect(onExpandEnd).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/__tests__/components/calendar/EventListWindowed.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/calendar/EventListWindowed"`.

- [ ] **Step 3: Implement the container**

Create `frontend/src/components/calendar/EventListWindowed.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DayGroup } from '@/lib/utils/eventHelpers';
import { extendRenderEndIndex, renderEndIndex } from '@/lib/utils/renderWindow';
import { EventListView, type EventListViewProps } from './EventListView';

export interface EventListWindowedProps extends Omit<EventListViewProps, 'groups'> {
  // NOTE: `earlierDay` and `onShowEarlier` below are declared now and wired
  // in Task 5. Destructure them in this task even though they are unused, so
  // they never reach the `...view` spread and land on `EventListView`.
  groupedEvents: DayGroup[];
  /** Identity of the non-window filters — see `renderResetKey`. */
  resetKey: string;
  /** True when the page has a later event day to widen the view window to. */
  canExpandEnd?: boolean;
  onExpandEnd?: () => void;
  /** The previous event day, or null at the navigable start. (Task 5) */
  earlierDay?: string | null;
  onShowEarlier?: () => void;
}

/** Whether the document is long enough to scroll at all. */
function isPageScrollable(): boolean {
  return document.documentElement.scrollHeight > window.innerHeight;
}

/**
 * The list under `VITE_NAV_V2`: a day-granular render window over the day
 * groups the view window produced, growing forward on its own.
 *
 * Two windows, deliberately not conflated. The **view** window is data —
 * which days pass the date filter, owned by `useFilterState` and derived by
 * `dayWindow`. The **render** window is DOM — which of those days are
 * mounted, owned here and reset only when the non-window filters change.
 * Growth is one-way: nothing is ever unmounted, because eviction breaks
 * scroll position to solve a problem 1,470 events do not have.
 *
 * **The caller must hand down a referentially stable `groupedEvents`.** Every
 * growth step is driven by an `IntersectionObserver` that is torn down and
 * recreated when the effect's dependencies change, so that a sentinel still
 * in view fires again immediately and growth continues at the pace the
 * browser reports intersection. A parent that rebuilds the array on every
 * render — same content, new identity — turns that into one growth step per
 * render instead. `page.tsx` memoizes it; anything else that mounts this
 * component must too.
 */
export function EventListWindowed({
  groupedEvents, resetKey, canExpandEnd, onExpandEnd, earlierDay, onShowEarlier, ...view
}: EventListWindowedProps) {
  // Anchored on a day key, never an index: expanding the window backward
  // prepends groups and shifts every index underneath us.
  //
  // The anchor carries the `resetKey` it was set under, and re-anchoring is
  // *derived* rather than synchronised by an effect. An effect runs after the
  // commit, so the render that first sees a filter change would still be
  // matching the previous question's anchor against the new day groups — and
  // whenever that day survives the new filter (a search that narrows event
  // counts but not which days have any events), it resolves to a far later
  // index and paints one frame with many more days mounted than the fresh
  // fill wants. Deriving costs a string comparison and cannot be out of step.
  //
  // A window that merely grew keeps its anchor: that is the same question,
  // and re-anchoring on it would throw the reader back to the top of the list
  // on every auto-expand.
  const [anchor, setAnchor] = useState<{ key: string | null; resetKey: string }>(
    { key: null, resetKey }
  );
  const sentinelRef = useRef<HTMLDivElement>(null);

  // A stale anchor is simply never consulted; the next growth step overwrites
  // it. Nothing has to clear it.
  const anchorKey = anchor.resetKey === resetKey ? anchor.key : null;

  // Latch the initial fill as soon as there are groups to fill from.
  //
  // Without this the anchor stays null until the first *downward* growth
  // step, and a reader who presses "Show earlier" before ever scrolling down
  // — an entirely ordinary first action — gets the initial fill re-run
  // against the newly prepended array, which unmounts days that were already
  // on screen and makes the scroll correction measure a document that grew at
  // the top and shrank at the bottom.
  //
  // This effect cannot reintroduce the stale frame that killed the earlier
  // reset effect: it only ever writes the value the render already derived,
  // so the interim frame and the stored frame are identical by construction.
  // And it always runs before any click can occur, since effects flush before
  // the browser hands the user back the main thread.
  useEffect(() => {
    if (anchorKey !== null || groupedEvents.length === 0) return;
    const idx = renderEndIndex(groupedEvents, null);
    setAnchor({ key: groupedEvents[idx].key, resetKey });
  }, [anchorKey, groupedEvents, resetKey]);

  const endIdx = useMemo(
    () => renderEndIndex(groupedEvents, anchorKey),
    [groupedEvents, anchorKey]
  );
  const visibleGroups = useMemo(
    () => groupedEvents.slice(0, endIdx + 1),
    [groupedEvents, endIdx]
  );

  const hasMoreLoadedDays = endIdx >= 0 && endIdx + 1 < groupedEvents.length;
  const showSentinel = groupedEvents.length > 0 && (hasMoreLoadedDays || !!canExpandEnd);

  useEffect(() => {
    if (!showSentinel) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      if (hasMoreLoadedDays) {
        // Cheap half: mount more of what the view window already produced.
        // Deliberately NOT gated on the page being scrollable — this step
        // changes no filter and costs one render.
        const nextIdx = extendRenderEndIndex(groupedEvents, endIdx);
        setAnchor({ key: groupedEvents[nextIdx].key, resetKey });
        return;
      }
      // Expensive half: ask the page for another day. Only from a page that
      // can actually scroll — otherwise a short list would widen its own
      // window on mount, before the reader scrolled past anything.
      if (canExpandEnd && onExpandEnd && isPageScrollable()) onExpandEnd();
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [showSentinel, hasMoreLoadedDays, endIdx, groupedEvents, canExpandEnd, onExpandEnd, resetKey]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <EventListView groups={visibleGroups} {...view} />
      {showSentinel && (
        <div
          ref={sentinelRef}
          data-testid="event-list-sentinel"
          className="text-center py-4 text-sm text-gray-500 dark:text-gray-400"
        >
          Loading more events...
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/__tests__/components/calendar/EventListWindowed.test.tsx`
Expected: PASS.

- [ ] **Step 5: Dispatch on the flag**

In `frontend/src/components/calendar/EventList.tsx`, replace the placeholder
body:

```tsx
import { EventListWindowed } from './EventListWindowed';

export function EventList({
  navV2, resetKey, earlierDay, onShowEarlier, canExpandEnd, onExpandEnd,
  dateFilter, onShowNextDay, hasMoreDays, ...view
}: EventListProps) {
  if (navV2) {
    return (
      <EventListWindowed
        {...view}
        resetKey={resetKey ?? ''}
        earlierDay={earlierDay}
        onShowEarlier={onShowEarlier}
        canExpandEnd={canExpandEnd}
        onExpandEnd={onExpandEnd}
      />
    );
  }
  return (
    <EventListLegacy
      {...view}
      dateFilter={dateFilter}
      onShowNextDay={onShowNextDay}
      hasMoreDays={hasMoreDays}
    />
  );
}
```

`dateFilter` is destructured out rather than left in `...view`: it is a legacy
concept (it drove the "Show next day" label and gate), the windowed container
has no such prop, and a JSX spread carries excess properties through without a
type error — so leaving it in `view` would silently hand a prop to a component
whose type says it does not exist. `groupedEvents` stays in `view`; both
containers declare it.

- [ ] **Step 6: Add the dispatch test**

Append to
`frontend/src/__tests__/components/calendar/EventList.legacy.test.tsx`:

```tsx
describe('EventList flag dispatch', () => {
  let io: ReturnType<typeof installIntersectionObserverMock>;
  beforeEach(() => { io = installIntersectionObserverMock(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders the legacy container when navV2 is absent or false', () => {
    const groups = [group('2026-07-05', 'Sunday, July 5, 2026', 80)];
    render(<EventList {...baseProps} groupedEvents={groups} dateFilter="all" />);
    // Legacy slices by event count, so day one is cut at 50.
    expect(screen.getByText('Event 2026-07-05-49')).toBeInTheDocument();
    expect(screen.queryByText('Event 2026-07-05-50')).not.toBeInTheDocument();
    expect(io.liveCount).toBeGreaterThan(0);
  });

  it('renders the windowed container when navV2 is true', () => {
    const groups = [group('2026-07-05', 'Sunday, July 5, 2026', 80)];
    render(<EventList {...baseProps} groupedEvents={groups} dateFilter="all" navV2 resetKey="k1" />);
    // The windowed container never splits a day.
    expect(screen.getByText('Event 2026-07-05-79')).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run the full frontend suite**

Run: `npm test`
Expected: PASS, including every characterization test from Task 3 unedited.

- [ ] **Step 8: Commit**

```bash
git add src/components/calendar/EventListWindowed.tsx src/components/calendar/EventList.tsx src/__tests__/components/calendar/
git commit -m "feat(web): grow the list by whole days and widen the window at the bottom edge"
```

---

## Task 5: "Show earlier", and surviving the prepend

The riskiest piece of the whole initiative: growing the list *upward* moves
everything already on screen down by the height of what was inserted. The fix
is to measure before the change and correct scroll position in a layout
effect, before the browser paints.

**Files:**
- Modify: `frontend/src/components/calendar/EventListWindowed.tsx`
- Modify: `frontend/src/__tests__/components/calendar/EventListWindowed.test.tsx`

**Interfaces:**
- Consumes: `formatDayLabel` (Task 1).
- Produces: no new exports — `earlierDay` / `onShowEarlier` (already declared
  in Task 4's props) become live.

- [ ] **Step 1: Write the failing tests**

Append to
`frontend/src/__tests__/components/calendar/EventListWindowed.test.tsx`:

```tsx
describe('EventListWindowed — showing earlier days', () => {
  beforeEach(() => {
    // No binding: none of these tests drive intersection. The mock is still
    // installed because the component constructs an observer whenever a
    // sentinel renders, and jsdom provides no constructor to construct.
    installIntersectionObserverMock();
    setPageScrollable(true);
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0, writable: true });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  /** Layout is simulated: jsdom measures nothing, so the test sets the heights. */
  function setScrollHeight(px: number) {
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: px });
  }

  it('offers the earlier control only when there is an earlier day', () => {
    const groups = [group('2026-07-05', 10)];
    const { rerender } = render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    expect(screen.queryByRole('button', { name: /Show earlier/ })).not.toBeInTheDocument();

    rerender(<EventListWindowed {...baseProps} groupedEvents={groups} earlierDay="2026-07-03" onShowEarlier={noop} />);
    expect(screen.getByRole('button', { name: /Show earlier/ })).toBeInTheDocument();
  });

  it('names the day it will show, never just "earlier"', () => {
    render(
      <EventListWindowed {...baseProps} groupedEvents={[group('2026-07-05', 10)]}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );
    const button = screen.getByRole('button', { name: /Show earlier/ });
    expect(button).toHaveTextContent('Show earlier (Friday, Jul 3)');
    expect(button).toHaveAttribute('aria-label', 'Show earlier events, Friday, Jul 3');
  });

  it('calls onShowEarlier when clicked', () => {
    const onShowEarlier = vi.fn();
    render(
      <EventListWindowed {...baseProps} groupedEvents={[group('2026-07-05', 10)]}
        earlierDay="2026-07-03" onShowEarlier={onShowEarlier} />
    );
    screen.getByRole('button', { name: /Show earlier/ }).click();
    expect(onShowEarlier).toHaveBeenCalledTimes(1);
  });

  it('restores scroll position across the prepend', () => {
    const groups = [group('2026-07-05', 10)];
    setScrollHeight(2000);
    (window as unknown as { scrollY: number }).scrollY = 900;

    const { rerender } = render(
      <EventListWindowed {...baseProps} groupedEvents={groups}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );
    screen.getByRole('button', { name: /Show earlier/ }).click();

    // The page grows by 600px above the reader's position.
    setScrollHeight(2600);
    rerender(
      <EventListWindowed {...baseProps} groupedEvents={[group('2026-07-03', 8), ...groups]}
        earlierDay="2026-07-02" onShowEarlier={noop} />
    );

    expect(window.scrollTo).toHaveBeenCalledWith(0, 1500);
  });

  it('does not touch scroll position on an ordinary re-render', () => {
    const groups = [group('2026-07-05', 10)];
    setScrollHeight(2000);
    const { rerender } = render(
      <EventListWindowed {...baseProps} groupedEvents={groups}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );

    setScrollHeight(2600);
    rerender(
      <EventListWindowed {...baseProps} groupedEvents={[...groups, group('2026-07-06', 5)]}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );

    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('corrects scroll only once per click', () => {
    const groups = [group('2026-07-05', 10)];
    setScrollHeight(2000);
    (window as unknown as { scrollY: number }).scrollY = 900;
    const { rerender } = render(
      <EventListWindowed {...baseProps} groupedEvents={groups}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );
    screen.getByRole('button', { name: /Show earlier/ }).click();

    setScrollHeight(2600);
    const prepended = [group('2026-07-03', 8), ...groups];
    rerender(<EventListWindowed {...baseProps} groupedEvents={prepended} earlierDay="2026-07-02" onShowEarlier={noop} />);
    setScrollHeight(3000);
    rerender(<EventListWindowed {...baseProps} groupedEvents={[...prepended, group('2026-07-06', 5)]} earlierDay="2026-07-02" onShowEarlier={noop} />);

    expect(window.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('forgets a pending correction when the filters change under it', () => {
    const groups = [group('2026-07-05', 10)];
    setScrollHeight(2000);
    const { rerender } = render(
      <EventListWindowed {...baseProps} groupedEvents={groups}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );
    screen.getByRole('button', { name: /Show earlier/ }).click();

    setScrollHeight(2600);
    rerender(
      <EventListWindowed {...baseProps} resetKey="k2" groupedEvents={[group('2026-08-01', 4)]}
        earlierDay={null} />
    );

    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/__tests__/components/calendar/EventListWindowed.test.tsx`
Expected: FAIL — no `Show earlier` button exists.

- [ ] **Step 3: Implement**

In `frontend/src/components/calendar/EventListWindowed.tsx`, add the import,
the pending-prepend ref, the layout effect and the control.

Imports:

```tsx
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatDayLabel } from '@/lib/utils/dayWindow';
```

Inside the component, after the render-window state:

```tsx
  // Growing the list upward pushes everything already on screen down by the
  // height of what was inserted. Measure before the change, correct after —
  // in a layout effect, so the correction lands before the browser paints
  // and the reader never sees the jump.
  const pendingPrependRef = useRef<{ scrollHeight: number; scrollY: number; resetKey: string } | null>(null);

  const handleShowEarlier = useCallback(() => {
    if (!onShowEarlier) return;
    pendingPrependRef.current = {
      scrollHeight: document.documentElement.scrollHeight,
      scrollY: window.scrollY,
      resetKey,
    };
    onShowEarlier();
  }, [onShowEarlier, resetKey]);

  useLayoutEffect(() => {
    const pending = pendingPrependRef.current;
    if (!pending) return;
    pendingPrependRef.current = null;
    // A filter change that landed between the click and the prepend means
    // this is a different list, and correcting against the old one would
    // scroll the reader into the middle of a result set they never asked
    // for. The reset effect cannot do this cancelling for us: layout
    // effects run before passive effects in the same commit, so by the time
    // it fired the correction would already be on screen.
    if (pending.resetKey !== resetKey) return;
    const delta = document.documentElement.scrollHeight - pending.scrollHeight;
    if (delta !== 0) window.scrollTo(0, pending.scrollY + delta);
  }, [groupedEvents, resetKey]);
```

Nothing else in the component changes. In particular, do not try to clear the
pending record from anywhere else: Task 4's anchor is derived during render,
not synchronised by an effect, so there is no reset effect to hang a cancel
on — and even if there were, layout effects run before passive effects in the
same commit, so it would fire too late. The stamped `resetKey` is the whole
cancellation mechanism.

And the control, rendered above the day sections inside the existing wrapper:

```tsx
      {earlierDay && onShowEarlier && (
        <div className="text-center py-2">
          <button
            type="button"
            onClick={handleShowEarlier}
            aria-label={`Show earlier events, ${formatDayLabel(earlierDay)}`}
            className="px-4 py-2 text-sm bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400 rounded-md hover:bg-blue-100 dark:hover:bg-gray-600 transition-colors"
          >
            Show earlier ({formatDayLabel(earlierDay)})
          </button>
        </div>
      )}
```

Destructure `earlierDay` and `onShowEarlier` out of props alongside the rest.

Note the asymmetry, and keep it: forward growth is automatic, backward growth
is a button. Auto-loading upward is the one thing that reliably moves the page
under the reader's thumb, and the backward case ("what did I miss yesterday?")
is deliberate rather than incidental.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/__tests__/components/calendar/EventListWindowed.test.tsx`
Expected: PASS.

- [ ] **Step 5: Prove the scroll correction by breaking it**

Temporarily change `useLayoutEffect` to `useEffect` and re-run — the tests
still pass, because jsdom does not paint and cannot distinguish them. Note
that in the commit message: **the correction's timing is not covered by any
test**, and is verified only in the browser pass in Task 7. Restore
`useLayoutEffect`.

Then temporarily delete the `if (pending.resetKey !== resetKey) return;` line
and confirm the "forgets a pending correction" test fails. Restore it. A
guard nobody has seen fail is not a guard.

- [ ] **Step 6: Commit**

```bash
git add src/components/calendar/EventListWindowed.tsx src/__tests__/components/calendar/EventListWindowed.test.tsx
git commit -m "feat(web): show earlier days without moving the page under the reader"
```

---

## Task 6: The flag, and wiring the page

**Files:**
- Create: `frontend/src/lib/featureFlags.ts`
- Create: `frontend/src/lib/__tests__/featureFlags.test.ts`
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/.env.example`

**Interfaces:**
- Consumes: `eventDayKeys`, `navigationTargets`, `viewWindow` (Task 1);
  `renderResetKey` (Task 2); `EventList`'s new props (Tasks 3–5).
- Produces: `isNavV2Enabled(): boolean`.

- [ ] **Step 1: Write the failing flag test**

Create `frontend/src/lib/__tests__/featureFlags.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { isNavV2Enabled } from '@/lib/featureFlags';

describe('isNavV2Enabled', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('is off when the variable is unset', () => {
    expect(isNavV2Enabled()).toBe(false);
  });

  it('is on only for the exact string "true"', () => {
    vi.stubEnv('VITE_NAV_V2', 'true');
    expect(isNavV2Enabled()).toBe(true);
  });

  it('is off for anything else', () => {
    for (const value of ['false', '1', 'yes', 'TRUE', '']) {
      vi.stubEnv('VITE_NAV_V2', value);
      expect(isNavV2Enabled()).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/lib/__tests__/featureFlags.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the flag**

Create `frontend/src/lib/featureFlags.ts`:

```ts
/**
 * Build-time flags.
 *
 * Each reads `import.meta.env` **inside the function**, never at module
 * scope: `vi.stubEnv` mutates `import.meta.env` at runtime, and a value
 * captured at import time would freeze whatever the first test saw. It also
 * keeps the flag honest in the dev server, where the variable can change
 * between restarts.
 */

/**
 * Phase 2 of the date-navigation initiative: the day-granular render window,
 * automatic forward expansion and the "Show earlier" control.
 *
 * Off unless `VITE_NAV_V2` is exactly `"true"`, so merging the phase changes
 * nothing for anyone until the flip. Matches the `VITE_ENABLE_PUBLISHER_FEEDS`
 * idiom already used by `useEventData`.
 */
export function isNavV2Enabled(): boolean {
  return String(import.meta.env.VITE_NAV_V2) === 'true';
}
```

Add to `frontend/.env.example`:

```
# Date-navigation phase 2: day-granular list growth, automatic forward
# expansion past the end of the current scope, and a "Show earlier" control.
# When unset or "false", the list behaves exactly as it did before.
VITE_NAV_V2=false
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- src/lib/__tests__/featureFlags.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `page.tsx`**

Add imports:

```tsx
import { navigableBounds, viewWindow, addDays, eventDayKeys, navigationTargets } from '@/lib/utils/dayWindow';
import { renderResetKey } from '@/lib/utils/renderWindow';
import { isNavV2Enabled } from '@/lib/featureFlags';
```

First split the existing `filterOpts` memo (`page.tsx:114-127`) so the date
window is the only thing layered on top. Everything that was in it stays in
it, in the same order — this is a split, not a rewrite:

```tsx
  // Everything except the date stage. Split out so the navigation targets
  // below can re-run the identical filter with the date stage wide open,
  // without recomputing on every window expansion.
  const nonDateFilterOpts = useMemo(() => ({
    searchTerm: debouncedSearch,
    selectedWeeks: filters.selectedWeeks,
    selectedTagsLowerSet: filters.selectedTagsLowerSet,
    selectedLocationsLowerSet: filters.selectedLocationsLowerSet,
    seasonWeeks,
    showFavoritesOnly: filters.showFavoritesOnly,
    favoriteIds: favorites.favoriteIds,
  }), [
    debouncedSearch, filters.selectedWeeks, filters.selectedTagsLowerSet,
    filters.selectedLocationsLowerSet, seasonWeeks,
    filters.showFavoritesOnly, favorites.favoriteIds,
  ]);

  const filterOpts: FilterOptions = useMemo(
    () => ({ ...nonDateFilterOpts, viewWindow: dateWindow }),
    [nonDateFilterOpts, dateWindow]
  );
```

Then, after the `filteredEvents` memo (`:128`), add:

```tsx
  const navV2 = isNavV2Enabled();

  // Every day that has an event under the *non-date* filters — the set
  // navigation steps through. Derived by re-running the same filter with the
  // date stage wide open, so search, category, venue, week and favourites
  // all constrain where stepping can go, and a step always lands on a day
  // that will actually render something.
  const navEventDays = useMemo(() => {
    if (!navV2) return [];
    const unbounded = viewWindow({
      dateFilter: 'all', seasonWeeks, currentWeekNumber, now: new Date(),
      bounds: navBounds, expandedStartDay: null, expandedEndDay: null,
    });
    return eventDayKeys(filterEvents(events, { ...nonDateFilterOpts, viewWindow: unbounded }));
  }, [navV2, events, nonDateFilterOpts, seasonWeeks, currentWeekNumber, navBounds]);

  const { earlierDay, laterDay } = useMemo(
    () => navigationTargets(navEventDays, dateWindow),
    [navEventDays, dateWindow]
  );

  const showEarlier = useCallback(() => {
    if (earlierDay) filters.expandWindowStart(earlierDay);
  }, [earlierDay, filters.expandWindowStart]);

  const expandEnd = useCallback(() => {
    if (laterDay) filters.expandWindowEnd(laterDay);
  }, [laterDay, filters.expandWindowEnd]);

  // What the render window resets on. The window fields are deliberately
  // not part of it.
  const listResetKey = useMemo(() => renderResetKey({
    searchTerm: debouncedSearch,
    selectedTags: filters.selectedTags,
    selectedLocations: filters.selectedLocations,
    showFavoritesOnly: filters.showFavoritesOnly,
    favoriteCount: favorites.favoriteCount,
    dateFilter: filters.dateFilter,
    selectedWeeks: filters.selectedWeeks,
    year: selectedYear,
  }), [
    debouncedSearch, filters.selectedTags, filters.selectedLocations,
    filters.showFavoritesOnly, favorites.favoriteCount, filters.dateFilter,
    filters.selectedWeeks, selectedYear,
  ]);
```

Then extend the `<EventList …>` call (`page.tsx:215-219`) with:

```tsx
                navV2={navV2}
                resetKey={listResetKey}
                earlierDay={earlierDay}
                onShowEarlier={showEarlier}
                canExpandEnd={!!laterDay}
                onExpandEnd={expandEnd}
```

Leave `onShowNextDay`, `hasMoreDays` and `dateFilter` exactly as they are —
the legacy container still needs all three.

- [ ] **Step 6: Verify the memoization invariant the list depends on**

Two reviews raised the same load-bearing assumption from different angles, and
this is the task that can finally check it. `EventListWindowed` recreates its
`IntersectionObserver` whenever its effect dependencies change, and its
scroll-correction record is discharged by the first `groupedEvents` change
after a click. Both are sound only if `groupedEvents` changes identity when,
and only when, its *content* changes for the current filters.

Confirm by reading `page.tsx`, and write what you found in your report:

- `groupedEvents` is a `useMemo` over `[filteredEvents, seasonWeeks]`.
- `filteredEvents` is a `useMemo` over `[events, filterOpts]`.
- `filterOpts` is now a `useMemo` over `[nonDateFilterOpts, dateWindow]`, and
  `nonDateFilterOpts` over primitives and memoized sets.
- `expandEnd` and `showEarlier` are `useCallback`s, and `canExpandEnd` is a
  boolean.

If any link in that chain rebuilds on every render, say so — it is a real
defect in the wiring, not a nitpick, and it makes the list grow one step per
render instead of one step per scroll.

Also drop the now-unused `io` binding from the `showing earlier days` describe
block in `EventListWindowed.test.tsx` — Task 5 left it behind, and the plan's
copy of that block has been corrected:

```tsx
describe('EventListWindowed — showing earlier days', () => {
  beforeEach(() => {
    // No binding: none of these tests drive intersection. The mock is still
    // installed because the component constructs an observer whenever a
    // sentinel renders, and jsdom provides no constructor to construct.
    installIntersectionObserverMock();
```

- [ ] **Step 7: Verify the flag-off path is untouched**

Run: `npm test && npm run type-check && npm run lint`
Expected: PASS. Every characterization test from Task 3 still passes unedited,
which is the evidence that a flag-off build renders what `main` renders.

- [ ] **Step 8: Commit**

```bash
git add src/lib/featureFlags.ts src/lib/__tests__/featureFlags.test.ts src/app/page.tsx .env.example src/__tests__/components/calendar/EventListWindowed.test.tsx
git commit -m "feat(web): wire the render window to the page behind VITE_NAV_V2"
```

---

## Task 7: Verification, browser pass, and documentation

Nothing here is optional. Two of this phase's three risks — layout-effect
timing and sticky/scroll interaction — are invisible to jsdom by
construction.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-15-cross-platform-date-navigation-design.md`
  (status line only)
- Modify: this plan (check off completed tasks)

- [x] **Step 1: Full verification sweep**

From the repo root:

```bash
cd frontend && npm run build          # validate (type-check + lint) + coverage + vite build
cd ../backend && npm run validate     # untouched, but the checklist says run it
```

Expected: both green; frontend line coverage at or above the 74.3 floor in
`.coverage-floor.json`. If coverage dropped, add tests — do not lower the
floor.

- [x] **Step 2: Browser pass with the flag ON** — performed; 11 of 12 checks
  passed on the first pass, check 6 found a real bug (see task-7-report.md):
  the render-window `anchor` in `EventListWindowed` started `null` and was
  only ever set by the bottom-sentinel's growth callback. If the reader
  clicked "Show earlier" before any bottom-scroll growth had fired,
  `renderEndIndex` recomputed `fillFrom(groups, 0, 50)` from scratch against
  the newly-prepended array and could silently drop previously-rendered
  later days from the DOM (confirmed reproducible, confirmed it did NOT
  occur once a growth step had fired first, confirmed it compounded across
  repeated clicks). **Fixed in a Task 7 fix round**: a `useEffect` now
  latches the initial fill's `endIdx` into `anchor` as soon as there are
  groups to fill from, so the anchor is never `null` by the time a click can
  reach it. Backed by a new jsdom regression test (confirmed to fail before
  the fix, pass after) and a re-verified browser pass — see the fix-round
  appendix in task-7-report.md for the numbers. Check 6 now passes.

```bash
cd frontend && VITE_NAV_V2=true npm run dev
```

Visit `http://localhost:3000` and confirm each of these, in order:

1. **Default (`Now`) scope** loads and reads exactly as before.
2. **Scroll to the bottom.** The list keeps loading days with no button. The
   old "Show next day" button is absent.
3. **Keep scrolling to the end of the season.** Loading stops; no sentinel
   remains; the page does not spin.
4. **Switch to `Today`.** The list is one day. Scroll to the bottom — it
   extends into following days.
5. **A short `Today`** (pick a scope/filter combination whose content is
   shorter than the viewport, e.g. `Today` plus a narrow category): the list
   must **not** expand on its own. Nothing was scrolled past.
6. **"Show earlier"** appears above the first day. Click it: the earlier day
   appears above, and **the event you were looking at does not move**. This
   is the single most important check in this list.
7. **Click "Show earlier" repeatedly** to the start of the season: the button
   disappears at the navigable start.
8. **Change a filter** (type in search, pick a category): the list resets to
   the top, as it should.
9. **Star an event with favourites-only OFF**: the list does not jump.
10. **Turn favourites-only ON, then un-star** the top event: the list resets.
    That is the intended trade.
11. **Switch year** to 2025: no time-relative scope survives; no expansion
    state survives.
12. **Mobile width (375px)** in device emulation: day headers still stick
    correctly; the "Show earlier" button is reachable and not overlapped.

Record the result of every numbered check in the PR body. If the Chrome
extension is unavailable, do the pass manually and say so.

- [x] **Step 3: Browser pass with the flag OFF** — confirmed byte-identical
  legacy behaviour: "Show next day" reappears, batch growth is exactly 50 at
  a time, no "Show earlier" anywhere.

```bash
cd frontend && npm run dev
```

Confirm: "Show next day" is back under the `Now` scope, the list grows 50
events at a time, and nothing named "Show earlier" exists anywhere.

- [x] **Step 4: Update the spec's status line**

In `docs/superpowers/specs/2026-08-15-cross-platform-date-navigation-design.md`,
change the `**Status:**` line to record that phases 0, 1a, 1b are merged and
phase 2 is implemented behind `VITE_NAV_V2` (default off), and that the flip
is phase 3's first act.

- [x] **Step 5: Commit** — committed locally only, per the controlling
  agent's instruction to stop before Step 6 (no push, no PR).

```bash
git add docs/superpowers/specs/2026-08-15-cross-platform-date-navigation-design.md docs/superpowers/plans/2026-08-15-date-navigation-phase-2-web-render-window.md
git commit -m "docs: record phase 2 as implemented behind VITE_NAV_V2"
git push -u origin feat/date-nav-phase-2-web-render-window
```

- [ ] **Step 6: Open the PR**

The body must carry, at minimum:

- That the phase ships **dark**: `VITE_NAV_V2` is unset in CI and in the
  deploy workflow, so production behaviour does not change. No workflow
  change is needed for that — an unset variable is off.
- The result of every numbered browser check from Step 2.
- The known limitation: a scope matching zero events still renders
  `EmptyState` with no way forward, and the active-filter chip still says
  "Today" while the window shows more than today. Both are phase 3.
- That the layout-effect **timing** of the scroll correction is verified only
  in the browser (jsdom cannot distinguish `useLayoutEffect` from
  `useEffect`).
- `[skip-screenshots: web-only change, no iOS surface touched]` is **not**
  needed — that guard only fires on `ios/**` and related paths. Do not add it.

---

## Self-review notes

**Spec coverage.** Phase 2's mandate is "web bidirectional render window +
edge expansion, no rail, behind a flag". Mapped: render window → Tasks 2, 4;
edge expansion forward → Task 4; backward → Task 5; the three named gotchas →
`resetKey` (Task 2 + 4), prepend scroll preservation (Task 5), and sticky
stacking (deferred with the rail, since phase 2 adds no sticky layer — the day
headers keep `top-0` and nothing new sits above them); the flag → Task 6; the
deferred phase-1a cleanups → Task 1. `DateFilter` union de-duplication stays
deferred to phase 3, where `'season'` is added.

**Deliberate deviations from the spec's letter, both recorded here so review
does not have to rediscover them:**

1. The spec's bottom sentinel dispatches `EXPAND_WINDOW_END` with no stated
   target day; this plan expands to *the next day that has events under the
   current non-date filters*. A calendar-day step would widen the window and
   add nothing to the list whenever the next day is empty or filtered out,
   which reads as a broken control — and under a narrow filter it would take
   one refilter per empty day to cross a gap. `navigationTargets` makes each
   step land on content. The same rule runs backward, which is why "Show
   earlier" names a real day.
2. The spec describes a sentinel at **both** ends. Phase 2 has a sentinel at
   the bottom and a **button** at the top, because D3 says backward stays
   explicit and, until the rail exists, the render window always starts at
   index 0 — there is never loaded content above it to reveal. The prepend
   machinery the top sentinel would have needed is built and tested anyway
   (Task 5), which is what the risk register actually asked for.
