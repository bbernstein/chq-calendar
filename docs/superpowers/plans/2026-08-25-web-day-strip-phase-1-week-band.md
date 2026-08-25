# Web day strip, phase 1 — the week band Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a week band above the day rail's chips on the web, so the reader
can see where each week starts and ends and can jump to a week by tapping it —
purely additive, deleting nothing.

**Architecture:** A new pure module `frontend/src/lib/utils/weekBands.ts`,
transcribed from `ios/ChqCalendarShared/Domain/WeekBands.swift`, decides *which*
week spans the band covers and where a tap lands. A new presentational
component `WeekBandCell` draws one day's slice. `DayRail` wraps each chip in a
column whose first child is that slice, so band-to-chip alignment is structural
rather than two layouts agreeing. `page.tsx` supplies the segments and the
reachability map and turns a band tap into the existing `goToDay`.

**Tech Stack:** Vite 7 + Preact 10 + TypeScript 5 + Tailwind CSS 4, Vitest for
unit tests, Playwright (`frontend/e2e/*.mjs`) for browser verification.

**Spec:** `docs/superpowers/specs/2026-08-25-web-day-strip-date-navigation-design.md`
(read "Phase 1 — the week band", plus "Testing" and "Falsification")

**Issue:** #274. Branch: `feat/274-day-strip-date-navigation` (already checked
out; never commit to `main`).

## Global Constraints

- **Nothing is deleted in this phase.** `DateFilter`, `WeekSelector`, the rail's
  `filtersToggle`, `dateFilter`/`selectedWeeks` all stay exactly as they are.
  They go in phases 3 and 4.
- **The band renders inside `DayRail`'s own root** — the element `rootRef`
  lands on. `useDayRailHeight` measures only that root and publishes
  `--day-rail-h`; chrome added in a sibling widens the stuck header without
  widening the variable, undercounting the clearance `dayHeaderTop()` and
  `useDayAnchor` compute against it.
- **One segment per day chip.** The band aligns with the chips by construction
  (same flex column lays out both), never by two layouts agreeing. A single
  pixel of drift shows as a seam through a week boundary.
- **Day-granular week membership**, matching the `Wk 5/6` day-header badge and
  #257: a Chautauqua week turns over at Saturday *noon*, but a boundary
  Saturday belongs to **both** its weeks for the band's purposes.
- **Only the painted fill and the `WEEK n` label may leave a segment's box.**
  The segment's own box, its tap target and its accessibility element stay
  exactly one chip wide. A label that widened its column would pull the band
  out of line with the chips it labels.
- **Labelled by destination, never by direction.** `"Go to Week 6, opens
  Saturday, June 27, 84 events"`. An unreachable week is stated as a fact —
  `"Week 6, no events"` — never offered.
- **Accessibility exposure:** exactly one real `<button>` per week (the
  labelled segment). Every other segment is an `aria-hidden` `<div>` carrying
  the pointer handler and containing nothing focusable. axe's
  `aria-hidden-focus` is proven clean in the browser pass, not assumed.
- **Verification before every commit:** `cd frontend && npm run build` (runs
  `validate` + the unit suite + `vite build`). The backend is untouched.
- **Coverage floor** is enforced by `.coverage-floor.json` (`docs/coverage.md`).
  Every new module ships with its tests in the same commit.
- **Falsification:** every new guard is proven by breaking the code first. For a
  **browser** check, build with `npx vite build` and grep `out/` to confirm the
  injection landed — `npm run build` gates the bundle on the unit suite, so a
  defect that fails a unit test silently serves the *previous* bundle and the
  browser check passes for the wrong reason.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `frontend/src/lib/utils/weekBands.ts` | Pure: segmentation, ramp steps, tap targets, reachability map, spoken labels, `bridgesGutter`. No DOM, no colour, no pixels. |
| `frontend/src/lib/utils/railMetrics.ts` | The rail's shared horizontal metrics. One place for the chip gutter; the band's bleed and seam are *derived* from it. |
| `frontend/src/lib/utils/railBandPalette.ts` | The ramp endpoints per theme, the mix, and the fade. The single source the CSS tokens are checked against. |
| `frontend/src/components/calendar/WeekBandCell.tsx` | One day's slice of the band: the painted run, the `WEEK n` label, the accessible button or the decorative hit area. |
| `frontend/src/__tests__/lib/utils/weekBands.test.ts` | Transcribed from `ios/ChqCalendarTests/WeekBandsTests.swift`. |
| `frontend/src/__tests__/lib/utils/weekBandContrast.test.ts` | Transcribed from `ios/ChqCalendarTests/WeekBandContrastTests.swift`. |
| `frontend/src/__tests__/lib/utils/railMetrics.test.ts` | The derived-not-duplicated guard, and the CSS token agreement. |
| `frontend/src/__tests__/components/calendar/WeekBandCell.test.tsx` | The cell's structure, a11y shape and fill rules. |

**Modified**

| File | Change |
|---|---|
| `frontend/src/lib/utils/dayWindow.ts` | Extract `spokenDayTitle(key)` from `dayChips` and export it, so the band names a day the same way a chip does. |
| `frontend/src/components/calendar/DayRail.tsx` | Chips wrap in columns; the band is each column's first child; the pill re-bases below the band; the clipped copy grows the same column with a band-height spacer; the keyboard walk gains the band row. |
| `frontend/src/hooks/useRailHighlight.ts` | Export `RAIL_CHIP_SELECTOR` and use it in `measureChips` (chips are no longer direct children of the content element). |
| `frontend/src/app/globals.css` | `--rail-band-h`, `--rail-band-start`, `--rail-band-end`, with a dark-mode override, inside a marker-delimited block. |
| `frontend/src/app/page.tsx` | Hoist `railDayKeys`; memoize `weekBandSegments` and `weekBandDestinations`; pass them plus `onSelectWeek` to `DayRail`. |
| `frontend/src/__tests__/hooks/useRailHighlight.test.tsx` | The harness mirrors `DayRail`'s column structure, or `RAIL_CHIP_SELECTOR` matches nothing and every highlight test silently stops testing the highlight. |
| `frontend/e2e/verify-rail.mjs` | Band checks, the axe pass, and the 44px carve-out. |
| `frontend/package.json` | `axe-core` devDependency for the browser a11y check. |

---

## Task 1: `weekBands.ts` — segmentation

**Files:**
- Create: `frontend/src/lib/utils/weekBands.ts`
- Create: `frontend/src/__tests__/lib/utils/weekBands.test.ts`

**Interfaces:**
- Consumes: `SeasonWeek` from `@/lib/types`; `DayKey`, `dayKeyOf`, `dayKeys`,
  `startOfDay` from `@/lib/utils/dayWindow`; `getChautauquaSeasonWeeks`,
  `weekNumbersForCalendarDate` from `@/lib/utils/dateHelpers` (tests only).
- Produces:
  - `interface WeekDayKeySpan { number: number; opening: DayKey; closing: DayKey }`
  - `function weekDayKeySpans(seasonWeeks: SeasonWeek[]): WeekDayKeySpan[]`
  - `interface WeekBandSegment { dayKey: DayKey; weekNumbers: number[]; rampSteps: number[]; navigationTarget: number | null; labelledWeek: number | null }`
  - `function weekBandSegments(dayKeys: DayKey[], seasonWeeks: SeasonWeek[]): WeekBandSegment[]`

**Background the implementer needs.** The 2026 season: week 1 runs Sat Jun 27
noon → Sat Jul 4 noon, so `2026-06-27` opens week 1 and `2026-07-04` is the
week 1 / week 2 boundary. Week 5 opens `2026-07-25` and closes `2026-08-01`.
Week 9 opens `2026-08-22` and closes `2026-08-29`. `getChautauquaSeasonWeeks`
always returns nine weeks.

**Why the day-key comparison rather than `weekNumbersForCalendarDate`.**
`weekNumbersForCalendarDate` costs ~7 `Intl.formatToParts` round-trips per call
(one `chqParts` plus two `chqDateAt`, each three more) and the rail is ~70
chips, re-derived on every filter change. Comparing `"yyyy-mm-dd"` strings
against each week's opening and closing day keys is the same rule — a week
overlaps a calendar day exactly when `dayKey(week.start) <= key <=
dayKey(week.end)` — at nine `dayKeyOf` calls total. The test in step 1 is what
makes that "the same rule" a checked claim rather than an assertion.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/__tests__/lib/utils/weekBands.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { weekBandSegments, weekDayKeySpans } from '@/lib/utils/weekBands';
import { getChautauquaSeasonWeeks, weekNumbersForCalendarDate } from '@/lib/utils/dateHelpers';
import { dayKeys, startOfDay } from '@/lib/utils/dayWindow';

const weeks = getChautauquaSeasonWeeks(2026);
const segments = (keys: string[]) => weekBandSegments(keys, weeks);

describe('weekBandSegments — membership', () => {
  it('puts a boundary Saturday in both of its weeks', () => {
    expect(segments(['2026-07-04'])[0].weekNumbers).toEqual([1, 2]);
  });

  it('puts a midweek day in one week', () => {
    expect(segments(['2026-06-30'])[0].weekNumbers).toEqual([1]);
  });

  it('puts the opening Saturday in week 1 alone', () => {
    // No previous week to share with.
    expect(segments(['2026-06-27'])[0].weekNumbers).toEqual([1]);
  });

  it('gives an out-of-season day no week at all', () => {
    const s = segments(['2026-01-15'])[0];
    expect(s.weekNumbers).toEqual([]);
    expect(s.navigationTarget).toBeNull();
    expect(s.labelledWeek).toBeNull();
  });

  // The guard that makes the day-key comparison a checked claim rather than a
  // second, faster model that happens to agree today.
  it('agrees with weekNumbersForCalendarDate across the whole navigable range', () => {
    const keys = dayKeys('2026-06-01', '2026-09-30');
    for (const s of weekBandSegments(keys, weeks)) {
      expect(s.weekNumbers).toEqual(weekNumbersForCalendarDate(startOfDay(s.dayKey), weeks));
    }
  });
});

describe('weekBandSegments — tap targets', () => {
  it('makes a shared Saturday no tap target', () => {
    // Ambiguous by construction: it opens one week and closes another, so a
    // tap on it cannot mean one week. The six non-shared days carry the
    // week's navigation instead.
    expect(segments(['2026-07-04'])[0].navigationTarget).toBeNull();
  });

  it('sends a non-shared day to its own week', () => {
    expect(segments(['2026-06-30'])[0].navigationTarget).toBe(1);
  });

  it("makes week 1's opening Saturday a tap target", () => {
    // Shared with nothing, so unlike every other Saturday it is unambiguous.
    expect(segments(['2026-06-27'])[0].navigationTarget).toBe(1);
  });
});

describe('weekBandSegments — the WEEK n label', () => {
  it('gives exactly one day per week the label', () => {
    const result = segments(dayKeys('2026-06-27', '2026-07-11'));
    expect(result.filter(s => s.labelledWeek === 1)).toHaveLength(1);
    expect(result.filter(s => s.labelledWeek === 2)).toHaveLength(1);
  });

  it('never lands the label on a shared Saturday', () => {
    for (const s of segments(dayKeys('2026-06-27', '2026-08-29'))) {
      if (s.labelledWeek !== null) expect(s.weekNumbers).toHaveLength(1);
    }
  });

  it('follows the visible run when a week is clipped by the rail', () => {
    // The rail spans navigableBounds, which can start mid-week. The label
    // must land inside what is actually rendered, not at a fixed offset from
    // a week start that may be off screen. Pinned away from both ends so a
    // naive "always index 0" or "always last" is caught.
    const keys = dayKeys('2026-07-01', '2026-07-03');
    const labelled = weekBandSegments(keys, weeks).filter(s => s.labelledWeek === 1);
    expect(labelled).toHaveLength(1);
    expect(labelled[0].dayKey).toBe('2026-07-02');
  });
});

describe('weekBandSegments — the ramp', () => {
  it('runs 0 to 1 across the season', () => {
    expect(segments(['2026-06-29'])[0].rampSteps).toEqual([0]);   // week 1
    expect(segments(['2026-08-24'])[0].rampSteps).toEqual([1]);   // week 9
  });

  it('gives a shared Saturday both weeks steps, ascending', () => {
    const steps = segments(['2026-07-04'])[0].rampSteps;
    expect(steps).toHaveLength(2);
    expect(steps[0]).toBeLessThan(steps[1]);
  });
});

describe('weekDayKeySpans', () => {
  it('spans each week from the Saturday it opens through the Saturday it closes', () => {
    const spans = weekDayKeySpans(weeks);
    expect(spans).toHaveLength(9);
    expect(spans[0]).toEqual({ number: 1, opening: '2026-06-27', closing: '2026-07-04' });
    expect(spans[8]).toEqual({ number: 9, opening: '2026-08-22', closing: '2026-08-29' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && npx vitest run src/__tests__/lib/utils/weekBands.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/utils/weekBands"`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/utils/weekBands.ts`:

```ts
import type { SeasonWeek } from '@/lib/types';
import { type DayKey, dayKeyOf } from '@/lib/utils/dayWindow';

/**
 * One week's extent expressed in day keys — the opening Saturday through the
 * closing Saturday, both inclusive.
 *
 * This is the day-granular model, not the noon-granular one. A Chautauqua
 * week turns over at Saturday *noon*, but splitting a 44px chip at its centre
 * is a distinction no reader can use at swipe speed, so a boundary Saturday
 * belongs to both of its weeks — the same rule
 * `weekNumbersForCalendarDate` gives the day header's `Wk 5/6` badge and the
 * week filter (#257).
 *
 * Day keys are `"yyyy-mm-dd"`, so string order is chronological order and
 * membership is a plain pair of comparisons. That is the whole reason this
 * type exists: `weekNumbersForCalendarDate` costs ~7 `Intl.formatToParts`
 * round-trips per call and the rail asks about ~70 days on every filter
 * change. Nine `dayKeyOf` calls, then string compares.
 * `weekBands.test.ts` walks the whole navigable range asserting the two
 * agree, so this stays a faster spelling of one model rather than a second
 * model that happens to match.
 */
export interface WeekDayKeySpan {
  number: number;
  opening: DayKey;
  closing: DayKey;
}

export function weekDayKeySpans(seasonWeeks: SeasonWeek[]): WeekDayKeySpan[] {
  return seasonWeeks.map(w => ({
    number: w.number,
    opening: dayKeyOf(w.start),
    closing: dayKeyOf(w.end),
  }));
}

/** One day's slice of the week band above the day rail. */
export interface WeekBandSegment {
  dayKey: DayKey;
  /** Ascending. Two entries = a boundary Saturday. Empty = outside the season. */
  weekNumbers: number[];
  /** `(n - 1) / (weeks - 1)` per entry, same order. Drives the lightness ramp. */
  rampSteps: number[];
  /**
   * The week a tap here navigates to, or `null` when a tap would be ambiguous
   * or meaningless.
   *
   * `null` for a *shared* Saturday: it opens one week and closes another, so
   * a tap on it cannot mean one week. Each week's six non-shared days carry
   * its navigation instead — plus week 1's opening Saturday and the final
   * week's closing Saturday, which have no neighbour to share with. Also
   * `null` outside the season.
   */
  navigationTarget: number | null;
  /** The week whose `WEEK n` label this segment draws. At most one per week. */
  labelledWeek: number | null;
}

/**
 * Segments for `keys`, in the order given.
 *
 * `keys` is the rail's own span (`navigableBounds`), a superset of the season
 * that can start or end mid-week. Label placement therefore follows the
 * *visible* run of each week rather than a fixed offset from a week start
 * that may be off screen.
 *
 * Pure and fully unit-testable: *which* spans the band covers is decided
 * here; where they land in pixels is `WeekBandCell`'s problem. That split is
 * deliberate — the pixel half is the part only a browser can check.
 */
export function weekBandSegments(keys: DayKey[], seasonWeeks: SeasonWeek[]): WeekBandSegment[] {
  // Built once and reused for every day, rather than per lookup: the iOS
  // version needed exactly this fix after a ~70-chip rail cost ~70 season
  // rebuilds per scroll tick (#256).
  const spans = weekDayKeySpans(seasonWeeks);
  // `getChautauquaSeasonWeeks` always returns nine, so an empty season is
  // unreachable — but the ramp divides by this, and a one-week season would
  // divide by zero rather than merely look wrong.
  const denominator = Math.max(seasonWeeks.length - 1, 1);

  const membership = keys.map(key =>
    spans.filter(s => s.opening <= key && key <= s.closing).map(s => s.number));

  // A week's label goes on the middle of its visible *non-shared* days, so it
  // never lands on a boundary Saturday — where it would have to pick one of
  // two weeks and would sit on the split fill.
  const soloIndicesByWeek = new Map<number, number[]>();
  membership.forEach((numbers, index) => {
    if (numbers.length !== 1) return;
    const existing = soloIndicesByWeek.get(numbers[0]);
    if (existing) existing.push(index);
    else soloIndicesByWeek.set(numbers[0], [index]);
  });
  const labelIndexByWeek = new Map<number, number>();
  for (const [week, indices] of soloIndicesByWeek) {
    labelIndexByWeek.set(week, indices[Math.floor(indices.length / 2)]);
  }

  return keys.map((key, index) => {
    const numbers = membership[index];
    // Unambiguous only when this day belongs to exactly one week.
    const target = numbers.length === 1 ? numbers[0] : null;
    const labelled =
      numbers.length === 1 && labelIndexByWeek.get(numbers[0]) === index ? numbers[0] : null;
    return {
      dayKey: key,
      weekNumbers: numbers,
      rampSteps: numbers.map(n => (n - 1) / denominator),
      navigationTarget: target,
      labelledWeek: labelled,
    };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && npx vitest run src/__tests__/lib/utils/weekBands.test.ts
```

Expected: PASS.

- [ ] **Step 5: Falsify the two guards that could be written to pass trivially**

Prove the label test can fail, then restore. In `weekBandSegments`, replace
`indices[Math.floor(indices.length / 2)]` with `indices[0]` and re-run:
`follows the visible run when a week is clipped` must FAIL
(`'2026-07-01'` received). Then replace the membership filter with
`spans.filter(s => s.opening <= key && key < s.closing)` and re-run:
`puts a boundary Saturday in both of its weeks` **and** `agrees with
weekNumbersForCalendarDate` must both FAIL. Restore both.

- [ ] **Step 6: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add frontend/src/lib/utils/weekBands.ts frontend/src/__tests__/lib/utils/weekBands.test.ts
git commit -m "feat(web): week band segmentation, transcribed from WeekBands.swift (#274)"
```

---

## Task 2: reachability — where a band tap actually lands

**Files:**
- Modify: `frontend/src/lib/utils/dayWindow.ts` (extract and export `spokenDayTitle`)
- Modify: `frontend/src/lib/utils/weekBands.ts` (append)
- Modify: `frontend/src/__tests__/lib/utils/weekBands.test.ts` (append)

**Interfaces:**
- Consumes: `WeekDayKeySpan`, `weekDayKeySpans` (Task 1); `NavigableBounds`,
  `DayKey` from `@/lib/utils/dayWindow`.
- Produces:
  - `function spokenDayTitle(key: DayKey): string` from `@/lib/utils/dayWindow` — `"Saturday, July 25"`
  - `interface WeekBandDestination { dayKey: DayKey; label: string }`
  - `function weekBandDestinations(o: { seasonWeeks: SeasonWeek[]; eventDays: DayKey[]; bounds: NavigableBounds; countsByDay: Map<DayKey, number> }): Map<number, WeekBandDestination>`
  - `function weekBandUnreachableLabel(week: number): string`

**The two lookups are deliberately separate.** `navigationTarget` is a property
of the *calendar* — it depends only on the day and the season.
`weekBandDestinations` is a property of the current *filters* — it depends on
which days hold matching events. Keeping them apart is what lets segmentation
be tested as a pure function of the season while reachability is tested against
event sets.

**Deliberate delta from iOS.** `WeekBands.swift` has both a single-week
`navigationTarget(week:…)` and a batch `destinations(…)`, and a test pinning
that they agree. Web has only the batch form: the tap handler reads the same
map the fill reads, so they cannot disagree by construction and the agreement
test would check nothing. Also: iOS's label takes `includingYear` for archived
seasons; web's `dayChips` never says the year, so the band does not either —
one spoken form across the rail.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/__tests__/lib/utils/weekBands.test.ts`:

```ts
import { weekBandDestinations, weekBandUnreachableLabel } from '@/lib/utils/weekBands';

// 2026: week 5 opens Sat 07-25 and closes Sat 08-01, which it shares with
// week 6.
const SEASON_BOUNDS = { startDay: '2026-06-01', endDay: '2026-09-30' };

function destinations(
  eventDays: string[],
  counts: Record<string, number> = {},
  bounds = SEASON_BOUNDS,
) {
  return weekBandDestinations({
    seasonWeeks: weeks, eventDays, bounds,
    countsByDay: new Map(Object.entries(counts)),
  });
}

describe('weekBandDestinations — which day a week tap lands on', () => {
  it('takes the opening Saturday when it has events', () => {
    expect(destinations(['2026-07-25', '2026-07-28']).get(5)?.dayKey).toBe('2026-07-25');
  });

  it("falls back to the week's first day with events when the opening Saturday is empty", () => {
    // The rail never announces a destination it cannot reach.
    expect(destinations(['2026-07-28', '2026-07-30']).get(5)?.dayKey).toBe('2026-07-28');
  });

  it("takes the week's earliest day, not the list's first", () => {
    // `eventDays` spans the whole rail, not one week, and is sorted ascending
    // — which is what lets the fallback stop at the first match. What it must
    // not do is stop at the first element: 07-20 is in week 4.
    expect(destinations(['2026-07-20', '2026-07-28', '2026-07-30']).get(5)?.dayKey)
      .toBe('2026-07-28');
  });

  it('leaves a week with nothing reachable out of the map', () => {
    // Absent is the signal the band is DISABLED. Days on either side of week
    // 5, none inside it.
    expect(destinations(['2026-07-20', '2026-08-05']).has(5)).toBe(false);
  });

  it('counts a shared Saturday for both of its weeks', () => {
    const result = destinations(['2026-08-01']);
    expect(result.get(5)?.dayKey).toBe('2026-08-01');
    expect(result.get(6)?.dayKey).toBe('2026-08-01');
  });

  it('refuses a day outside the rail\'s own bounds', () => {
    // `railTarget` refuses a day past `navigableBounds`, so a target outside
    // them would be announced and then declined.
    const clamped = { startDay: '2026-07-28', endDay: '2026-09-30' };
    expect(destinations(['2026-07-25', '2026-07-29'], {}, clamped).get(5)?.dayKey)
      .toBe('2026-07-29');
  });

  it('leaves a week entirely outside the bounds unreachable', () => {
    const clamped = { startDay: '2026-08-10', endDay: '2026-09-30' };
    expect(destinations(['2026-07-25'], {}, clamped).has(5)).toBe(false);
  });
});

describe('weekBandDestinations — what it is named', () => {
  it('says the opening Saturday opens the week', () => {
    expect(destinations(['2026-07-25'], { '2026-07-25': 84 }).get(5)?.label)
      .toBe('Go to Week 5, opens Saturday, July 25, 84 events');
  });

  it('does not claim a fallback day opens the week', () => {
    // Saying "opens" here would be a small lie about where the reader is put
    // down.
    expect(destinations(['2026-07-28'], { '2026-07-28': 1 }).get(5)?.label)
      .toBe('Go to Week 5, first events Tuesday, July 28, 1 event');
  });

  it('states an unreachable week as a fact rather than offering it', () => {
    // Mirrors an empty day chip ("Monday, July 6, no events"), which also
    // never says "Go to".
    expect(weekBandUnreachableLabel(6)).toBe('Week 6, no events');
  });

  it('never names a week by direction', () => {
    const result = destinations(['2026-07-25', '2026-08-10'], { '2026-07-25': 3 });
    for (const d of result.values()) {
      expect(d.label).not.toMatch(/\bnext\b|\bprevious\b|\bforward\b|\bback\b/i);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && npx vitest run src/__tests__/lib/utils/weekBands.test.ts
```

Expected: FAIL — `weekBandDestinations is not a function`.

- [ ] **Step 3: Extract `spokenDayTitle` in `dayWindow.ts`**

In `frontend/src/lib/utils/dayWindow.ts`, add this next to `formatDayLabel`:

```ts
/**
 * `"Saturday, July 25"` — the long spoken form every rail control names its
 * target by.
 *
 * Extracted from `dayChips` so the week band names a day exactly as the chip
 * under it does. Two spellings of the same day in one strip is the kind of
 * drift a screen-reader user hears and a sighted reviewer never sees.
 */
export function spokenDayTitle(key: DayKey): string {
  return startOfDay(key).toLocaleDateString('en-US', {
    timeZone: CHQ_ZONE, weekday: 'long', month: 'long', day: 'numeric',
  });
}
```

Then, inside `dayChips`, replace the local

```ts
    const spoken = date.toLocaleDateString('en-US', { timeZone: CHQ_ZONE, weekday: 'long', month: 'long', day: 'numeric' });
```

with

```ts
    const spoken = spokenDayTitle(key);
```

- [ ] **Step 4: Append the implementation to `weekBands.ts`**

```ts
import { type DayKey, type NavigableBounds, dayKeyOf, spokenDayTitle } from '@/lib/utils/dayWindow';
```

(replace the existing `dayWindow` import line with the one above), then append:

```ts
/** Where a tap on one week's band lands, and what a screen reader reads for it. */
export interface WeekBandDestination {
  dayKey: DayKey;
  /** e.g. `"Go to Week 6, opens Saturday, June 27, 84 events"`. */
  label: string;
}

interface FoundDay {
  dayKey: DayKey;
  opensTheWeek: boolean;
}

/**
 * The design's three branches, in order:
 *
 * 1. the full Saturday that opens the week, when it holds events under the
 *    current non-date filters — a reader asking for week 6 is asking to be put
 *    at the top of week 6;
 * 2. otherwise the week's first day that does, because the rail never
 *    announces a destination it cannot reach;
 * 3. otherwise `null`, which is the signal the band is **disabled** — matching
 *    the dashed empty chips directly beneath it. A normal-looking band next to
 *    visibly empty chips that does nothing when tapped is worse than one that
 *    says it cannot go there.
 *
 * `bounds` is the rail's own navigable span. A day outside it is not a legal
 * target (`railTarget` refuses it), so a week whose days all lie outside is
 * unreachable even if events exist there.
 */
function findDay(
  span: WeekDayKeySpan, eventDays: DayKey[], bounds: NavigableBounds
): FoundDay | null {
  // Day keys are `"yyyy-mm-dd"`, so the clamp against `bounds` is a plain
  // string comparison.
  const first = span.opening > bounds.startDay ? span.opening : bounds.startDay;
  const last = span.closing < bounds.endDay ? span.closing : bounds.endDay;
  if (first > last) return null;

  if (span.opening >= first && span.opening <= last && eventDays.includes(span.opening)) {
    return { dayKey: span.opening, opensTheWeek: true };
  }
  // `eventDays` is `eventDayKeys`' output, already sorted ascending, so the
  // first match in its existing order is the week's earliest reachable day.
  const fallback = eventDays.find(k => k >= first && k <= last);
  return fallback === undefined ? null : { dayKey: fallback, opensTheWeek: false };
}

/**
 * Named by destination, never by direction — the rail's established
 * convention, and why `⟳ Now` reads "Go to Wednesday, July 1, today, 3 events"
 * rather than "go forward". "Opens" is said only when the target really is the
 * week's opening Saturday; when the reader is being sent to a later day
 * because that Saturday is empty, saying "opens" would be a small lie about
 * where they are landing.
 */
function destinationLabel(week: number, found: FoundDay, count: number): string {
  const title = spokenDayTitle(found.dayKey);
  const where = found.opensTheWeek ? `opens ${title}` : `first events ${title}`;
  return `Go to Week ${week}, ${where}, ${count} event${count === 1 ? '' : 's'}`;
}

/**
 * Every week the band can navigate to, keyed by week number.
 *
 * A week **absent** from the map is unreachable: its fill renders faded and a
 * tap does nothing. Absent is not the same as "nothing is reachable" — an
 * absent *map* means "no reachability information yet", which is why
 * `WeekBandCell` treats an empty map as "do not dim anything".
 *
 * One batch form, not a batch and a single-week form: the tap handler and the
 * fill both read this map, so they cannot disagree about which weeks are
 * reachable.
 */
export function weekBandDestinations(o: {
  seasonWeeks: SeasonWeek[];
  /** Sorted ascending — the days navigation can reach under the non-date filters. */
  eventDays: DayKey[];
  bounds: NavigableBounds;
  countsByDay: Map<DayKey, number>;
}): Map<number, WeekBandDestination> {
  const result = new Map<number, WeekBandDestination>();
  for (const span of weekDayKeySpans(o.seasonWeeks)) {
    const found = findDay(span, o.eventDays, o.bounds);
    if (!found) continue;
    result.set(span.number, {
      dayKey: found.dayKey,
      label: destinationLabel(span.number, found, o.countsByDay.get(found.dayKey) ?? 0),
    });
  }
  return result;
}

/**
 * What a screen reader reads for a week the band cannot reach — a statement of
 * fact, not an offer, exactly as an empty day chip reads "Monday, July 6, no
 * events" rather than offering to go there.
 */
export function weekBandUnreachableLabel(week: number): string {
  return `Week ${week}, no events`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd frontend && npx vitest run src/__tests__/lib/utils/weekBands.test.ts src/__tests__/lib/utils/dayWindow.test.ts
```

Expected: PASS. The `dayWindow` suite is run too because `dayChips`' spoken
labels moved; if any of those fail, the extraction changed the string and must
be corrected, not the test.

- [ ] **Step 6: Falsify the fallback branch**

Change `eventDays.find(k => k >= first && k <= last)` to `eventDays[0]` and
re-run: `takes the week's earliest day, not the list's first` must FAIL.
Restore. Then change `first` in `findDay` to `span.opening` (dropping the
bounds clamp) and re-run: `refuses a day outside the rail's own bounds` must
FAIL. Restore.

- [ ] **Step 7: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add frontend/src/lib/utils/weekBands.ts frontend/src/lib/utils/dayWindow.ts frontend/src/__tests__/lib/utils/weekBands.test.ts
git commit -m "feat(web): week band reachability and destination labels (#274)"
```

---

## Task 3: `bridgesGutter` — where the painted run breaks

**Files:**
- Modify: `frontend/src/lib/utils/weekBands.ts` (append)
- Modify: `frontend/src/__tests__/lib/utils/weekBands.test.ts` (append)

**Interfaces:**
- Produces: `function bridgesGutter(index: number, segments: WeekBandSegment[]): boolean`
  — whether the fill runs on through the gutter *after* `index`.

**Why this exists.** Every chip is the same distance from the next, within a
week and across a week boundary alike — so a band drawn strictly chip-by-chip
is a row of identical bars with identical gaps, and a week's *extent* is
invisible. Bridging the gutters inside a week makes each week one continuous
run, and then the one surviving break — the seam through the Saturday two weeks
share — is the only gap in the band and therefore unmistakable.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/__tests__/lib/utils/weekBands.test.ts`:

```ts
import { bridgesGutter, type WeekBandSegment } from '@/lib/utils/weekBands';

const bridges = (keys: string[]) => {
  const all = segments(keys);
  return Array.from({ length: Math.max(all.length - 1, 0) }, (_, i) => bridgesGutter(i, all));
};

describe('bridgesGutter', () => {
  it('bridges every gutter inside a week', () => {
    // Sun through Fri of week 2 — six days, five gutters, none a boundary. If
    // any came back false the week would be drawn in pieces and the boundary
    // would stop being the only break.
    expect(bridges(['2026-07-05', '2026-07-06', '2026-07-07',
                    '2026-07-08', '2026-07-09', '2026-07-10']))
      .toEqual([true, true, true, true, true]);
  });

  it('bridges both ways across a boundary Saturday', () => {
    // Sat Jul 4 closes week 1 and opens week 2, so it joins the run on each
    // side and the break goes *through* it rather than beside it.
    expect(bridges(['2026-07-03', '2026-07-04', '2026-07-05'])).toEqual([true, true]);
  });

  it("ends a run at the season's edge", () => {
    // Thu/Fri before the season, then the opening Saturday. Nothing to share,
    // so the run starts flush with week 1's first chip.
    expect(bridges(['2026-06-25', '2026-06-26', '2026-06-27', '2026-06-28']))
      .toEqual([false, false, true]);
  });

  it('never bridges two out-of-season days', () => {
    expect(bridges(['2026-01-15', '2026-01-16'])).toEqual([false]);
  });

  it('has no gutter to bridge at the ends of the array', () => {
    const all = segments(['2026-07-06', '2026-07-07']);
    expect(bridgesGutter(-1, all)).toBe(false);
    expect(bridgesGutter(1, all)).toBe(false);
    expect(bridgesGutter(5, all)).toBe(false);
  });
});

// Hand-built segments, isolated from `weekBandSegments`, pinning the exact
// case a `[0] === [0]` comparison would get wrong.
describe('bridgesGutter — two-entry sets', () => {
  const segment = (dayKey: string, weekNumbers: number[]): WeekBandSegment => ({
    dayKey, weekNumbers, rampSteps: weekNumbers.map(n => n),
    navigationTarget: null, labelledWeek: null,
  });

  it("bridges on a shared Saturday's SECOND week number", () => {
    // Left is the boundary Saturday, [5, 6]; right is plain week 6. Comparing
    // first-to-first compares 5 to 6 and misses the match in the second slot.
    expect(bridgesGutter(0, [segment('2026-08-01', [5, 6]), segment('2026-08-02', [6])]))
      .toBe(true);
  });

  it("bridges on a shared Saturday's FIRST week number on the other side", () => {
    expect(bridgesGutter(0, [segment('2026-07-31', [5]), segment('2026-08-01', [5, 6])]))
      .toBe(true);
  });

  it('never bridges disjoint sets, even with two entries each', () => {
    expect(bridgesGutter(0, [segment('2026-08-01', [5, 6]), segment('2026-08-08', [7, 8])]))
      .toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd frontend && npx vitest run src/__tests__/lib/utils/weekBands.test.ts
```

Expected: FAIL — `bridgesGutter is not a function`.

- [ ] **Step 3: Append the implementation**

```ts
/**
 * Whether the band's fill runs straight through the gutter between the chips
 * at `index` and `index + 1`, instead of stopping at the chip's edge the way
 * the segment's own box does.
 *
 * Two adjacent days bridge when they share a week. A boundary Saturday shares
 * its closing week with the Friday before it and its opening week with the
 * Sunday after, so it bridges *both* ways and its own split is where the break
 * goes. An out-of-season day shares nothing, so a run ends at the season's
 * edge.
 *
 * Must compare every element on both sides, not just the first: a boundary
 * Saturday's `[1, 2]` shares its *second* entry with the week after it, which
 * a first-only shortcut would miss. `weekNumbers` holds 0, 1 or 2 entries by
 * construction and this runs twice per segment on every rail render, so a
 * `Set` over a domain this small would buy nothing but an allocation.
 */
export function bridgesGutter(index: number, segments: WeekBandSegment[]): boolean {
  if (index < 0 || index + 1 >= segments.length) return false;
  const left = segments[index].weekNumbers;
  const right = segments[index + 1].weekNumbers;
  if (left.length === 0 || right.length === 0) return false;
  return left.some(n => right.includes(n));
}
```

- [ ] **Step 4: Run to verify they pass**

```bash
cd frontend && npx vitest run src/__tests__/lib/utils/weekBands.test.ts
```

Expected: PASS.

- [ ] **Step 5: Falsify**

Replace the body's last line with `return left[0] === right[0];` and re-run:
`bridges on a shared Saturday's SECOND week number` and `bridges both ways
across a boundary Saturday` must FAIL. Restore.

- [ ] **Step 6: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add frontend/src/lib/utils/weekBands.ts frontend/src/__tests__/lib/utils/weekBands.test.ts
git commit -m "feat(web): bridgesGutter, so a week reads as one run (#274)"
```

---

## Task 4: the colour ramp

**Files:**
- Create: `frontend/src/lib/utils/railBandPalette.ts`
- Create: `frontend/src/__tests__/lib/utils/weekBandContrast.test.ts`
- Modify: `frontend/src/app/globals.css`

**Interfaces:**
- Produces:
  - `const WEEK_BAND_RAMP: Record<'light' | 'dark', { start: string; end: string }>`
  - `const RAIL_BAND_LABEL: Record<'light' | 'dark', string>`
  - `const RAIL_BACKDROP: Record<'light' | 'dark', string>`
  - `const RAIL_PILL: string`
  - `const UNREACHABLE_FILL_OPACITY: number`
  - `function rampPercent(step: number): number`
  - `function rampBackground(step: number): string` — the CSS a bar paints with
  - `function rampHex(theme: 'light' | 'dark', step: number): string` — the same mix, resolved

**A lightness ramp, not a hue ramp.** Adjacent weeks always differ, and it
survives colour-vision deficiency. The endpoints are ported from iOS's
`WeekBandStart` / `WeekBandEnd` colorsets.

**One endpoint had to change, and the number is why.** iOS's light-mode
`WeekBandEnd` is `#79808A`, checked against `UIColor.label`, which is pure
black in light mode. Web draws the `WEEK n` label in `--foreground`, `#171717`,
and `#79808A` against `#171717` computes **4.497:1** — below AA's 4.5. The web
light endpoint is therefore `#7e858f`, which computes **4.814:1**. The other
three endpoints port unchanged. Verified ramp minima, all nine steps:

| | vs label | ΔE vs pill | channel spread | faded 0.3 vs label |
|---|---|---|---|---|
| light | 4.81 (wk 9) | 75.1 | ≤ 17 | ≥ 12.80 |
| dark | 5.77 (wk 9) | 75.7 | ≤ 14 | ≥ 10.09 |

**Why ΔE and not only a WCAG ratio.** WCAG's ratio is a luminance ratio blind
to hue: two colours of the same lightness and wildly different hue compute
≈1:1 and look nothing alike. ΔE*ab (CIE 1976) is the cheap standard perceptual
distance that accounts for hue and chroma. On web the more sensitive guard is
actually **neutrality** — the highlight pill (`bg-blue-600`, `#2563eb`) has a
channel spread of 198, and every re-tint of the ramp toward the accent that
iOS's history records (`#8fa9c6` spread 55, `#5a7794` spread 58, `#22303f`
spread 29) fails a spread ceiling of 24 while still clearing a ΔE floor. Both
guards ship; the spread one is the one that catches the mistake that has
actually been made.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/lib/utils/weekBandContrast.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RAIL_BACKDROP, RAIL_BAND_LABEL, RAIL_PILL, UNREACHABLE_FILL_OPACITY,
  WEEK_BAND_RAMP, rampHex, rampPercent, rampBackground,
} from '@/lib/utils/railBandPalette';

/**
 * WCAG 2.1 §1.4.3 and CIE 1976 ΔE*ab, computed here rather than sampled.
 * `theHelpersCanFail` below proves both can detect a known failure before
 * anything relies on them — the same discipline `DayChipContrastTests` and
 * `WeekBandContrastTests` apply on iOS.
 */
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const linear = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const lab = (hex: string) => {
  const [r, g, b] = rgb(hex).map(linear);
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b;
  const f = (t: number) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  const [fx, fy, fz] = [f(x / 0.95047), f(y / 1.0), f(z / 1.08883)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
const deltaE = (a: string, b: string) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
/** How far a colour's most and least intense channels are apart, on 0…255. */
const channelSpread = (hex: string) => Math.max(...rgb(hex)) - Math.min(...rgb(hex));
const toHex = (c: number[]) => `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
/** Ordinary source-over alpha compositing in sRGB — what `opacity` on a fill does. */
const composite = (top: string, backdrop: string, alpha: number) =>
  toHex(rgb(top).map((v, i) => v * alpha + rgb(backdrop)[i] * (1 - alpha)));

const THEMES = ['light', 'dark'] as const;
/** Nine weeks, so nine steps. Derived, not a literal 9 in the component. */
const STEPS = Array.from({ length: 9 }, (_, i) => i / 8);
/** WCAG AA for normal-size text. `WEEK n` is 10px — nowhere near "large". */
const AA_NORMAL = 4.5;
/** Between what a re-tint costs and what the neutral palette holds. */
const MIN_SEPARATION = 40;

describe('the helpers can fail', () => {
  it('catches a known WCAG failure', () => {
    // iOS's light endpoint against web's --foreground: 4.497:1, the reason the
    // web light endpoint is #7e858f and not #79808a.
    expect(ratio('#79808a', '#171717')).toBeLessThan(AA_NORMAL);
  });

  it('catches a known perceptual collision', () => {
    // blue-700 beside blue-600: two fills a reader could not tell apart.
    expect(deltaE('#1d4ed8', RAIL_PILL)).toBeLessThan(MIN_SEPARATION);
    expect(deltaE('#1d4ed8', RAIL_PILL)).toBeGreaterThan(0);
  });

  it('catches a re-tint toward the accent', () => {
    // The blue ramp #256 started from, and the endpoint that shipped a 1.196:1
    // collision on iOS. Both are neutral-looking numbers that are not neutral.
    expect(channelSpread('#8fa9c6')).toBeGreaterThan(24);
    expect(channelSpread('#5a7794')).toBeGreaterThan(24);
  });
});

describe('the week band ramp', () => {
  it.each(THEMES)('clears AA against the WEEK n label in %s', theme => {
    for (const step of STEPS) {
      const fill = rampHex(theme, step);
      expect(
        ratio(fill, RAIL_BAND_LABEL[theme]),
        `${fill} at step ${step}`,
      ).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it.each(THEMES)('never collides with the highlight pill in %s', theme => {
    // A band segment sits directly above its own chip, so two fills of the
    // same tone merge into one shape and the highlighted chip grows a flag.
    for (const step of STEPS) {
      expect(deltaE(rampHex(theme, step), RAIL_PILL)).toBeGreaterThanOrEqual(MIN_SEPARATION);
    }
  });

  it.each(THEMES)('stays neutral while the pill stays saturated in %s', theme => {
    // The design rule the whole colour choice rests on, as an assertion rather
    // than a comment: the pill is the only saturated fill on the rail.
    expect(channelSpread(RAIL_PILL)).toBeGreaterThanOrEqual(40);
    for (const step of STEPS) {
      expect(channelSpread(rampHex(theme, step)), `step ${step}`).toBeLessThanOrEqual(24);
    }
  });

  it.each(THEMES)('is monotonic in luminance in %s', theme => {
    // What makes the two endpoints the extremes: a ramp that turned around in
    // the middle would make every check above stop proving anything.
    const lums = STEPS.map(s => luminance(rampHex(theme, s)));
    const rising = lums[lums.length - 1] > lums[0];
    for (let i = 1; i < lums.length; i++) {
      expect(rising ? lums[i] >= lums[i - 1] : lums[i] <= lums[i - 1]).toBe(true);
    }
    expect(lums[0]).not.toBe(lums[lums.length - 1]);
  });

  it.each(THEMES)('fading an unreachable week never costs the label contrast in %s', theme => {
    // Fade the FILL, never the label. Because the ramp sits between the rail's
    // background and the label's colour in both themes, a faded fill
    // composites *toward* the background, away from the label. That is the
    // claim; this checks it rather than trusting it.
    for (const step of STEPS) {
      const fill = rampHex(theme, step);
      const faded = composite(fill, RAIL_BACKDROP[theme], UNREACHABLE_FILL_OPACITY);
      const full = ratio(fill, RAIL_BAND_LABEL[theme]);
      const dimmed = ratio(faded, RAIL_BAND_LABEL[theme]);
      expect(dimmed).toBeGreaterThanOrEqual(AA_NORMAL);
      expect(dimmed, 'fading moved the fill toward the label').toBeGreaterThanOrEqual(full);
    }
  });
});

describe('the CSS tokens and the TypeScript palette', () => {
  // The band paints with `color-mix` on two CSS custom properties; these tests
  // compute against TypeScript constants. Two copies of four hex values is
  // exactly the drift this reads the stylesheet to prevent.
  const css = readFileSync(new URL('../../../app/globals.css', import.meta.url), 'utf8');
  const block = css.slice(
    css.indexOf('/* week-band-ramp:start */'),
    css.indexOf('/* week-band-ramp:end */'),
  );
  const darkAt = block.indexOf('@media (prefers-color-scheme: dark)');
  const read = (name: string, where: string) =>
    where.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`))?.[1];

  it('declares the ramp block once, with a dark override inside it', () => {
    expect(block).not.toBe('');
    expect(darkAt).toBeGreaterThan(0);
  });

  it.each(['start', 'end'] as const)('light --rail-band-%s matches the palette', which => {
    expect(read(`rail-band-${which}`, block.slice(0, darkAt))).toBe(WEEK_BAND_RAMP.light[which]);
  });

  it.each(['start', 'end'] as const)('dark --rail-band-%s matches the palette', which => {
    expect(read(`rail-band-${which}`, block.slice(darkAt))).toBe(WEEK_BAND_RAMP.dark[which]);
  });
});

describe('rampBackground', () => {
  it('mixes the two tokens by the step, so the painted colour is the tested one', () => {
    expect(rampBackground(0.5))
      .toBe('color-mix(in srgb, var(--rail-band-end) 50%, var(--rail-band-start))');
  });

  it('resolves the endpoints exactly', () => {
    expect(rampHex('light', 0)).toBe(WEEK_BAND_RAMP.light.start);
    expect(rampHex('light', 1)).toBe(WEEK_BAND_RAMP.light.end);
  });

  it('clamps a step outside 0…1 rather than extrapolating off the ramp', () => {
    expect(rampPercent(-3)).toBe(0);
    expect(rampPercent(7)).toBe(100);
    expect(rampPercent(Number.NaN)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd frontend && npx vitest run src/__tests__/lib/utils/weekBandContrast.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/utils/railBandPalette"`.

- [ ] **Step 3: Write the palette module**

Create `frontend/src/lib/utils/railBandPalette.ts`:

```ts
/**
 * The week band's colour ramp.
 *
 * A **lightness** ramp, not a hue ramp: adjacent weeks always differ, and it
 * survives colour-vision deficiency. Ported from iOS's `WeekBandStart` /
 * `WeekBandEnd` colorsets, with one deliberate change — iOS's light-mode
 * `WeekBandEnd` (`#79808a`) was checked against `UIColor.label`, which is pure
 * black; against web's `--foreground` (`#171717`) it computes 4.497:1 and
 * fails AA. `#7e858f` computes 4.814:1.
 *
 * The endpoints live here as well as in `globals.css` because the CSS is what
 * paints and TypeScript is what `weekBandContrast.test.ts` computes against.
 * That test reads the stylesheet and asserts the two agree, so the duplication
 * cannot drift silently.
 *
 * If a future palette change fails the contrast floor, the fix is to pull the
 * endpoints closer together (less lightness travel, still monotonic) or to
 * demote the fill to a thin rule under a normally-coloured label — never to
 * loosen the floor.
 */
export type RailTheme = 'light' | 'dark';

export const WEEK_BAND_RAMP: Record<RailTheme, { start: string; end: string }> = {
  light: { start: '#cfd4db', end: '#7e858f' },
  dark: { start: '#262b31', end: '#565c64' },
};

/** The colour the `WEEK n` label is drawn in — `--foreground`, per theme. */
export const RAIL_BAND_LABEL: Record<RailTheme, string> = {
  light: '#171717',
  dark: '#ededed',
};

/** The rail's own opaque backdrop — `bg-white dark:bg-gray-800`. */
export const RAIL_BACKDROP: Record<RailTheme, string> = {
  light: '#ffffff',
  dark: '#1f2937',
};

/**
 * The one saturated fill on the rail — the highlight pill, `bg-blue-600`.
 *
 * It means exactly one thing ("you are here"), which is why the band is
 * neutral. Re-tinting the ramp back toward it is the exact change that caused
 * iOS's one real collision, where the band and the selected chip merged into a
 * single shape.
 */
export const RAIL_PILL = '#2563eb';

/**
 * How far an unreachable week's fill is faded.
 *
 * **The fill, never the `WEEK n` label.** A dimming pass over the whole label
 * is what took an empty iOS chip's text to a sampled ~3.7:1. Fading only the
 * fill cannot repeat that: the ramp sits between the rail's background and the
 * label's colour in both themes, so a faded fill composites *toward* the
 * background and can only raise the label's contrast.
 */
export const UNREACHABLE_FILL_OPACITY = 0.3;

/**
 * The step, clamped and rounded to whole percent.
 *
 * Shared by `rampBackground` and `rampHex` so the colour the contrast test
 * computes is byte-for-byte the colour the browser paints, rather than a
 * neighbouring one that rounds differently.
 */
export function rampPercent(step: number): number {
  if (!Number.isFinite(step)) return 0;
  return Math.round(Math.min(1, Math.max(0, step)) * 100);
}

/** What a band bar paints with. `color-mix` in sRGB is a plain linear mix. */
export function rampBackground(step: number): string {
  return `color-mix(in srgb, var(--rail-band-end) ${rampPercent(step)}%, var(--rail-band-start))`;
}

/** The same mix, resolved — for tests, which have no browser to ask. */
export function rampHex(theme: RailTheme, step: number): string {
  const { start, end } = WEEK_BAND_RAMP[theme];
  const t = rampPercent(step) / 100;
  const channels = [1, 3, 5].map(i => {
    const a = parseInt(start.slice(i, i + 2), 16);
    const b = parseInt(end.slice(i, i + 2), 16);
    return Math.round(a + (b - a) * t);
  });
  return `#${channels.map(c => c.toString(16).padStart(2, '0')).join('')}`;
}
```

- [ ] **Step 4: Add the CSS tokens**

In `frontend/src/app/globals.css`, immediately after the existing top-level
`:root { --day-rail-h: 0px; }` block, insert:

```css
/* week-band-ramp:start */
:root {
  /*
   * The week band above the day rail (#274 phase 1).
   *
   * 16px rather than iOS's 14pt: web's `WEEK n` is 10px text, and 14px leaves
   * no room around it at the browser's own minimum font size.
   *
   * The two endpoints are duplicated in `lib/utils/railBandPalette.ts`, which
   * is where `weekBandContrast.test.ts` computes the WCAG and ΔE floors — and
   * that test reads this block back and asserts the two agree, so the copies
   * cannot drift. The markers around this block are what it slices on; do not
   * remove them.
   */
  --rail-band-h: 16px;
  --rail-band-start: #cfd4db;
  --rail-band-end: #7e858f;
}

@media (prefers-color-scheme: dark) {
  :root {
    --rail-band-start: #262b31;
    --rail-band-end: #565c64;
  }
}
/* week-band-ramp:end */
```

- [ ] **Step 5: Run to verify it passes**

```bash
cd frontend && npx vitest run src/__tests__/lib/utils/weekBandContrast.test.ts
```

Expected: PASS.

- [ ] **Step 6: Falsify the token-agreement guard**

Change `--rail-band-end: #7e858f;` in `globals.css` to `#79808a` and re-run.
Expected: `light --rail-band-end matches the palette` FAILS. Then also change
`WEEK_BAND_RAMP.light.end` to `'#79808a'` and re-run: the agreement test passes
again but `clears AA against the WEEK n label in light` now FAILS — which is
the whole point of having both guards. Restore both.

- [ ] **Step 7: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add frontend/src/lib/utils/railBandPalette.ts frontend/src/app/globals.css frontend/src/__tests__/lib/utils/weekBandContrast.test.ts
git commit -m "feat(web): week band colour ramp, pinned by contrast and neutrality (#274)"
```

---

## Task 5: `WeekBandCell` — one day's slice

**Files:**
- Create: `frontend/src/lib/utils/railMetrics.ts`
- Create: `frontend/src/__tests__/lib/utils/railMetrics.test.ts`
- Create: `frontend/src/components/calendar/WeekBandCell.tsx`
- Create: `frontend/src/__tests__/components/calendar/WeekBandCell.test.tsx`

**Interfaces:**
- Consumes: `WeekBandSegment`, `WeekBandDestination`, `weekBandUnreachableLabel`
  (Tasks 1–3); `rampBackground`, `UNREACHABLE_FILL_OPACITY` (Task 4).
- Produces:
  - `const RAIL_CHIP_GUTTER_PX = 4`, `RAIL_BAND_BLEED_PX`, `RAIL_WEEK_SEAM_PX`,
    `RAIL_BAND_HEIGHT_PX = 16`, `RAIL_BAND_RADIUS_PX = 3` from `@/lib/utils/railMetrics`
  - `interface WeekBandCellProps { segment: WeekBandSegment | null; destinations: Map<number, WeekBandDestination>; bridgesLeading: boolean; bridgesTrailing: boolean; isTabStop: boolean; onSelectWeek: (week: number) => void }`
  - `function WeekBandCell(props: WeekBandCellProps)` from `@/components/calendar/WeekBandCell`

**The two things allowed out of the box, and only these two.** The painted fill
(it bridges half a gutter on each bridged side, so two bridged neighbours meet
exactly at the gutter's midpoint with no hairline and no overlap seam) and the
`WEEK n` label (absolutely positioned, allowed to overhang, clipped only by the
scroller — the label names a whole week, so overhanging is correct; widening
one column of the rail is not). Neither may change the cell's own box.

**The a11y shape.** Exactly one real `<button>` per week — the labelled
segment, carrying the accessible name. Every other segment is an `aria-hidden`
`<div>` carrying the pointer handler: the same "must be a `<div>`, never a
`<button>`" call the clipped copy row already makes, and for the same reason —
it must not answer to a selector looking for a control. Nine elements reading
"Week 1" through "Week 9" is the band's actual content; exposing all ~64 would
put sixty-odd mostly-unlabelled stops in front of a reader swiping the rail.

- [ ] **Step 1: Write the failing metrics test**

Create `frontend/src/__tests__/lib/utils/railMetrics.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RAIL_BAND_BLEED_PX, RAIL_BAND_HEIGHT_PX, RAIL_CHIP_GUTTER_PX, RAIL_WEEK_SEAM_PX,
} from '@/lib/utils/railMetrics';

describe('railMetrics', () => {
  it('derives the bleed and the seam from the chip gutter', () => {
    // Two independent 2s would drift the moment the gutter was tuned, and the
    // symptom would be a hairline or an overlap seam between two bridged
    // neighbours — not an error.
    expect(RAIL_BAND_BLEED_PX).toBe(RAIL_CHIP_GUTTER_PX / 2);
    expect(RAIL_WEEK_SEAM_PX).toBe(RAIL_CHIP_GUTTER_PX / 2);
  });

  it('matches the --rail-band-h the stylesheet publishes', () => {
    // The band's box is sized in CSS and its spacer in the clipped copy row is
    // sized from the same token; this pins the TypeScript copy the browser
    // checks are written against.
    const css = readFileSync(new URL('../../../app/globals.css', import.meta.url), 'utf8');
    expect(css).toContain(`--rail-band-h: ${RAIL_BAND_HEIGHT_PX}px;`);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then write `railMetrics.ts`**

```bash
cd frontend && npx vitest run src/__tests__/lib/utils/railMetrics.test.ts
```

Expected: FAIL — unresolved import. Then create
`frontend/src/lib/utils/railMetrics.ts`:

```ts
/**
 * The rail's shared horizontal metrics.
 *
 * One place, because the band's fill overflow is *derived* from the chip
 * gutter rather than being a second literal that happens to match today: the
 * fill bridges exactly half a gutter on each side, so two bridged neighbours
 * meet with no hairline and no overlap seam. Mirrors iOS's `RailMetrics`.
 *
 * The gutter is applied as an inline `gap` on the rail's two stacked rows
 * rather than as Tailwind's `gap-1`, so the constant the bleed is derived from
 * is the same one the browser lays out with.
 */

/** Space between two day chips. */
export const RAIL_CHIP_GUTTER_PX = 4;

/**
 * How far a bridged band fill overflows its own segment on one side — half the
 * gutter, so two neighbours' overflows meet exactly at the gutter's midpoint.
 */
export const RAIL_BAND_BLEED_PX = RAIL_CHIP_GUTTER_PX / 2;

/**
 * The break between two weeks' runs, drawn through the middle of the boundary
 * Saturday they share.
 *
 * Deliberately *narrower* than a chip gutter: it is the only gap left in the
 * band, so it does not need to shout, and a wider one would start to look like
 * the per-chip gaps this design removes.
 */
export const RAIL_WEEK_SEAM_PX = RAIL_CHIP_GUTTER_PX / 2;

/**
 * The band's height. Published as `--rail-band-h` in `globals.css`, which is
 * what sizes both the band itself and the transparent spacer that keeps the
 * clipped copy row in step with it.
 */
export const RAIL_BAND_HEIGHT_PX = 16;

/**
 * Rounding on a run's outer ends. Small enough to stay a bar rather than a
 * capsule, large enough that a run reads as one closed shape.
 */
export const RAIL_BAND_RADIUS_PX = 3;
```

Re-run: PASS.

- [ ] **Step 3: Write the failing cell test**

Create `frontend/src/__tests__/components/calendar/WeekBandCell.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { WeekBandCell } from '@/components/calendar/WeekBandCell';
import { weekBandSegments, type WeekBandDestination } from '@/lib/utils/weekBands';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import { RAIL_BAND_BLEED_PX, RAIL_WEEK_SEAM_PX } from '@/lib/utils/railMetrics';
import { UNREACHABLE_FILL_OPACITY } from '@/lib/utils/railBandPalette';

const weeks = getChautauquaSeasonWeeks(2026);
const segmentFor = (key: string) => weekBandSegments([key], weeks)[0];

const reachable = (...numbers: number[]) =>
  new Map<number, WeekBandDestination>(
    numbers.map(n => [n, { dayKey: '2026-07-25', label: `Go to Week ${n}, opens Saturday, July 25, 3 events` }]),
  );

function renderCell(overrides: Partial<Parameters<typeof WeekBandCell>[0]> = {}) {
  const props = {
    // '2026-06-30' is a solo week-1 day, and the only key rendered, so it is
    // also the labelled one.
    segment: segmentFor('2026-06-30'),
    destinations: reachable(1),
    bridgesLeading: false,
    bridgesTrailing: false,
    isTabStop: false,
    onSelectWeek: vi.fn(),
    ...overrides,
  };
  return { ...render(<WeekBandCell {...props} />), props };
}

const bars = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[data-band-bar]'));

describe('WeekBandCell — the painted run', () => {
  it('draws one bar for an ordinary day', () => {
    const { container } = renderCell();
    expect(bars(container)).toHaveLength(1);
  });

  it('draws two bars split by the seam for a boundary Saturday', () => {
    // A shared Saturday carries BOTH weeks' tones, split down the middle —
    // that is what says "this day is in both" directly.
    const { container } = renderCell({
      segment: segmentFor('2026-07-04'), destinations: reachable(1, 2),
    });
    expect(bars(container)).toHaveLength(2);
    const run = container.querySelector<HTMLElement>('[data-band-run]')!;
    expect(run.style.gap).toBe(`${RAIL_WEEK_SEAM_PX}px`);
  });

  it('draws nothing outside the season', () => {
    const { container } = renderCell({ segment: segmentFor('2026-01-15'), destinations: new Map() });
    expect(bars(container)).toHaveLength(0);
    expect(container.querySelector('[data-band-run]')).toBeNull();
  });

  it('bleeds half a gutter only on a bridged side', () => {
    const { container } = renderCell({ bridgesLeading: true, bridgesTrailing: false });
    const run = container.querySelector<HTMLElement>('[data-band-run]')!;
    expect(run.style.left).toBe(`${-RAIL_BAND_BLEED_PX}px`);
    expect(run.style.right).toBe('0px');
  });

  it('never bleeds a cell that has no run to draw', () => {
    // `bridgesLeading`/`bridgesTrailing` are looked up by raw index; refusing
    // to bleed when this cell has no segment is what keeps a stale bridge
    // answer from painting a run over a day that has none.
    const { container } = renderCell({
      segment: null, destinations: new Map(), bridgesLeading: true, bridgesTrailing: true,
    });
    expect(container.querySelector('[data-band-run]')).toBeNull();
  });

  it('fades an unreachable week and only its own half of a shared Saturday', () => {
    // Reachability is per WEEK, not per segment, precisely so a shared
    // Saturday's two halves can disagree: it can close a week that still has
    // events and open one that has none.
    const { container } = renderCell({
      segment: segmentFor('2026-07-04'), destinations: reachable(1),
    });
    const [closing, opening] = bars(container);
    expect(closing.style.opacity).toBe('1');
    expect(opening.style.opacity).toBe(String(UNREACHABLE_FILL_OPACITY));
  });

  it('dims nothing when reachability is not known yet', () => {
    // An empty MAP means "no reachability information yet", not "nothing is
    // reachable" — the first paint must not flash a fully faded band.
    const { container } = renderCell({ destinations: new Map() });
    expect(bars(container)[0].style.opacity).toBe('1');
  });
});

describe('WeekBandCell — accessibility', () => {
  it('exposes exactly one button, on the labelled segment', () => {
    const { container } = renderCell();
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.querySelector('button')!.textContent).toBe('Week 1');
  });

  it('names a reachable week by its destination', () => {
    const { container } = renderCell();
    expect(container.querySelector('button')!.getAttribute('aria-label'))
      .toBe('Go to Week 1, opens Saturday, July 25, 3 events');
  });

  it('states an unreachable week as a fact and refuses the tap', () => {
    const { container, props } = renderCell({ destinations: new Map([[9, {
      dayKey: '2026-08-24', label: 'x',
    }]]) });
    const button = container.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Week 1, no events');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(props.onSelectWeek).not.toHaveBeenCalled();
  });

  it('hides an unlabelled segment from assistive technology', () => {
    // Sixty-odd mostly-unlabelled stops in front of a reader swiping the rail
    // is the thing this avoids — and an unlabelled element is itself what an
    // audit flags.
    // A segment rendered alone is always its own week's labelled day, so the
    // unlabelled shape is forced explicitly rather than relying on a fixture
    // accident that a later change to the fixture would quietly undo.
    const unlabelled = { ...segmentFor('2026-07-01'), labelledWeek: null };
    const { container } = renderCell({ segment: unlabelled });
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelector('[data-band-hit]')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps the pointer handler on the hidden segment', () => {
    // Hidden from a screen reader, still tappable by a thumb: the week's six
    // non-shared days are what carry its navigation.
    const unlabelled = { ...segmentFor('2026-07-01'), labelledWeek: null };
    const onSelectWeek = vi.fn();
    const { container } = render(
      <WeekBandCell segment={unlabelled} destinations={reachable(1)}
        bridgesLeading={false} bridgesTrailing={false} isTabStop={false} onSelectWeek={onSelectWeek} />
    );
    fireEvent.click(container.querySelector('[data-band-hit]')!);
    expect(onSelectWeek).toHaveBeenCalledWith(1);
  });

  it('never fires from a shared Saturday, which cannot mean one week', () => {
    const onSelectWeek = vi.fn();
    const { container } = render(
      <WeekBandCell segment={segmentFor('2026-07-04')} destinations={reachable(1, 2)}
        bridgesLeading={false} bridgesTrailing={false} isTabStop={false} onSelectWeek={onSelectWeek} />
    );
    fireEvent.click(container.querySelector('[data-band-hit]')!);
    expect(onSelectWeek).not.toHaveBeenCalled();
  });

  it('is the rail band\'s single tab stop when told it is', () => {
    const { container } = renderCell({ isTabStop: true });
    expect(container.querySelector('button')!.tabIndex).toBe(0);
    const { container: c2 } = renderCell({ isTabStop: false });
    expect(c2.querySelector('button')!.tabIndex).toBe(-1);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

```bash
cd frontend && npx vitest run src/__tests__/components/calendar/WeekBandCell.test.tsx
```

Expected: FAIL — unresolved import `@/components/calendar/WeekBandCell`.

- [ ] **Step 5: Write the component**

Create `frontend/src/components/calendar/WeekBandCell.tsx`:

```tsx
import type { WeekBandDestination, WeekBandSegment } from '@/lib/utils/weekBands';
import { weekBandUnreachableLabel } from '@/lib/utils/weekBands';
import { UNREACHABLE_FILL_OPACITY, rampBackground } from '@/lib/utils/railBandPalette';
import {
  RAIL_BAND_BLEED_PX, RAIL_BAND_RADIUS_PX, RAIL_WEEK_SEAM_PX,
} from '@/lib/utils/railMetrics';

export interface WeekBandCellProps {
  /**
   * This day's segment, or `null` for a day the band says nothing about — out
   * of season, or an index the caller could not confirm belongs to this chip.
   */
  segment: WeekBandSegment | null;
  /**
   * Which weeks can be reached under the current non-date filters.
   *
   * An **empty** map means "no reachability information yet", not "nothing is
   * reachable": nothing is dimmed, so the first paint cannot flash a fully
   * faded band.
   */
  destinations: Map<number, WeekBandDestination>;
  /** Whether this day's fill continues into the gutter on that side. */
  bridgesLeading: boolean;
  bridgesTrailing: boolean;
  /** Whether this cell's button is the band row's single tab stop. */
  isTabStop: boolean;
  onSelectWeek: (week: number) => void;
}

/**
 * One day's slice of the week band above the chips.
 *
 * The cell's own box is exactly one chip wide, and stays that way: only the
 * painted fill and the `WEEK n` label are allowed outside it, both by absolute
 * positioning that cannot change the size of the box it is drawn in. A label
 * that widened its column would pull the band out of line with the chips it
 * labels, and with it the chip below.
 */
export function WeekBandCell({
  segment, destinations, bridgesLeading, bridgesTrailing, isTabStop, onSelectWeek,
}: WeekBandCellProps) {
  const numbers = segment?.weekNumbers ?? [];
  // A day cannot be in three Chautauqua weeks. Drawing the first two rather
  // than crashing a rail over a colour is the same call iOS's `runSteps` makes.
  const steps = (segment?.rampSteps ?? []).slice(0, 2);

  // A bleed is only ever applied to a cell that actually has a run to draw: a
  // null segment paints nothing, so it must not paint nothing *wider*.
  const leadingBleed = segment && bridgesLeading ? RAIL_BAND_BLEED_PX : 0;
  const trailingBleed = segment && bridgesTrailing ? RAIL_BAND_BLEED_PX : 0;

  // Reachability is per WEEK, not per segment, precisely so a shared
  // Saturday's two halves can disagree.
  const isReachable = (week: number | undefined) =>
    destinations.size === 0 || week === undefined || destinations.has(week);

  const target = segment?.navigationTarget ?? null;
  const navigable = target !== null && destinations.has(target);
  const labelled = segment?.labelledWeek ?? null;
  const navigate = () => { if (navigable && target !== null) onSelectWeek(target); };

  const bar = (index: number, roundsLeading: boolean, roundsTrailing: boolean) => (
    <span
      key={index}
      data-band-bar
      className="block flex-1"
      style={{
        // A named token first, so a browser that drops the `color-mix`
        // declaration still paints a band rather than nothing.
        backgroundColor: 'var(--rail-band-start)',
        background: rampBackground(steps[index]),
        opacity: isReachable(numbers[index]) ? 1 : UNREACHABLE_FILL_OPACITY,
        borderTopLeftRadius: roundsLeading ? RAIL_BAND_RADIUS_PX : 0,
        borderBottomLeftRadius: roundsLeading ? RAIL_BAND_RADIUS_PX : 0,
        borderTopRightRadius: roundsTrailing ? RAIL_BAND_RADIUS_PX : 0,
        borderBottomRightRadius: roundsTrailing ? RAIL_BAND_RADIUS_PX : 0,
      }}
    />
  );

  return (
    <div data-band-cell={segment?.dayKey} className="relative h-[var(--rail-band-h)] shrink-0">
      {steps.length > 0 && (
        <span
          data-band-run
          aria-hidden="true"
          className="absolute inset-y-0 flex"
          style={{
            left: `${-leadingBleed}px`,
            right: `${-trailingBleed}px`,
            gap: `${RAIL_WEEK_SEAM_PX}px`,
          }}
        >
          {/*
            Rounded only where the run actually ends — at a seam, or at the
            edge of the season. A rounded end inside a run would be a false
            boundary; a square end at a real one would blunt the only signal
            this design has left. Both inner ends of a split are rounded: they
            are the ends of two different weeks' runs, not the middle of one.
          */}
          {steps.length === 1
            ? bar(0, !bridgesLeading, !bridgesTrailing)
            : [bar(0, !bridgesLeading, true), bar(1, true, !bridgesTrailing)]}
        </span>
      )}

      {labelled !== null ? (
        <button
          type="button"
          data-week-band-button={labelled}
          // Named by destination, never by direction — and an unreachable week
          // is stated as a fact rather than offered.
          aria-label={destinations.get(labelled)?.label ?? weekBandUnreachableLabel(labelled)}
          aria-disabled={navigable ? undefined : true}
          // One tab stop for the whole band, like the chip row below it. The
          // rail's own key handler walks between the week buttons.
          tabIndex={isTabStop ? 0 : -1}
          onClick={navigate}
          className="absolute inset-0 block"
        >
          {/*
            Absolutely positioned and centred, so a label wider than one chip
            overhangs its neighbours (clipped only by the scroller) instead of
            widening this column. `pointer-events-none` so the overhang cannot
            steal a tap from the week beside it.
          */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] font-semibold uppercase leading-none tracking-wide"
            style={{ color: 'var(--foreground)' }}
          >
            {`Week ${labelled}`}
          </span>
        </button>
      ) : (
        /*
          A div, not a button, and carrying no accessible name. This layer is a
          tap target, not content: exposing all ~64 segments would put
          sixty-odd mostly-unlabelled stops in front of a reader swiping the
          rail, and an unlabelled element is itself what an audit flags. It
          holds nothing focusable, which is what keeps axe's
          `aria-hidden-focus` clean.
        */
        <div
          data-band-hit
          aria-hidden="true"
          onClick={navigate}
          className={`absolute inset-0 ${navigable ? 'cursor-pointer' : ''}`}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run to verify it passes**

```bash
cd frontend && npx vitest run src/__tests__/components/calendar/WeekBandCell.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Falsify the two rules most likely to be written wrong**

Change `isReachable` to `destinations.has(week!)` (dropping the empty-map
branch) and re-run: `dims nothing when reachability is not known yet` must
FAIL. Restore. Then change the shared-Saturday branch to
`bar(0, …), bar(1, …)` with both using `numbers[0]` and re-run: `fades an
unreachable week and only its own half of a shared Saturday` must FAIL.
Restore.

- [ ] **Step 8: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add frontend/src/lib/utils/railMetrics.ts frontend/src/components/calendar/WeekBandCell.tsx frontend/src/__tests__/lib/utils/railMetrics.test.ts frontend/src/__tests__/components/calendar/WeekBandCell.test.tsx
git commit -m "feat(web): WeekBandCell — one day's slice of the week band (#274)"
```

---

## Task 6: `DayRail` — columns, the spacer, and the re-based pill

**Files:**
- Modify: `frontend/src/hooks/useRailHighlight.ts`
- Modify: `frontend/src/components/calendar/DayRail.tsx`
- Modify: `frontend/src/__tests__/hooks/useRailHighlight.test.tsx`
- Modify: `frontend/src/__tests__/components/calendar/DayRail.test.tsx`

**Interfaces:**
- Consumes: `WeekBandCell` (Task 5); `weekBandSegments`, `bridgesGutter`,
  `WeekBandSegment`, `WeekBandDestination` (Tasks 1–3);
  `RAIL_CHIP_GUTTER_PX` (Task 5).
- Produces:
  - `const RAIL_CHIP_SELECTOR = ':scope > [data-rail-column] > [data-chip]'` from `@/hooks/useRailHighlight`
  - `DayRailProps` gains `bandSegments: WeekBandSegment[]`,
    `weekDestinations: Map<number, WeekBandDestination>`,
    `onSelectWeek: (week: number) => void` — all required, so a caller cannot
    silently render a rail with no band.

**The two risks the spec names, both in `useRailHighlight`.**

1. **Pill geometry.** The pill is `absolute inset-y-0` against the content
   container. With a band above the chips it would paint over the band. It
   re-bases to the chip row's top (`top: var(--rail-band-h); bottom: 0`).
2. **Layer parity.** The clipped copy row must grow the *same* column wrapper
   with a transparent band-height spacer, or the two layers desync and produce
   the seam through a digit that the shared `chipBoxClass` exists to prevent.
   Both layers keep sharing one class for the box; the column class and the
   band spacer join that contract.

**A third, not in the spec, that will bite first.** `measureChips` and the
keyboard walk both query `':scope > [data-chip]'`. Once a chip is a
grandchild of the content element that matches **nothing** — the pill would
silently stop painting and every highlight test would keep passing on a
harness that never had a real chip row. One exported constant, used by both,
plus a `DayRail` test asserting it matches every chip in the real component.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/__tests__/components/calendar/DayRail.test.tsx`
(and update `renderRail`/`renderRailIn` to pass the three new props — use
`bandSegments: weekBandSegments(chips.map(c => c.key), getChautauquaSeasonWeeks(2026))`,
`weekDestinations: new Map([[1, { dayKey: '2026-07-04', label: 'Go to Week 1, opens Saturday, July 4, 12 events' }], [2, { dayKey: '2026-07-05', label: 'Go to Week 2, first events Sunday, July 5, 1 event' }]])`,
`onSelectWeek: vi.fn()`):

```tsx
import { weekBandSegments } from '@/lib/utils/weekBands';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import { RAIL_CHIP_GUTTER_PX } from '@/lib/utils/railMetrics';
import { RAIL_CHIP_SELECTOR } from '@/hooks/useRailHighlight';

describe('DayRail — the week band', () => {
  it('renders one band cell per chip, inside the rail\'s own root', () => {
    // Inside the root `rootRef` lands on, because `useDayRailHeight` measures
    // only that element: persistent chrome in a sibling widens the stuck
    // header without widening `--day-rail-h`.
    const { container } = renderRailIn();
    const root = container.querySelector('[data-day-rail]')!;
    expect(root.querySelectorAll('[data-band-cell]')).toHaveLength(chips.length);
  });

  it('keeps the chip row findable by the one selector both walkers use', () => {
    // The guard against the failure that would otherwise be silent: chips are
    // grandchildren of the content element now, and a stale `:scope >
    // [data-chip]` matches nothing while every test still passes.
    const { container } = renderRailIn();
    const content = container.querySelector('[data-rail-content]')!;
    expect(content.querySelectorAll(RAIL_CHIP_SELECTOR)).toHaveLength(chips.length);
  });

  it('grows the clipped copy with a band-height spacer, column for column', () => {
    // The copy is positioned on top of the real row and clipped, so a single
    // pixel of difference shows as a seam through the middle of a digit.
    const { container } = renderRailIn();
    const copy = container.querySelector('[data-rail-clip]')!;
    expect(copy.querySelectorAll('[data-rail-column]')).toHaveLength(chips.length);
    expect(copy.querySelectorAll('[data-band-spacer]')).toHaveLength(chips.length);
    // And it is still paint, not controls.
    expect(copy.querySelectorAll('button')).toHaveLength(0);
    expect(copy.querySelectorAll('[data-chip]')).toHaveLength(0);
  });

  it('re-bases the highlight pill below the band', () => {
    const { container } = renderRailIn();
    const pill = container.querySelector<HTMLElement>('[data-rail-pill]')!;
    expect(pill.style.top).toBe('var(--rail-band-h)');
    expect(pill.style.bottom).toBe('0px');
  });

  it('lays both rows out on the shared gutter constant', () => {
    const { container } = renderRailIn();
    for (const row of ['[data-rail-content]', '[data-rail-clip]']) {
      expect(container.querySelector<HTMLElement>(row)!.style.gap)
        .toBe(`${RAIL_CHIP_GUTTER_PX}px`);
    }
  });

  it('makes the anchor\'s own week the band\'s tab stop', () => {
    const { container } = renderRailIn({ anchorDay: '2026-07-05' });
    const stops = Array.from(container.querySelectorAll<HTMLElement>('[data-week-band-button]'))
      .filter(b => b.tabIndex === 0);
    expect(stops).toHaveLength(1);
    // 2026-07-05 is a solo week-2 day; 07-04 is the shared Saturday, which
    // lights the LATER of its two weeks — the one the reader is scrolling into.
    expect(stops[0].dataset.weekBandButton).toBe('2');
  });

  it('walks the band row with the arrow keys, not the chip row', () => {
    // The default 3-chip fixture spans one solo week and so carries exactly
    // ONE labelled button — nothing to walk to. This fixture spans Jun 28
    // through Jul 11, which has a labelled day in week 1 and another in week
    // 2.
    const wide = dayChips(dayKeys('2026-06-28', '2026-07-11'), new Map([['2026-06-30', 4]]));
    const { container } = renderRailIn({
      chips: wide,
      bandSegments: weekBandSegments(wide.map(c => c.key), getChautauquaSeasonWeeks(2026)),
      anchorDay: '2026-06-30',
      windowDayKeys: wide.map(c => c.key),
    });
    const buttons = Array.from(container.querySelectorAll<HTMLElement>('[data-week-band-button]'));
    expect(buttons.length).toBeGreaterThan(1);
    buttons[0].focus();
    fireEvent.keyDown(container.querySelector('[data-day-rail]')!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[1]);
  });

  it('hands a band tap to onSelectWeek and resumes the strip', () => {
    // In the default fixture the sole labelled segment is 2026-07-06, whose
    // week is 2 — 07-04 is the shared Saturday and carries no label at all.
    const props = renderRail();
    const strip = document.querySelector<HTMLElement>('[data-rail-strip]')!;
    strip.scrollLeft = 500;   // the reader has panned the rail
    fireEvent.click(document.querySelector('[data-week-band-button="2"]')!);
    expect(props.onSelectWeek).toHaveBeenCalledWith(2);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd frontend && npx vitest run src/__tests__/components/calendar/DayRail.test.tsx
```

Expected: FAIL — `RAIL_CHIP_SELECTOR` is not exported and no `[data-band-cell]`
exists.

- [ ] **Step 3: Export the selector from `useRailHighlight.ts`**

Add near `FALLBACK_PITCH`:

```ts
/**
 * The real chip row, and only it.
 *
 * `:scope >` restricts every walk to the content element's own columns. The
 * highlighted copy row is a descendant of that same element and carries its
 * own `[data-rail-column]` children, so an unscoped query would measure and
 * walk every chip twice.
 *
 * Exported because `DayRail`'s keyboard walk needs the identical string: the
 * chips are grandchildren of the content element (each sits under the column
 * that also holds its week-band cell), and a copy of this selector that fell
 * out of step would match **nothing** — the pill would silently stop painting
 * and the arrow keys would stop moving, with no error anywhere.
 */
export const RAIL_CHIP_SELECTOR = ':scope > [data-rail-column] > [data-chip]';
```

and in `measureChips`, replace

```ts
    for (const el of Array.from(content.querySelectorAll<HTMLElement>(':scope > [data-chip]'))) {
```

with

```ts
    for (const el of Array.from(content.querySelectorAll<HTMLElement>(RAIL_CHIP_SELECTOR))) {
```

- [ ] **Step 4: Update the `useRailHighlight` test harness**

In `frontend/src/__tests__/hooks/useRailHighlight.test.tsx`, replace

```tsx
        {chips.map(k => <button key={k} type="button" data-chip={k} />)}
```

with

```tsx
        {/*
          Mirrors `DayRail`: a chip is the second child of a column whose first
          child is its week-band cell. Flattening this back would make
          `RAIL_CHIP_SELECTOR` match nothing, and every assertion in this file
          would keep passing against a hook that measured an empty row.
        */}
        {chips.map(k => (
          <div key={k} data-rail-column>
            <div data-band-cell={k} />
            <button type="button" data-chip={k} />
          </div>
        ))}
```

- [ ] **Step 5: Rewrite `DayRail`'s row markup**

In `frontend/src/components/calendar/DayRail.tsx`:

(a) Add imports:

```tsx
import { WeekBandCell } from '@/components/calendar/WeekBandCell';
import { bridgesGutter, type WeekBandDestination, type WeekBandSegment } from '@/lib/utils/weekBands';
import { RAIL_CHIP_GUTTER_PX } from '@/lib/utils/railMetrics';
import { RAIL_CHIP_SELECTOR, useRailHighlight } from '@/hooks/useRailHighlight';
```

(replacing the existing `useRailHighlight` import).

(b) Below `chipBoxClass`, add:

```tsx
/**
 * The column that holds one day's band cell and its chip.
 *
 * Shared verbatim by the two layers for the same reason `chipBoxClass` is: the
 * clipped copy is positioned on top of the real row, so a column that laid out
 * differently in one layer would show as a seam. `items-stretch` on the rows
 * (not `items-center`) is what keeps every band cell on the same baseline —
 * a chip carrying a month label is a line taller than its neighbours, and
 * centring the columns would push those days' band segments out of line.
 */
const railColumnClass = 'flex shrink-0 flex-col';

/** The band's own row, for the keyboard walk. Excludes the clipped copy's columns. */
const BAND_BUTTON_SELECTOR = ':scope > [data-rail-column] [data-week-band-button]';
```

(c) Add to `DayRailProps`:

```tsx
  /**
   * One segment per chip, in the same order — `weekBandSegments(chipKeys, …)`.
   *
   * Passed rather than derived here so the band's model stays a pure function
   * of the season that can be tested without a view, and so the reachability
   * map beside it is built once per filter change rather than per render.
   */
  bandSegments: WeekBandSegment[];
  /**
   * Which weeks the band can reach under the current non-date filters. A week
   * absent from the map renders faded and refuses its tap; an empty map means
   * "not known yet" and dims nothing.
   */
  weekDestinations: Map<number, WeekBandDestination>;
  /** A band tap. The caller turns the week into a day and calls `goToDay`. */
  onSelectWeek: (week: number) => void;
```

(d) Destructure the three new props in the function signature.

(e) After `tabStopKey`, add:

```tsx
  // The band is one tab stop, like the chip row: the week the reader is
  // actually in, resolved from the band's own model rather than from a second
  // date computation. A shared Saturday lights the LATER of its two weeks —
  // the one the reader is scrolling into. Falls back to the first labelled
  // week so the band is never unreachable from the keyboard.
  const anchorSegment = bandSegments.find(s => s.dayKey === anchorDay);
  const anchorWeek = anchorSegment?.weekNumbers[anchorSegment.weekNumbers.length - 1] ?? null;
  const bandTabStopWeek = anchorWeek
    ?? bandSegments.find(s => s.labelledWeek !== null)?.labelledWeek
    ?? null;
```

(f) Replace the body of `onKeyDown` with:

```tsx
    const content = contentEl.current;
    if (!content) return;
    const active = document.activeElement as HTMLElement | null;
    // Which row the walk applies to is decided by where focus already is, so
    // the band and the chips each behave like the single strip they look like.
    const onBand = active?.hasAttribute('data-week-band-button') ?? false;
    const buttons = Array.from(content.querySelectorAll<HTMLElement>(
      onBand ? BAND_BUTTON_SELECTOR : RAIL_CHIP_SELECTOR));
    const current = buttons.indexOf(active as HTMLElement);
    if (current < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = Math.min(current + 1, buttons.length - 1);
    else if (e.key === 'ArrowLeft') next = Math.max(current - 1, 0);
    else if (e.key === 'Home') {
      if (onBand) next = 0;
      else {
        const idx = todayKey ? buttons.findIndex(b => b.dataset.chip === todayKey) : 0;
        next = idx < 0 ? 0 : idx;
      }
    }
    else return;
    if (next < 0) return;
    e.preventDefault();
    buttons[next].focus();
```

(g) Replace the content container and its two layers. The content element
becomes:

```tsx
        <div
          ref={contentRef}
          data-rail-content
          className="relative flex items-stretch w-max"
          // The gutter the band's bleed is derived from — one constant, not a
          // Tailwind class and a literal that happen to agree.
          style={{ gap: `${RAIL_CHIP_GUTTER_PX}px` }}
        >
          {chips.map((chip, index) => {
            const isEmpty = chip.count === 0;
            // Looked up by index, then confirmed by day key. Index alignment
            // is structural today (both arrays are built from the same chip
            // list, in order), but a segment drawn over the wrong day is a
            // silent, plausible-looking defect, so the band says nothing
            // rather than guessing.
            const raw = bandSegments[index];
            const segment = raw?.dayKey === chip.key ? raw : null;
            return (
              <div key={chip.key} data-rail-column className={railColumnClass}>
                <WeekBandCell
                  segment={segment}
                  destinations={weekDestinations}
                  bridgesLeading={bridgesGutter(index - 1, bandSegments)}
                  bridgesTrailing={bridgesGutter(index, bandSegments)}
                  isTabStop={segment?.labelledWeek !== null
                    && segment?.labelledWeek === bandTabStopWeek}
                  onSelectWeek={(week) => { resume(); onSelectWeek(week); }}
                />
                <button
                  type="button"
                  data-chip={chip.key}
                  aria-label={chip.label}
                  aria-current={chip.key === anchorDay ? 'date' : undefined}
                  aria-disabled={isEmpty || undefined}
                  tabIndex={chip.key === tabStopKey ? 0 : -1}
                  onClick={() => { if (!isEmpty) { resume(); onSelectDay(chip.key); } }}
                  className={`${chipBoxClass(isEmpty)} text-gray-700 dark:text-gray-300 ${
                    isEmpty ? 'opacity-50 cursor-default' : 'hover:bg-blue-50 dark:hover:bg-gray-700'
                  }`}
                >
                  <ChipFace chip={chip} />
                </button>
              </div>
            );
          })}
```

the pill becomes:

```tsx
          <div
            ref={pillRef}
            data-rail-pill
            aria-hidden="true"
            className="absolute left-0 z-10 rounded-md bg-blue-600 pointer-events-none"
            // Re-based below the band: `inset-y-0` would paint the highlight
            // over the week it is meant to sit under. Vertical placement is
            // static; `useRailHighlight` writes only width and transform.
            style={{ opacity: 0, top: 'var(--rail-band-h)', bottom: '0px' }}
          />
```

and the clipped copy becomes:

```tsx
          <div
            ref={clipRef}
            data-rail-clip
            aria-hidden="true"
            className="absolute inset-0 z-20 flex items-stretch text-white pointer-events-none"
            style={{ gap: `${RAIL_CHIP_GUTTER_PX}px`, clipPath: 'inset(0 100% 0 0)' }}
          >
            {chips.map((chip) => (
              // Divs, not buttons, and carrying no `data-chip` — this row is
              // paint: it must not be a control, and it must not answer to a
              // selector looking for one.
              <div key={chip.key} data-rail-column className={railColumnClass}>
                {/*
                  The band's height, spent on nothing. Without it the copy's
                  chips sit one band higher than the real ones and every digit
                  gets a seam through it — the exact failure the shared
                  `chipBoxClass` exists to prevent, one level up.
                */}
                <div data-band-spacer className="h-[var(--rail-band-h)] shrink-0" />
                <div className={chipBoxClass(chip.count === 0)}>
                  <ChipFace chip={chip} />
                </div>
              </div>
            ))}
          </div>
```

- [ ] **Step 6: Run the full unit suite**

```bash
cd frontend && npx vitest run
```

Expected: PASS. If `useRailHighlight.test.tsx` fails, the harness in step 4 does
not match the markup in step 5 — fix the harness, never the hook.

- [ ] **Step 7: Falsify the layer-parity and selector guards**

Delete the `[data-band-spacer]` div and re-run: `grows the clipped copy with a
band-height spacer` must FAIL. Restore. Then change `RAIL_CHIP_SELECTOR` to
`':scope > [data-chip]'` and re-run: `keeps the chip row findable by the one
selector both walkers use` must FAIL **and** several `useRailHighlight` tests
must fail with an unplaced pill — which is the point: without the guard, only
the second set would have caught it, and only if the harness had been updated.
Restore.

- [ ] **Step 8: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add frontend/src/components/calendar/DayRail.tsx frontend/src/hooks/useRailHighlight.ts frontend/src/__tests__/components/calendar/DayRail.test.tsx frontend/src/__tests__/hooks/useRailHighlight.test.tsx
git commit -m "feat(web): the day rail carries the week band above its chips (#274)"
```

---

## Task 7: wire the band into `page.tsx`

**Files:**
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/src/__tests__/` — the page-level suite that already mounts
  the calendar (find it with `grep -rl "app/page" frontend/src/__tests__`)

**Interfaces:**
- Consumes: `weekBandSegments`, `weekBandDestinations` (Tasks 1–2); `DayRail`'s
  three new props (Task 6).
- Produces: nothing new — this is the last wire.

**What it is fed, and why each source is the right one.** `navEventDays` and
`navDayCounts` are built from `navMatchingEvents`, which is everything matching
the **non-date** filters. The rail is a navigation surface, not a filter
readout: feeding it the date-windowed subset would mark every day and every
week outside the current scope unreachable, which is the same wall in a new
control.

- [ ] **Step 1: Hoist the rail's day list**

`railChips` currently rebuilds the day list inline. Replace

```tsx
  const railChips = useMemo(
    () => dayChips(dayKeys(navBounds.startDay, navBounds.endDay), navDayCounts),
    [navBounds, navDayCounts]
  );
```

with

```tsx
  // Hoisted out of `railChips` because the week band needs the same list, and
  // in the same order: the band's segments are matched to chips by index.
  const railDayKeys = useMemo(
    () => dayKeys(navBounds.startDay, navBounds.endDay),
    [navBounds]
  );

  const railChips = useMemo(
    () => dayChips(railDayKeys, navDayCounts),
    [railDayKeys, navDayCounts]
  );

  // The band's segmentation depends only on the calendar, so it survives every
  // filter change untouched.
  const bandSegments = useMemo(
    () => weekBandSegments(railDayKeys, seasonWeeks),
    [railDayKeys, seasonWeeks]
  );

  // Reachability depends on the filters, so it does not. Kept separate from
  // the segments for exactly that reason.
  const weekDestinations = useMemo(
    () => weekBandDestinations({
      seasonWeeks, eventDays: navEventDays, bounds: navBounds, countsByDay: navDayCounts,
    }),
    [seasonWeeks, navEventDays, navBounds, navDayCounts]
  );
```

and add to the `@/lib/utils/weekBands` import:

```tsx
import { weekBandDestinations, weekBandSegments } from '@/lib/utils/weekBands';
```

- [ ] **Step 2: Add the tap handler beside `goToToday`**

```tsx
  /**
   * A week band tap.
   *
   * Two lookups, deliberately separate: `WeekBandCell` has already asked the
   * *calendar* which week this day unambiguously means, and this asks the
   * *filters* which day of that week can actually be reached. `goToDay` then
   * does what a chip tap does, expansion included — a band tap is navigation,
   * and it changes no scope, week, category or search.
   */
  const goToWeek = useCallback((week: number) => {
    const destination = weekDestinations.get(week);
    if (destination) goToDay(destination.dayKey);
  }, [weekDestinations, goToDay]);
```

- [ ] **Step 3: Pass the three props at the `<DayRail>` call site**

```tsx
            bandSegments={bandSegments}
            weekDestinations={weekDestinations}
            onSelectWeek={goToWeek}
```

- [ ] **Step 4: Add the page-level test**

In the page suite, add:

```tsx
  it('moves the list when a week band segment is tapped', async () => {
    // The seam between the pure model and the app: `weekBandDestinations`
    // decides the day, `goToDay` expands the window if it has to, and the
    // list mounts it. Each half is tested alone; only this covers the join.
    renderCalendar();                      // whatever this suite's helper is
    await screen.findByTestId?.('...');    // await the loaded list as the suite already does
    const band = document.querySelector<HTMLElement>('[data-week-band-button]')!;
    const before = document.querySelector('[data-day-key][aria-current], [data-chip][aria-current]')
      ?.getAttribute('data-chip');
    fireEvent.click(band);
    await waitFor(() => {
      const after = document.querySelector('[data-chip][aria-current]')?.getAttribute('data-chip');
      expect(after).not.toBe(before);
    });
  });
```

Match the surrounding suite's own helpers and fixtures rather than these
placeholders — the assertion that matters is "a band tap moves the anchor",
however this file already mounts and awaits the calendar.

- [ ] **Step 5: Run the whole suite and the build**

```bash
cd frontend && npm run build
```

Expected: type-check, lint, the full unit suite and `vite build` all pass.

- [ ] **Step 6: Falsify the wire**

Change `goToWeek` to `if (destination) goToDay(railDayKeys[0])` and re-run the
page test: `moves the list when a week band segment is tapped` should still
pass (it only asserts movement) — so **also** assert the landing day:

```tsx
    expect(document.querySelector('[data-chip][aria-current]')?.getAttribute('data-chip'))
      .toBe(expectedWeekOpeningDayKey);
```

with the expected key read from `weekBandDestinations` for that week in the
same fixture. Re-run with the defect: it must now FAIL. Restore. (This is the
recorded lesson from #250: an unguarded field is an unverified field, and a
test that only asserts "something changed" is one of those.)

- [ ] **Step 7: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add frontend/src/app/page.tsx frontend/src/__tests__
git commit -m "feat(web): a week band tap navigates to that week (#274)"
```

---

## Task 8: browser verification

**Files:**
- Modify: `frontend/e2e/verify-rail.mjs`
- Modify: `frontend/package.json` (add `axe-core` to `devDependencies`)

**Why this task is not optional.** Everything phase 1 risks is geometry, and
jsdom computes none of it. Phase 3a's own history is the argument: eleven green
task reviews shipped a rail that did not stick, because a wrapper `<div>` gave
`position: sticky` zero travel and no unit test has an opinion about that. The
browser pass is the only thing that tests the seams.

**Run it against a dev server, not a stale preview.** `npm run dev` on port
3000. A `vite preview` left running on the same port serves the *previous*
build and has already cost one wrong diagnosis on this branch.

- [ ] **Step 1: Add the dependency**

```bash
cd frontend && npm install --save-dev axe-core
```

- [ ] **Step 2: Add the band geometry checks**

Append to `frontend/e2e/verify-rail.mjs`, before `await browser.close()`:

```js
// ------------------------------------------------------------ 16. the week band
//
// Alignment is claimed to be structural — the band cell and the chip are
// block-level children of one flex column, so the cell's width EQUALS the
// chip's rather than matching it. A structural claim is still worth measuring
// once: `w-max`, `shrink-0` and a stray `min-width` on a future descendant can
// all break "equals" without breaking the markup.
{
  const page = await newPage();
  await enterList(page);
  const geometry = await page.evaluate(() => {
    const rail = document.querySelector('[data-day-rail]');
    if (!rail) return null;
    const columns = [...rail.querySelectorAll('[data-rail-content] > [data-rail-column]')];
    const cells = columns.map(col => {
      const cell = col.querySelector('[data-band-cell]');
      const chip = col.querySelector('[data-chip]');
      const run = col.querySelector('[data-band-run]');
      const bars = [...col.querySelectorAll('[data-band-bar]')].map(b => {
        const r = b.getBoundingClientRect();
        return { left: r.left, right: r.right, opacity: Number(getComputedStyle(b).opacity) };
      });
      return {
        day: chip?.dataset.chip ?? null,
        cellW: cell?.getBoundingClientRect().width ?? null,
        chipW: chip?.getBoundingClientRect().width ?? null,
        runLeft: run?.getBoundingClientRect().left ?? null,
        runRight: run?.getBoundingClientRect().right ?? null,
        cellLeft: cell?.getBoundingClientRect().left ?? null,
        cellRight: cell?.getBoundingClientRect().right ?? null,
        bars,
      };
    });
    const pill = document.querySelector('[data-rail-pill]')?.getBoundingClientRect();
    const bandBottom = cells[0] ? document.querySelector('[data-band-cell]').getBoundingClientRect().bottom : null;
    const labels = [...rail.querySelectorAll('[data-week-band-button]')]
      .map(b => b.dataset.weekBandButton);
    // The copy layer must lay out column for column with the real row.
    const copy = [...rail.querySelectorAll('[data-rail-clip] > [data-rail-column]')]
      .map(c => c.getBoundingClientRect());
    const real = columns.map(c => c.getBoundingClientRect());
    const worstCopyDelta = Math.max(0, ...real.map((r, i) =>
      copy[i] ? Math.max(Math.abs(r.left - copy[i].left), Math.abs(r.width - copy[i].width)) : 999));
    return { cells, pill, bandBottom, labels, worstCopyDelta, columns: columns.length };
  });

  if (!geometry) {
    check('16 week band present', false, 'no rail');
  } else {
    const { cells, pill, bandBottom, labels, worstCopyDelta } = geometry;
    const widthDrift = Math.max(...cells.map(c => Math.abs((c.cellW ?? 0) - (c.chipW ?? -1))));
    check('16a every band cell is exactly its chip\'s width', widthDrift < 0.5,
      `worst ${widthDrift.toFixed(2)}px over ${cells.length} columns`);

    // A week is drawn as ONE run: inside a week the fill bridges the gutter,
    // and the only break in the whole band is the seam through the Saturday
    // two weeks share.
    const bridged = cells.filter((c, i) => {
      const next = cells[i + 1];
      return next && c.bars.length === 1 && next.bars.length === 1
        && Math.abs(c.runRight - next.runLeft) < 0.5;
    }).length;
    check('16b the fill bridges the gutters inside a week', bridged > 0,
      `${bridged} bridged gutters`);

    const split = cells.filter(c => c.bars.length === 2);
    const seams = split.map(c => c.bars[1].left - c.bars[0].right);
    check('16c a boundary Saturday is split, and only there',
      split.length > 0 && seams.every(s => s > 0.5 && s < 6),
      `${split.length} split days, seams ${seams.map(s => s.toFixed(1)).join(', ')}`);

    check('16d WEEK n appears at most once per week',
      labels.length === new Set(labels).size && labels.length > 0,
      `${labels.length} labels: ${labels.join(',')}`);

    // Risk 1 from the design, measured rather than assumed.
    check('16e the highlight pill does not paint over the band',
      !!pill && !!bandBottom && pill.top >= bandBottom - 0.5,
      pill ? `pill.top=${pill.top.toFixed(1)} band.bottom=${bandBottom.toFixed(1)}` : 'no pill');

    // Risk 1's other half: the two layers must stay in step, or the seam the
    // shared chip-box class exists to prevent comes back one level up.
    check('16f the clipped copy lays out column for column', worstCopyDelta < 0.5,
      `worst ${worstCopyDelta.toFixed(2)}px`);
  }
  await page.close();
}

// ------------------------------------------- 17. a band tap navigates
{
  const page = await newPage();
  await enterList(page);
  const before = await anchorChip(page);
  const jumped = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('[data-week-band-button]')]
      .filter(b => b.getAttribute('aria-disabled') !== 'true');
    // The furthest reachable week from wherever the rail opened, so the check
    // cannot pass on a one-chip move.
    const target = buttons[buttons.length - 1];
    if (!target) return null;
    target.click();
    return { week: target.dataset.weekBandButton, label: target.getAttribute('aria-label') };
  });
  if (!jumped) {
    check('17a a band tap navigates', false, 'no reachable week band button');
  } else {
    await page.waitForTimeout(700);
    const after = await anchorChip(page);
    check('17a a band tap navigates', !!after && after !== before, `${before} → ${after}`);
    // Named by destination, and the destination is where it actually landed.
    const named = /Go to Week \d+, (opens|first events) (.+), \d+ events?$/.exec(jumped.label ?? '');
    check('17b the band names the day it actually lands on',
      !!named && !!after && jumped.label.includes(new Date(`${after}T12:00:00`)
        .toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' })),
      `${jumped.label} → landed ${after}`);
  }
  await page.close();
}

// ------------------------------------------- 18. an unreachable week is inert
{
  // Narrow to a category that cannot fill nine weeks, so at least one week
  // goes unreachable — the state the band renders faded and refuses.
  const page = await newPage();
  await enterList(page);
  const state = await page.evaluate(() => {
    const disabled = [...document.querySelectorAll('[data-week-band-button][aria-disabled="true"]')];
    return {
      count: disabled.length,
      labels: disabled.map(b => b.getAttribute('aria-label')),
      // The FILL is faded; the label is not. Fading the label is what took an
      // empty iOS chip's text to a sampled ~3.7:1.
      fillOpacity: disabled[0]
        ? Number(getComputedStyle(disabled[0].closest('[data-band-cell]')
            .querySelector('[data-band-bar]')).opacity)
        : null,
      labelOpacity: disabled[0]
        ? Number(getComputedStyle(disabled[0].querySelector('span')).opacity)
        : null,
    };
  });
  if (state.count === 0) {
    skip('18 an unreachable week is dimmed and inert', 'every week is reachable in this data');
  } else {
    check('18a an unreachable week says so rather than offering a trip',
      state.labels.every(l => /^Week \d+, no events$/.test(l ?? '')),
      state.labels.slice(0, 3).join(' | '));
    check('18b the fill is faded and the label is not',
      state.fillOpacity !== null && state.fillOpacity < 1 && state.labelOpacity === 1,
      `fill=${state.fillOpacity} label=${state.labelOpacity}`);
  }
  await page.close();
}

// ------------------------------------------- 19. axe over the rail
//
// `aria-hidden-focus` is the rule this design has to prove clean, not assume:
// ~64 decorative segments carry the band's pointer handlers, and every one of
// them is `aria-hidden`. A single focusable descendant among them would put a
// hidden control in the tab order.
{
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const page = await newPage();
  await enterList(page);
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const results = await page.evaluate(async () => {
    const run = await window.axe.run('[data-day-rail]', {
      runOnly: { type: 'rule', values: [
        'aria-hidden-focus', 'button-name', 'aria-allowed-attr', 'nested-interactive',
      ] },
    });
    return run.violations.map(v => `${v.id} x${v.nodes.length}`);
  });
  check('19 axe is clean over the rail with the band present',
    results.length === 0, results.join(', ') || 'no violations');
  await page.close();
}
```

- [ ] **Step 3: Carve the band out of the 44px check, honestly**

Replace check 15's `[...rail.querySelectorAll('button')]` with

```js
    return [...rail.querySelectorAll('button')]
      // The band is 16px tall by design — a full-height band would dominate a
      // rail whose whole job is the chips. It is carved out here rather than
      // silently passing because nothing is reachable ONLY through it: every
      // week is also reachable from its own day chips, which 15a measures at
      // the full 44px, and 15b below is what keeps that true.
      .filter(el => !el.hasAttribute('data-week-band-button'))
      .map(el => { /* unchanged */ });
```

and rename the check to `15a`. Then add:

```js
  // The carve-out's premise, asserted rather than assumed: every week the band
  // offers is also reachable from a full-size control.
  const weeksWithFullSizeChips = await page.evaluate(() => {
    const rail = document.querySelector('[data-day-rail]');
    const offered = [...rail.querySelectorAll('[data-week-band-button]')]
      .filter(b => b.getAttribute('aria-disabled') !== 'true')
      .map(b => b.dataset.weekBandButton);
    // A week's own days are the columns whose band cell paints any bar at all
    // and whose labelled button, if present, names that week — approximated
    // here by "the column under this label, and its neighbours in the run".
    const chips = [...rail.querySelectorAll('[data-chip]')]
      .map(c => c.getBoundingClientRect())
      .filter(r => r.width >= 44 && r.height >= 44);
    return { offered: offered.length, fullSizeChips: chips.length };
  });
  check('15b every offered week is also reachable from full-size day chips',
    weeksWithFullSizeChips.offered > 0 && weeksWithFullSizeChips.fullSizeChips >= 7 * weeksWithFullSizeChips.offered,
    `${weeksWithFullSizeChips.offered} weeks offered, ${weeksWithFullSizeChips.fullSizeChips} chips at ≥44px`);
```

- [ ] **Step 4: Run it**

```bash
cd frontend && npm run dev &        # or in a second terminal
# wait for :3000, then
node e2e/verify-rail.mjs
```

Expected: every check PASS, including the pre-existing 1–15.

- [ ] **Step 5: Falsify the browser checks**

Injecting into a **browser** check means building the bundle. `npm run build`
gates the bundle on the unit suite, so a defect that also fails a unit test
silently serves the *previous* bundle and the check passes for the wrong
reason. Use `npx vite build` and grep `out/` to confirm the injection landed.

Three injections, one at a time, each followed by a restore:

1. In `WeekBandCell`, drop the bleed (`leadingBleed = 0`): **16b** must FAIL.
2. In `DayRail`, restore the pill to `inset-y-0`: **16e** must FAIL.
3. In `WeekBandCell`, make the decorative segment a `<button aria-hidden="true">`:
   **19** must FAIL on `aria-hidden-focus`.

If any of these *passes*, suspect the harness before believing the code —
confirm the injected file actually reached `out/` (`grep -r "inset-y-0" out/assets/*.js`),
and re-run the falsification against the old code.

- [ ] **Step 6: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add frontend/e2e/verify-rail.mjs frontend/package.json frontend/package-lock.json
git commit -m "test(web): browser checks for the week band, including an axe pass (#274)"
```

---

## Task 9: verify, record, and open the PR

**Files:**
- Modify: `docs/superpowers/plans/2026-08-25-web-day-strip-phase-1-week-band.md` (tick the boxes)
- Modify: the `#274` memory file at
  `/Users/bernard/.claude/projects/-Users-bernard-src-chq-chq-calendar/memory/day-strip-date-navigation-274-status.md`

- [ ] **Step 1: Full verification**

```bash
cd /Users/bernard/src/chq/chq-calendar/frontend && npm run build
cd ../backend && npm run validate && npm run build
```

Both must be green. The backend is untouched by this phase; run it anyway so
"the branch is green" is a checked claim.

- [ ] **Step 2: Browser pass, both engines where it matters**

```bash
cd frontend && npm run dev &
node e2e/verify-rail.mjs
node e2e/verify-filter-reveal.mjs
node e2e/verify-header-reveal.mjs
node e2e/verify-timezone.mjs
node e2e/verify-offseason.mjs
```

All five, not just the rail: the band changes the rail's height, and
`--day-rail-h` is what the header-reveal and off-season checks compute their
clearances against.

- [ ] **Step 3: No iOS opt-out is needed**

`.github/workflows/app-store-assets.yml` triggers on `ios/**` paths only. This
phase touches no iOS file, so no `[skip-screenshots: …]` marker belongs in the
PR description.

- [ ] **Step 4: Update the memory file**

Change the `#274` memory's phase-1 line from "no implementation yet" to what
shipped, and record the three things this phase learned that a future session
would otherwise re-derive:

- the iOS light ramp endpoint `#79808a` computes **4.497:1** against web's
  `--foreground` and had to be lightened to `#7e858f`;
- chips are no longer direct children of the content element, so
  `RAIL_CHIP_SELECTOR` is shared by `measureChips` and the keyboard walk, and
  the `useRailHighlight` test harness must mirror `DayRail`'s columns or the
  whole file tests nothing;
- the band's buttons are 16px tall and carved out of the rail's 44px check,
  with 15b asserting the premise that nothing is reachable only through them.

- [ ] **Step 5: Push and open the PR**

```bash
cd /Users/bernard/src/chq/chq-calendar
git push -u origin feat/274-day-strip-date-navigation
gh pr create --title "feat(web): the day rail carries a week band (#274 phase 1)" --body "$(cat <<'BODY'
Phase 1 of #274. Purely additive: nothing is deleted, and `DateFilter`,
`WeekSelector` and the rail's Filters toggle all still work exactly as they do
on `main`.

The day rail gains a week band above its chips. Each week is one continuous
run; the only break in the band is the seam through the Saturday two weeks
share. Tapping a week's band takes you to that week — the opening Saturday when
it has events, otherwise the week's first day that does, and nothing at all
when the week has none, which the band shows by fading and says out loud as
"Week 4, no events".

The model is transcribed from `ios/ChqCalendarShared/Domain/WeekBands.swift`
(#256/#258), so `WeekBandsTests.swift` transcribes with it.

Spec: `docs/superpowers/specs/2026-08-25-web-day-strip-date-navigation-design.md`
Plan: `docs/superpowers/plans/2026-08-25-web-day-strip-phase-1-week-band.md`

Verified: `npm run build` green (frontend and backend); all five browser
suites green against a dev server; every new guard falsified by breaking the
code first, including the three browser checks built with `npx vite build`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_0133YDvKqPFVWc6rzzCha9Hh
BODY
)"
```

Then iterate the PR per the project's rules: address every review comment,
including anything Copilot files in a collapsed **`Suppressed comments`** block
— on this repo that block has hidden real findings in most rounds, and reading
only the review summary has missed findings four times. Do not merge; hand the
merge to the user.

---

## Self-Review

**Spec coverage.** Every requirement in "Phase 1 — the week band" maps to a
task: the pure module and its rules → Tasks 1–3; what a tap does → Tasks 2 and
7; placement inside `DayRail`'s root → Task 6, asserted in its first test;
alignment by construction and the two things allowed out of the box → Task 5,
measured in Task 8's 16a; both named `useRailHighlight` risks → Task 6, measured
in 16e/16f; colour → Task 4; unreachable and empty → Tasks 2, 5 and 8's check
18; "the band scrolls with the chips" → structural, since the band lives inside
the existing `w-max` scroller content and no code pins it. Testing §Unit →
Tasks 1–7; §Browser → Task 8; §Falsification → a step in every task.

**Deliberate deltas from iOS, each argued where it is made.** No single-week
`navigationTarget` form (one map, so the two cannot disagree); no
`includingYear` in the spoken label (web's chips never say the year); a 16px
band rather than 14pt (web's label is 10px text); a lighter light-mode ramp
endpoint (web's `--foreground` is not pure black).

**Not in this phase, by design.** The week chooser (phase 2), the Filters move
(phase 3), and deleting `dateFilter`/`selectedWeeks` (phase 4). Phase 4 remains
gated on the mount-everything measurement, and it must read
`determineLandingState` or it silently regresses the #269 off-season landing.
