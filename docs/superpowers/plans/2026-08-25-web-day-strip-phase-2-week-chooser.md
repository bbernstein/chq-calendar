# Web day strip, phase 2 — the week chooser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a 3×3 chooser at the right end of the day rail — a miniature grid
icon whose lit cell says which week the reader is in, opening a 3×3 grid of the
season's nine weeks — so **any week is reachable in two interactions from
anywhere in the list**, before `WeekSelector` is deleted from the filter panel
in phase 4.

**Architecture:** One pure module (`lib/utils/weekChooser.ts`) owns the grid's
shape, its two-dimensional keyboard walk and the trigger's spoken name. One
extracted hook (`hooks/useWeekThemePopover.tsx`) owns the long-press /
right-click / Shift+F10 theme popover that `WeekSelector` invented, so the
chooser inherits it rather than reimplementing it. Three presentational
components — `WeekChooserIcon` (the miniature), `WeekGrid` (the nine cells) and
`WeekChooser` (trigger + popover + focus) — compose into a single control that
`DayRail` renders inside its own root. Reachability comes from phase 1's
`weekBandDestinations` map, unchanged, so the band and the grid cannot disagree
about which weeks can be reached.

**Tech Stack:** Vite 7 + Preact 10 + TypeScript 5 + Tailwind CSS 4, Vitest for
unit tests, Playwright (`frontend/e2e/*.mjs`) for browser verification.

**Spec:** `docs/superpowers/specs/2026-08-25-web-day-strip-date-navigation-design.md`
(read "Phase 2 — the week chooser", plus "Testing" and "Falsification"; phase 1's
"Colour" and "Accessibility exposure" sections are the rules this phase inherits)

**Issue:** #274.

**Branch:** `feat/274-week-chooser`, cut from `feat/274-day-strip-date-navigation`
(phase 1, **PR #276, open and already reviewed**). This is a *stacked* PR:
phase 1 must not be re-reviewed because phase 2 touched it. Open the PR with
`--base feat/274-day-strip-date-navigation` and retarget it to `main` once #276
merges. Never commit to `main`.

---

## Global Constraints

- **Nothing is deleted in this phase.** `DateFilter`, the filter panel's
  `WeekSelector`, the rail's `filtersToggle`, `dateFilter`/`selectedWeeks` all
  stay exactly as they are. They go in phases 3 and 4. The one *refactor* to
  existing code is Task 3, which moves behaviour out of `WeekSelector` without
  changing any of it — proven by `WeekSelector`'s existing tests passing
  untouched.
- **The chooser renders inside `DayRail`'s own root** — the element `rootRef`
  lands on. `useDayRailHeight` measures only that root and publishes
  `--day-rail-h`; chrome added in a sibling widens the stuck header without
  widening the variable, undercounting the clearance `dayHeaderTop()` and
  `useDayAnchor` compute against it. The *popover* is portalled to
  `document.body` and is not part of that measurement, which is correct — it is
  transient overlay, not persistent chrome.
- **Reachability has exactly one source: `weekBandDestinations`.** The band and
  the grid read the same `Map<number, WeekBandDestination>` instance passed down
  from `page.tsx`. A week absent from it is dimmed and inert in both places.
  Never recompute it, never filter it, never build a second one.
- **Labelled by destination, never by direction.** A reachable cell's accessible
  name is `destinations.get(n).label` verbatim —
  `"Go to Week 6, opens Saturday, June 27, 84 events"`. An unreachable cell's is
  `weekBandUnreachableLabel(n)` — `"Week 6, no events"`. Both come from phase 1;
  do not write new label strings for them.
- **The grid derives its cells from `seasonWeeks.length`, never a literal 9.**
  Nine weeks is structural on both platforms, but a hypothetical non-nine season
  must degrade to an odd-shaped grid rather than drop weeks.
- **Fade the fill, never the label.** An unreachable cell dims its background
  fill to `UNREACHABLE_FILL_OPACITY`; the numeral stays at full opacity. This is
  phase 1's rule and `weekBandContrast.test.ts` already proves the composite is
  safe in both themes — but only while the surface behind the fill really is
  `RAIL_BACKDROP`, which Task 5 pins.
- **A ramp tone alone is never the only signal.** In *both* themes the ramp's
  first step computes ~1.5:1 (light) and ~1.03:1 (dark) against the surface
  behind it, so a "lit" cell painted only in its week's tone can be invisible.
  Every tinted element in this phase carries a second, tone-independent signal —
  a ring on the trigger's lit cell, a border on every grid cell. Task 4 asserts
  the ~1.03:1 fact so the ring can never be removed as redundant.
- **The chooser is navigation, not a filter.** It never touches scope, weeks,
  categories, locations or search. It calls `page.tsx`'s existing `goToWeek`,
  which is `weekDestinations.get(week)` → `goToDay(dayKey)`. It also must not
  use `isWeekInPast`: a past week that still holds events is perfectly
  navigable, and graying it would be a filter's opinion on a navigation surface.
- **Verification before every commit:** `cd frontend && npm run build` (runs
  `validate` → `test:ci` with coverage → `vite build`). The backend is untouched
  in this phase.
- **Coverage floor** is `.coverage-floor.json` at the repo root
  (frontend lines 74.3); see `docs/coverage.md`. Every new module ships with its
  tests in the same commit.
- **Falsification:** every new guard is proven by breaking the code first. For a
  **browser** check, build with `npx vite build` and grep `out/` to confirm the
  injection landed — `npm run build` gates the bundle on the unit suite, so a
  defect that fails a unit test silently serves the *previous* bundle and the
  browser check passes for the wrong reason. When a falsification passes
  unexpectedly, suspect the harness and re-run it against the old code.

---

## Deviation from the spec, recorded

The spec says the popover is "built from `WeekSelector`'s existing markup,
repurposed from a filter into a jump control", and phase 4's deletion list says
"the component itself survives inside phase 2's chooser".

**This plan builds from `WeekSelector`'s behaviour, extracted, rather than from
its component.** The two controls share only "nine numbered buttons that can
open a theme popover". Everything else is opposed:

| | `WeekSelector` (filter) | `WeekGrid` (chooser) |
|---|---|---|
| Layout | 1×9 bordered strip | 3×3 grid of 44px cells |
| Meaning of a cell | selected / not (`aria-pressed`) | reachable / not (`aria-disabled`) |
| Meaning of grey | week is in the past | week has no matching events |
| Interaction | mousedown/enter/up drag-select | click, Enter/Space |
| Keyboard | none (mouse/touch only) | 2-D roving walk |

Making one component do both means the filter path carries grid code and the
navigation path carries drag code, for two phases, and then the drag half is
deleted anyway. Instead **Task 3 extracts the shared half** — the long-press,
right-click and Shift+F10 theme popover, with its portal and viewport
clamping — into `useWeekThemePopover`, which both controls call. That keeps the
spec's actual requirement ("`WeekThemePopover` comes along unchanged — this is
what keeps week themes reachable when the week strip leaves the filter panel in
phase 4") satisfied by one implementation rather than two.

**Consequence for phase 4:** `WeekSelector.tsx` is deleted outright rather than
surviving inside the chooser; `useWeekThemePopover` and `WeekThemePopover` are
what survive. Task 10 writes this into the spec as an addendum so the change is
a recorded decision rather than an inference from the code that ships.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `frontend/src/lib/utils/weekChooser.ts` | Pure: grid columns, row wrapping, the 2-D keyboard walk, the trigger's spoken name. No DOM, no colour, no pixels. |
| `frontend/src/hooks/useWeekThemePopover.tsx` | The long-press / right-click / Shift+F10 theme popover, its anchor registry, its portal and its coordinates. Extracted verbatim from `WeekSelector`. |
| `frontend/src/components/calendar/WeekChooserIcon.tsx` | The 3×3 miniature, with the current week's cell lit in its ramp tone plus a ring. Decorative throughout. |
| `frontend/src/components/calendar/WeekGrid.tsx` | The nine cells: ramp tone, reachability, current-week highlight, roving 2-D focus, theme popover. |
| `frontend/src/components/calendar/WeekChooser.tsx` | The trigger button and the popover it opens: open/close, focus in and back out, outside-dismiss, viewport clamping. |
| `frontend/src/__tests__/lib/utils/weekChooser.test.ts` | The pure module. |
| `frontend/src/__tests__/hooks/useWeekThemePopover.test.tsx` | The extracted hook, through a minimal host component. |
| `frontend/src/__tests__/components/calendar/WeekGrid.test.tsx` | Cell shape, labels, reachability, the keyboard walk, Escape deference. |
| `frontend/src/__tests__/components/calendar/WeekChooser.test.tsx` | Trigger name, open/close, focus return, dismissal. |

**Modified**

| File | Change |
|---|---|
| `frontend/src/lib/utils/weekBands.ts` | Add `anchorWeekNumber(anchorDay, segments)` — the one answer to "which week is the reader in", shared by the band's tab stop and the chooser's lit cell. |
| `frontend/src/components/calendar/WeekBandCell.tsx` | *(untouched — listed only to state that it is)* |
| `frontend/src/components/calendar/DayRail.tsx` | Use `anchorWeekNumber`; accept `seasonWeeks` and `weekThemes`; render `<WeekChooser>` between `⟳ Now` and the Filters toggle. |
| `frontend/src/components/filters/WeekSelector.tsx` | Call `useWeekThemePopover` instead of holding the long-press/portal logic inline. No behaviour change. |
| `frontend/src/components/filters/WeekThemePopover.tsx` | Export `buildWeekTitle(week, theme)`, moved from `WeekSelector`, so both controls title their cells identically. |
| `frontend/src/app/page.tsx` | Pass `seasonWeeks` and `weeklyThemes` to `DayRail`. |
| `frontend/src/__tests__/components/calendar/DayRail.test.tsx` | The chevron-selector guard excludes `[data-week-chooser-trigger]` by attribute; new tests for the chooser's presence and its `resume()` wiring. |
| `frontend/src/__tests__/lib/utils/weekBands.test.ts` | `anchorWeekNumber`'s cases. |
| `frontend/src/__tests__/lib/utils/weekBandContrast.test.ts` | The ~1.03:1 fact that makes the ring load-bearing; white-on-pill AA; `WeekGrid`'s surface classes pinned to `RAIL_BACKDROP`. |
| `frontend/e2e/verify-rail.mjs` | Checks 20a–20f (open from deep scroll, week 2 → week 8, the lit cell follows, an unreachable week is inert, the popover stays on screen at 390px) and 21 (axe over the open popover). |

---

## Task 1: one answer to "which week is the reader in"

`DayRail` already computes this inline for the band's tab stop. The chooser's
lit cell needs the identical answer, and a second inline copy is how the band
and the chooser start disagreeing about which week is current on a boundary
Saturday. Move it into `weekBands.ts`, where the segments live, and have both
read it.

**Files:**
- Modify: `frontend/src/lib/utils/weekBands.ts`
- Modify: `frontend/src/components/calendar/DayRail.tsx:~230` (the
  `anchorSegment` / `anchorWeek` / `bandTabStopWeek` block)
- Modify: `frontend/src/__tests__/lib/utils/weekBands.test.ts`

**Interfaces:**
- Consumes: `WeekBandSegment` (already in `weekBands.ts`).
- Produces:
  `export function anchorWeekNumber(anchorDay: string | null, segments: WeekBandSegment[]): number | null`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/__tests__/lib/utils/weekBands.test.ts`. Match the
existing file's fixtures — it already builds segments from
`getChautauquaSeasonWeeks(2026)` over a `dayKeys(...)` range; reuse whatever
helper it defines rather than inventing a second season fixture.

```ts
describe('anchorWeekNumber', () => {
  // The 2026 season's weeks, as day-key spans, are what the segments below are
  // built from — so these three days are looked up, not asserted from memory.
  const season = getChautauquaSeasonWeeks(2026);
  const spans = weekDayKeySpans(season);
  const week2 = spans.find(s => s.number === 2)!;
  const midWeek2 = dayKeys(week2.opening, week2.closing)[3];
  const segments = weekBandSegments(
    dayKeys(spans[0].opening, spans[spans.length - 1].closing), season);

  it('returns null with no anchor', () => {
    expect(anchorWeekNumber(null, segments)).toBeNull();
  });

  it('returns the week of a day that belongs to exactly one', () => {
    expect(anchorWeekNumber(midWeek2, segments)).toBe(2);
  });

  it('returns the LATER week on a boundary Saturday', () => {
    // The one the reader is scrolling INTO. Week 2's opening Saturday is also
    // week 1's closing Saturday; the chooser must light week 2 there, or the
    // lit cell lags a whole week behind the reader for one day in seven.
    const shared = segments.find(s => s.dayKey === week2.opening)!;
    expect(shared.weekNumbers).toEqual([1, 2]);
    expect(anchorWeekNumber(week2.opening, segments)).toBe(2);
  });

  it('returns null for a day the season does not contain', () => {
    // `navigableBounds` widens past the season whenever a pre- or post-season
    // event exists, so this is a day the rail really renders.
    const outside = weekBandSegments(['2026-05-01'], season);
    expect(outside[0].weekNumbers).toEqual([]);
    expect(anchorWeekNumber('2026-05-01', outside)).toBeNull();
  });

  it('returns null for a day no segment covers at all', () => {
    // Not the same case as above: here the day is absent from the array, which
    // is what happens for one commit while the rail's range is changing.
    expect(anchorWeekNumber('2026-07-04', [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd frontend && npx vitest run src/__tests__/lib/utils/weekBands.test.ts -t anchorWeekNumber
```

Expected: FAIL — `anchorWeekNumber is not a function` (or a TS error on the
import).

- [ ] **Step 3: Implement**

Append to `frontend/src/lib/utils/weekBands.ts`:

```ts
/**
 * Which week the reader is in, from the day the anchor settled on.
 *
 * A shared Saturday resolves to the **later** of its two weeks — the one the
 * reader is scrolling into. That is the rail's own convention (the band's tab
 * stop already used it) and it is the one the chooser's lit cell needs: lighting
 * the earlier week would leave the icon a week behind the reader for one day in
 * seven, on the exact day a reader is most likely to be checking where they are.
 *
 * `null` when there is no anchor yet, when the anchor is a day outside the
 * season (`navigableBounds` widens past it whenever a pre- or post-season event
 * exists), or when no segment covers the day. All three mean the same thing to
 * a caller — no cell lights — and none of them is an error.
 */
export function anchorWeekNumber(
  anchorDay: string | null, segments: WeekBandSegment[]
): number | null {
  if (!anchorDay) return null;
  const segment = segments.find(s => s.dayKey === anchorDay);
  if (!segment || segment.weekNumbers.length === 0) return null;
  return segment.weekNumbers[segment.weekNumbers.length - 1];
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd frontend && npx vitest run src/__tests__/lib/utils/weekBands.test.ts
```

Expected: PASS, whole file.

- [ ] **Step 5: Have `DayRail` read the shared function**

In `frontend/src/components/calendar/DayRail.tsx`, add
`anchorWeekNumber` to the existing `@/lib/utils/weekBands` import and replace the
inline block:

```tsx
  // The band is one tab stop, like the chip row: the week the reader is
  // actually in, resolved once in `weekBands.ts` so the band's tab stop and the
  // chooser's lit cell cannot answer this differently. Falls back to the first
  // labelled week so the band is never unreachable from the keyboard.
  const anchorWeek = anchorWeekNumber(anchorDay, bandSegments);
  const bandTabStopWeek = anchorWeek
    ?? bandSegments.find(s => s.labelledWeek !== null)?.labelledWeek
    ?? null;
```

The two lines removed are the `anchorSegment` lookup and the
`anchorSegment?.weekNumbers[...]` expression. `anchorWeek` keeps its name — Task
7 passes it to the chooser.

- [ ] **Step 6: Prove the refactor changed nothing**

```bash
cd frontend && npx vitest run src/__tests__/components/calendar/DayRail.test.tsx
```

Expected: PASS, with **no test edited**. `DayRail.test.tsx` already covers the
band's tab stop (search it for `data-week-band-button` and `tabIndex`); if those
tests pass untouched, the extraction is behaviour-preserving. If any of them
needed editing, stop — the extraction was not equivalent.

- [ ] **Step 7: Falsify**

Temporarily change the implementation's last line to
`return segment.weekNumbers[0];` (the *earlier* week on a shared Saturday) and
re-run the `weekBands` file.

Expected: FAIL on "returns the LATER week on a boundary Saturday". Revert.

- [ ] **Step 8: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git checkout -b feat/274-week-chooser   # first task only; from the phase-1 branch head
git add frontend/src/lib/utils/weekBands.ts \
        frontend/src/components/calendar/DayRail.tsx \
        frontend/src/__tests__/lib/utils/weekBands.test.ts
git commit -m "refactor(web): one shared answer for the rail's current week (#274)"
```

---

## Task 2: `weekChooser.ts` — the grid's shape and its keyboard walk

Everything about the grid that is not a pixel: how many columns, how the weeks
wrap into rows, where each arrow key goes, and what the trigger is called. Pure,
so the 2-D walk is testable without a DOM and the "derive from
`seasonWeeks.length`, never a literal 9" rule is provable.

**Files:**
- Create: `frontend/src/lib/utils/weekChooser.ts`
- Create: `frontend/src/__tests__/lib/utils/weekChooser.test.ts`

**Interfaces:**
- Consumes: nothing. No imports at all.
- Produces:
  - `function weekGridColumns(count: number): number`
  - `function weekGridRows(weekNumbers: number[], columns: number): number[][]`
  - `function moveGridFocus(current: number, key: string, count: number, columns: number): number | null`
  - `function weekChooserTriggerLabel(currentWeek: number | null, totalWeeks: number): string`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/__tests__/lib/utils/weekChooser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  moveGridFocus, weekChooserTriggerLabel, weekGridColumns, weekGridRows,
} from '@/lib/utils/weekChooser';

describe('weekGridColumns', () => {
  it('gives a nine-week season three columns', () => {
    // Nine 44px cells in a row is 396px, wider than a 390px phone. Nine in a
    // 3x3 is a 132px square with real touch targets.
    expect(weekGridColumns(9)).toBe(3);
  });

  it('degrades to an odd-shaped grid rather than dropping weeks', () => {
    // Derived, never a literal 9 — a hypothetical non-nine season must still
    // show every week it has.
    expect(weekGridColumns(8)).toBe(3);   // 3 + 3 + 2
    expect(weekGridColumns(10)).toBe(4);  // 4 + 4 + 2
    expect(weekGridColumns(1)).toBe(1);
  });

  it('never returns zero, which would divide the rows by nothing', () => {
    expect(weekGridColumns(0)).toBe(1);
    expect(weekGridColumns(-3)).toBe(1);
  });
});

describe('weekGridRows', () => {
  it('wraps nine weeks into three rows of three, in order', () => {
    expect(weekGridRows([1, 2, 3, 4, 5, 6, 7, 8, 9], 3))
      .toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
  });

  it('leaves a short final row short rather than padding it', () => {
    // A padded cell is a control that means nothing; the icon and the grid both
    // render exactly what they are given.
    expect(weekGridRows([1, 2, 3, 4, 5, 6, 7, 8], 3))
      .toEqual([[1, 2, 3], [4, 5, 6], [7, 8]]);
  });

  it('holds every week it was given', () => {
    const weeks = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(weekGridRows(weeks, weekGridColumns(weeks.length)).flat()).toEqual(weeks);
  });

  it('is empty for no weeks', () => {
    expect(weekGridRows([], 3)).toEqual([]);
  });
});

describe('moveGridFocus', () => {
  // A 3x3 of indices:
  //   0 1 2
  //   3 4 5
  //   6 7 8
  const COLS = 3, COUNT = 9;

  it('moves one cell horizontally', () => {
    expect(moveGridFocus(4, 'ArrowRight', COUNT, COLS)).toBe(5);
    expect(moveGridFocus(4, 'ArrowLeft', COUNT, COLS)).toBe(3);
  });

  it('moves a whole row vertically — the thing a 1x9 strip could not do', () => {
    expect(moveGridFocus(4, 'ArrowDown', COUNT, COLS)).toBe(7);
    expect(moveGridFocus(4, 'ArrowUp', COUNT, COLS)).toBe(1);
  });

  it('clamps at every edge instead of wrapping', () => {
    // Clamping matches the rail's own chip walk. Wrapping from week 9 to week 1
    // on one keystroke is a jump across the whole season disguised as a nudge.
    expect(moveGridFocus(8, 'ArrowRight', COUNT, COLS)).toBeNull();
    expect(moveGridFocus(0, 'ArrowLeft', COUNT, COLS)).toBeNull();
    expect(moveGridFocus(1, 'ArrowUp', COUNT, COLS)).toBeNull();
    expect(moveGridFocus(7, 'ArrowDown', COUNT, COLS)).toBeNull();
  });

  it('crosses a row boundary horizontally', () => {
    // Left/Right walk the whole sequence, so a reader who only knows two arrow
    // keys can still reach every week.
    expect(moveGridFocus(2, 'ArrowRight', COUNT, COLS)).toBe(3);
    expect(moveGridFocus(3, 'ArrowLeft', COUNT, COLS)).toBe(2);
  });

  it('jumps to the ends', () => {
    expect(moveGridFocus(4, 'Home', COUNT, COLS)).toBe(0);
    expect(moveGridFocus(4, 'End', COUNT, COLS)).toBe(8);
  });

  it('returns null for a key it does not handle, so the caller does not preventDefault', () => {
    // Escape, Tab and Enter all have to keep working. A walk that swallowed
    // them would trap focus in the grid and break dismissal.
    for (const key of ['Escape', 'Tab', 'Enter', ' ', 'a']) {
      expect(moveGridFocus(4, key, COUNT, COLS), key).toBeNull();
    }
  });

  it('returns null when the move would not move', () => {
    expect(moveGridFocus(0, 'Home', COUNT, COLS)).toBeNull();
    expect(moveGridFocus(8, 'End', COUNT, COLS)).toBeNull();
  });

  it('returns null from an index outside the grid', () => {
    expect(moveGridFocus(-1, 'ArrowRight', COUNT, COLS)).toBeNull();
    expect(moveGridFocus(9, 'ArrowLeft', COUNT, COLS)).toBeNull();
    expect(moveGridFocus(0, 'ArrowRight', 0, COLS)).toBeNull();
  });

  it('walks a short final row without falling off it', () => {
    // Eight weeks: 0 1 2 / 3 4 5 / 6 7. Down from 5 lands on 8, which is not
    // there.
    expect(moveGridFocus(5, 'ArrowDown', 8, 3)).toBeNull();
    expect(moveGridFocus(4, 'ArrowDown', 8, 3)).toBe(7);
  });
});

describe('weekChooserTriggerLabel', () => {
  it('says where you are and what it does', () => {
    expect(weekChooserTriggerLabel(6, 9)).toBe('Week 6 of 9, choose a week');
  });

  it('says only what it does when no week is current', () => {
    // Off-season, or on a pre/post-season day inside the navigable bounds, the
    // anchor is in no week. This mirrors the rail's own convention: a control
    // that cannot mean anything says less rather than something false.
    expect(weekChooserTriggerLabel(null, 9)).toBe('Choose a week');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd frontend && npx vitest run src/__tests__/lib/utils/weekChooser.test.ts
```

Expected: FAIL — cannot resolve `@/lib/utils/weekChooser`.

- [ ] **Step 3: Implement**

Create `frontend/src/lib/utils/weekChooser.ts`:

```ts
/**
 * The week chooser's shape and its keyboard walk.
 *
 * Pure on purpose, the same split the band uses: *which cells exist and where a
 * key goes* is decided here and unit-tested; *where they land in pixels* is
 * `WeekGrid`'s problem and the browser pass's.
 */

/**
 * Columns in the chooser grid.
 *
 * Nine 44px cells in a row is 396px, wider than a 390px phone; nine in a 3x3 is
 * a 132px square with real touch targets. That is the whole argument, and it is
 * a straight win over a 1x9 strip independent of what the trigger looks like.
 *
 * Derived from the count rather than fixed at 3, so a hypothetical non-nine
 * season degrades to an odd-shaped grid rather than dropping weeks. Nine is
 * structural on both platforms today (`getChautauquaSeasonWeeks` loops nine
 * times; `SeasonCalendar.weeks` "always returns nine"), which is exactly why
 * a literal 9 here would never be caught being wrong.
 */
export function weekGridColumns(count: number): number {
  if (count <= 0) return 1;
  return Math.ceil(Math.sqrt(count));
}

/** The weeks, wrapped into rows in order. A short final row stays short. */
export function weekGridRows(weekNumbers: number[], columns: number): number[][] {
  const width = Math.max(1, columns);
  const rows: number[][] = [];
  for (let i = 0; i < weekNumbers.length; i += width) {
    rows.push(weekNumbers.slice(i, i + width));
  }
  return rows;
}

/**
 * Where a key takes focus, as an index into the flat week list, or `null` when
 * it takes it nowhere.
 *
 * `null` covers three cases the caller treats identically — an unhandled key, a
 * move off the edge, and a move that lands where focus already is — because all
 * three mean "do not `preventDefault`, do not move". Swallowing Escape, Tab or
 * Enter here is how a popover traps focus, so keys this function does not know
 * must fall through untouched.
 *
 * Clamping, not wrapping: the rail's chip walk clamps, and wrapping from week 9
 * to week 1 on one keystroke is a jump across the whole season disguised as a
 * nudge.
 */
export function moveGridFocus(
  current: number, key: string, count: number, columns: number
): number | null {
  if (count <= 0 || current < 0 || current >= count) return null;
  const width = Math.max(1, columns);
  let next: number;
  switch (key) {
    case 'ArrowRight': next = current + 1; break;
    case 'ArrowLeft': next = current - 1; break;
    case 'ArrowDown': next = current + width; break;
    case 'ArrowUp': next = current - width; break;
    case 'Home': next = 0; break;
    case 'End': next = count - 1; break;
    default: return null;
  }
  if (next < 0 || next >= count || next === current) return null;
  return next;
}

/**
 * The trigger's accessible name, and its `title` for sighted mouse users.
 *
 * "Week 6 of 9" gives position in the season in words for a reader who cannot
 * see the lit cell give it spatially. On touch there is no tooltip, but the
 * first tap opens a grid of numbered weeks, which self-explains.
 */
export function weekChooserTriggerLabel(
  currentWeek: number | null, totalWeeks: number
): string {
  if (currentWeek === null) return 'Choose a week';
  return `Week ${currentWeek} of ${totalWeeks}, choose a week`;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd frontend && npx vitest run src/__tests__/lib/utils/weekChooser.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Falsify the two guards that matter**

Prove each by breaking the code, one at a time, reverting after each:

1. Replace `weekGridColumns`'s body with `return 3;` → expect FAIL on
   "degrades to an odd-shaped grid" (`weekGridColumns(10)` returns 3, not 4).
2. In `moveGridFocus`, change `default: return null;` to
   `default: next = current; break;` → expect FAIL on "returns null for a key it
   does not handle" (Escape would now be swallowed).
3. Change the edge guard to `if (next < 0) next = 0; if (next >= count) next = count - 1;`
   → expect FAIL on "clamps at every edge instead of wrapping" (right from index
   8 would return 8 rather than null — a `preventDefault` on a key that did
   nothing).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/utils/weekChooser.ts \
        frontend/src/__tests__/lib/utils/weekChooser.test.ts
git commit -m "feat(web): the week chooser's grid shape and keyboard walk (#274)"
```

---

## Task 3: extract the theme popover from `WeekSelector`

The chooser has to keep long-press, right-click and Shift+F10 opening a week's
theme — that is what keeps week themes reachable when the week strip leaves the
filter panel in phase 4. This task moves that behaviour, unchanged, into a hook
both controls call.

**The guard for this task is that `WeekSelector`'s existing tests pass
untouched.** If any of them needs editing, the extraction was not equivalent —
stop and fix the hook, not the test.

**Files:**
- Create: `frontend/src/hooks/useWeekThemePopover.tsx`
- Create: `frontend/src/__tests__/hooks/useWeekThemePopover.test.tsx`
- Modify: `frontend/src/components/filters/WeekSelector.tsx`
- Modify: `frontend/src/components/filters/WeekThemePopover.tsx` (export
  `buildWeekTitle`)

**Interfaces:**
- Consumes: `WeekTheme` from `@/hooks/useWeeklyThemes`; `useFloatingCoords` from
  `@/hooks/useViewportClamp`; `LONG_PRESS_MS` from `@/lib/constants`;
  `WeekThemePopover` from `@/components/filters/WeekThemePopover`.
- Produces:
  - `interface WeekThemePopoverApi { isOpen: boolean; registerAnchor(week: number, el: HTMLButtonElement | null): void; handlers(week: number): WeekCellThemeHandlers; portal: ReturnType<typeof createPortal> | null }`
  - `function useWeekThemePopover(o: { themes?: Record<number, WeekTheme>; onActivate: (week: number) => void }): WeekThemePopoverApi`
  - `function buildWeekTitle(week: SeasonWeek, theme: WeekTheme | undefined): string`
    (re-homed into `WeekThemePopover.tsx`, beside `formatThemeDateRange`)

- [ ] **Step 1: Write the failing hook tests**

Create `frontend/src/__tests__/hooks/useWeekThemePopover.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/preact';
import { useWeekThemePopover } from '@/hooks/useWeekThemePopover';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';
import { LONG_PRESS_MS } from '@/lib/constants';

const themes: Record<number, WeekTheme> = {
  2: {
    number: 2, title: 'A Life of Literature', description: 'Books.',
    startDate: '2026-07-04', endDate: '2026-07-10',
  },
};

/** The smallest thing that can host the hook: two week cells. */
function Host({ onActivate = vi.fn(), withThemes = true }) {
  const popover = useWeekThemePopover({
    themes: withThemes ? themes : undefined, onActivate,
  });
  return (
    <div>
      {[1, 2].map(week => (
        <button
          key={week}
          type="button"
          data-week={week}
          ref={el => popover.registerAnchor(week, el)}
          {...popover.handlers(week)}
        >
          {week}
        </button>
      ))}
      <span data-open={popover.isOpen ? 'true' : 'false'} />
      {popover.portal}
    </div>
  );
}

const cell = (week: number) => document.querySelector<HTMLElement>(`[data-week="${week}"]`)!;
const isOpen = () => document.querySelector('[data-open]')!.getAttribute('data-open');

describe('useWeekThemePopover', () => {
  it('opens a themed week on right-click and does not open the browser menu', () => {
    render(<Host />);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => { cell(2).dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Week 2 theme' })).toBeTruthy();
    expect(isOpen()).toBe('true');
  });

  it('leaves an unthemed week's context menu alone', () => {
    // The season's themes file can be missing a week, or missing entirely.
    // Suppressing the browser menu for a popover that will never open takes
    // something away and gives nothing back.
    render(<Host />);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => { cell(1).dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens on Shift+F10, the keyboard equivalent of right-click', () => {
    render(<Host />);
    fireEvent.keyDown(cell(2), { key: 'F10', shiftKey: true });
    expect(screen.getByRole('dialog', { name: 'Week 2 theme' })).toBeTruthy();
  });

  it('opens on a long press and does not then activate the week', () => {
    vi.useFakeTimers();
    const onActivate = vi.fn();
    render(<Host onActivate={onActivate} />);
    fireEvent.touchStart(cell(2));
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS + 10); });
    fireEvent.touchEnd(cell(2));
    expect(screen.getByRole('dialog', { name: 'Week 2 theme' })).toBeTruthy();
    expect(onActivate).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('activates on a short tap of a themed week', () => {
    vi.useFakeTimers();
    const onActivate = vi.fn();
    render(<Host onActivate={onActivate} />);
    fireEvent.touchStart(cell(2));
    act(() => { vi.advanceTimersByTime(50); });
    fireEvent.touchEnd(cell(2));
    expect(onActivate).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('dialog')).toBeNull();
    vi.useRealTimers();
  });

  it('activates an unthemed week on touchstart, with nothing to wait for', () => {
    const onActivate = vi.fn();
    render(<Host onActivate={onActivate} />);
    fireEvent.touchStart(cell(1));
    expect(onActivate).toHaveBeenCalledWith(1);
  });

  it('cancels a pending long press when the finger moves', () => {
    vi.useFakeTimers();
    render(<Host />);
    fireEvent.touchStart(cell(2));
    fireEvent.touchMove(cell(2));
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS + 10); });
    expect(screen.queryByRole('dialog')).toBeNull();
    vi.useRealTimers();
  });

  it('reports closed before anything opens, so a caller can defer to it', () => {
    // `WeekGrid` reads `isOpen` to decide whether Escape belongs to the theme
    // popover or to the grid. A hook that always reported open would make the
    // grid undismissable.
    render(<Host />);
    expect(isOpen()).toBe('false');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd frontend && npx vitest run src/__tests__/hooks/useWeekThemePopover.test.tsx
```

Expected: FAIL — cannot resolve `@/hooks/useWeekThemePopover`.

- [ ] **Step 3: Move `buildWeekTitle` into `WeekThemePopover.tsx`**

Add to `frontend/src/components/filters/WeekThemePopover.tsx`, just below
`formatThemeDateRange`:

```tsx
/**
 * A week cell's `title`, for a sighted mouse user who has no other way to
 * discover the theme. Lives here rather than in either control so the filter
 * strip and the chooser grid cannot title the same week differently.
 */
export function buildWeekTitle(week: SeasonWeek, theme: WeekTheme | undefined): string {
  if (!theme) return week.label;
  return `Week ${week.number} — "${theme.title}" (${formatThemeDateRange(theme)})`;
}
```

with `import type { SeasonWeek } from '@/lib/types';` at the top. Delete
`buildButtonTitle` from `WeekSelector.tsx` and import `buildWeekTitle` in its
place, renaming the one call site.

- [ ] **Step 4: Implement the hook**

Create `frontend/src/hooks/useWeekThemePopover.tsx`. This is `WeekSelector`'s
logic moved, not rewritten — keep the comments that explain *why* each branch
exists.

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';
import { useFloatingCoords } from '@/hooks/useViewportClamp';
import { LONG_PRESS_MS } from '@/lib/constants';
import { WeekThemePopover } from '@/components/filters/WeekThemePopover';

/** Everything a week cell has to spread onto its `<button>`. */
export interface WeekCellThemeHandlers {
  onContextMenu: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onTouchMove: () => void;
  onTouchCancel: () => void;
}

export interface WeekThemePopoverApi {
  /**
   * Whether a theme popover is currently open.
   *
   * Read by a caller that also handles Escape: `WeekThemePopover` listens on
   * `document`, and Preact attaches a cell's own handler to the element, so the
   * caller's handler runs FIRST on the way up. A grid that closed itself on
   * Escape without checking this would dismiss the whole chooser when the
   * reader only meant to close the theme they had just opened.
   */
  isOpen: boolean;
  registerAnchor: (week: number, el: HTMLButtonElement | null) => void;
  handlers: (week: number) => WeekCellThemeHandlers;
  /** The popover's portal, or null. Render it inside the caller's tree. */
  portal: ReturnType<typeof createPortal> | null;
}

/**
 * Long-press, right-click and Shift+F10 open a week's theme.
 *
 * Extracted from `WeekSelector` so the filter strip and the day rail's week
 * chooser share one implementation. This is what keeps week themes reachable
 * once the week strip leaves the filter panel in phase 4 — the other route,
 * `WeekBadge` on the day header, is untouched throughout.
 *
 * `onActivate` is the plain tap: the caller decides what a tap means (select a
 * week, or navigate to one). The touch path is here rather than in the caller
 * because it is entangled with the long press — a tap is "a touch that ended
 * before the timer fired", which only this hook knows.
 */
export function useWeekThemePopover({ themes, onActivate }: {
  themes?: Record<number, WeekTheme>;
  onActivate: (week: number) => void;
}): WeekThemePopoverApi {
  const [popoverWeek, setPopoverWeek] = useState<number | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const buttonRefs = useRef<Map<number, HTMLButtonElement | null>>(new Map());
  const activeAnchorRef = useRef<HTMLButtonElement | null>(null);
  const popoverContentRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    activeAnchorRef.current = popoverWeek !== null
      ? buttonRefs.current.get(popoverWeek) ?? null
      : null;
  }, [popoverWeek]);

  const popoverCoords = useFloatingCoords(
    popoverWeek !== null, activeAnchorRef, popoverContentRef, { mode: 'center' },
  );

  useEffect(() => () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
  }, []);

  function clearLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function openIfThemed(week: number) {
    if (themes && themes[week]) setPopoverWeek(week);
  }

  const popoverTheme = popoverWeek !== null ? themes?.[popoverWeek] : undefined;

  function handlers(week: number): WeekCellThemeHandlers {
    const hasTheme = !!themes?.[week];
    return {
      onContextMenu: (e) => {
        // Only suppress the browser's own menu when there is something to put
        // in its place.
        if (!hasTheme) return;
        e.preventDefault();
        openIfThemed(week);
      },
      onKeyDown: (e) => {
        // ContextMenu key (Windows menu key) and Shift+F10 (the universal
        // keyboard equivalent of right-click). Nothing else is touched here —
        // the caller owns its own arrow-key walk and its own Escape.
        if (hasTheme && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
          e.preventDefault();
          openIfThemed(week);
        }
      },
      onTouchStart: (e) => {
        longPressFiredRef.current = false;
        if (hasTheme) {
          clearLongPress();
          longPressTimer.current = window.setTimeout(() => {
            longPressFiredRef.current = true;
            openIfThemed(week);
          }, LONG_PRESS_MS);
        }
        // Suppresses the emulated click that would otherwise follow touchend
        // and activate the week a second time.
        e.preventDefault();
        if (!hasTheme) onActivate(week);
      },
      onTouchEnd: (e) => {
        clearLongPress();
        if (longPressFiredRef.current) {
          e.preventDefault();
          longPressFiredRef.current = false;
          return;
        }
        if (hasTheme) {
          e.preventDefault();
          onActivate(week);
        }
      },
      onTouchMove: () => clearLongPress(),
      onTouchCancel: () => {
        clearLongPress();
        longPressFiredRef.current = false;
      },
    };
  }

  const portal = popoverWeek !== null && popoverTheme
    ? createPortal(
      <div
        ref={popoverContentRef}
        className="fixed z-50"
        style={{
          top: popoverCoords ? `${popoverCoords.top}px` : '-9999px',
          left: popoverCoords ? `${popoverCoords.left}px` : '0px',
          visibility: popoverCoords ? 'visible' : 'hidden',
        }}
      >
        <WeekThemePopover themes={[popoverTheme]} onClose={() => setPopoverWeek(null)} />
      </div>,
      document.body,
    )
    : null;

  return {
    isOpen: popoverWeek !== null && !!popoverTheme,
    registerAnchor: (week, el) => { buttonRefs.current.set(week, el); },
    handlers,
    portal,
  };
}
```

- [ ] **Step 5: Run the hook tests and watch them pass**

```bash
cd frontend && npx vitest run src/__tests__/hooks/useWeekThemePopover.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Rewrite `WeekSelector` onto the hook**

In `frontend/src/components/filters/WeekSelector.tsx`, delete the popover state,
the timer refs, the anchor refs, `useFloatingCoords`, the two `useEffect`s,
`openPopoverIfThemed`, `clearLongPress`, `buildButtonTitle` and the portal at the
bottom. Replace with:

```tsx
  const themePopover = useWeekThemePopover({ themes, onActivate: onTap });
```

Each cell keeps its own `onMouseDown` / `onMouseEnter` / `onMouseUp` (drag
selection, which is this control's alone) and gains:

```tsx
              ref={(el) => { buttonRefs.current.set(week.number, el); themePopover.registerAnchor(week.number, el); }}
              {...themePopover.handlers(week.number)}
              title={buildWeekTitle(week, theme)}
```

— and `buttonRefs` goes away entirely if nothing else in the file uses it (check;
at the time of writing nothing does, so the `ref` reduces to
`ref={(el) => themePopover.registerAnchor(week.number, el)}`). Render
`{themePopover.portal}` where the old `createPortal(...)` block was.

**Do not** reorder or reword the cell's `className`, `aria-pressed`,
`aria-label` or the mouse handlers. This step moves code; it changes nothing a
test can see.

- [ ] **Step 7: Prove the extraction changed nothing**

```bash
cd frontend && npx vitest run src/__tests__/components/filters/WeekSelector.test.tsx
```

Expected: PASS, **with no test edited**. That file has nine tests covering the
theme integration specifically. If one fails, the hook is not equivalent — fix
the hook.

- [ ] **Step 8: Falsify**

Temporarily change the hook's `isOpen` to `return true` unconditionally
(`isOpen: true`) → expect FAIL on "reports closed before anything opens".
Then change `onTouchEnd`'s `if (longPressFiredRef.current)` guard to `if (false)`
→ expect FAIL on "opens on a long press and does not then activate the week".
Revert both.

- [ ] **Step 9: Full verification and commit**

```bash
cd frontend && npm run build
git add frontend/src/hooks/useWeekThemePopover.tsx \
        frontend/src/components/filters/WeekSelector.tsx \
        frontend/src/components/filters/WeekThemePopover.tsx \
        frontend/src/__tests__/hooks/useWeekThemePopover.test.tsx
git commit -m "refactor(web): extract the week theme popover so the chooser can reuse it (#274)"
```

---

## Task 4: `WeekChooserIcon` — the 3×3 miniature

The trigger's face: a literal miniature of what it opens, with the current
week's cell lit. The lit cell gives position-in-season *spatially*, which a
numeral gives only once the reader relates it to a nine-week season.

The lit cell takes that week's tone from the band's ramp, so the icon reads as a
legend for the band beside it — **and carries a ring**, because in both themes
the ramp's first step is nearly invisible against the rail's own backdrop. This
task pins that number so the ring cannot be removed later as decoration.

**Files:**
- Create: `frontend/src/components/calendar/WeekChooserIcon.tsx`
- Modify: `frontend/src/__tests__/lib/utils/weekBandContrast.test.ts`
- Test: covered by `WeekChooser.test.tsx` (Task 6) for rendering; the contrast
  facts are tested here.

**Interfaces:**
- Consumes: `rampBackground` from `@/lib/utils/railBandPalette`; `weekGridRows`
  output shape from Task 2 (`number[][]`).
- Produces:
  `function WeekChooserIcon(props: { rows: number[][]; currentWeek: number | null; denominator: number }): JSX.Element`

- [ ] **Step 1: Write the failing contrast tests**

Append to `frontend/src/__tests__/lib/utils/weekBandContrast.test.ts`. It already
imports `ratio`, `luminance`, `THEMES`, `STEPS`, `rampHex`, `RAIL_BACKDROP`,
`RAIL_PILL` and `AA_NORMAL` — reuse them; do not redefine.

```ts
describe('the chooser icon's lit cell', () => {
  // AA for non-text: a graphical object needs 3:1 against what is behind it.
  const AA_NON_TEXT = 3;

  it.each(THEMES)('cannot be identified by its tone alone in %s', theme => {
    // THE REASON THE RING EXISTS, as a measurement rather than a comment.
    // The lit cell is painted in its week's ramp tone, on the rail's own
    // backdrop. Early steps of the ramp are nearly the backdrop: ~1.5:1 in
    // light, ~1.03:1 in dark. A future reader who deletes the ring as
    // redundant decoration makes weeks 1-3 unfindable in dark mode.
    const worst = Math.min(...STEPS.map(s => ratio(rampHex(theme, s), RAIL_BACKDROP[theme])));
    expect(worst).toBeLessThan(AA_NON_TEXT);
  });

  it.each(THEMES)('is identified by its ring, which clears AA for a graphic in %s', theme => {
    // The ring is drawn in `--foreground`, which is `RAIL_BAND_LABEL`.
    expect(ratio(RAIL_BAND_LABEL[theme], RAIL_BACKDROP[theme]))
      .toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it('draws the ring in a token the stylesheet actually defines', () => {
    // `var(--foreground)` and RAIL_BAND_LABEL are already pinned to each other
    // above; this pins the icon to that variable rather than to a literal.
    const src = readFileSync(
      resolve(__dirname, '../../../components/calendar/WeekChooserIcon.tsx'), 'utf8');
    expect(src).toContain('var(--foreground)');
  });
});

describe('the current week's cell in the chooser grid', () => {
  it('reads white on the pill, the rail's one saturated fill', () => {
    // Same pairing as the rail's highlight: the pill means "you are here", in
    // exactly one place, in exactly one colour.
    expect(ratio('#ffffff', RAIL_PILL)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});
```

`readFileSync` / `resolve` are already imported by this file for the CSS-token
tests; check the existing import block and reuse it rather than adding a second.

- [ ] **Step 2: Run them and watch them fail**

```bash
cd frontend && npx vitest run src/__tests__/lib/utils/weekBandContrast.test.ts
```

Expected: FAIL on "draws the ring in a token the stylesheet actually defines" —
the file does not exist. The other three should PASS immediately; they are facts
about constants that already exist, and they are what the implementation is
being *held to*, not what it changes.

- [ ] **Step 3: Implement**

Create `frontend/src/components/calendar/WeekChooserIcon.tsx`:

```tsx
import { rampBackground } from '@/lib/utils/railBandPalette';

/**
 * The chooser trigger's face: a miniature of the grid it opens, with the
 * current week's cell lit.
 *
 * Position-in-season, spatially. A numeral gives the same fact only once the
 * reader has related it to a nine-week season; the lit cell moving down and
 * across as they scroll gives it without arithmetic.
 *
 * Accepted risk, recorded in the design: a bare 3x3 is also the generic
 * apps/grid icon, so "weeks" comes from context — the lit cell moving as the
 * reader scrolls, the `WEEK n` band immediately beside it, and the grid itself
 * on first tap.
 *
 * Decorative throughout. The trigger button carries the accessible name (see
 * `WeekChooser`), so nothing here may paint into it — the same rule
 * `FiltersIcon` follows, and for the same reason: letting the icon contribute
 * would silently rename a control a screen-reader user has already learned.
 *
 * 3 columns x 4px + 2 gaps x 2px = 16px, matching `FiltersIcon`'s box.
 */
export function WeekChooserIcon({ rows, currentWeek, denominator }: {
  rows: number[][];
  currentWeek: number | null;
  denominator: number;
}) {
  return (
    <span
      aria-hidden="true"
      data-week-chooser-icon
      className="inline-flex flex-col gap-[2px]"
    >
      {rows.map((row, rowIndex) => (
        <span key={rowIndex} className="flex gap-[2px]">
          {row.map(week => {
            const lit = week === currentWeek;
            return (
              <span
                key={week}
                data-week-chooser-cell={week}
                data-lit={lit ? 'true' : undefined}
                className="block h-1 w-1 rounded-[1px]"
                style={lit
                  ? {
                    // The week's own tone, so the icon reads as a legend for
                    // the band beside it — plus a ring, because the tone alone
                    // is ~1.03:1 against this backdrop in dark mode and ~1.5:1
                    // in light. `weekBandContrast.test.ts` pins both numbers;
                    // the ring is the signal, the tone is the annotation.
                    // `boxShadow`, not `border`: a border would change the box
                    // and shift every cell beside it.
                    background: rampBackground((week - 1) / denominator),
                    boxShadow: '0 0 0 1px var(--foreground)',
                  }
                  : { backgroundColor: 'currentColor', opacity: 0.35 }}
              />
            );
          })}
        </span>
      ))}
    </span>
  );
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd frontend && npx vitest run src/__tests__/lib/utils/weekBandContrast.test.ts
```

Expected: PASS, whole file (the phase-1 describes included).

- [ ] **Step 5: Falsify**

Delete the `boxShadow` line → expect FAIL on "draws the ring in a token the
stylesheet actually defines". Then, separately, change the assertion
`toBeLessThan(AA_NON_TEXT)` to `toBeGreaterThan(AA_NON_TEXT)` and confirm it
fails, proving the ~1.03:1 measurement is real rather than a tautology. Revert
both.

- [ ] **Step 6: Commit**

```bash
cd frontend && npm run build
git add frontend/src/components/calendar/WeekChooserIcon.tsx \
        frontend/src/__tests__/lib/utils/weekBandContrast.test.ts
git commit -m "feat(web): the week chooser's 3x3 icon, with a ring the tone cannot replace (#274)"
```

---

## Task 5: `WeekGrid` — the nine cells

The popover's contents: every week of the season as a 44px cell, tinted by the
band's ramp, dimmed and inert where the current filters reach nothing, with the
current week carrying the rail's one saturated fill. Focus roves in two
dimensions.

**Files:**
- Create: `frontend/src/components/calendar/WeekGrid.tsx`
- Create: `frontend/src/__tests__/components/calendar/WeekGrid.test.tsx`
- Modify: `frontend/src/__tests__/lib/utils/weekBandContrast.test.ts` (pin the
  grid's surface to `RAIL_BACKDROP`)

**Interfaces:**
- Consumes: `SeasonWeek` from `@/lib/types`; `WeekBandDestination` and
  `weekBandUnreachableLabel` from `@/lib/utils/weekBands`; `rampBackground`,
  `UNREACHABLE_FILL_OPACITY` from `@/lib/utils/railBandPalette`;
  `weekGridColumns`, `weekGridRows`, `moveGridFocus` from
  `@/lib/utils/weekChooser`; `useWeekThemePopover` (Task 3); `buildWeekTitle`
  from `@/components/filters/WeekThemePopover`; `WeekTheme` from
  `@/hooks/useWeeklyThemes`.
- Produces:
  ```ts
  export interface WeekGridProps {
    seasonWeeks: SeasonWeek[];
    destinations: Map<number, WeekBandDestination>;
    currentWeek: number | null;
    themes?: Record<number, WeekTheme>;
    onSelectWeek: (week: number) => void;
    onDismiss: () => void;
  }
  export function WeekGrid(props: WeekGridProps): JSX.Element | null;
  ```

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/__tests__/components/calendar/WeekGrid.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { WeekGrid } from '@/components/calendar/WeekGrid';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import { UNREACHABLE_FILL_OPACITY } from '@/lib/utils/railBandPalette';
import type { WeekBandDestination } from '@/lib/utils/weekBands';

const season = getChautauquaSeasonWeeks(2026);

/** Every week reachable except 4 — enough to test both states in one render. */
function destinations(exclude: number[] = [4]): Map<number, WeekBandDestination> {
  const map = new Map<number, WeekBandDestination>();
  for (const week of season) {
    if (exclude.includes(week.number)) continue;
    map.set(week.number, {
      dayKey: `2026-07-0${(week.number % 9) + 1}`,
      label: `Go to Week ${week.number}, opens Saturday, June 27, 84 events`,
    });
  }
  return map;
}

function renderGrid(overrides: Partial<Parameters<typeof WeekGrid>[0]> = {}) {
  const props = {
    seasonWeeks: season,
    destinations: destinations(),
    currentWeek: 6 as number | null,
    onSelectWeek: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  const view = render(<WeekGrid {...props} />);
  return { ...view, props };
}

const cell = (week: number) => document.querySelector<HTMLElement>(`[data-week-cell="${week}"]`)!;
const cells = () => Array.from(document.querySelectorAll<HTMLElement>('[data-week-cell]'));

describe('WeekGrid', () => {
  it('renders every week of the season, derived from its length', () => {
    renderGrid();
    expect(cells().map(c => c.dataset.weekCell)).toEqual(
      season.map(w => String(w.number)));
  });

  it('lays out three rows of three for a nine-week season', () => {
    const { container } = renderGrid();
    const rows = container.querySelectorAll('[data-week-row]');
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelectorAll('[data-week-cell]')).toHaveLength(3);
  });

  it('names a reachable week by its destination, verbatim from the shared map', () => {
    // The SAME string the band's button carries. One source, so the two
    // surfaces cannot describe the same jump differently.
    const { props } = renderGrid();
    expect(cell(6).getAttribute('aria-label'))
      .toBe(props.destinations.get(6)!.label);
  });

  it('states an unreachable week as a fact rather than offering a trip', () => {
    renderGrid();
    expect(cell(4).getAttribute('aria-label')).toBe('Week 4, no events');
    expect(cell(4).getAttribute('aria-disabled')).toBe('true');
  });

  it('does not navigate to an unreachable week', () => {
    const { props } = renderGrid();
    fireEvent.click(cell(4));
    expect(props.onSelectWeek).not.toHaveBeenCalled();
  });

  it('navigates to a reachable week and then dismisses', () => {
    const { props } = renderGrid();
    fireEvent.click(cell(8));
    expect(props.onSelectWeek).toHaveBeenCalledWith(8);
    expect(props.onDismiss).toHaveBeenCalled();
  });

  it('marks the current week, and only it', () => {
    renderGrid();
    const current = cells().filter(c => c.getAttribute('aria-current') === 'true');
    expect(current.map(c => c.dataset.weekCell)).toEqual(['6']);
  });

  it('marks nothing when the reader is in no week', () => {
    // Off-season, or a pre/post-season day inside the navigable bounds.
    renderGrid({ currentWeek: null });
    expect(cells().some(c => c.getAttribute('aria-current') === 'true')).toBe(false);
  });

  it('fades an unreachable week's fill and not its numeral', () => {
    // Phase 1's rule. A dimming pass over the whole cell is what took an empty
    // iOS chip's text to a sampled ~3.7:1.
    renderGrid();
    const fill = cell(4).querySelector<HTMLElement>('[data-week-cell-fill]')!;
    expect(fill.style.opacity).toBe(String(UNREACHABLE_FILL_OPACITY));
    const numeral = cell(4).querySelector<HTMLElement>('[data-week-cell-number]')!;
    expect(numeral.style.opacity === '' || numeral.style.opacity === '1').toBe(true);
  });

  it('does not grey a week merely for being in the past', () => {
    // `isWeekInPast` is a filter's opinion. A past week that still holds events
    // is perfectly navigable, and this is a navigation surface.
    renderGrid();
    const fill = cell(1).querySelector<HTMLElement>('[data-week-cell-fill]')!;
    expect(fill.style.opacity).toBe('1');
  });

  it('is one tab stop, starting on the current week', () => {
    renderGrid();
    expect(cells().filter(c => c.tabIndex === 0).map(c => c.dataset.weekCell))
      .toEqual(['6']);
  });

  it('starts on the first cell when no week is current', () => {
    renderGrid({ currentWeek: null });
    expect(cells().filter(c => c.tabIndex === 0).map(c => c.dataset.weekCell))
      .toEqual(['1']);
  });

  it('moves focus a whole row on ArrowDown', () => {
    const { container } = renderGrid();
    cell(6).focus();
    fireEvent.keyDown(container.querySelector('[data-week-grid]')!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(cell(9));
  });

  it('moves focus one cell on ArrowRight', () => {
    const { container } = renderGrid();
    cell(6).focus();
    fireEvent.keyDown(container.querySelector('[data-week-grid]')!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cell(7));
  });

  it('lets focus land on an unreachable week rather than stalling on it', () => {
    // `aria-disabled`, not `disabled` — the same call the day chips make. A walk
    // that skipped unreachable weeks would make the grid's shape change under
    // the reader as filters change.
    const { container } = renderGrid();
    cell(1).focus();
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight']) {
      fireEvent.keyDown(container.querySelector('[data-week-grid]')!, { key });
    }
    expect(document.activeElement).toBe(cell(4));
  });

  it('dismisses on Escape', () => {
    const { container, props } = renderGrid();
    fireEvent.keyDown(container.querySelector('[data-week-grid]')!, { key: 'Escape' });
    expect(props.onDismiss).toHaveBeenCalled();
  });

  it('leaves Escape to an open theme popover', () => {
    // `WeekThemePopover` listens on `document` and stops propagation, but
    // Preact attaches this handler to the element, so it runs FIRST. Without
    // this deference, Escape would close the whole chooser when the reader only
    // meant to close the theme they had just opened.
    const themes = {
      6: {
        number: 6, title: 'Water', description: '', startDate: '2026-08-01',
        endDate: '2026-08-07',
      },
    };
    const { container, props } = renderGrid({ themes });
    fireEvent.contextMenu(cell(6));
    expect(screen.getByRole('dialog', { name: 'Week 6 theme' })).toBeTruthy();
    fireEvent.keyDown(container.querySelector('[data-week-grid]')!, { key: 'Escape' });
    expect(props.onDismiss).not.toHaveBeenCalled();
  });

  it('renders nothing for a season with no weeks', () => {
    const { container } = renderGrid({ seasonWeeks: [] });
    expect(container.querySelector('[data-week-grid]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd frontend && npx vitest run src/__tests__/components/calendar/WeekGrid.test.tsx
```

Expected: FAIL — cannot resolve `@/components/calendar/WeekGrid`.

- [ ] **Step 3: Implement**

Create `frontend/src/components/calendar/WeekGrid.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { SeasonWeek } from '@/lib/types';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';
import { type WeekBandDestination, weekBandUnreachableLabel } from '@/lib/utils/weekBands';
import { UNREACHABLE_FILL_OPACITY, rampBackground } from '@/lib/utils/railBandPalette';
import { moveGridFocus, weekGridColumns, weekGridRows } from '@/lib/utils/weekChooser';
import { useWeekThemePopover } from '@/hooks/useWeekThemePopover';
import { buildWeekTitle } from '@/components/filters/WeekThemePopover';

export interface WeekGridProps {
  seasonWeeks: SeasonWeek[];
  /**
   * The SAME map the week band reads, passed down from `page.tsx`. A week
   * absent from it is dimmed and inert here exactly as it is on the band —
   * one source of truth, so the two surfaces cannot disagree about which weeks
   * the current filters can reach.
   */
  destinations: Map<number, WeekBandDestination>;
  /** From `anchorWeekNumber`; null off-season or on a pre/post-season day. */
  currentWeek: number | null;
  themes?: Record<number, WeekTheme>;
  onSelectWeek: (week: number) => void;
  /** Escape, or a week having been chosen. The caller closes and refocuses. */
  onDismiss: () => void;
}

/**
 * The chooser's contents: every week of the season as a 44px cell.
 *
 * Repurposed from `WeekSelector`'s job, not from its markup — a cell here means
 * "reachable / not", never "selected / not", and grey means "no matching
 * events", never "in the past". `isWeekInPast` is deliberately not consulted:
 * this is a navigation surface, and a past week that still holds events is
 * perfectly navigable.
 *
 * Every cell carries a border regardless of its tone. The ramp's first step is
 * ~1.03:1 against this surface in dark mode, so a cell drawn in tone alone would
 * have no visible edge — the same reason the chooser's icon rings its lit cell.
 */
export function WeekGrid({
  seasonWeeks, destinations, currentWeek, themes, onSelectWeek, onDismiss,
}: WeekGridProps) {
  const weekNumbers = seasonWeeks.map(w => w.number);
  const columns = weekGridColumns(weekNumbers.length);
  const rows = weekGridRows(weekNumbers, columns);
  // `getChautauquaSeasonWeeks` always returns nine, so a one-week season is
  // unreachable — but the ramp divides by this, and dividing by zero would be a
  // silent NaN in a colour rather than a visible mistake.
  const denominator = Math.max(weekNumbers.length - 1, 1);

  const cellRefs = useRef<Map<number, HTMLButtonElement | null>>(new Map());
  // Where the reader is, or the first cell — never nothing, or the grid opens
  // with no keyboard entry point at all.
  const initialIndex = currentWeek === null ? 0 : Math.max(0, weekNumbers.indexOf(currentWeek));
  const [focusIndex, setFocusIndex] = useState(initialIndex);

  const activate = (week: number) => {
    if (!destinations.has(week)) return;
    onSelectWeek(week);
    onDismiss();
  };

  const themePopover = useWeekThemePopover({ themes, onActivate: activate });

  // Focus enters the grid on open, on the week the reader is already in. Doing
  // it here rather than in the caller keeps "which cell is the entry point" in
  // one place — the same value the roving `tabIndex` uses.
  useEffect(() => {
    cellRefs.current.get(weekNumbers[initialIndex])?.focus();
    // Mount only: a later `currentWeek` change must not steal focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // Defer to an open theme popover: it listens on `document` and stops
      // propagation, but Preact attaches THIS handler to the element, so it
      // runs first and would dismiss the whole chooser out from under a reader
      // who only meant to close the theme.
      if (themePopover.isOpen) return;
      e.preventDefault();
      onDismiss();
      return;
    }
    const next = moveGridFocus(focusIndex, e.key, weekNumbers.length, columns);
    if (next === null) return;
    e.preventDefault();
    setFocusIndex(next);
    cellRefs.current.get(weekNumbers[next])?.focus();
  };

  if (weekNumbers.length === 0) return null;

  return (
    <div
      data-week-grid
      role="group"
      aria-label="Weeks"
      onKeyDown={onKeyDown}
      className="flex flex-col gap-1"
    >
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} data-week-row className="flex gap-1">
          {row.map(number => {
            const week = seasonWeeks.find(w => w.number === number)!;
            const destination = destinations.get(number);
            const reachable = !!destination;
            const isCurrent = number === currentWeek;
            const index = weekNumbers.indexOf(number);
            const theme = themes?.[number];
            return (
              <button
                key={number}
                type="button"
                data-week-cell={number}
                // The destination day, in the DOM, so a browser check can
                // confirm where a cell actually goes without re-deriving
                // `weekBandDestinations`' rule itself.
                data-week-cell-target={destination?.dayKey}
                aria-label={destination?.label ?? weekBandUnreachableLabel(number)}
                aria-current={isCurrent ? 'true' : undefined}
                // `aria-disabled`, not `disabled`, so the cell stays focusable
                // and the walk above cannot stall on it — the same call the day
                // chips make.
                aria-disabled={reachable ? undefined : true}
                tabIndex={index === focusIndex ? 0 : -1}
                title={buildWeekTitle(week, theme)}
                ref={el => {
                  cellRefs.current.set(number, el);
                  themePopover.registerAnchor(number, el);
                }}
                onClick={() => activate(number)}
                {...themePopover.handlers(number)}
                className={`relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 ${
                  reachable ? '' : 'cursor-default'
                }`}
              >
                <span
                  data-week-cell-fill
                  aria-hidden="true"
                  className={`absolute inset-0 rounded-md ${isCurrent ? 'bg-blue-600' : ''}`}
                  style={isCurrent
                    ? { opacity: reachable ? 1 : UNREACHABLE_FILL_OPACITY }
                    : {
                      // A named token first, so a browser that drops the
                      // `color-mix` declaration still paints a cell rather than
                      // nothing — the same two-line pattern `WeekBandCell` uses.
                      backgroundColor: 'var(--rail-band-start)',
                      background: rampBackground((number - 1) / denominator),
                      opacity: reachable ? 1 : UNREACHABLE_FILL_OPACITY,
                    }}
                />
                {/*
                  The numeral never fades. The ramp sits between this surface and
                  the text colour in both themes, so a faded FILL composites
                  toward the background and can only raise the numeral's
                  contrast; fading the numeral instead is what took an empty iOS
                  chip's text to a sampled ~3.7:1.
                */}
                <span
                  data-week-cell-number
                  aria-hidden="true"
                  className="relative text-sm font-semibold"
                  style={{ color: isCurrent ? '#ffffff' : 'var(--foreground)' }}
                >
                  {number}
                </span>
              </button>
            );
          })}
        </div>
      ))}
      {themePopover.portal}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd frontend && npx vitest run src/__tests__/components/calendar/WeekGrid.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Pin the grid's surface to `RAIL_BACKDROP`**

The unreachable-fade contrast proof in `weekBandContrast.test.ts` composites the
faded fill against `RAIL_BACKDROP`. That is only the right backdrop while the
popover's surface really is `bg-white dark:bg-gray-800`. The existing
`RAIL_BACKDROP and the rail's own background classes` describe already asserts
this for `DayRail.tsx` by reading the source; extend it to the chooser.

Find that describe block and add the chooser's file to whatever list of sources
it reads (at the time of writing it reads `DayRail.tsx` into `dayRailSrc` and
asserts the class appears in it). Add alongside:

```ts
  it.each(THEMES)('the chooser's popover surface is the same backdrop in %s', theme => {
    // The unreachable-fade proof above composites against RAIL_BACKDROP. That
    // is the right backdrop for the grid only while the popover paints the same
    // surface the rail does.
    const src = readFileSync(
      resolve(__dirname, '../../../components/calendar/WeekChooser.tsx'), 'utf8');
    const cls = theme === 'light' ? 'bg-white' : 'dark:bg-gray-800';
    expect(src).toMatch(new RegExp(`\\b${cls.replace(':', '\\:')}\\b`));
  });
```

This test references `WeekChooser.tsx`, created in Task 6 — so **write it now
and expect it to fail**, and add the file in Task 6. Note the failure in the
commit message rather than skipping the test; a skipped test is a test nobody
turns back on.

*(If holding a red test across one commit is unacceptable to the executor, move
this single `it` to Task 6 Step 1 instead. Do not delete it.)*

- [ ] **Step 6: Falsify**

Three, reverting after each:

1. Change `activate` to drop its `destinations.has(week)` guard → expect FAIL on
   "does not navigate to an unreachable week".
2. Move `opacity: reachable ? 1 : UNREACHABLE_FILL_OPACITY` from the fill span to
   the numeral span → expect FAIL on "fades an unreachable week's fill and not
   its numeral".
3. Delete the `if (themePopover.isOpen) return;` line → expect FAIL on "leaves
   Escape to an open theme popover".

- [ ] **Step 7: Commit**

```bash
cd frontend && npx vitest run src/__tests__/components/calendar/WeekGrid.test.tsx
git add frontend/src/components/calendar/WeekGrid.tsx \
        frontend/src/__tests__/components/calendar/WeekGrid.test.tsx \
        frontend/src/__tests__/lib/utils/weekBandContrast.test.ts
git commit -m "feat(web): the week chooser's 3x3 grid of weeks (#274)

The backdrop test references WeekChooser.tsx, added in the next commit."
```

---

## Task 6: `WeekChooser` — the trigger and the popover

The control itself: a 44px square on the rail, the popover it opens, and the
focus contract between them.

**Files:**
- Create: `frontend/src/components/calendar/WeekChooser.tsx`
- Create: `frontend/src/__tests__/components/calendar/WeekChooser.test.tsx`

**Interfaces:**
- Consumes: `WeekChooserIcon` (Task 4); `WeekGrid` (Task 5); `weekGridColumns`,
  `weekGridRows`, `weekChooserTriggerLabel` (Task 2); `useFloatingCoords` from
  `@/hooks/useViewportClamp`; `WeekBandDestination` from `@/lib/utils/weekBands`.
- Produces:
  ```ts
  export interface WeekChooserProps {
    seasonWeeks: SeasonWeek[];
    destinations: Map<number, WeekBandDestination>;
    currentWeek: number | null;
    themes?: Record<number, WeekTheme>;
    onSelectWeek: (week: number) => void;
  }
  export function WeekChooser(props: WeekChooserProps): JSX.Element | null;
  ```

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/__tests__/components/calendar/WeekChooser.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { WeekChooser } from '@/components/calendar/WeekChooser';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import type { WeekBandDestination } from '@/lib/utils/weekBands';

const season = getChautauquaSeasonWeeks(2026);

function destinations(): Map<number, WeekBandDestination> {
  return new Map(season.map(w => [w.number, {
    dayKey: '2026-07-04',
    label: `Go to Week ${w.number}, opens Saturday, July 4, 12 events`,
  }]));
}

function renderChooser(overrides: Partial<Parameters<typeof WeekChooser>[0]> = {}) {
  const props = {
    seasonWeeks: season,
    destinations: destinations(),
    currentWeek: 6 as number | null,
    onSelectWeek: vi.fn(),
    ...overrides,
  };
  const view = render(<WeekChooser {...props} />);
  return { ...view, props };
}

const trigger = () => document.querySelector<HTMLElement>('[data-week-chooser-trigger]')!;
const popover = () => document.querySelector<HTMLElement>('[data-week-chooser-popover]');

describe('WeekChooser', () => {
  it('names itself by position in the season and by what it does', () => {
    renderChooser();
    expect(trigger().getAttribute('aria-label')).toBe('Week 6 of 9, choose a week');
    // The same words for a sighted mouse user, who gets no accessible name.
    expect(trigger().getAttribute('title')).toBe('Week 6 of 9, choose a week');
  });

  it('says only what it does when the reader is in no week', () => {
    renderChooser({ currentWeek: null });
    expect(trigger().getAttribute('aria-label')).toBe('Choose a week');
  });

  it('lights exactly one icon cell, the current week', () => {
    renderChooser();
    const lit = Array.from(document.querySelectorAll('[data-week-chooser-cell][data-lit]'));
    expect(lit.map(c => c.getAttribute('data-week-chooser-cell'))).toEqual(['6']);
  });

  it('lights nothing when no week is current', () => {
    renderChooser({ currentWeek: null });
    expect(document.querySelectorAll('[data-week-chooser-cell][data-lit]')).toHaveLength(0);
  });

  it('draws a miniature of the grid it opens', () => {
    // The icon is a legend, not decoration: nine cells, in the same wrap as the
    // grid. If the grid ever reshapes, this catches an icon that did not.
    renderChooser();
    expect(document.querySelectorAll('[data-week-chooser-cell]')).toHaveLength(9);
  });

  it('opens on click and announces that it did', () => {
    renderChooser();
    expect(popover()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger());
    expect(popover()).not.toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('is a dialog with a name of its own', () => {
    renderChooser();
    fireEvent.click(trigger());
    expect(screen.getByRole('dialog', { name: 'Choose a week' })).toBeTruthy();
    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('puts focus on the current week when it opens', () => {
    // Two interactions to any week: this is the first, and it must land the
    // keyboard reader somewhere they can walk from.
    renderChooser();
    fireEvent.click(trigger());
    expect(document.activeElement?.getAttribute('data-week-cell')).toBe('6');
  });

  it('closes on Escape and gives focus back to the trigger', () => {
    renderChooser();
    fireEvent.click(trigger());
    fireEvent.keyDown(document.querySelector('[data-week-grid]')!, { key: 'Escape' });
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on a second click of the trigger', () => {
    renderChooser();
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(popover()).toBeNull();
  });

  it('closes on a pointer press outside itself', () => {
    renderChooser();
    fireEvent.click(trigger());
    fireEvent.mouseDown(document.body);
    expect(popover()).toBeNull();
  });

  it('stays open for a press inside the popover', () => {
    renderChooser();
    fireEvent.click(trigger());
    fireEvent.mouseDown(document.querySelector('[data-week-cell="3"]')!);
    expect(popover()).not.toBeNull();
  });

  it('navigates, closes, and returns focus when a week is chosen', () => {
    const { props } = renderChooser();
    fireEvent.click(trigger());
    fireEvent.click(document.querySelector('[data-week-cell="8"]')!);
    expect(props.onSelectWeek).toHaveBeenCalledWith(8);
    expect(popover()).toBeNull();
    // The list is about to scroll a long way. Focus left inside a removed node
    // would be lost to the document body.
    expect(document.activeElement).toBe(trigger());
  });

  it('renders nothing at all for a season with no weeks', () => {
    // Not a disabled trigger: a control that can never open is chrome that
    // costs rail width and means nothing.
    renderChooser({ seasonWeeks: [] });
    expect(document.querySelector('[data-week-chooser-trigger]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd frontend && npx vitest run src/__tests__/components/calendar/WeekChooser.test.tsx
```

Expected: FAIL — cannot resolve `@/components/calendar/WeekChooser`.

- [ ] **Step 3: Implement**

Create `frontend/src/components/calendar/WeekChooser.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SeasonWeek } from '@/lib/types';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';
import type { WeekBandDestination } from '@/lib/utils/weekBands';
import { useFloatingCoords } from '@/hooks/useViewportClamp';
import { weekChooserTriggerLabel, weekGridColumns, weekGridRows } from '@/lib/utils/weekChooser';
import { WeekChooserIcon } from '@/components/calendar/WeekChooserIcon';
import { WeekGrid } from '@/components/calendar/WeekGrid';

export interface WeekChooserProps {
  seasonWeeks: SeasonWeek[];
  /** The same map the band reads — see `WeekGrid`. */
  destinations: Map<number, WeekBandDestination>;
  currentWeek: number | null;
  themes?: Record<number, WeekTheme>;
  onSelectWeek: (week: number) => void;
}

/**
 * The week chooser: a 3x3 icon at the right end of the rail, opening a 3x3 grid.
 *
 * The cheapest control on the strip — ~44px square — and a literal miniature of
 * what it opens. It is what makes any week of the season reachable in **two**
 * interactions from anywhere in the list: the rail is sticky, so one tap opens
 * the grid and one picks the week. No trip to the top of a document that can be
 * ~31,000px away, and no reveal of the site header needed.
 *
 * Navigation, never a filter. Choosing a week calls the caller's `onSelectWeek`,
 * which is `page.tsx`'s `goToWeek` — `weekDestinations.get(week)` then
 * `goToDay` — and touches no scope, week, category or search.
 */
export function WeekChooser({
  seasonWeeks, destinations, currentWeek, themes, onSelectWeek,
}: WeekChooserProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const coords = useFloatingCoords(open, triggerRef, popoverRef, { mode: 'center' });

  const weekNumbers = seasonWeeks.map(w => w.number);
  const rows = weekGridRows(weekNumbers, weekGridColumns(weekNumbers.length));
  const denominator = Math.max(weekNumbers.length - 1, 1);

  function close() {
    setOpen(false);
    // Back to the trigger, always. The list is about to scroll a long way when
    // a week was chosen, and focus left inside a node that is being removed is
    // focus lost to the document body.
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDownOutside(e: Event) {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      // Not `close()`: a press outside is not a request to move focus back into
      // the rail, and stealing it from whatever the reader pressed would be
      // worse than leaving it where they put it.
      setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDownOutside);
    document.addEventListener('touchstart', onPointerDownOutside);
    return () => {
      document.removeEventListener('mousedown', onPointerDownOutside);
      document.removeEventListener('touchstart', onPointerDownOutside);
    };
  }, [open]);

  // A season with no weeks can open nothing, so it shows nothing — chrome that
  // costs rail width and means nothing is worse than an absence.
  if (weekNumbers.length === 0) return null;

  const label = weekChooserTriggerLabel(currentWeek, weekNumbers.length);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        data-week-chooser-trigger
        // The icon is decorative in every part, so this explicit name is what a
        // screen reader announces — the same contract `FiltersIcon` has.
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        // 44px square, the platform minimum, on a phone-first app's primary
        // navigation surface. `inline-flex` + centring because a `min-h` on a
        // plain inline-block button would leave the icon top-aligned.
        className="shrink-0 inline-flex min-h-11 min-w-11 items-center justify-center px-2 py-1 rounded-md text-gray-600 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-gray-700"
      >
        <WeekChooserIcon rows={rows} currentWeek={currentWeek} denominator={denominator} />
      </button>

      {open && createPortal(
        <div
          ref={popoverRef}
          data-week-chooser-popover
          role="dialog"
          aria-label="Choose a week"
          className="fixed z-50 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-2 shadow-lg"
          style={{
            // Rendered off-screen until measured, exactly as `WeekSelector`'s
            // theme popover is: `useFloatingCoords` needs the popover's own box
            // to clamp it, so the first paint has to happen somewhere.
            top: coords ? `${coords.top}px` : '-9999px',
            left: coords ? `${coords.left}px` : '0px',
            visibility: coords ? 'visible' : 'hidden',
          }}
        >
          <WeekGrid
            seasonWeeks={seasonWeeks}
            destinations={destinations}
            currentWeek={currentWeek}
            themes={themes}
            onSelectWeek={onSelectWeek}
            onDismiss={close}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd frontend && npx vitest run src/__tests__/components/calendar/WeekChooser.test.tsx \
  src/__tests__/lib/utils/weekBandContrast.test.ts
```

Expected: PASS both — including the backdrop test left red at the end of Task 5.

- [ ] **Step 5: Falsify**

Three, reverting after each:

1. Change `close()` to `setOpen(false)` only (no refocus) → expect FAIL on
   "closes on Escape and gives focus back to the trigger" **and** on
   "navigates, closes, and returns focus when a week is chosen".
2. Change the outside handler to skip its `popoverRef.current?.contains` guard →
   expect FAIL on "stays open for a press inside the popover".
3. Change the trigger's `className` surface `bg-white` in the popover to
   `bg-gray-50` → expect FAIL on the chooser backdrop test in
   `weekBandContrast.test.ts`.

- [ ] **Step 6: Commit**

```bash
cd frontend && npm run build
git add frontend/src/components/calendar/WeekChooser.tsx \
        frontend/src/__tests__/components/calendar/WeekChooser.test.tsx
git commit -m "feat(web): the week chooser trigger and its popover (#274)"
```

---

## Task 7: `DayRail` renders the chooser

**Files:**
- Modify: `frontend/src/components/calendar/DayRail.tsx`
- Modify: `frontend/src/__tests__/components/calendar/DayRail.test.tsx`

**Interfaces:**
- Consumes: `WeekChooser` (Task 6); `anchorWeekNumber` (Task 1, already
  imported); `SeasonWeek`, `WeekTheme`.
- Produces: two new `DayRailProps` fields —
  `seasonWeeks: SeasonWeek[]` and `weekThemes?: Record<number, WeekTheme>`.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/__tests__/components/calendar/DayRail.test.tsx`. Both
`renderRail` and `renderRailIn` need `seasonWeeks: getChautauquaSeasonWeeks(2026)`
added to their default props — the import is already at the top of the file.

```tsx
  describe('the week chooser', () => {
    it('sits on the rail, inside the measured root', () => {
      // Persistent chrome outside this root would widen the stuck header
      // without widening `--day-rail-h`, undercounting the clearance
      // `dayHeaderTop()` and `useDayAnchor` compute against it.
      const { container } = renderRailIn();
      const rail = container.querySelector('[data-day-rail]')!;
      expect(rail.querySelector('[data-week-chooser-trigger]')).not.toBeNull();
    });

    it('lights the week the anchor is in', () => {
      renderRail();
      // July 5 2026 is inside week 2 of the 2026 season; the chooser and the
      // band's tab stop resolve it through the same `anchorWeekNumber`.
      const lit = Array.from(document.querySelectorAll('[data-week-chooser-cell][data-lit]'));
      expect(lit).toHaveLength(1);
    });

    it('offers the same weeks the band does, from the same map', () => {
      renderRail();
      fireEvent.click(document.querySelector('[data-week-chooser-trigger]')!);
      // The default fixture reaches weeks 1 and 2 only.
      const enabled = Array.from(document.querySelectorAll('[data-week-cell]'))
        .filter(c => c.getAttribute('aria-disabled') !== 'true')
        .map(c => c.getAttribute('data-week-cell'));
      expect(enabled).toEqual(['1', '2']);
    });

    it('routes a choice through the rail's own onSelectWeek', () => {
      const props = renderRail();
      fireEvent.click(document.querySelector('[data-week-chooser-trigger]')!);
      fireEvent.click(document.querySelector('[data-week-cell="2"]')!);
      expect(props.onSelectWeek).toHaveBeenCalledWith(2);
    });

    it('contributes nothing to the rail's chevron selector', () => {
      // Same guard as the band button's, by attribute rather than by a bigger
      // count: a count that absorbed the trigger could no longer distinguish
      // "the clipped copy leaked a button" from "the rail gained one".
      const { container } = renderRailIn();
      const rail = container.querySelector<HTMLElement>('[data-day-rail]')!;
      const nonChipButtons = rail.querySelectorAll(
        'button:not([data-chip]):not([data-week-band-button]):not([data-week-chooser-trigger])');
      expect(nonChipButtons).toHaveLength(2);
    });

    it('does not answer to the band's keyboard walk', () => {
      // The trigger is neither a chip nor a band button, so an arrow key on it
      // must fall through rather than teleporting focus into a row it is not in.
      const { container } = renderRailIn();
      const trigger = document.querySelector<HTMLElement>('[data-week-chooser-trigger]')!;
      trigger.focus();
      fireEvent.keyDown(container.querySelector('[data-day-rail]')!, { key: 'ArrowRight' });
      expect(document.activeElement).toBe(trigger);
    });
  });
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd frontend && npx vitest run src/__tests__/components/calendar/DayRail.test.tsx
```

Expected: FAIL — no `[data-week-chooser-trigger]` in the rail. (Add
`seasonWeeks` to the two prop builders first, or every test in the file fails on
a type error instead, which proves nothing.)

- [ ] **Step 3: Implement**

In `frontend/src/components/calendar/DayRail.tsx`:

Add the imports:

```tsx
import type { SeasonWeek } from '@/lib/types';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';
import { WeekChooser } from '@/components/calendar/WeekChooser';
```

Add to `DayRailProps`, beside `bandSegments` / `weekDestinations`:

```tsx
  /**
   * The season's weeks, for the chooser's grid.
   *
   * Passed rather than derived from `bandSegments` because the grid must show
   * every week of the season — including one entirely outside `navigableBounds`,
   * which has no segment at all and would silently vanish from a grid built
   * from the segments.
   */
  seasonWeeks: SeasonWeek[];
  /**
   * The weekly themes, if they have loaded. Optional throughout: the themes
   * file can 404 for a season, and the chooser has to work without it.
   */
  weekThemes?: Record<number, WeekTheme>;
```

Destructure them in the signature, and render the chooser immediately after the
`⟳ Now` block and before `filtersToggle`:

```tsx
      {/*
        The week chooser. Right end of the rail, next to `⟳ Now` — the two
        controls that answer "take me somewhere in the season" rather than
        "take me one step".
      */}
      <WeekChooser
        seasonWeeks={seasonWeeks}
        destinations={weekDestinations}
        currentWeek={anchorWeek}
        themes={weekThemes}
        // `resume()` for the same reason a band tap and a chip tap call it: the
        // highlight is scroll-linked and paused while the reader is dragging the
        // rail, and a jump has to hand control back to the scroll position it is
        // about to land on.
        onSelectWeek={(week) => { resume(); onSelectWeek(week); }}
      />
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd frontend && npx vitest run src/__tests__/components/calendar/DayRail.test.tsx
```

Expected: PASS, whole file — the phase-1 band tests included, untouched.

- [ ] **Step 5: Falsify**

Move the `<WeekChooser>` element outside the rail's root `<div>` (wrap the root
and the chooser in a fragment sibling) → expect FAIL on "sits on the rail,
inside the measured root". Revert.

Then drop the `resume()` from `onSelectWeek` and confirm no test fails — this
one is *not* unit-testable (it needs real geometry), which is why check 20c in
Task 9 asserts the landing rather than the call. Note it and revert.

- [ ] **Step 6: Commit**

```bash
cd frontend && npm run build
git add frontend/src/components/calendar/DayRail.tsx \
        frontend/src/__tests__/components/calendar/DayRail.test.tsx
git commit -m "feat(web): the day rail carries the week chooser (#274)"
```

---

## Task 8: wire it into `page.tsx`

Two props. Everything else the chooser needs already exists there: `seasonWeeks`
(line ~49), `weeklyThemes` (line ~63), `weekDestinations` (line ~256) and
`goToWeek` (line ~445) were all built in phase 1 or earlier.

**Files:**
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/src/__tests__/` — whichever page-level test file already
  renders the calendar page (search for one that mounts `page.tsx`; if none
  exists, the browser checks in Task 9 are this task's coverage and that is
  stated in the commit message rather than papered over with a shallow test).

**Interfaces:**
- Consumes: `DayRail`'s two new props (Task 7).
- Produces: nothing new.

- [ ] **Step 1: Add the props**

In `frontend/src/app/page.tsx`, in the `<DayRail ... />` element, beside
`bandSegments` / `weekDestinations` / `onSelectWeek`:

```tsx
            // The chooser's grid shows every week of the SEASON, which is not
            // the same set as the band's segments: `navigableBounds` can start
            // or end mid-season, and a week with no segment must still appear
            // in the grid (dimmed, from `weekDestinations`) rather than vanish.
            seasonWeeks={seasonWeeks}
            weekThemes={weeklyThemes}
```

No other change. `goToWeek` is already `onSelectWeek`, and it already does the
two-lookup dance the chooser needs.

- [ ] **Step 2: Verify nothing else moved**

```bash
cd frontend && npm run build
```

Expected: PASS — type-check, lint, the whole unit suite with coverage, then the
bundle.

- [ ] **Step 3: Smoke-test in the browser by hand**

```bash
cd frontend && npm run dev
```

Open http://localhost:3000, scroll into the list, and confirm by eye:
the 3×3 icon is at the right end of the rail; its lit cell moves as you scroll
between weeks; tapping it opens a 3×3 grid; picking a week moves the list;
the grid closes.

**If the dev server was already running, restart it.** A stale `vite preview` on
:3000 and Vite HMR dropping module-level state have each cost a wrong diagnosis
on this branch's predecessors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/page.tsx
git commit -m "feat(web): wire the week chooser into the calendar page (#274)"
```

---

## Task 9: browser verification

Everything this phase risks that jsdom cannot see: whether the popover is
reachable from a deep scroll position, whether a jump across the season actually
lands, whether the lit cell follows, whether the popover fits a 390px phone, and
whether an `aria-hidden` decorative icon inside a `role="dialog"` trips axe.

**Files:**
- Modify: `frontend/e2e/verify-rail.mjs`

**Interfaces:**
- Consumes: the suite's existing `newPage`, `check`, `anchorChip`, `railChips`
  helpers and the `storage` seed pattern from check 18.
- Produces: checks 20a–20f and 21.

- [ ] **Step 1: Write the checks**

Append to `frontend/e2e/verify-rail.mjs`, **before** the final
`await browser.close(); finish();` lines.

```js
// ------------------------------------------- 20. the week chooser
//
// The acceptance criterion for this phase, measured rather than asserted: any
// week of the season reachable in TWO interactions from anywhere in the list.
// The rail is sticky, so the trigger is on screen at any scroll position — that
// is the property this opens from a deep scroll to test, because it is the one
// the whole design rests on and the one a sticky regression would silently take
// away (a wrapper div gave `position: sticky` zero travel in #238, and eleven
// green task reviews missed it).
{
  const page = await newPage({ width: 390, height: 844 });
  // Deep enough that the top of the document is nowhere near the viewport.
  await page.mouse.wheel(0, 6000);
  await page.waitForTimeout(700);
  const before = await anchorChip(page);

  const triggerBox = await page.evaluate(() => {
    const el = document.querySelector('[data-week-chooser-trigger]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, w: Math.round(r.width), h: Math.round(r.height),
             onScreen: r.top >= 0 && r.bottom <= window.innerHeight };
  });
  check('20a the chooser is on screen after a deep scroll',
    !!triggerBox && triggerBox.onScreen,
    triggerBox ? `top=${triggerBox.top.toFixed(0)} ${triggerBox.w}x${triggerBox.h}` : 'no trigger');

  await page.click('[data-week-chooser-trigger]');
  await page.waitForSelector('[data-week-chooser-popover]', { timeout: 3000 });
  const opened = await page.evaluate(() => {
    const pop = document.querySelector('[data-week-chooser-popover]');
    const r = pop.getBoundingClientRect();
    return {
      cells: pop.querySelectorAll('[data-week-cell]').length,
      // Nine 44px cells in a ROW would be 396px, wider than this 390px viewport.
      // The 3x3 is what makes the control fit a phone at all, so its box is the
      // measurement, not its class list.
      width: Math.round(r.width),
      withinViewport: r.left >= 0 && r.right <= window.innerWidth
        && r.top >= 0 && r.bottom <= window.innerHeight,
    };
  });
  check('20b the popover holds every week of the season', opened.cells === 9,
    `${opened.cells} cells`);
  check('20c the popover fits a 390px phone', opened.withinViewport && opened.width < 390,
    `${opened.width}px wide, within=${opened.withinViewport}`);

  // The jump itself: the furthest reachable week from wherever the rail opened,
  // so the check cannot pass on a one-week nudge.
  const jumped = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-week-cell]')]
      .filter(c => c.getAttribute('aria-disabled') !== 'true');
    const target = cells[cells.length - 1];
    if (!target) return null;
    target.click();
    return { week: target.dataset.weekCell, day: target.dataset.weekCellTarget,
             label: target.getAttribute('aria-label') };
  });
  if (!jumped) {
    check('20d a chooser tap navigates', false, 'no reachable week cell');
  } else {
    await page.waitForTimeout(900);
    const after = await anchorChip(page);
    check('20d a chooser tap navigates', !!after && after !== before,
      `${before} → ${after} (week ${jumped.week})`);
    // Where it SAID it would go, not merely somewhere. The rail's standing rule:
    // a control names its destination, and the destination is where it lands.
    check('20e it lands on the day it named', after === jumped.day,
      `named ${jumped.day}, landed ${after}`);
    const closed = await page.$$('[data-week-chooser-popover]');
    check('20f the popover closes on a choice', closed.length === 0,
      `${closed.length} popovers still open`);

    // The lit cell followed. This is the trigger's whole job — position in the
    // season, spatially — and it is downstream of `anchorDay`, which is
    // scroll-derived, so nothing but a real scroll can test it.
    const lit = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('[data-week-chooser-cell][data-lit]')];
      return { count: cells.length, week: cells[0]?.dataset.weekChooserCell ?? null };
    });
    check('20g the lit cell followed the jump',
      lit.count === 1 && lit.week === jumped.week,
      `lit=${lit.week} expected=${jumped.week} (${lit.count} lit)`);
  }
  await page.close();
}

// ------------------------------------------- 20h. an unreachable week is inert
//
// Same storage seed as check 18, and for the same reason: the default feed
// fills every in-season week, so this state has to be CONSTRUCTED rather than
// hoped for. A check that never creates the state it names can only skip.
// 'williamsburg' leaves week 6 reachable and every other in-season week empty,
// in both the local dev fixture and live production.
{
  const page = await newPage({
    width: 390, height: 844,
    storage: ['chq-calendar-user-state', JSON.stringify({
      dateFilter: 'all', selectedWeeks: [], searchTerm: 'williamsburg',
      selectedTags: [], selectedLocations: [], expandedDescriptions: [],
      recentLocations: [], recentCategories: [], showFavoritesOnly: false,
      lastSaved: Date.now(),
    })],
  });
  await page.click('[data-week-chooser-trigger]');
  await page.waitForSelector('[data-week-chooser-popover]', { timeout: 3000 });
  const state = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-week-cell]')];
    const dim = cells.filter(c => c.getAttribute('aria-disabled') === 'true');
    return {
      dim: dim.length,
      reachable: cells.length - dim.length,
      labels: dim.map(c => c.getAttribute('aria-label')),
      fillOpacity: dim[0]
        ? Number(getComputedStyle(dim[0].querySelector('[data-week-cell-fill]')).opacity)
        : null,
      numberOpacity: dim[0]
        ? Number(getComputedStyle(dim[0].querySelector('[data-week-cell-number]')).opacity)
        : null,
    };
  });
  // Both counts, as in 18-pre: zero unreachable is the original gap, and zero
  // reachable would mean the term matched nothing at all and 20h passes
  // vacuously.
  check('20h-pre the seed narrows to exactly one theme week',
    state.dim > 0 && state.reachable > 0,
    `${state.reachable} reachable, ${state.dim} unreachable`);
  check('20h an unreachable week in the grid says so rather than offering a trip',
    state.dim > 0 && state.labels.every(l => /^Week \d+, no events$/.test(l ?? '')),
    state.labels.slice(0, 3).join(' | ') || 'none');
  check('20i the grid fades the fill and not the numeral',
    state.fillOpacity !== null && state.fillOpacity < 1 && state.numberOpacity === 1,
    `fill=${state.fillOpacity} number=${state.numberOpacity}`);
  await page.close();
}

// ------------------------------------------- 21. axe over the open chooser
//
// The popover is a `role="dialog"` containing nine controls and, on the trigger
// behind it, an `aria-hidden` icon made of nine decorative spans. Both are
// shapes an audit has opinions about, and neither is checked by check 19, which
// scopes itself to `[data-day-rail]` — the popover is portalled to
// `document.body` and is not inside it.
{
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const page = await newPage();
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  await page.click('[data-week-chooser-trigger]');
  await page.waitForSelector('[data-week-chooser-popover]', { timeout: 3000 });
  const results = await page.evaluate(async () => {
    const run = await window.axe.run('[data-week-chooser-popover]', {
      runOnly: { type: 'rule', values: [
        'aria-hidden-focus', 'button-name', 'aria-allowed-attr',
        'nested-interactive', 'aria-dialog-name', 'aria-required-children',
      ] },
    });
    return run.violations.map(v => `${v.id} x${v.nodes.length}`);
  });
  check('21 axe is clean over the open week chooser',
    results.length === 0, results.join(', ') || 'no violations');
  await page.close();
}
```

- [ ] **Step 2: Run the suite against a fresh dev server**

```bash
cd frontend && npm run dev            # in one terminal, restarted, not a stale preview
cd frontend && node e2e/verify-rail.mjs
```

Expected: every check PASS, and the count grown by 11 over phase 1's run.

- [ ] **Step 3: Falsify — the important part**

Browser checks are the ones that pass for the wrong reason. Prove each of the
three load-bearing ones by breaking the code, and **build with `npx vite build`
and grep `out/` to confirm the injection actually landed** — `npm run build`
gates the bundle on the unit suite, so a defect that fails a unit test silently
serves the previous bundle and the check passes against code you did not write.

1. **20e (lands where it named).** In `page.tsx`'s `goToWeek`, change
   `goToDay(destination.dayKey)` to `goToDay(navEventDays[0])`.
   ```bash
   cd frontend && npx vite build && grep -rc "navEventDays\[0\]" out/assets/*.js | head
   ```
   Expected: 20e FAILS (`named X, landed Y`). Revert.
2. **20g (the lit cell follows).** In `DayRail.tsx`, hard-code
   `currentWeek={1}` on `<WeekChooser>`.
   Expected: 20g FAILS with `lit=1 expected=<the jumped week>`. Revert.
3. **20c (fits a phone).** In `WeekGrid.tsx`, change the outer container to
   `flex flex-row` (one row of nine).
   Expected: 20c FAILS with a width over 390. Revert.

If any falsification unexpectedly **passes**, suspect the harness before the
code: re-run it against the unmodified build and confirm the check can tell the
two apart at all.

- [ ] **Step 4: Confirm the suite still holds in the other regimes**

```bash
cd frontend && npm run test:browser
```

Expected: all five suites pass. `verify-offseason.mjs` is the one to watch — the
chooser renders in a regime where `anchorWeekNumber` is null for every day, and
"lights nothing" must not become "throws".

- [ ] **Step 5: Commit**

```bash
git add frontend/e2e/verify-rail.mjs
git commit -m "test(web): browser checks for the week chooser, including an axe pass (#274)"
```

---

## Task 10: verify, record, and open the stacked PR

**Files:**
- Modify: `docs/superpowers/specs/2026-08-25-web-day-strip-date-navigation-design.md`
  (addendum)
- Modify: `/Users/bernard/.claude/projects/-Users-bernard-src-chq-chq-calendar/memory/day-strip-date-navigation-274-status.md`

- [ ] **Step 1: Full verification, with the output in front of you**

```bash
cd frontend && npm run build
cd ../backend && npm run validate     # untouched, but the checklist says run it
cd ../frontend && npm run test:browser
```

Do not claim any of these passed without the output. If a test fails, ask before
changing the test — a failing test is a claim about the code until proven
otherwise.

- [ ] **Step 2: Write the spec addendum**

Append to the spec, at the end of the "Phase 2 — the week chooser" section:

```markdown
### Addendum, 2026-08-25 — how the popover was actually built

Phase 2 built the grid from `WeekSelector`'s *behaviour*, extracted into
`hooks/useWeekThemePopover.tsx`, rather than from its markup. The two controls
share only "nine numbered buttons that can open a theme popover": a cell in the
filter strip means selected/not and greys for being in the past, a cell in the
chooser means reachable/not and greys for having no matching events, and the
chooser adds a two-dimensional keyboard walk the strip never had. One component
doing both would carry grid code down the filter path and drag code down the
navigation path for two phases, and the drag half is deleted in phase 4 anyway.

**Consequence for phase 4:** `components/filters/WeekSelector.tsx` is deleted
outright, not preserved inside the chooser. `useWeekThemePopover` and
`WeekThemePopover` are what keep week themes reachable once the week strip
leaves the filter panel, together with `WeekBadge` on the day header.
```

- [ ] **Step 3: Update the memory file**

Rewrite `day-strip-date-navigation-274-status.md`'s status line and add what
phase 2 taught. At minimum:

- Phase 2 built on `feat/274-week-chooser`, **stacked on** `feat/274-day-strip-date-navigation`
  (PR #276), with its own PR based on that branch — retarget to `main` after
  #276 merges.
- The ramp's first step is ~1.5:1 (light) and ~1.03:1 (dark) against the rail's
  own backdrop, so **a ramp tone is never a sufficient signal on its own**;
  every tinted element carries a ring or a border, and the number is pinned in
  `weekBandContrast.test.ts` so it cannot be removed as decoration.
- **Preact attaches a component's `onKeyDown` to the element**, while
  `WeekThemePopover` listens on `document` — so the *inner* popover's Escape
  arrives at the grid first. Deference is explicit (`if (themePopover.isOpen)
  return`), not inherited from propagation order.
- The spec's "built from `WeekSelector`'s markup" was changed to "built from its
  behaviour", which changes phase 4's deletion list.

- [ ] **Step 4: Commit the docs**

```bash
git add docs/superpowers/specs/2026-08-25-web-day-strip-date-navigation-design.md \
        docs/superpowers/plans/2026-08-25-web-day-strip-phase-2-week-chooser.md
git commit -m "docs: record how phase 2's chooser was built, and what it changes for phase 4 (#274)"
```

- [ ] **Step 5: Push and open the stacked PR**

```bash
git push -u origin feat/274-week-chooser
gh pr create \
  --base feat/274-day-strip-date-navigation \
  --title "feat(web): a week chooser on the day rail (#274 phase 2)" \
  --body "$(cat <<'BODY'
Phase 2 of #274. **Stacked on #276** (phase 1, the week band) — based on
`feat/274-day-strip-date-navigation` so #276's approved review is not reopened.
Retarget to `main` once #276 merges.

Any week of the season is now reachable in **two** interactions from anywhere in
the list: the rail is sticky, so one tap opens a 3×3 grid and one picks the week.
This lands *before* `WeekSelector` is deleted from the filter panel in phase 4,
which is the whole reason the phases are ordered this way.

### What's here
- A ~44px 3×3 trigger at the right end of the rail, with the current week's cell
  lit in its own band tone plus a ring. The lit cell gives position-in-season
  spatially; the accessible name gives it in words ("Week 6 of 9, choose a week").
- A 3×3 popover of the season's weeks. Nine 44px cells in a row is 396px — wider
  than a 390px phone; 3×3 is a 132px square with real touch targets.
- Reachability from phase 1's `weekBandDestinations`, **the same map instance**
  the band reads, so the two surfaces cannot disagree. An unreachable week is
  dimmed and inert in both, named as a fact ("Week 4, no events").
- Long-press / right-click / Shift+F10 still open a week's theme — extracted
  from `WeekSelector` into `useWeekThemePopover` so both controls share one
  implementation. `WeekSelector`'s nine existing tests pass untouched, which is
  the proof the extraction changed nothing.
- 2-D keyboard walk (←→ by one, ↑↓ by a row), Escape closes and returns focus to
  the trigger, and Escape defers to an open theme popover.

### Nothing is deleted
`DateFilter`, the filter panel's `WeekSelector`, the rail's Filters toggle and
`dateFilter`/`selectedWeeks` are all untouched. They go in phases 3 and 4.

### Verification
- `npm run build` (type-check, lint, full unit suite with coverage, bundle)
- `npm run test:browser` — all five suites; `verify-rail.mjs` gains checks
  20a–20i and 21 (axe over the open dialog)
- Every new guard falsified by breaking the code first; the browser ones built
  with `npx vite build` and grepped in `out/` to confirm the injection landed

### One recorded deviation
The spec said the popover would be built from `WeekSelector`'s markup. It is
built from its *behaviour*, extracted — the two controls share only "nine
numbered buttons with a theme popover", and everything else about them is
opposed. Written into the spec as an addendum; it means phase 4 deletes
`WeekSelector.tsx` outright rather than preserving it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01BM5NGyZfki8sV5xbAyqKEa
BODY
)"
```

- [ ] **Step 6: Iterate the PR**

Follow the project's PR-iteration rule. Two things this repo has learned the
hard way and that apply on every round:

- **Copilot hides real findings in a collapsed `Suppressed comments` block**
  while its summary says it "generated no new comments". Read the review *body*,
  and read inline comments — a separate surface again — not just the summary.
- The `@claude` workflow leaves PRs `UNSTABLE` at `action_required`. That is not
  a real merge blocker; don't chase it.

Do not merge. Report status and hand the merge to the user.

---

## Self-Review

**1. Spec coverage.** Walking "Phase 2 — the week chooser" line by line:

| Spec requirement | Task |
|---|---|
| ~44px 3×3 trigger at the right end of the rail | 4, 6, 7 |
| Lit cell takes the week's tone from the band's ramp | 4 |
| Current week from `anchorDay`; shared Saturday lights the later week | 1 |
| Off-season / pre-post-season anchor lights nothing; name is "Choose a week" | 1, 2, 6 |
| `"Week 6 of 9, choose a week"`, with a matching `title` | 2, 6 |
| 3×3 grid of 44px cells, derived from `seasonWeeks.length` | 2, 5 |
| `onTap` becomes navigation via `weekBandDestinations` | 5, 7, 8 |
| Unreachable weeks dimmed and inert, from one source of truth | 5, 9 |
| `WeekThemePopover` keeps working (long-press, right-click, Shift+F10) | 3, 5 |
| Keyboard: ←→ by one, ↑↓ by a row; Escape closes and refocuses the trigger | 2, 5, 6 |
| `useFloatingCoords` clamping; portal to `document.body` | 6, 9 (check 20c) |
| Acceptance: any week in two interactions from anywhere | 9 (checks 20a–20e) |
| Testing → "Week chooser" unit list (current-week resolution incl. shared Saturday and out-of-season; unreachable inert; 2-D walk) | 1, 2, 5 |
| Testing → browser: open from a deep scroll, jump 2→8, landing day, lit cell followed | 9 |
| Falsification: break the code first; `npx vite build` + grep for browser checks | every task's falsify step, 9 in particular |

The one spec line not implemented as written is "built from `WeekSelector`'s
existing markup" — deviated deliberately, argued in "Deviation from the spec,
recorded", and written back into the spec in Task 10.

**2. Placeholder scan.** No "TBD", no "add error handling", no "similar to Task
N". Every test step carries its assertions; every implementation step carries
its code. Task 8 names no page-level test file because the repo may not have
one — and says explicitly what to do in that case rather than leaving it open.

**3. Type consistency.** `anchorWeekNumber(anchorDay, segments)` (Task 1) is
consumed by `DayRail` in Tasks 1 and 7 with the same argument order.
`weekGridColumns` / `weekGridRows` / `moveGridFocus` / `weekChooserTriggerLabel`
(Task 2) are consumed by `WeekGrid` (5) and `WeekChooser` (6) with the
signatures defined. `useWeekThemePopover`'s returned `{ isOpen, registerAnchor,
handlers, portal }` (Task 3) is used with exactly those four names in Tasks 3, 5.
`WeekChooserIcon`'s `{ rows, currentWeek, denominator }` (Task 4) is passed
exactly those three by `WeekChooser` (6). `WeekGrid`'s six props (5) are passed
exactly by `WeekChooser` (6). `DayRail`'s two new props (7) are passed exactly by
`page.tsx` (8). The `data-` attributes the browser checks query
(`data-week-chooser-trigger`, `data-week-chooser-popover`,
`data-week-chooser-cell`, `data-lit`, `data-week-cell`, `data-week-cell-target`,
`data-week-cell-fill`, `data-week-cell-number`, `data-week-grid`,
`data-week-row`) are each emitted by the component that Task 9 reads them from.
