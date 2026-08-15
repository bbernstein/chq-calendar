# Date Navigation Phase 1a — Web Shared Window Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the web's four scope-specific date predicates with one derived `ViewWindow`, and replace `extraDays` with explicit window bounds — **with zero user-visible behavior change**.

**Architecture:** A new pure module `dayWindow.ts` derives a `{ startDay, endDay, start, end }` window from the current scope. `filterHelpers` stops calling `isToday` / `isThisWeek` / the inline `next` branch and applies one instant-range check instead. `useFilterState` swaps `extraDays: number` for `windowStartDay` / `windowEndDay` day keys. Nothing about the UI changes; the "Show next day" button keeps working identically through the new state.

**Tech Stack:** TypeScript, Preact, vitest.

**Spec:** `docs/superpowers/specs/2026-08-15-cross-platform-date-navigation-design.md` — see "Shared model" and "ViewWindow".

## Global Constraints

- **Zero behavior change.** This is the de-risking phase. All 619 existing frontend tests must pass at every commit, and **exactly one may be edited**: `frontend/src/__tests__/hooks/useFilterState.test.ts:196`, `'clears extraDays on reconciliation'`, which names the API being deleted. It is *translated* to the new API in Task 4 Step 5, not dropped — the behavior it pins (the window is cleared on year switch) survives intact. **Any other test that needs changing to go green means the window derivation is wrong.** Verified by grepping `frontend/src` for `extraDays|addExtraDay`: that one test, `page.tsx`, and `useFilterState.ts` are the only references anywhere.
- **The window covers the `dateFilter` stage ONLY.** The `selectedWeeks` stage in `filterHelpers.ts:44-48` stays exactly as it is, a separate AND-ed filter. Today a user can hold `dateFilter: 'today'` *and* `selectedWeeks: [3]` simultaneously and both apply. The spec's table showing weeks as a base window describes the **phase 3** world, after web adopts iOS's scope/weeks mutual exclusion. Folding weeks in now would change behavior.
- **`season` scope is NOT added in this phase.** The scope-set change is phase 3. `baseWindow` handles exactly today's union: `'all' | 'today' | 'next' | 'this-week'`.
- **Day keys are `yyyy-mm-dd`, zero-padded, local time.** Lexicographic order is chronological — that is what makes plain `<` / `>` comparison correct, and it matches iOS's `ChqTime.dayKey`. Never compare day keys as `Date`s.
- **Date arithmetic is DST-safe.** Construct from `(year, month, date)` parts and use `setDate(+n)`. Never 86,400-second arithmetic. This mirrors iOS's `ChqTime.day(_:offsetBy:)`.
- **The window is half-open: `start <= x < endExclusive`.** Never inclusive-with-an-epsilon. JavaScript's `Date` is integer milliseconds so `end - 1` happens to be exact here, but iOS's `Date` is a `Double` where it is not — the same written rule would mean different things on the two platforms, which is the drift this shared model exists to prevent. See the iOS counterpart's Global Constraints.
- **Half-open is what the existing code already does**, so most scopes need no conversion at all: the week filter is `>= week.start && < week.end`, and `localDateKey` equality is exactly `[startOfDay(d), startOfDay(d+1))`. Carry those bounds through verbatim.
- **`endDay` names the last day *shown*, not the boundary.** `'this-week'` ends at noon Saturday so that Saturday counts; `'today'` ends at midnight so the next day does not. One rule covers both — *the day containing the last instant strictly before `endExclusive`* — implemented once in `lastDayCovered()`.
- **`windowStartDay` / `windowEndDay` are session-only.** Never added to the `localStorage` payload in `useFilterState.ts:197-204`. Cleared by `RECONCILE_FILTERS` and `CLEAR_FILTERS`.

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/lib/utils/dayWindow.ts` | **Create.** All day-key arithmetic and the window derivation. Pure — no React, no `Date.now()` (callers pass `now`). |
| `frontend/src/__tests__/lib/utils/dayWindow.test.ts` | **Create.** Unit tests for the module. |
| `frontend/src/__tests__/lib/utils/filterHelpers.test.ts` | **Create.** Characterization tests for `filterEvents`, written *before* any change. |
| `frontend/src/lib/utils/filterHelpers.ts` | **Modify.** Date stage becomes one range check. |
| `frontend/src/lib/utils/dateHelpers.ts` | **Modify.** Delete `isToday` and `isThisWeek` once nothing calls them. |
| `frontend/src/hooks/useFilterState.ts` | **Modify.** `extraDays` → `windowStartDay` / `windowEndDay`. |
| `frontend/src/app/page.tsx` | **Modify.** Derive the window, pass it down, rewire the next-day handler. |

`dayWindow.ts` is deliberately separate from `dateHelpers.ts`: `dateHelpers` owns season/week structure (`getChautauquaSeasonWeeks`, `getAdaptiveEndDate`) and `dayWindow` owns day-key arithmetic and window derivation. Two responsibilities, two files. `dayWindow` imports from `dateHelpers`, never the reverse.

---

## Task 1: Characterization tests for the current date stage

`filterEvents` has **no direct test coverage today** — verified by grepping `frontend/src` for `filterEvents`, which finds only `page.tsx` and its own definition. It is the function this whole phase rewires. These tests are written against the *current* implementation and must never be edited afterwards; if a later task makes one fail, the later task is wrong.

**Files:**
- Create: `frontend/src/__tests__/lib/utils/filterHelpers.test.ts`

**Interfaces:**
- Consumes: `filterEvents`, `FilterOptions` from `@/lib/utils/filterHelpers` (unchanged public shape at this point).
- Produces: nothing consumed by later tasks. It is a safety net for Tasks 3–5.

- [ ] **Step 1: Write the characterization tests**

Create `frontend/src/__tests__/lib/utils/filterHelpers.test.ts`:

```typescript
// Characterization tests: these pin what filterEvents' DATE stage does
// TODAY, before the ViewWindow refactor replaces four scope-specific
// predicates with one range check.
//
// They are the safety net for that refactor. Do NOT edit them to make a
// later change pass — if one of these goes red, the refactor is wrong, not
// the test. Written first because filterEvents had no direct coverage at
// all.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { filterEvents, type FilterOptions } from '@/lib/utils/filterHelpers';
import { getChautauquaSeasonWeeks, getCurrentWeekNumber } from '@/lib/utils/dateHelpers';
import type { Event } from '@/lib/types';

// Fixed reference instant: Wednesday 2026-07-15, 15:00 local. Mid-season,
// mid-week, mid-afternoon — so "one hour ago" stays on the same calendar
// day and the week boundaries sit clear of it in both directions.
const NOW = new Date(2026, 6, 15, 15, 0, 0, 0);

function makeEvent(id: string, date: Date): Event {
  return {
    id,
    title: `Event ${id}`,
    startDate: date.toISOString(),
  } as Event;
}

const seasonWeeks = getChautauquaSeasonWeeks(2026);

function baseOptions(overrides: Partial<FilterOptions>): FilterOptions {
  return {
    searchTerm: '',
    dateFilter: 'all',
    selectedWeeks: [],
    selectedTagsLowerSet: new Set<string>(),
    selectedLocationsLowerSet: new Set<string>(),
    seasonWeeks,
    currentWeekNumber: getCurrentWeekNumber(seasonWeeks),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('filterEvents date stage — characterization', () => {
  describe("dateFilter: 'all'", () => {
    it('filters nothing by date, including events years away', () => {
      const events = [
        makeEvent('past', new Date(2020, 0, 1, 9, 0)),
        makeEvent('today', new Date(2026, 6, 15, 9, 0)),
        makeEvent('future', new Date(2030, 0, 1, 9, 0)),
      ];
      const result = filterEvents(events, baseOptions({ dateFilter: 'all' }));
      expect(result.map((e) => e.id)).toEqual(['past', 'today', 'future']);
    });
  });

  describe("dateFilter: 'today'", () => {
    it('keeps only events on the current calendar day', () => {
      const events = [
        makeEvent('yesterday-2359', new Date(2026, 6, 14, 23, 59)),
        makeEvent('today-0000', new Date(2026, 6, 15, 0, 0)),
        makeEvent('today-2359', new Date(2026, 6, 15, 23, 59)),
        makeEvent('tomorrow-0000', new Date(2026, 6, 16, 0, 0)),
      ];
      const result = filterEvents(events, baseOptions({ dateFilter: 'today' }));
      expect(result.map((e) => e.id)).toEqual(['today-0000', 'today-2359']);
    });

    it('keeps an event earlier today that has already finished', () => {
      // 'today' is a whole-day filter, NOT a from-now filter. This is the
      // distinction that separates it from 'next'.
      const events = [makeEvent('this-morning', new Date(2026, 6, 15, 8, 0))];
      const result = filterEvents(events, baseOptions({ dateFilter: 'today' }));
      expect(result.map((e) => e.id)).toEqual(['this-morning']);
    });
  });

  describe("dateFilter: 'next'", () => {
    it('includes an event that started within the last hour', () => {
      const events = [makeEvent('started-30m-ago', new Date(2026, 6, 15, 14, 30))];
      const result = filterEvents(
        events,
        baseOptions({
          dateFilter: 'next',
          adaptiveEndDate: new Date(2026, 6, 17, 23, 59, 59, 999),
        })
      );
      expect(result.map((e) => e.id)).toEqual(['started-30m-ago']);
    });

    it('excludes an event that started more than an hour ago', () => {
      const events = [makeEvent('started-90m-ago', new Date(2026, 6, 15, 13, 30))];
      const result = filterEvents(
        events,
        baseOptions({
          dateFilter: 'next',
          adaptiveEndDate: new Date(2026, 6, 17, 23, 59, 59, 999),
        })
      );
      expect(result).toEqual([]);
    });

    it('excludes an event after adaptiveEndDate', () => {
      const events = [
        makeEvent('inside', new Date(2026, 6, 17, 20, 0)),
        makeEvent('outside', new Date(2026, 6, 18, 9, 0)),
      ];
      const result = filterEvents(
        events,
        baseOptions({
          dateFilter: 'next',
          adaptiveEndDate: new Date(2026, 6, 17, 23, 59, 59, 999),
        })
      );
      expect(result.map((e) => e.id)).toEqual(['inside']);
    });

    it('falls back to a six-day end-of-day window when adaptiveEndDate is absent', () => {
      const events = [
        makeEvent('day-6', new Date(2026, 6, 21, 23, 0)),
        makeEvent('day-7', new Date(2026, 6, 22, 9, 0)),
      ];
      const result = filterEvents(events, baseOptions({ dateFilter: 'next' }));
      expect(result.map((e) => e.id)).toEqual(['day-6']);
    });
  });

  describe("dateFilter: 'this-week'", () => {
    it('uses noon-Saturday boundaries, not calendar-week ones', () => {
      const current = getCurrentWeekNumber(seasonWeeks);
      expect(current, 'NOW must fall inside the 2026 season').not.toBeNull();
      const week = seasonWeeks[current! - 1];

      const events = [
        makeEvent('one-ms-before-start', new Date(week.start.getTime() - 1)),
        makeEvent('exactly-at-start', new Date(week.start.getTime())),
        makeEvent('one-ms-before-end', new Date(week.end.getTime() - 1)),
        makeEvent('exactly-at-end', new Date(week.end.getTime())),
      ];
      const result = filterEvents(events, baseOptions({ dateFilter: 'this-week' }));
      // Start is inclusive, end is exclusive. The boundary Saturday
      // therefore belongs to two weeks, which is why the season cannot be
      // paged into disjoint weeks.
      expect(result.map((e) => e.id)).toEqual(['exactly-at-start', 'one-ms-before-end']);
    });

    it('returns nothing when NOW is outside the season', () => {
      vi.setSystemTime(new Date(2026, 11, 25, 12, 0));
      const offSeasonWeeks = getChautauquaSeasonWeeks(2026);
      const events = [makeEvent('anything', new Date(2026, 11, 25, 12, 0))];
      const result = filterEvents(
        events,
        baseOptions({
          dateFilter: 'this-week',
          seasonWeeks: offSeasonWeeks,
          currentWeekNumber: getCurrentWeekNumber(offSeasonWeeks),
        })
      );
      expect(result).toEqual([]);
    });
  });

  describe('the weeks stage is independent of the date stage', () => {
    it('ANDs a week selection with the date filter', () => {
      // This is the behavior the ViewWindow refactor must NOT change in
      // phase 1: scope and weeks are two separate AND-ed stages today.
      // Mutual exclusion arrives in phase 3.
      const week1 = seasonWeeks[0];
      const inWeek1 = new Date(week1.start.getTime() + 60 * 60 * 1000);
      const events = [makeEvent('week1-not-today', inWeek1)];

      const weekOnly = filterEvents(
        events,
        baseOptions({ dateFilter: 'all', selectedWeeks: [1] })
      );
      expect(weekOnly.map((e) => e.id)).toEqual(['week1-not-today']);

      const weekAndToday = filterEvents(
        events,
        baseOptions({ dateFilter: 'today', selectedWeeks: [1] })
      );
      expect(weekAndToday).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they PASS against unchanged code**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/filterHelpers.test.ts`

Expected: **PASS**, all tests. These characterize existing behavior, so they must be green immediately.

If any test fails, the test encodes a wrong assumption about current behavior — fix the *test* to match reality, and note what surprised you. Do not change `filterHelpers.ts` in this task.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/__tests__/lib/utils/filterHelpers.test.ts
git commit -m "test(web): characterize filterEvents' date stage before refactor

filterEvents had no direct test coverage — grepping frontend/src for it
found only page.tsx and its own definition — and it is the function the
ViewWindow refactor rewires.

Pins all four scopes including the two boundaries most likely to move
silently: 'next' includes an event that started up to an hour ago while
'today' is a whole-day filter, and 'this-week' uses noon-Saturday bounds
with an inclusive start and exclusive end, so a boundary Saturday belongs
to two weeks.

Also pins that the weeks stage ANDs with the date stage rather than
replacing it — the behavior phase 1 must preserve and phase 3 changes."
```

---

## Task 2: The `dayWindow` module

**Files:**
- Create: `frontend/src/lib/utils/dayWindow.ts`
- Create: `frontend/src/__tests__/lib/utils/dayWindow.test.ts`

**Interfaces:**
- Consumes: `SeasonWeek` and `Event` from `@/lib/types`; nothing from Task 1.
- Produces, for Tasks 3–5:
  - `type DayKey = string`
  - `dayKeyOf(d: Date): DayKey`
  - `startOfDay(key: DayKey): Date`
  - `dayAfter(key: DayKey): Date` — the next day's midnight, i.e. that day's exclusive upper bound
  - `lastDayCovered(endExclusive: Date): DayKey`
  - `addDays(key: DayKey, n: number): DayKey`
  - `dayKeys(from: DayKey, through: DayKey): DayKey[]`
  - `interface ViewWindow { startDay: DayKey; endDay: DayKey; start: Date; endExclusive: Date }`
  - `windowContains(w: ViewWindow, d: Date): boolean` — `d >= w.start && d < w.endExclusive`
  - `interface NavigableBounds { startDay: DayKey; endDay: DayKey }`
  - `navigableBounds(seasonWeeks: SeasonWeek[], events: Event[]): NavigableBounds`
  - `interface WindowOptions { dateFilter: 'all' | 'today' | 'next' | 'this-week'; seasonWeeks: SeasonWeek[]; currentWeekNumber: number | null; now: Date; adaptiveEndDate?: Date; bounds: NavigableBounds; expandedStartDay?: DayKey | null; expandedEndDay?: DayKey | null }`
  - `baseWindow(o: WindowOptions): ViewWindow | null`
  - `viewWindow(o: WindowOptions): ViewWindow | null`

`null` means "this scope matches nothing right now" and is reachable only for `'this-week'` outside the season.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/__tests__/lib/utils/dayWindow.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  dayKeyOf,
  startOfDay,
  dayAfter,
  lastDayCovered,
  addDays,
  dayKeys,
  navigableBounds,
  baseWindow,
  viewWindow,
} from '@/lib/utils/dayWindow';
import { getChautauquaSeasonWeeks, getCurrentWeekNumber } from '@/lib/utils/dateHelpers';
import type { Event } from '@/lib/types';

const seasonWeeks = getChautauquaSeasonWeeks(2026);

function makeEvent(id: string, date: Date): Event {
  return { id, title: id, startDate: date.toISOString() } as Event;
}

describe('day key arithmetic', () => {
  it('formats a date as a zero-padded local day key', () => {
    expect(dayKeyOf(new Date(2026, 6, 5, 23, 30))).toBe('2026-07-05');
    expect(dayKeyOf(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });

  it('sorts lexicographically in chronological order', () => {
    const keys = ['2026-12-31', '2026-07-05', '2026-07-15'];
    expect([...keys].sort()).toEqual(['2026-07-05', '2026-07-15', '2026-12-31']);
  });

  it('adds and subtracts days across month and year boundaries', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-08-01', -1)).toBe('2026-07-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-07-15', 0)).toBe('2026-07-15');
  });

  it('crosses a DST transition without drifting', () => {
    // US DST ends 2026-11-01. A naive +86400000ms lands on 2026-10-31
    // 23:00, whose day key is the day it started from.
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    // DST begins 2026-03-08.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
  });

  it('produces inclusive contiguous ranges', () => {
    expect(dayKeys('2026-07-14', '2026-07-16')).toEqual([
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
    ]);
    expect(dayKeys('2026-07-14', '2026-07-14')).toEqual(['2026-07-14']);
  });

  it('returns an empty range when the bounds are inverted', () => {
    expect(dayKeys('2026-07-16', '2026-07-14')).toEqual([]);
  });

  it('bounds a day at local midnight and one ms before the next', () => {
    expect(startOfDay('2026-07-15').getTime()).toBe(new Date(2026, 6, 15, 0, 0, 0, 0).getTime());
    expect(dayAfter('2026-07-15').getTime()).toBe(new Date(2026, 6, 16, 0, 0, 0, 0).getTime());
  });

  it('names the last day shown, stepping back only on an exact midnight', () => {
    // A window ending at midnight does not show that day; one ending mid-day
    // does. `this-week` ends at noon Saturday and that Saturday has events.
    expect(lastDayCovered(new Date(2026, 6, 16, 0, 0, 0, 0))).toBe('2026-07-15');
    expect(lastDayCovered(new Date(2026, 6, 18, 12, 0, 0, 0))).toBe('2026-07-18');
  });
});

describe('navigableBounds', () => {
  it('spans the season when every event is inside it', () => {
    const events = [makeEvent('mid', new Date(2026, 6, 15, 9, 0))];
    const bounds = navigableBounds(seasonWeeks, events);
    expect(bounds.startDay).toBe(dayKeyOf(seasonWeeks[0].start));
    expect(bounds.endDay).toBe(dayKeyOf(seasonWeeks[8].end));
  });

  it('widens to contain events outside the season', () => {
    const events = [
      makeEvent('early', new Date(2026, 4, 1, 9, 0)),
      makeEvent('late', new Date(2026, 9, 1, 9, 0)),
    ];
    const bounds = navigableBounds(seasonWeeks, events);
    expect(bounds.startDay).toBe('2026-05-01');
    expect(bounds.endDay).toBe('2026-10-01');
  });

  it('falls back to the season alone when there are no events', () => {
    const bounds = navigableBounds(seasonWeeks, []);
    expect(bounds.startDay).toBe(dayKeyOf(seasonWeeks[0].start));
    expect(bounds.endDay).toBe(dayKeyOf(seasonWeeks[8].end));
  });
});

describe('baseWindow', () => {
  const NOW = new Date(2026, 6, 15, 15, 0, 0, 0);
  const bounds = navigableBounds(seasonWeeks, []);
  const currentWeekNumber = (() => {
    // getCurrentWeekNumber reads the real clock, so derive it from NOW
    // directly rather than faking timers in a pure-module test.
    const w = seasonWeeks.find((week) => NOW >= week.start && NOW <= week.end);
    return w ? w.number : null;
  })();

  it("'today' spans exactly the current calendar day", () => {
    const w = baseWindow({
      dateFilter: 'today', seasonWeeks, currentWeekNumber, now: NOW, bounds,
    })!;
    expect(w.startDay).toBe('2026-07-15');
    expect(w.endDay).toBe('2026-07-15');
    expect(w.start.getTime()).toBe(new Date(2026, 6, 15, 0, 0, 0, 0).getTime());
    expect(w.endExclusive.getTime()).toBe(new Date(2026, 6, 16, 0, 0, 0, 0).getTime());
  });

  it("'next' starts one hour before now, not at midnight", () => {
    const adaptiveEndDate = new Date(2026, 6, 17, 23, 59, 59, 999);
    const w = baseWindow({
      dateFilter: 'next', seasonWeeks, currentWeekNumber, now: NOW, adaptiveEndDate, bounds,
    })!;
    expect(w.start.getTime()).toBe(new Date(2026, 6, 15, 14, 0, 0, 0).getTime());
    // adaptiveEndDate is an inclusive 23:59:59.999; the half-open bound is
    // the following midnight. No representable event falls in the gap.
    expect(w.endExclusive.getTime()).toBe(new Date(2026, 6, 18, 0, 0, 0, 0).getTime());
    expect(w.startDay).toBe('2026-07-15');
    expect(w.endDay).toBe('2026-07-17');
  });

  it("'next' near midnight puts startDay on the previous calendar day", () => {
    // 00:30 minus one hour is 23:30 yesterday. The navigation-facing
    // startDay has to follow the actual bound, not "today".
    const nearMidnight = new Date(2026, 6, 15, 0, 30, 0, 0);
    const w = baseWindow({
      dateFilter: 'next',
      seasonWeeks,
      currentWeekNumber,
      now: nearMidnight,
      adaptiveEndDate: new Date(2026, 6, 17, 23, 59, 59, 999),
      bounds,
    })!;
    expect(w.startDay).toBe('2026-07-14');
  });

  it("'this-week' carries the week's own exclusive noon bound through", () => {
    const week = seasonWeeks[currentWeekNumber! - 1];
    const w = baseWindow({
      dateFilter: 'this-week', seasonWeeks, currentWeekNumber, now: NOW, bounds,
    })!;
    expect(w.start.getTime()).toBe(week.start.getTime());
    expect(w.endExclusive.getTime()).toBe(week.end.getTime());
  });

  it("'this-week' spans both boundary Saturdays", () => {
    const w = baseWindow({
      dateFilter: 'this-week', seasonWeeks, currentWeekNumber, now: NOW, bounds,
    })!;
    expect(dayKeys(w.startDay, w.endDay)).toHaveLength(8);
  });

  it("'this-week' is null outside the season", () => {
    const w = baseWindow({
      dateFilter: 'this-week',
      seasonWeeks,
      currentWeekNumber: null,
      now: new Date(2026, 11, 25, 12, 0),
      bounds,
    });
    expect(w).toBeNull();
  });

  it("'all' bounds no instant, but still reports navigable days", () => {
    const w = baseWindow({
      dateFilter: 'all', seasonWeeks, currentWeekNumber, now: NOW, bounds,
    })!;
    expect(w.start.getTime()).toBeLessThan(new Date(1900, 0, 1).getTime());
    expect(w.endExclusive.getTime()).toBeGreaterThan(new Date(2200, 0, 1).getTime());
    expect(w.startDay).toBe(bounds.startDay);
    expect(w.endDay).toBe(bounds.endDay);
  });
});

describe('viewWindow expansion', () => {
  const NOW = new Date(2026, 6, 15, 15, 0, 0, 0);
  const bounds = navigableBounds(seasonWeeks, []);
  const currentWeekNumber =
    seasonWeeks.find((w) => NOW >= w.start && NOW <= w.end)?.number ?? null;

  const todayOpts = {
    dateFilter: 'today' as const, seasonWeeks, currentWeekNumber, now: NOW, bounds,
  };

  it('is the base window when nothing is expanded', () => {
    const w = viewWindow(todayOpts)!;
    expect(w.startDay).toBe('2026-07-15');
    expect(w.endDay).toBe('2026-07-15');
  });

  it('extends the end and uses a full day for the added region', () => {
    const w = viewWindow({ ...todayOpts, expandedEndDay: '2026-07-17' })!;
    expect(w.endDay).toBe('2026-07-17');
    expect(w.endExclusive.getTime()).toBe(new Date(2026, 6, 18, 0, 0, 0, 0).getTime());
    // The start is untouched, so it keeps the base window's exact instant.
    expect(w.start.getTime()).toBe(new Date(2026, 6, 15, 0, 0, 0, 0).getTime());
  });

  it('extends the start backwards', () => {
    const w = viewWindow({ ...todayOpts, expandedStartDay: '2026-07-13' })!;
    expect(w.startDay).toBe('2026-07-13');
    expect(w.start.getTime()).toBe(new Date(2026, 6, 13, 0, 0, 0, 0).getTime());
  });

  it('drops the intra-day start instant once expanded earlier', () => {
    // 'next' starts at now-1h. Once the user reaches back past that day,
    // they want the whole earlier day, not a window that still begins at
    // 14:00 on a day they have scrolled away from.
    const w = viewWindow({
      dateFilter: 'next',
      seasonWeeks,
      currentWeekNumber,
      now: NOW,
      adaptiveEndDate: new Date(2026, 6, 17, 23, 59, 59, 999),
      bounds,
      expandedStartDay: '2026-07-13',
    })!;
    expect(w.start.getTime()).toBe(new Date(2026, 6, 13, 0, 0, 0, 0).getTime());
  });

  it('ignores an expansion that would narrow the base window', () => {
    const w = viewWindow({ ...todayOpts, expandedEndDay: '2026-07-10' })!;
    expect(w.endDay).toBe('2026-07-15');
  });

  it('clamps expansion to the navigable bounds', () => {
    const w = viewWindow({ ...todayOpts, expandedEndDay: '2030-01-01' })!;
    expect(w.endDay).toBe(bounds.endDay);
  });

  it('stays null when the base window is null', () => {
    const w = viewWindow({
      dateFilter: 'this-week',
      seasonWeeks,
      currentWeekNumber: null,
      now: new Date(2026, 11, 25, 12, 0),
      bounds,
      expandedEndDay: '2026-12-31',
    });
    expect(w).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/dayWindow.test.ts`

Expected: FAIL — `Failed to resolve import "@/lib/utils/dayWindow"`.

- [ ] **Step 3: Write the module**

Create `frontend/src/lib/utils/dayWindow.ts`:

```typescript
import type { Event, SeasonWeek } from '@/lib/types';

/**
 * A calendar day as `yyyy-mm-dd`, zero-padded, in local time.
 *
 * Lexicographic order is chronological, which is what makes plain string
 * comparison a correct date comparison throughout this module. Matches
 * iOS's `ChqTime.dayKey` byte for byte, so the two platforms describe the
 * same day the same way.
 */
export type DayKey = string;

/** The widest instants a `Date` can hold — used by the unbounded scope. */
const MIN_INSTANT = new Date(-8640000000000000);
const MAX_INSTANT = new Date(8640000000000000);

export function dayKeyOf(d: Date): DayKey {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function partsOf(key: DayKey): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number);
  return [y, m, d];
}

export function startOfDay(key: DayKey): Date {
  const [y, m, d] = partsOf(key);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/**
 * The exclusive upper bound of `key` — the next day's midnight.
 *
 * Deliberately not "23:59:59.999": that is an inclusive bound whose
 * correctness depends on `Date` being integer milliseconds. It is here, and
 * it is not on iOS, where `Date` wraps a `Double`. A half-open bound needs
 * no such assumption and tiles exactly with the next day's window.
 */
export function dayAfter(key: DayKey): Date {
  const [y, m, d] = partsOf(key);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + 1);
  return date;
}

/**
 * The last day a window actually shows, given its exclusive upper bound.
 *
 * One rule for two cases that look unrelated at the call site: a window
 * ending at midnight does not show that day (`'today'`, `'next'`), while one
 * ending mid-day does (`'this-week'` ends at noon Saturday, and that
 * Saturday morning has events).
 */
export function lastDayCovered(endExclusive: Date): DayKey {
  const isMidnight =
    endExclusive.getHours() === 0 && endExclusive.getMinutes() === 0 &&
    endExclusive.getSeconds() === 0 && endExclusive.getMilliseconds() === 0;
  const key = dayKeyOf(endExclusive);
  return isMidnight ? addDays(key, -1) : key;
}

/**
 * `key` shifted by `n` calendar days.
 *
 * Built from date parts and `setDate`, never from millisecond arithmetic:
 * adding 86,400,000 ms across a DST transition lands on the previous or
 * next day's 23:00/01:00 and produces the wrong key. Mirrors iOS's
 * `ChqTime.day(_:offsetBy:)`, which uses `Calendar` for the same reason.
 */
export function addDays(key: DayKey, n: number): DayKey {
  const [y, m, d] = partsOf(key);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + n);
  return dayKeyOf(date);
}

/** Every day from `from` through `through`, inclusive. Empty if inverted. */
export function dayKeys(from: DayKey, through: DayKey): DayKey[] {
  const out: DayKey[] = [];
  let cursor = from;
  while (cursor <= through) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/**
 * The instants the list is filtered to, plus the days that range covers.
 *
 * **Half-open**: `start <= x < endExclusive`. Never inclusive with a
 * subtracted epsilon — `end - 1` is exact here because `Date` is integer
 * milliseconds, but it is not on iOS where `Date` wraps a `Double`, and the
 * same written rule meaning two different things per platform is the drift
 * this shared model exists to prevent.
 *
 * Half-open is also what the existing code already used, so most scopes need
 * no conversion: the week filter is `>= week.start && < week.end`, and
 * `localDateKey` equality is exactly `[startOfDay(d), startOfDay(d+1))`.
 * Those bounds are carried through verbatim below.
 *
 * `startDay`/`endDay` are the navigation-facing projection: what a day rail
 * or a step control moves through. They are derived from `start`/`end`, not
 * the other way round, so they can never disagree with what is filtered.
 */
export interface ViewWindow {
  startDay: DayKey;
  endDay: DayKey;
  start: Date;
  endExclusive: Date;
}

/** `d >= w.start && d < w.endExclusive`. */
export function windowContains(w: ViewWindow, d: Date): boolean {
  return d >= w.start && d < w.endExclusive;
}

/** The outer limit of everything navigation can reach. */
export interface NavigableBounds {
  startDay: DayKey;
  endDay: DayKey;
}

/**
 * The season, widened to contain every day that has an event.
 *
 * The widening is not cosmetic: without it a pre- or post-season event
 * would be permanently unreachable by stepping. Mirrors iOS's
 * `DayWindow.bounds(year:starredDays:)`, which widens by starred days for
 * the same reason.
 */
export function navigableBounds(
  seasonWeeks: SeasonWeek[],
  events: Event[]
): NavigableBounds {
  let startDay = dayKeyOf(seasonWeeks[0].start);
  let endDay = dayKeyOf(seasonWeeks[seasonWeeks.length - 1].end);

  for (const event of events) {
    const key = dayKeyOf(new Date(event.startDate));
    if (key < startDay) startDay = key;
    if (key > endDay) endDay = key;
  }

  return { startDay, endDay };
}

export interface WindowOptions {
  dateFilter: 'all' | 'today' | 'next' | 'this-week';
  seasonWeeks: SeasonWeek[];
  currentWeekNumber: number | null;
  now: Date;
  adaptiveEndDate?: Date;
  bounds: NavigableBounds;
  expandedStartDay?: DayKey | null;
  expandedEndDay?: DayKey | null;
}

/**
 * The window a scope defines before any expansion.
 *
 * `null` means "this scope matches nothing right now", which is reachable
 * only for `'this-week'` outside the season — the case the old
 * `isThisWeek` handled by returning `false` for every event.
 */
export function baseWindow(o: WindowOptions): ViewWindow | null {
  switch (o.dateFilter) {
    case 'all':
      // No instant bound at all. Deliberately not derived from the event
      // list: a window computed from the events being filtered would be
      // circular, and would behave differently for a caller that passed a
      // subset.
      return {
        startDay: o.bounds.startDay,
        endDay: o.bounds.endDay,
        start: MIN_INSTANT,
        endExclusive: MAX_INSTANT,
      };

    case 'today': {
      const key = dayKeyOf(o.now);
      return { startDay: key, endDay: key, start: startOfDay(key), endExclusive: dayAfter(key) };
    }

    case 'next': {
      // One hour of grace so an event that has just begun is still "next".
      const start = new Date(o.now.getTime() - 60 * 60 * 1000);
      // `adaptiveEndDate` is an inclusive end-of-day; the half-open
      // equivalent is that day's exclusive end. No representable event falls
      // in the difference — event times carry no sub-second component.
      let inclusiveEnd = o.adaptiveEndDate;
      if (!inclusiveEnd) {
        inclusiveEnd = new Date(o.now.getTime() + 6 * 24 * 60 * 60 * 1000);
        inclusiveEnd.setHours(23, 59, 59, 999);
      }
      const endExclusive = dayAfter(dayKeyOf(inclusiveEnd));
      return {
        startDay: dayKeyOf(start),
        endDay: lastDayCovered(endExclusive),
        start,
        endExclusive,
      };
    }

    case 'this-week': {
      if (o.currentWeekNumber === null) return null;
      const week = o.seasonWeeks[o.currentWeekNumber - 1];
      // The week's own bounds, carried through verbatim — `SeasonWeek` is
      // already half-open (`>= start && < end`).
      return {
        startDay: dayKeyOf(week.start),
        endDay: lastDayCovered(week.end),
        start: week.start,
        endExclusive: week.end,
      };
    }
  }
}

/**
 * The base window, widened by however far the user has navigated.
 *
 * Expansion only ever grows the window — an `expanded*` value that would
 * narrow it is ignored, so a stale value can never hide events. The added
 * region uses whole days, while an untouched end keeps the base window's
 * exact instant. That is what preserves `'next'`'s one-hour grace and
 * `'this-week'`'s noon boundaries until the user actually navigates past
 * them.
 */
export function viewWindow(o: WindowOptions): ViewWindow | null {
  const base = baseWindow(o);
  if (!base) return null;

  let startDay = base.startDay;
  let endDay = base.endDay;

  if (o.expandedStartDay && o.expandedStartDay < startDay) startDay = o.expandedStartDay;
  if (o.expandedEndDay && o.expandedEndDay > endDay) endDay = o.expandedEndDay;

  if (startDay < o.bounds.startDay) startDay = o.bounds.startDay;
  if (endDay > o.bounds.endDay) endDay = o.bounds.endDay;

  return {
    startDay,
    endDay,
    start: startDay === base.startDay ? base.start : startOfDay(startDay),
    endExclusive: endDay === base.endDay ? base.endExclusive : dayAfter(endDay),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/dayWindow.test.ts`

Expected: PASS, all tests.

- [ ] **Step 5: Prove the DST guard actually guards**

Temporarily replace the body of `addDays` with millisecond arithmetic:

```typescript
export function addDays(key: DayKey, n: number): DayKey {
  const [y, m, d] = partsOf(key);
  return dayKeyOf(new Date(new Date(y, m - 1, d).getTime() + n * 86400000));
}
```

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/dayWindow.test.ts`
Expected: FAIL on `crosses a DST transition without drifting`.

Restore the correct implementation and confirm the suite is green again. If the naive version *passes*, the test's dates are wrong for the machine's timezone — check `TZ` and pick a transition that applies.

Then run a second mutation, on the bound this design turns on. Change `dayAfter` to return the inclusive form it replaced:

```typescript
export function dayAfter(key: DayKey): Date {
  const [y, m, d] = partsOf(key);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}
```

Expected: FAIL on `bounds a day at local midnight...`, on `names the last day shown...` (an inclusive bound is never exactly midnight, so `lastDayCovered` stops stepping back), and on `'today' spans exactly the current calendar day`. Restore and confirm green.

That second mutation is the one that matters: it is the version a reviewer would wave through as equivalent, and it *is* equivalent on this platform — while being wrong on iOS, where `Date` is a `Double`. If it produces no failures, the tests are not pinning the property the shared model depends on.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/utils/dayWindow.ts frontend/src/__tests__/lib/utils/dayWindow.test.ts
git commit -m "feat(web): add the dayWindow module

Day-key arithmetic plus the ViewWindow derivation that will replace the
four scope-specific date predicates in filterHelpers. Pure and unwired —
nothing imports it yet.

Day keys are yyyy-mm-dd local, matching iOS's ChqTime.dayKey byte for
byte, so lexicographic comparison is chronological comparison and the two
platforms name the same day the same way.

addDays builds from date parts and setDate rather than adding 86,400,000
ms, which lands on the wrong day across a DST transition. Proven by
swapping in the naive version and watching the DST test fail.

The window is half-open, so this-week and the week filter carry their own
bounds through verbatim rather than being converted. Not inclusive with a
subtracted epsilon: end - 1 is exact here because Date is integer
milliseconds, and is not on iOS where Date wraps a Double — the same rule
meaning two different things per platform is the drift the shared model
exists to prevent.

endDay is derived by lastDayCovered, which steps back a day only when the
bound falls exactly on midnight, so today does not claim tomorrow while
this-week, ending at noon Saturday, still claims that Saturday.

Expansion only grows the window, and an untouched end keeps the base
window's exact instant — which is what preserves next's one-hour grace
until the user navigates past it."
```

---

## Task 3: Route the date stage through the window

**Files:**
- Modify: `frontend/src/lib/utils/filterHelpers.ts:1-42`
- Modify: `frontend/src/lib/utils/dateHelpers.ts:52-64` (delete `isToday` and `isThisWeek`)
- Modify: `frontend/src/__tests__/lib/utils/filterHelpers.test.ts` (the `baseOptions` helper only — see Step 1)

**Interfaces:**
- Consumes: `ViewWindow`, `viewWindow`, `navigableBounds` from Task 2.
- Produces: `FilterOptions` loses `dateFilter`, `currentWeekNumber`, and `adaptiveEndDate`; gains `viewWindow: ViewWindow | null`. `seasonWeeks` stays — the weeks stage still needs it. Task 5 supplies the new field from `page.tsx`.

- [ ] **Step 1: Update the characterization test's options builder only**

The characterization tests from Task 1 assert *behavior* and must not change. But `baseOptions` constructs a `FilterOptions`, whose shape is changing. Replace only that helper:

```typescript
import { navigableBounds, viewWindow } from '@/lib/utils/dayWindow';

function baseOptions(overrides: {
  dateFilter?: 'all' | 'today' | 'next' | 'this-week';
  selectedWeeks?: number[];
  seasonWeeks?: typeof seasonWeeks;
  currentWeekNumber?: number | null;
  adaptiveEndDate?: Date;
  searchTerm?: string;
}): FilterOptions {
  const weeks = overrides.seasonWeeks ?? seasonWeeks;
  const currentWeekNumber =
    overrides.currentWeekNumber !== undefined
      ? overrides.currentWeekNumber
      : getCurrentWeekNumber(weeks);
  return {
    searchTerm: overrides.searchTerm ?? '',
    selectedWeeks: overrides.selectedWeeks ?? [],
    selectedTagsLowerSet: new Set<string>(),
    selectedLocationsLowerSet: new Set<string>(),
    seasonWeeks: weeks,
    viewWindow: viewWindow({
      dateFilter: overrides.dateFilter ?? 'all',
      seasonWeeks: weeks,
      currentWeekNumber,
      now: new Date(),
      adaptiveEndDate: overrides.adaptiveEndDate,
      bounds: navigableBounds(weeks, []),
    }),
  };
}
```

**Every `it(...)` body stays byte-identical.** If an assertion needs touching, stop: the refactor changed behavior.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/filterHelpers.test.ts`

Expected: FAIL — TypeScript rejects `viewWindow` as an unknown property on `FilterOptions`, and the date assertions fail because `filterEvents` still reads `options.dateFilter`.

- [ ] **Step 3: Rewrite the date stage**

In `frontend/src/lib/utils/filterHelpers.ts`, replace the imports and the whole date-filter block (`:1-42`) with:

```typescript
import type { Event, SeasonWeek } from '@/lib/types';
import { isInChautauquaWeek } from './dateHelpers';
import { windowContains, type ViewWindow } from './dayWindow';
import { searchEvents } from './searchHelpers';

export interface FilterOptions {
  searchTerm: string;
  selectedWeeks: number[];
  selectedTagsLowerSet: Set<string>;
  selectedLocationsLowerSet: Set<string>;
  seasonWeeks: SeasonWeek[];
  /**
   * The instant range the list is narrowed to, derived by `dayWindow`.
   * `null` means the current scope matches nothing — reachable only for
   * `'this-week'` outside the season.
   */
  viewWindow: ViewWindow | null;
  showFavoritesOnly?: boolean;
  favoriteIds?: Set<string>;
}

export function filterEvents(events: Event[], options: FilterOptions): Event[] {
  // A null window means the scope matches nothing. Returning early also
  // keeps the weeks/venue/category stages from running over a set that is
  // already empty.
  if (options.viewWindow === null) return [];

  let filtered = [...events];

  if (options.searchTerm) {
    filtered = searchEvents(filtered, options.searchTerm);
  }

  // The date stage. One half-open range check for every scope — the four
  // scope-specific predicates this replaced (isToday, isThisWeek, the
  // inline 'next' arithmetic, and 'all' doing nothing) all reduce to this
  // once the scope has been turned into a window.
  const window = options.viewWindow;
  filtered = filtered.filter((event) => windowContains(window, new Date(event.startDate)));
```

Everything from the `// Week filter (independent of date filter)` comment onward is **unchanged**.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/lib/utils/filterHelpers.test.ts src/__tests__/lib/utils/dayWindow.test.ts`

Expected: PASS. Every characterization assertion from Task 1 is green against the new implementation — that is the whole point of this task.

- [ ] **Step 5: Delete the now-dead predicates**

`isToday` and `isThisWeek` had exactly one caller each, both just removed. Delete both from `frontend/src/lib/utils/dateHelpers.ts` (lines 52–64, the two exported functions and the blank line between them). Leave `isInChautauquaWeek`, `isWeekInPast`, `getWeekNumberForDate`, `getCurrentWeekNumber`, and `getAdaptiveEndDate` alone.

Confirm nothing else referenced them:

```bash
grep -rn "isToday\|isThisWeek" frontend/src --include="*.ts" --include="*.tsx"
```

Expected: no output.

- [ ] **Step 6: Verify the whole suite**

Run: `cd frontend && npm run type-check && npx vitest run`

Expected: type-check clean. Tests: `page.tsx` still passes the old `FilterOptions` shape, so **`src/app/page.tsx` will fail type-check here**. That is expected and is fixed in Task 5 — but it means this task cannot be committed on its own without a broken build.

**Therefore: do not commit yet.** Continue straight to Task 4 and Task 5, and commit once at the end of Task 5. Tasks 3–5 are one atomic change to a live call chain; splitting the commit would put a red build on the branch.

---

## Task 4: Replace `extraDays` with window bounds in `useFilterState`

**Files:**
- Modify: `frontend/src/hooks/useFilterState.ts`
- Create: `frontend/src/__tests__/hooks/useFilterState.window.test.ts`

**Interfaces:**
- Consumes: `DayKey`, `addDays` from Task 2.
- Produces, for Task 5: the hook returns `windowStartDay: DayKey | null`, `windowEndDay: DayKey | null`, `expandWindowStart(day: DayKey): void`, `expandWindowEnd(day: DayKey): void`, `resetWindow(): void`. It no longer returns `extraDays` or `addExtraDay`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/__tests__/hooks/useFilterState.window.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useFilterState } from '@/hooks/useFilterState';

beforeEach(() => {
  localStorage.clear();
});

describe('useFilterState window bounds', () => {
  it('starts with no expansion', () => {
    const { result } = renderHook(() => useFilterState());
    expect(result.current.windowStartDay).toBeNull();
    expect(result.current.windowEndDay).toBeNull();
  });

  it('records an expanded end', () => {
    const { result } = renderHook(() => useFilterState());
    act(() => result.current.expandWindowEnd('2026-07-17'));
    expect(result.current.windowEndDay).toBe('2026-07-17');
  });

  it('records an expanded start', () => {
    const { result } = renderHook(() => useFilterState());
    act(() => result.current.expandWindowStart('2026-07-13'));
    expect(result.current.windowStartDay).toBe('2026-07-13');
  });

  it('clears both bounds when the date filter changes', () => {
    // Replaces the old "reset extraDays on dateFilter change" effect.
    // Without this, widening the window twice, switching scope, and
    // switching back returns a window wider than a fresh selection with
    // nothing on screen explaining why (#156 on iOS, same shape here).
    const { result } = renderHook(() => useFilterState());
    act(() => result.current.expandWindowEnd('2026-07-17'));
    act(() => result.current.setDateFilter('today'));
    expect(result.current.windowEndDay).toBeNull();
    expect(result.current.windowStartDay).toBeNull();
  });

  it('clears both bounds on resetWindow', () => {
    const { result } = renderHook(() => useFilterState());
    act(() => result.current.expandWindowEnd('2026-07-17'));
    act(() => result.current.expandWindowStart('2026-07-13'));
    act(() => result.current.resetWindow());
    expect(result.current.windowEndDay).toBeNull();
    expect(result.current.windowStartDay).toBeNull();
  });

  it('clears both bounds on clearFilters', () => {
    const { result } = renderHook(() => useFilterState());
    act(() => result.current.expandWindowEnd('2026-07-17'));
    act(() => result.current.clearFilters());
    expect(result.current.windowEndDay).toBeNull();
  });

  it('clears both bounds on reconcileFilters', () => {
    // Year switching. A day key from 2026 means nothing in 2025.
    const { result } = renderHook(() => useFilterState());
    act(() => result.current.expandWindowEnd('2026-07-17'));
    act(() => result.current.reconcileFilters([], [], false));
    expect(result.current.windowEndDay).toBeNull();
  });

  it('never persists the window to localStorage', () => {
    // Session-only, matching iOS's selectedDayKey and extraDays. A date
    // pinned days ago and silently restored on launch would be worse than
    // no restore at all.
    const { result } = renderHook(() => useFilterState());
    act(() => result.current.expandWindowEnd('2026-07-17'));
    const saved = JSON.parse(localStorage.getItem('chq-calendar-user-state')!);
    expect(saved).not.toHaveProperty('windowEndDay');
    expect(saved).not.toHaveProperty('windowStartDay');
    expect(saved).not.toHaveProperty('extraDays');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/__tests__/hooks/useFilterState.window.test.ts`

Expected: FAIL — `windowStartDay` is undefined and `expandWindowEnd` is not a function.

- [ ] **Step 3: Change the state shape**

In `frontend/src/hooks/useFilterState.ts`:

1. In `interface FilterState`, replace `extraDays: number;` with:

```typescript
  /**
   * How far the user has navigated beyond the current scope's own window,
   * as day keys. `null` means "not expanded in that direction".
   *
   * Session-only: deliberately absent from the localStorage payload below,
   * matching iOS's `selectedDayKey` and the `extraDays` this replaced. A
   * date pinned days ago and silently restored on launch would be worse
   * than no restore.
   */
  windowStartDay: string | null;
  windowEndDay: string | null;
```

2. In `type FilterAction`, replace the `ADD_EXTRA_DAY` and `CLEAR_EXTRA_DAYS` members with:

```typescript
  | { type: 'EXPAND_WINDOW_START'; payload: string }
  | { type: 'EXPAND_WINDOW_END'; payload: string }
  | { type: 'RESET_WINDOW' }
```

3. In `filterReducer`, replace the `ADD_EXTRA_DAY` / `CLEAR_EXTRA_DAYS` cases with:

```typescript
    case 'EXPAND_WINDOW_START':
      return { ...state, windowStartDay: action.payload };
    case 'EXPAND_WINDOW_END':
      return { ...state, windowEndDay: action.payload };
    case 'RESET_WINDOW':
      return { ...state, windowStartDay: null, windowEndDay: null };
```

4. Change the `SET_DATE_FILTER` case to reset the window in the same action:

```typescript
    case 'SET_DATE_FILTER':
      // Resetting here rather than in an effect keyed on dateFilter: the
      // effect this replaces ran a second render pass to undo state the
      // first pass had already applied, and left a frame in which the
      // window belonged to the previous scope.
      return { ...state, dateFilter: action.payload, windowStartDay: null, windowEndDay: null };
```

5. In `RECONCILE_FILTERS` and `CLEAR_FILTERS`, replace `extraDays: 0` with `windowStartDay: null, windowEndDay: null`.

6. In `initialState`, replace `extraDays: 0` with `windowStartDay: null, windowEndDay: null`.

7. **Delete the `useEffect` that resets extra days** (currently `useFilterState.ts:207-213`, the one commented "Reset extra days when date filter changes"). Step 4 above moved its job into the reducer.

8. Replace the `addExtraDay` callback with:

```typescript
  const expandWindowStart = useCallback((day: string) => dispatch({ type: 'EXPAND_WINDOW_START', payload: day }), []);
  const expandWindowEnd = useCallback((day: string) => dispatch({ type: 'EXPAND_WINDOW_END', payload: day }), []);
  const resetWindow = useCallback(() => dispatch({ type: 'RESET_WINDOW' }), []);
```

9. In the returned object, replace `extraDays: state.extraDays, addExtraDay,` with:

```typescript
    windowStartDay: state.windowStartDay, windowEndDay: state.windowEndDay,
    expandWindowStart, expandWindowEnd, resetWindow,
```

10. **Leave the `localStorage` payload untouched.** It never listed `extraDays` and must not list the new fields.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/hooks/useFilterState.window.test.ts`

Expected: PASS, 8 tests.

- [ ] **Step 5: Translate the one pre-existing test that names the deleted API**

`frontend/src/__tests__/hooks/useFilterState.test.ts:196` calls `addExtraDay()` and asserts `extraDays === 0`. It is the **only** pre-existing reference to the deleted API anywhere in `frontend/src` — confirm that before editing:

```bash
grep -rn "extraDays\|addExtraDay" frontend/src --include="*.test.ts" --include="*.test.tsx"
```

Expected: only `useFilterState.test.ts` lines 196–204.

The behavior it pins — a year switch clears the widening — must survive. Translate rather than delete, keeping the two-step widening so the test still proves the reset does something:

```typescript
    it('clears the date window on reconciliation', () => {
      const { result } = renderHook(() => useFilterState());
      act(() => { result.current.expandWindowEnd('2026-07-16'); });
      act(() => { result.current.expandWindowStart('2026-07-13'); });

      act(() => {
        result.current.reconcileFilters([], [], true);
      });
      expect(result.current.windowEndDay).toBeNull();
      expect(result.current.windowStartDay).toBeNull();
    });
```

- [ ] **Step 6: Run the full pre-existing hook suite**

Run: `cd frontend && npx vitest run src/__tests__/hooks/`

Expected: PASS. Every other test in `useFilterState.test.ts` is untouched and green.

---

## Task 5: Wire the window through `page.tsx`

**Files:**
- Modify: `frontend/src/app/page.tsx:76-104`

**Interfaces:**
- Consumes: everything produced by Tasks 2–4.
- Produces: nothing. This closes the change.

- [ ] **Step 1: Derive the bounds and the window**

In `frontend/src/app/page.tsx`, add to the imports:

```typescript
import { navigableBounds, viewWindow, addDays } from '@/lib/utils/dayWindow';
```

Replace the `adaptiveEndDate` memo (`:76-91`) and the `filterOpts` memo (`:92-99`) with:

```typescript
  const adaptiveEndDate = useMemo(() => {
    if (filters.dateFilter !== 'next' || !events.length) return undefined;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return getAdaptiveEndDate(events, oneHourAgo, 50);
  }, [filters.dateFilter, events]);

  // The outer limit of everything navigation can reach: the season, widened
  // to contain any event outside it.
  const navBounds = useMemo(
    () => navigableBounds(seasonWeeks, events),
    [seasonWeeks, events]
  );

  // The single date filter. Every scope reduces to this range, and so does
  // however far the user has navigated past the scope's own edge.
  const dateWindow = useMemo(
    () =>
      viewWindow({
        dateFilter: filters.dateFilter,
        seasonWeeks,
        currentWeekNumber,
        now: new Date(),
        adaptiveEndDate,
        bounds: navBounds,
        expandedStartDay: filters.windowStartDay,
        expandedEndDay: filters.windowEndDay,
      }),
    [
      filters.dateFilter, seasonWeeks, currentWeekNumber, adaptiveEndDate,
      navBounds, filters.windowStartDay, filters.windowEndDay,
    ]
  );

  const filterOpts: FilterOptions = useMemo(() => ({
    searchTerm: debouncedSearch,
    selectedWeeks: filters.selectedWeeks,
    selectedTagsLowerSet: filters.selectedTagsLowerSet,
    selectedLocationsLowerSet: filters.selectedLocationsLowerSet,
    seasonWeeks,
    viewWindow: dateWindow,
    showFavoritesOnly: filters.showFavoritesOnly,
    favoriteIds: favorites.favoriteIds,
  }), [
    debouncedSearch, filters.selectedWeeks, filters.selectedTagsLowerSet,
    filters.selectedLocationsLowerSet, seasonWeeks, dateWindow,
    filters.showFavoritesOnly, favorites.favoriteIds,
  ]);
```

**Note the deliberate change to `adaptiveEndDate`:** it no longer applies `extraDays`. Extending past the adaptive end is now the window's job, via `expandedEndDay`. The memo also drops its `filters.extraDays` dependency.

- [ ] **Step 2: Rewire `hasMoreDays` and the next-day handler**

Replace the `hasMoreDays` memo (`:102-105`) with:

```typescript
  const hasMoreDays = useMemo(() => {
    if (filters.dateFilter !== 'next' || !dateWindow || !events.length) return false;
    return events.some(e => new Date(e.startDate) >= dateWindow.endExclusive);
  }, [filters.dateFilter, dateWindow, events]);

  // "Show next day" widens the window by one calendar day from wherever it
  // currently ends — which is the same operation whether the end came from
  // the scope or from a previous widening.
  const showNextDay = useCallback(() => {
    if (!dateWindow) return;
    filters.expandWindowEnd(addDays(dateWindow.endDay, 1));
  }, [dateWindow, filters.expandWindowEnd]);
```

Add `useCallback` to the `preact/hooks`-shaped import at the top of the file if it is not already imported.

Then find where `<EventList>` is rendered and change `onShowNextDay={filters.addExtraDay}` to `onShowNextDay={showNextDay}`. Leave every other `EventList` prop alone — `dateFilter`, `hasMoreDays`, and the rest keep their current names and meanings, so the component itself needs no change at all.

- [ ] **Step 3: Type-check and run the full suite**

Run:

```bash
cd frontend && npm run type-check && npx vitest run
```

Expected: type-check clean, **all 619 pre-existing tests plus the ~24 new ones pass**. Exactly one pre-existing test has been edited by this point — the `extraDays` reconciliation test translated in Task 4 Step 5. No other may be.

If any other pre-existing test fails, the window derivation is wrong. Do not adjust the test — read what it asserts and fix `dayWindow.ts`.

- [ ] **Step 4: Verify no behavior changed, by hand**

Run: `cd frontend && npm run dev`, then open `http://localhost:3000` and confirm:

1. The page loads on **Now** with events listed.
2. Scrolling to the bottom shows **Show next day (<date>)**; the date named matches the day after the last one listed.
3. Clicking it appends exactly one day, and the button re-labels to the following day.
4. Clicking **Today** shows only today's events and the next-day button disappears.
5. Clicking **This Week** shows the current week; **All** shows everything.
6. Reload the page — the widening does **not** come back (session-only).
7. Switch the year selector to 2025 and back; no crash, filters reconcile.

- [ ] **Step 5: Full project verification**

Run:

```bash
cd frontend && npm run build
cd ../backend && npm run validate && npm run build
```

Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/utils/filterHelpers.ts \
        frontend/src/lib/utils/dateHelpers.ts \
        frontend/src/hooks/useFilterState.ts \
        frontend/src/app/page.tsx \
        frontend/src/__tests__/lib/utils/filterHelpers.test.ts \
        frontend/src/__tests__/hooks/useFilterState.window.test.ts \
        frontend/src/__tests__/hooks/useFilterState.test.ts
git commit -m "refactor(web): derive one date window instead of four predicates

filterEvents' date stage was four scope-specific branches — isToday,
isThisWeek, inline 'next' arithmetic, and 'all' doing nothing. All four
reduce to a single half-open range check once the scope is turned into a
ViewWindow, so isToday and isThisWeek are deleted; each had exactly one
caller.

extraDays is replaced by windowStartDay/windowEndDay. It was only ever the
window's end expressed as an offset that meant something under one scope,
which is why it needed an effect to clear it on every scope change. Day
keys make that reset part of SET_DATE_FILTER itself, so the state cannot
outlive the scope it belongs to — the bug class behind #156, closed by
construction rather than by convention. The effect is deleted with it.

Both fields are session-only and never persisted, matching iOS's
selectedDayKey.

No user-visible behavior changes. The characterization tests written
before the refactor pass unmodified. One pre-existing test changed —
'clears extraDays on reconciliation' named the deleted API — and was
translated rather than dropped, so the behavior it pins still has
coverage."
```

---

## Self-review

**Spec coverage.** ViewWindow derivation, `extraDays` deletion, session-only persistence, year-switch clearing, and DST-safe arithmetic all have tasks. Three spec items are deliberately **out of scope for this phase** and are called out in Global Constraints: the `season` scope and the scope/weeks mutual exclusion (both phase 3), and the bidirectional render window (phase 2). The rail, `⟳ Now`, and the chip labels are phases 2–3.

**Type consistency.** `ViewWindow`, `NavigableBounds`, and `WindowOptions` are defined once in Task 2 and used with the same names in Tasks 3–5. `expandWindowEnd(day: DayKey)` is defined in Task 4 and called with that signature in Task 5. `FilterOptions` loses `dateFilter`, `currentWeekNumber`, and `adaptiveEndDate` in Task 3, and Task 5's `filterOpts` omits exactly those three.

**Known sequencing constraint.** Tasks 3, 4 and 5 form one atomic change: Task 3 breaks `page.tsx`'s type-check and Task 5 repairs it. They share a single commit at the end of Task 5. Tasks 1 and 2 commit independently. A reviewer can still reject Task 1 or Task 2 alone; Tasks 3–5 are reviewed together because they cannot compile apart.
