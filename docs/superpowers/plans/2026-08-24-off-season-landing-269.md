# Off-Season Landing and Regime-Aware Browser Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the web app an off-season landing screen, and make the three
Playwright browser-check suites work in the off-season regime, so that neither
visitors nor CI hit a blank screen between the season's last event day and the
years-manifest rollover on October 1.

**Architecture:** A pure `determineLandingState` function ports iOS's
`LandingState` to TypeScript; a new `OffSeasonLanding` component replaces
`<EmptyState />` in `page.tsx` when the reader has narrowed nothing and the
season is genuinely over or not yet begun. On the harness side, the three
suites' copy-pasted bootstrap and tally collapse into two shared modules — one
that detects the regime and navigates into the season when the default screen
is the landing, and one that reports pass/fail/skip honestly. A new
`verify-offseason.mjs` runs a five-entry regime matrix on every CI push so the
off-season path cannot rot during the eleven months it is unreachable.

**Tech Stack:** Vite 7, Preact 10 (via `preact/compat`, imports from
`'react'`), TypeScript 5, Tailwind CSS 4, Vitest + `@testing-library/preact`,
Playwright (Chromium only), Node 24.

**Spec:** `docs/superpowers/specs/2026-08-24-off-season-landing-269-design.md`

**Issue:** [#269](https://github.com/bbernstein/chq-calendar/issues/269)

## Global Constraints

- **Never commit to `main`.** Work happens on `fix/269-off-season-landing`,
  which already exists and already holds the spec commit.
- **Preact, not React.** Import hooks and React-shaped types from `'react'` —
  `@preact/preset-vite` aliases it to `preact/compat` at build time and
  `vitest.config.ts` does the same. This is the project convention; see
  `CLAUDE.md`. Files that render JSX and wire DOM handlers must keep the
  `'react'` import.
- **`@/` path alias** maps to `frontend/src/`.
- **Institution time, always.** Never use `new Date(y, m, d)`, `getMonth()`,
  `getFullYear()`, or millisecond date arithmetic for calendar reasoning. Use
  `chqParts` / `chqDateAt` / `dayKeyOf` from `@/lib/utils/chqTime` and
  `@/lib/utils/dayWindow`. Adding `86_400_000` ms across a DST transition
  lands an hour out and produces the wrong day.
- **Tailwind CSS 4**, dark mode via `prefers-color-scheme` (so every color
  class needs its `dark:` counterpart), mobile-first with `sm:` / `lg:`.
- **Verification before every commit**, from `frontend/`:
  `npm run build` (runs `validate` — type-check + lint — then the unit suite,
  then `vite build`).
- **Coverage floor** is enforced by `.coverage-floor.json`; new modules need
  real tests or the build fails.
- **Browser-check suites are ESM `.mjs` run directly by Node**, not by a test
  runner. They print `PASS`/`FAIL` per check and exit non-zero at the end.
  They run against **live production data** — CI builds the branch, serves it
  with `vite preview`, and `vite.config.ts` proxies `/cache` to
  `https://www.chqcal.org`. Never write an assertion that hardcodes a
  calendar date; derive it from the feed.

---

## File Structure

**New:**

| File | Responsibility |
|---|---|
| `frontend/src/lib/utils/landingState.ts` | Pure `determineLandingState`; no clock read, no DOM |
| `frontend/src/__tests__/lib/utils/landingState.test.ts` | Its unit tests (util tests live under `src/__tests__/lib/utils/`, not beside the source) |
| `frontend/src/components/layout/OffSeasonLanding.tsx` | The landing screen; presentational, all state passed in |
| `frontend/src/components/layout/__tests__/OffSeasonLanding.test.tsx` | Its component tests |
| `frontend/e2e/results.mjs` | Shared `check` / `skip` / `finish` tally |
| `frontend/e2e/regime.mjs` | Shared `enterList` bootstrap + regime detection |
| `frontend/e2e/verify-offseason.mjs` | The pinned-clock regime matrix |

**Modified:**

| File | Change |
|---|---|
| `frontend/src/app/page.tsx` | Derive `landingState`; branch to `OffSeasonLanding` at the empty case |
| `frontend/src/components/layout/EmptyState.tsx` | Add `data-testid="empty-state"` (nothing else) |
| `frontend/e2e/fixedNow.mjs` | `E2E_NOW` override |
| `frontend/e2e/verify-rail.mjs` | Use `enterList` + shared tally; skip checks 3 and 11 off-season |
| `frontend/e2e/verify-timezone.mjs` | Use `enterList` + shared tally |
| `frontend/e2e/verify-filter-reveal.mjs` | Use `enterList` + shared tally |
| `frontend/e2e/README.md` | Document the regime bootstrap, `E2E_NOW`, and the new suite |
| `frontend/package.json` | Add `verify-offseason.mjs` to `test:browser` |

---

## Task 1: `determineLandingState`

**Files:**
- Create: `frontend/src/lib/utils/landingState.ts`
- Test: `frontend/src/__tests__/lib/utils/landingState.test.ts`

**Interfaces:**
- Consumes: `getChautauquaSeasonWeeks` from `@/lib/utils/dateHelpers`,
  `dayKeyOf` from `@/lib/utils/dayWindow`.
- Produces:
  - `export type LandingState` — the discriminated union below.
  - `export function determineLandingState(input: LandingStateInput): LandingState`
  - `export interface LandingStateInput { now: Date; selectedYear: number; availableYears: number[]; yearHasEvents: boolean }`

Task 2 imports the type; Task 3 calls the function.

### Background the implementer needs

The Chautauqua season is nine weeks starting at **noon on the Saturday before
the 4th Sunday of June**. `getChautauquaSeasonWeeks(year)[0].start` is exactly
that instant, and it matches iOS's `SeasonCalendar.seasonStart(year:)` — do
not reimplement it.

Day counts must be whole *Institution calendar* days. The safe way is to
reduce both instants to their `yyyy-mm-dd` day key (which `dayKeyOf` resolves
in `America/New_York`) and subtract those as pure UTC calendar dates. Pure
calendar dates have no DST in them, so the subtraction is exact.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/lib/utils/landingState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { determineLandingState } from '@/lib/utils/landingState';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import { chqDateAt } from '@/lib/utils/chqTime';

const opening = (year: number) => getChautauquaSeasonWeeks(year)[0].start;

describe('determineLandingState', () => {
  it('is pre-season before the selected year opens', () => {
    const state = determineLandingState({
      now: chqDateAt(2026, 3, 1, 10),
      selectedYear: 2026,
      availableYears: [2025, 2026, 2027],
      yearHasEvents: true,
    });
    expect(state.kind).toBe('pre-season');
    if (state.kind !== 'pre-season') return;
    expect(state.opening.getTime()).toBe(opening(2026).getTime());
    expect(state.daysUntil).toBeGreaterThan(100);
  });

  it('is post-season once the season has opened and the year has events', () => {
    const state = determineLandingState({
      now: chqDateAt(2026, 9, 15, 10),
      selectedYear: 2026,
      availableYears: [2025, 2026, 2027],
      yearHasEvents: true,
    });
    expect(state).toEqual({
      kind: 'post-season',
      endedSeasonYear: 2026,
      nextSeasonYear: 2027,
      opening: opening(2027),
      daysUntil: expect.any(Number),
    });
  });

  // The opening instant itself is IN season: the comparison is `<`, so a
  // reader refreshing at noon on opening Saturday must not be told the
  // season has not started.
  it('is not pre-season at the exact opening instant', () => {
    const state = determineLandingState({
      now: opening(2026),
      selectedYear: 2026,
      availableYears: [2026],
      yearHasEvents: true,
    });
    expect(state.kind).toBe('post-season');
  });

  // Rule 3. A failed or empty feed fetch during the season must NOT produce
  // "See you next season" for a July visitor — it means "we have no data",
  // which is what the generic EmptyState says.
  it('is in-season when the year has no events at all and the season has opened', () => {
    const state = determineLandingState({
      now: chqDateAt(2026, 7, 15, 10),
      selectedYear: 2026,
      availableYears: [2026],
      yearHasEvents: false,
    });
    expect(state).toEqual({ kind: 'in-season' });
  });

  // An announced-but-empty future year still gets the countdown.
  it('is pre-season for a future year with no events yet', () => {
    const state = determineLandingState({
      now: chqDateAt(2026, 9, 15, 10),
      selectedYear: 2027,
      availableYears: [2026, 2027],
      yearHasEvents: false,
    });
    expect(state.kind).toBe('pre-season');
  });

  it('reports null next-season fields when no later year is available', () => {
    const state = determineLandingState({
      now: chqDateAt(2026, 9, 15, 10),
      selectedYear: 2026,
      availableYears: [2025, 2026],
      yearHasEvents: true,
    });
    expect(state).toEqual({
      kind: 'post-season',
      endedSeasonYear: 2026,
      nextSeasonYear: null,
      opening: null,
      daysUntil: null,
    });
  });

  it('picks the lowest later year from an unsorted availableYears', () => {
    const state = determineLandingState({
      now: chqDateAt(2026, 9, 15, 10),
      selectedYear: 2026,
      availableYears: [2029, 2024, 2027, 2025, 2028],
      yearHasEvents: true,
    });
    expect(state.kind === 'post-season' && state.nextSeasonYear).toBe(2027);
  });

  // Counts calendar dates, not 24-hour buckets. US DST ends 2026-11-01, so
  // this span contains a 25-hour day; naive ms division gives 30.04 days and
  // floors to 30, while the calendar answer is 31.
  it('counts whole calendar days across a DST transition', () => {
    const state = determineLandingState({
      now: chqDateAt(2026, 10, 20, 9),
      selectedYear: 2027,
      availableYears: [2027],
      yearHasEvents: false,
    });
    expect(state.kind).toBe('pre-season');
    if (state.kind !== 'pre-season') return;
    const expected = determineLandingState({
      now: chqDateAt(2026, 10, 20, 23),
      selectedYear: 2027,
      availableYears: [2027],
      yearHasEvents: false,
    });
    // Same calendar day, wildly different hour — the day count must not move.
    expect(expected.kind === 'pre-season' && expected.daysUntil).toBe(state.daysUntil);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `frontend/`:
`npx vitest run src/__tests__/lib/utils/landingState.test.ts`

Expected: FAIL — `Failed to resolve import "@/lib/utils/landingState"`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/utils/landingState.ts`:

```ts
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import { dayKeyOf } from '@/lib/utils/dayWindow';

/**
 * What the calendar's main panel should show when the default filter comes up
 * empty, derived purely from the clock, the season calendar, the years
 * manifest, and whether the selected year has any events at all.
 *
 * Ports `ios/ChqCalendarShared/Domain/LandingState.swift`, with one
 * deliberate divergence documented on `determineLandingState` below. The two
 * apps should not hold different opinions about whether the season is over.
 *
 * `determineLandingState` reads no clock — callers own supplying `now`
 * consistently with whatever else they derive from the same instant.
 */
export type LandingState =
  | { kind: 'in-season' }
  | { kind: 'pre-season'; opening: Date; daysUntil: number }
  | {
      kind: 'post-season';
      endedSeasonYear: number;
      nextSeasonYear: number | null;
      opening: Date | null;
      daysUntil: number | null;
    };

export interface LandingStateInput {
  now: Date;
  selectedYear: number;
  availableYears: number[];
  /**
   * `events.length > 0` for the selected year's full, UNFILTERED event set —
   * not the filtered list. See rule 3 in `determineLandingState`.
   */
  yearHasEvents: boolean;
}

/** Noon on the Saturday before the 4th Sunday of June, in Institution time. */
function seasonStart(year: number): Date {
  return getChautauquaSeasonWeeks(year)[0].start;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole Institution calendar days between the day containing `from` and the
 * day containing `to`.
 *
 * Reduced to day keys first, then subtracted as pure UTC calendar dates: a
 * calendar date has no DST in it, so the subtraction is exact. Dividing the
 * raw instant difference by 86,400,000 would be off by one across either
 * transition, which is exactly the class of bug `chqDateAt` exists to
 * prevent elsewhere in this codebase.
 */
function daysBetween(from: Date, to: Date): number {
  const [fy, fm, fd] = dayKeyOf(from).split('-').map(Number);
  const [ty, tm, td] = dayKeyOf(to).split('-').map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / MS_PER_DAY
  );
}

/**
 * Rules, in priority order:
 *
 * 1. `now` is before `selectedYear`'s season start → `pre-season`. Both a
 *    fully-loaded future year and an announced-but-empty one belong here;
 *    the countdown is the right screen either way.
 * 2. Else, the year has events → `post-season`. The season ran and is over.
 * 3. Else → `in-season`, which the caller renders as the generic empty state.
 *
 * **Rule 3 diverges from iOS deliberately.** iOS takes an
 * `upcomingDefaultCount` and returns `.inSeason` when it is positive. That
 * parameter would be dead here: this function is only ever called from inside
 * `page.tsx`'s `filteredEvents.length === 0` branch, so the count is always
 * zero and iOS's rule 1 could never fire. Discriminating on the *year's*
 * event set instead catches the case iOS handles separately via `AppModel`'s
 * `guard snapshot != nil`: a failed or empty feed fetch during the season
 * gives `events: []` with `now` past the season start, and a naive port would
 * tell a July visitor "See you next season". Rule 3 sends that visitor to the
 * generic empty state, which is the honest screen for "we have no data", and
 * reserves the landing for "we have the data and the season is genuinely
 * over".
 */
export function determineLandingState({
  now,
  selectedYear,
  availableYears,
  yearHasEvents,
}: LandingStateInput): LandingState {
  const start = seasonStart(selectedYear);
  if (now < start) {
    return { kind: 'pre-season', opening: start, daysUntil: daysBetween(now, start) };
  }

  if (!yearHasEvents) {
    return { kind: 'in-season' };
  }

  const later = availableYears.filter(y => y > selectedYear);
  const nextSeasonYear = later.length > 0 ? Math.min(...later) : null;
  const opening = nextSeasonYear === null ? null : seasonStart(nextSeasonYear);
  return {
    kind: 'post-season',
    endedSeasonYear: selectedYear,
    nextSeasonYear,
    opening,
    daysUntil: opening === null ? null : daysBetween(now, opening),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/lib/utils/landingState.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Falsify the DST test**

The DST test is worthless if it passes against a naive implementation.
Temporarily replace `daysBetween`'s body with
`return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);`
and re-run.

Expected: the DST test FAILS. If it passes, the test is not discriminating —
fix the test (pick a `now`/`opening` pair that actually straddles
2026-11-01), do not accept it. Restore the correct implementation afterward
and confirm green again.

- [ ] **Step 6: Verify and commit**

```bash
cd frontend && npm run build
git add src/lib/utils/landingState.ts src/__tests__/lib/utils/landingState.test.ts
git commit -m "feat(web): derive an off-season landing state (#269)

Ports iOS's LandingState to TypeScript. Rule 3 diverges deliberately:
iOS's upcomingDefaultCount would be dead on web (the function is only
reached from the already-empty branch), so the discriminator is whether
the YEAR has events. That catches a failed feed fetch mid-season, which a
literal port would have shown as 'See you next season' in July."
```

---

## Task 2: `OffSeasonLanding` component

**Files:**
- Create: `frontend/src/components/layout/OffSeasonLanding.tsx`
- Test: `frontend/src/components/layout/__tests__/OffSeasonLanding.test.tsx`
- Modify: `frontend/src/components/layout/EmptyState.tsx` (one attribute)

**Interfaces:**
- Consumes: `LandingState` from Task 1.
- Produces:
  ```ts
  export interface OffSeasonLandingProps {
    state: LandingState;
    onPreviewNextSeason: (year: number) => void;
    onBrowseArchiveSeason: () => void;
  }
  export function OffSeasonLanding(props: OffSeasonLandingProps): JSX.Element | null
  ```
  Task 3 renders it. The harness (Tasks 5–7) depends on
  `data-testid="off-season-landing"` and on the archive button's accessible
  name matching `/^Browse the \d{4} season$/`.

### Notes the implementer needs

- The component is **presentational**. It calls the two callbacks and owns no
  state; `page.tsx` decides what those callbacks do. This keeps it testable
  without mounting the page.
- It returns `null` for `kind: 'in-season'`. That state should never reach it
  (Task 3 gates on it), but returning `null` rather than throwing means a
  future caller that forgets the gate renders nothing rather than crashing
  the whole calendar.
- A thin pre-season countdown strip already exists at the top of the page
  (`CountdownBanner`). The card here is not a duplicate to remove: the banner
  is page chrome, this is the content area telling the reader why the list is
  empty. iOS has the same pairing (`AppModel.countdownDays` plus the landing).
- Every color class needs a `dark:` counterpart — dark mode is the
  `prefers-color-scheme` media strategy, not a class toggle.
- Date formatting uses `Intl.DateTimeFormat` with
  `timeZone: CHQ_ZONE` — never `toLocaleDateString` without the zone.
  `"MMMM d"` (`"June 27"`), matching iOS's `monthDayFormatter`: deliberately
  no weekday, because the day count is stated separately on the next line.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/layout/__tests__/OffSeasonLanding.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { OffSeasonLanding } from '../OffSeasonLanding';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import type { LandingState } from '@/lib/utils/landingState';

const opening = (year: number) => getChautauquaSeasonWeeks(year)[0].start;

const postSeason: LandingState = {
  kind: 'post-season',
  endedSeasonYear: 2026,
  nextSeasonYear: 2027,
  opening: opening(2027),
  daysUntil: 285,
};

function renderLanding(state: LandingState) {
  const onPreviewNextSeason = vi.fn();
  const onBrowseArchiveSeason = vi.fn();
  render(
    <OffSeasonLanding
      state={state}
      onPreviewNextSeason={onPreviewNextSeason}
      onBrowseArchiveSeason={onBrowseArchiveSeason}
    />
  );
  return { onPreviewNextSeason, onBrowseArchiveSeason };
}

describe('OffSeasonLanding', () => {
  it('renders nothing for in-season', () => {
    const { container } = render(
      <OffSeasonLanding
        state={{ kind: 'in-season' }}
        onPreviewNextSeason={vi.fn()}
        onBrowseArchiveSeason={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('names the post-season case and offers both ways forward', () => {
    renderLanding(postSeason);
    expect(screen.getByTestId('off-season-landing')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'See you next season' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview the 2027 season' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse the 2026 season' })).toBeInTheDocument();
  });

  it('states when the next season opens and how far off it is', () => {
    renderLanding(postSeason);
    // Read via textContent, not getByText: the line interpolates twice and
    // renders as three text nodes, which getByText will not match across.
    // "June 26" for 2027 — the Saturday before the 4th Sunday of June.
    expect(screen.getByTestId('off-season-countdown').textContent)
      .toMatch(/^The 2027 season begins [A-Z][a-z]+ \d{1,2}$/);
    expect(screen.getByText('285 days away')).toBeInTheDocument();
  });

  it('says "1 day away", not "1 days away"', () => {
    renderLanding({ ...postSeason, daysUntil: 1 });
    expect(screen.getByText('1 day away')).toBeInTheDocument();
  });

  it('omits the countdown and the preview button when no next year is announced', () => {
    renderLanding({
      kind: 'post-season',
      endedSeasonYear: 2026,
      nextSeasonYear: null,
      opening: null,
      daysUntil: null,
    });
    expect(screen.queryByTestId('off-season-countdown')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Preview the/ })).not.toBeInTheDocument();
    // The archive is still reachable — that is the whole point of the screen.
    expect(screen.getByRole('button', { name: 'Browse the 2026 season' })).toBeInTheDocument();
  });

  it('names the pre-season case and offers no buttons', () => {
    renderLanding({ kind: 'pre-season', opening: opening(2026), daysUntil: 42 });
    expect(screen.getByRole('heading', { name: 'Almost showtime' })).toBeInTheDocument();
    expect(screen.getByText('42 days away')).toBeInTheDocument();
    // Deliberate: there is no year-aware "browse a past season" action, so a
    // button labelled with last year would apply the scope to THIS year.
    // Mirrors LandingState.archiveYear === nil for .preSeason on iOS.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('reports the next year to preview, and asks for the archive without a year', () => {
    const { onPreviewNextSeason, onBrowseArchiveSeason } = renderLanding(postSeason);

    fireEvent.click(screen.getByRole('button', { name: 'Preview the 2027 season' }));
    expect(onPreviewNextSeason).toHaveBeenCalledWith(2027);

    fireEvent.click(screen.getByRole('button', { name: 'Browse the 2026 season' }));
    expect(onBrowseArchiveSeason).toHaveBeenCalledTimes(1);
  });
});
```

> **Superseded 2026-08-31 by #186.** The `pre-season` case above ("names the
> pre-season case and offers no buttons", and its comment "there is no
> year-aware 'browse a past season' action … Mirrors
> `LandingState.archiveYear === nil` for `.preSeason` on iOS") is no longer
> what the shipped test asserts. `archiveYear` is now manifest-derived for
> `pre-season` too on both platforms, so the pre-season landing renders the
> "Browse the {N} season" button and `onBrowseArchiveSeason` takes the year
> it is labelled with. The block is left as written — it is the record of
> what this plan executed — but read
> `frontend/src/components/layout/__tests__/OffSeasonLanding.test.tsx` for
> the current assertions.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/layout/__tests__/OffSeasonLanding.test.tsx`
Expected: FAIL — `Failed to resolve import "../OffSeasonLanding"`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/layout/OffSeasonLanding.tsx`:

```tsx
import { CHQ_ZONE } from '@/lib/utils/chqTime';
import type { LandingState } from '@/lib/utils/landingState';

export interface OffSeasonLandingProps {
  state: LandingState;
  /** Show the given year instead, with the date scope opened right up. */
  onPreviewNextSeason: (year: number) => void;
  /** Show the whole of the year already selected. Takes no year on purpose. */
  onBrowseArchiveSeason: () => void;
}

/**
 * What the main panel shows when the default filter is empty because the
 * season itself is over or has not started — rather than the generic
 * `EmptyState`, whose "try adjusting your filters" is false advice when the
 * reader has not set any.
 *
 * Mirrors iOS's `OffSeasonLandingView`. Presentational: it owns no state and
 * reads no clock, so `page.tsx` decides what the buttons do and the tests can
 * mount it directly.
 *
 * Returns `null` for `in-season`, which `page.tsx` already gates out. A
 * future caller that forgets the gate then renders nothing, rather than
 * crashing the whole calendar.
 */
export function OffSeasonLanding({
  state,
  onPreviewNextSeason,
  onBrowseArchiveSeason,
}: OffSeasonLandingProps) {
  if (state.kind === 'in-season') return null;

  const isPostSeason = state.kind === 'post-season';
  // `in-season` is narrowed out above, and both remaining arms carry these
  // two fields, so the union access is `Date | null` / `number | null`.
  const { opening, daysUntil } = state;
  // The season the countdown names: next year's when this one has ended,
  // this year's when it has not started yet.
  const openingYear =
    state.kind === 'post-season' ? state.nextSeasonYear : chqYearOf(state.opening);

  return (
    <div data-testid="off-season-landing" className="text-center py-12 px-4">
      <div className="text-6xl mb-4" aria-hidden="true">🎭</div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-6">
        {isPostSeason ? 'See you next season' : 'Almost showtime'}
      </h3>

      {opening !== null && daysUntil !== null && openingYear !== null && (
        <div className="max-w-sm mx-auto mb-6 rounded-lg bg-gray-50 dark:bg-gray-700/50 p-4">
          {/*
            `data-testid`, because this line interpolates twice and so renders
            as three text nodes. `getByText(/The 2027 season begins June 26/)`
            matches against a single node and would never find it — a test
            that fails on correct code teaches people to weaken the assertion.
          */}
          <p data-testid="off-season-countdown" className="font-medium text-gray-900 dark:text-white">
            The {openingYear} season begins {monthDay(opening)}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
            {daysUntil === 1 ? '1 day away' : `${daysUntil} days away`}
          </p>
        </div>
      )}

      {isPostSeason && (
        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-6">
          {state.nextSeasonYear !== null && (
            <button
              type="button"
              onClick={() => onPreviewNextSeason(state.nextSeasonYear as number)}
              className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
            >
              Preview the {state.nextSeasonYear} season
            </button>
          )}
          <button
            type="button"
            onClick={onBrowseArchiveSeason}
            className="px-4 py-2 rounded-md border border-gray-300 dark:border-gray-500 text-gray-700 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
          >
            Browse the {state.endedSeasonYear} season
          </button>
        </div>
      )}

      <p className="text-sm text-gray-500 dark:text-gray-400">
        Starred events and filters still work in past seasons.
      </p>
    </div>
  );
}

/**
 * `"June 27"`. Deliberately not the app's `dayTitle` format, which also names
 * the weekday — the line below already states the day count, so a weekday
 * would be redundant. Matches iOS's `monthDayFormatter`.
 */
const monthDayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CHQ_ZONE,
  month: 'long',
  day: 'numeric',
});

function monthDay(d: Date): string {
  return monthDayFormatter.format(d);
}

const yearFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CHQ_ZONE,
  year: 'numeric',
});

/** The calendar year an instant falls in, read at Chautauqua. */
function chqYearOf(d: Date): number {
  return Number(yearFormatter.format(d));
}
```

Note on the `opening` / `daysUntil` lines: both union arms carry fields of the
same name, but TypeScript needs the branch to narrow them. If the ternaries
above read awkwardly to you, destructure inside an `if (state.kind ===
'pre-season')` block instead — just do not reach for `as any`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/layout/__tests__/OffSeasonLanding.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add the `EmptyState` test id**

`frontend/src/components/layout/EmptyState.tsx` — add the attribute to its
outer `div`, changing nothing else:

```tsx
<div data-testid="empty-state" className="text-center py-12">
```

This exists so the browser harness can tell "the reader filtered to nothing"
apart from "the season is over" without waiting out a 30-second timeout. It is
the one change to that file.

- [ ] **Step 6: Verify and commit**

```bash
cd frontend && npm run build
git add src/components/layout/OffSeasonLanding.tsx \
        src/components/layout/__tests__/OffSeasonLanding.test.tsx \
        src/components/layout/EmptyState.tsx
git commit -m "feat(web): an off-season landing screen (#269)

Mirrors iOS's OffSeasonLandingView: names why the list is empty, counts
down to the next opening, and offers the archive and next-season previews.
Presentational — page.tsx owns what the buttons do.

EmptyState gains a data-testid so the browser harness can tell 'you
filtered to nothing' apart from 'the season is over' without a 30s
timeout. Nothing else about it changes."
```

---

## Task 3: Wire the landing into `page.tsx`

**Files:**
- Modify: `frontend/src/app/page.tsx` (imports; a `useMemo` near the other
  derivations; the branch at ~line 620)
- Test: `frontend/src/__tests__/integration/offSeasonLanding.test.tsx` (create)

**Interfaces:**
- Consumes: `determineLandingState` (Task 1), `OffSeasonLanding` (Task 2).
- Produces: nothing importable. The harness depends on the rendered result:
  `[data-testid="off-season-landing"]` appears in the off-season with default
  filters, and `[data-testid="empty-state"]` otherwise.

### Where things already are in `page.tsx`

- `availableYears`, `selectedYear`, `setSelectedYear` — lines 42–43.
- `events` (the year's full unfiltered set) and `loading` — line 59.
- `filteredEvents` — around line 146.
- `filters.setDateFilter`, `filters.hasNonDefaultFilters` — from
  `useFilterState()` at line 48.
- The branch to change — around line 620.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/integration/offSeasonLanding.test.tsx`. Model
it on `src/__tests__/integration/filterHeader.test.tsx`, which is the existing
example of rendering `page.tsx` under jsdom.

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/preact';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Home from '@/app/page';
import { installFetchMock, type FetchMock } from './helpers/fetchMock';
import { installIntersectionObserverMock } from '@/__tests__/helpers/intersectionObserver';
import { installResizeObserverMock } from '@/__tests__/helpers/resizeObserver';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import { chqDateAt } from '@/lib/utils/chqTime';

/**
 * The branch #269 is about: with no events left in the default window, does
 * the reader get a screen that explains why, or "No events found"?
 *
 * The clock is pinned per-test rather than derived from the real date. Every
 * case here is a statement about a specific point in the season, and a suite
 * whose answers change with the calendar would be exactly the defect this
 * feature fixes.
 */
const SEASON_YEAR = 2026;
const opening = getChautauquaSeasonWeeks(SEASON_YEAR)[0].start;

function eventsPayload() {
  return {
    data: [
      {
        id: 'e1',
        title: 'Morning Lecture',
        startDate: `${SEASON_YEAR}-07-06T10:45:00`,
        endDate: `${SEASON_YEAR}-07-06T11:45:00`,
        location: 'Amphitheater',
        description: 'A lecture.',
        categories: ['Lecture'],
      },
    ],
  };
}

let mock: FetchMock;
let io: ReturnType<typeof installIntersectionObserverMock>;
let ro: ReturnType<typeof installResizeObserverMock>;

function pin(now: Date) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(now);
}

beforeEach(() => {
  localStorage.clear();
  io = installIntersectionObserverMock();
  ro = installResizeObserverMock();
  mock = installFetchMock({ allowUnhandled: true });
  mock.on('GET', /years\.json/, { years: [2025, 2026, 2027], defaultYear: 2026, generated: '' });
  mock.on('GET', /all-events-\d{4}\.json/, eventsPayload());
});

afterEach(() => {
  vi.useRealTimers();
  mock.uninstall();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function renderPage() {
  render(<Home />);
  await waitFor(() =>
    expect(document.querySelector('[data-day-rail]')).toBeTruthy()
  );
}

describe('page.tsx — the off-season landing', () => {
  it('explains the empty screen after the season has ended', async () => {
    pin(chqDateAt(2026, 9, 15, 10));
    await renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('off-season-landing')).toBeInTheDocument()
    );
    expect(screen.getByRole('heading', { name: 'See you next season' })).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
  });

  it('counts down before the season starts', async () => {
    pin(chqDateAt(2026, 3, 1, 10));
    await renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('off-season-landing')).toBeInTheDocument()
    );
    expect(screen.getByRole('heading', { name: 'Almost showtime' })).toBeInTheDocument();
  });

  // The case a naive implementation gets wrong. "Try adjusting your filters"
  // is true advice here and "See you next season" is not — the reader's own
  // search is why the list is empty.
  it('keeps the generic empty state when the READER emptied the list', async () => {
    pin(chqDateAt(2026, 9, 15, 10));
    localStorage.setItem('chq-calendar-user-state', JSON.stringify({
      dateFilter: 'all', searchTerm: 'zzzznothingmatchesthis',
      selectedTags: [], selectedLocations: [], selectedWeeks: [],
      expandedDescriptions: [], recentLocations: [], recentCategories: [],
      showFavoritesOnly: false, lastSaved: Date.now(),
    }));
    await renderPage();

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
    expect(screen.queryByTestId('off-season-landing')).not.toBeInTheDocument();
  });

  // Rule 3 from Task 1, reaching the screen. A July visitor whose feed failed
  // must never be told the season is over.
  it('keeps the generic empty state when the feed came back empty mid-season', async () => {
    mock.reset();
    mock.on('GET', /years\.json/, { years: [2026], defaultYear: 2026, generated: '' });
    mock.on('GET', /all-events-\d{4}\.json/, { data: [] });
    pin(chqDateAt(2026, 7, 15, 10));
    render(<Home />);

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
    expect(screen.queryByTestId('off-season-landing')).not.toBeInTheDocument();
  });

  it('shows the list, and no landing, when the window has events', async () => {
    pin(chqDateAt(2026, 7, 5, 10));
    await renderPage();

    await waitFor(() =>
      expect(document.querySelectorAll('[data-day-key]').length).toBeGreaterThan(0)
    );
    expect(screen.queryByTestId('off-season-landing')).not.toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
  });

  it('browsing the archive puts the season on screen', async () => {
    pin(chqDateAt(2026, 9, 15, 10));
    await renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('off-season-landing')).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: 'Browse the 2026 season' }));

    await waitFor(() =>
      expect(document.querySelectorAll('[data-day-key]').length).toBeGreaterThan(0)
    );
    expect(screen.queryByTestId('off-season-landing')).not.toBeInTheDocument();
  });

  it('previewing next season switches the year and opens the date scope', async () => {
    pin(chqDateAt(2026, 9, 15, 10));
    await renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('off-season-landing')).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: 'Preview the 2027 season' }));

    await waitFor(() => {
      const requested = mock.calls(/all-events-/).map(r => new URL(r.url).pathname);
      expect(requested.some(p => p.endsWith('all-events-2027.json'))).toBe(true);
    });
    const allYear = screen.getByRole('button', { name: 'All Year' });
    await waitFor(() => expect(allYear.getAttribute('aria-pressed')).toBe('true'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/integration/offSeasonLanding.test.tsx`
Expected: FAIL — every landing assertion, because `page.tsx` still renders
`EmptyState`.

If instead the whole file errors before any assertion, the fake-timer setup is
fighting the app's real timers (the search debounce, the observers). Confirm
`useFakeTimers({ shouldAdvanceTime: true })` is in place — without that flag,
`waitFor` never advances and every test times out.

- [ ] **Step 3: Wire it into `page.tsx`**

Add the imports beside the existing ones:

```tsx
import { determineLandingState } from '@/lib/utils/landingState';
import { OffSeasonLanding } from '@/components/layout/OffSeasonLanding';
```

Add the derivation next to the other `useMemo`s — after `filteredEvents`
(around line 146) is the natural home, since it reads `events`:

```tsx
  // Why the default screen is empty, when it is. Only consulted in the empty
  // branch below; `events` rather than `filteredEvents` is the input on
  // purpose — see rule 3 in `determineLandingState`.
  const landingState = useMemo(
    () => determineLandingState({
      now: new Date(),
      selectedYear,
      availableYears,
      yearHasEvents: events.length > 0,
    }),
    [selectedYear, availableYears, events]
  );

  // The landing's two ways forward. Both mirror iOS's `AppModel`:
  // previewing opens the date scope right up, because `next`'s adaptive
  // window has nothing to adapt to that far ahead; browsing the archive
  // deliberately does NOT touch the year, since the year on screen is
  // already the one that ended.
  const previewNextSeason = useCallback((year: number) => {
    setSelectedYear(year);
    filters.setDateFilter('all');
  }, [setSelectedYear, filters.setDateFilter]);

  const browseArchiveSeason = useCallback(() => {
    filters.setDateFilter('season');
  }, [filters.setDateFilter]);
```

Then change the branch at ~line 620 from:

```tsx
{loading ? <LoadingSpinner /> : filteredEvents.length === 0 ? <EmptyState /> : (
```

to:

```tsx
{loading ? <LoadingSpinner /> : filteredEvents.length === 0 ? (
  // `hasNonDefaultFilters`, not `hasFilters`: the app starts on the `next`
  // scope, so `hasFilters` is true before the reader touches anything and
  // the landing would never show. See `useFilterState` for what "default"
  // means per year — note it counts `all` as a default too, which is the
  // archived year's own starting scope.
  landingState.kind !== 'in-season' && !filters.hasNonDefaultFilters ? (
    <OffSeasonLanding
      state={landingState}
      onPreviewNextSeason={previewNextSeason}
      onBrowseArchiveSeason={browseArchiveSeason}
    />
  ) : <EmptyState />
) : (
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/integration/offSeasonLanding.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the whole unit suite**

Run: `npx vitest run`

Expected: everything green. `filterHeader.test.tsx` and the smoke tests also
render `page.tsx`; if one of them now finds the landing where it expected the
list, that is real information — the gate is too loose. Fix the gate, not the
older test, and say so.

- [ ] **Step 6: Verify and commit**

```bash
cd frontend && npm run build
git add src/app/page.tsx src/__tests__/integration/offSeasonLanding.test.tsx
git commit -m "feat(web): show the off-season landing instead of 'No events found' (#269)

From the season's last event day until the years manifest rolls over on
October 1, the default window is empty and every visitor saw 'No events
found — try adjusting your filters', with no filters set. They now get a
screen that names the reason and offers the archive and next season.

Gated on !hasNonDefaultFilters, so a reader who filtered to nothing still
gets the generic empty state, whose advice is true for them."
```

---

## Task 4: Shared browser-check tally

**Files:**
- Create: `frontend/e2e/results.mjs`
- Modify: `frontend/e2e/verify-rail.mjs`, `frontend/e2e/verify-timezone.mjs`,
  `frontend/e2e/verify-filter-reveal.mjs`

**Interfaces:**
- Produces:
  ```js
  export function check(name, ok, detail)     // records + prints PASS/FAIL
  export function skip(name, reason)          // records + prints SKIP; reason required
  export function finish()                    // prints the summary, calls process.exit
  ```
  Tasks 5–7 use all three.

This task is a **pure refactor**: no suite changes what it asserts. Doing it
separately means the next task's diff is about regime handling only.

### Why `finish()` fails on an all-skip

A skip that no one notices is worse than a red gate, because it reports
success. Three copies of the tally would eventually disagree about that rule,
which is the other reason to have one.

- [ ] **Step 1: Write `results.mjs`**

```js
/**
 * One tally, shared by every browser-check suite.
 *
 * The three suites each held their own copy of `check()` and the closing
 * `N/M checks passed` block. They agreed by accident, not by construction,
 * and the skip rule below is exactly the kind of thing three copies
 * eventually disagree about.
 */
const results = [];

/** Record a check. `detail` is the measured value, and is worth printing. */
export function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Record a check that had no subject in this regime.
 *
 * `reason` is required and always printed. A silent skip reports success for
 * work that did not happen, which is the failure mode #269 is about: three
 * weeks of a gate that looked green while testing nothing.
 */
export function skip(name, reason) {
  if (!reason) throw new Error(`skip("${name}") needs a reason`);
  results.push({ name, skipped: true, detail: reason });
  console.log(`SKIP  ${name} — ${reason}`);
}

/**
 * Print the summary and exit.
 *
 * Exits non-zero when any check failed, and ALSO when no check passed — a
 * suite that skipped everything, or ran nothing at all, has proved nothing
 * and must not report success. Stated as "no check passed" rather than a
 * skip-to-pass ratio on purpose: a ratio would false-fail the smaller suites
 * on a legitimate two-skip off-season run.
 */
export function finish() {
  const failed = results.filter(r => !r.skipped && !r.ok);
  const passed = results.filter(r => !r.skipped && r.ok);
  const skipped = results.filter(r => r.skipped);

  console.log(
    `\n${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`
  );
  if (skipped.length) {
    console.log('SKIPPED:\n' + skipped.map(s => `  - ${s.name}: ${s.detail}`).join('\n'));
  }
  if (failed.length) {
    console.log('FAILED:\n' + failed.map(f => `  - ${f.name}: ${f.detail ?? ''}`).join('\n'));
  }
  if (failed.length || passed.length === 0) {
    if (passed.length === 0) console.log('No check passed — nothing was proved.');
    process.exit(1);
  }
}
```

- [ ] **Step 2: Migrate the three suites**

In each of `verify-rail.mjs`, `verify-timezone.mjs`,
`verify-filter-reveal.mjs`:

1. Delete the local `const results = []` and the local `check` function.
2. Add `import { check, finish } from './results.mjs';` beside the other
   imports.
3. Replace the closing block — the one that reads
   `const failed = results.filter(...)` through `process.exit(1)` — with a
   single `finish();`.

Leave `await browser.close();` exactly where it is, immediately before
`finish()`.

- [ ] **Step 3: Run all three against production**

```bash
cd frontend
URL=https://www.chqcal.org/ node e2e/verify-rail.mjs
URL=https://www.chqcal.org/ node e2e/verify-timezone.mjs
URL=https://www.chqcal.org/ node e2e/verify-filter-reveal.mjs
```

Expected: the same pass counts as before the refactor, now printed as
`N passed, 0 failed, 0 skipped`. Record the counts — Task 8 compares against
them.

If Playwright's browser is missing, run `npx playwright install chromium`
from `frontend/` first. Its install step stalls intermittently; cancel and
re-run rather than waiting it out.

- [ ] **Step 4: Falsify `finish()`**

Temporarily add `skip('temp', 'falsification');` as the only recorded result
in a scratch file:

```bash
node --input-type=module -e "
import { skip, finish } from './e2e/results.mjs';
skip('temp', 'falsification');
finish();
" ; echo "exit=$?"
```

Expected: `exit=1` and the line `No check passed — nothing was proved.`
If it exits 0, the guard is not doing its job.

- [ ] **Step 5: Commit**

```bash
git add frontend/e2e/results.mjs frontend/e2e/verify-rail.mjs \
        frontend/e2e/verify-timezone.mjs frontend/e2e/verify-filter-reveal.mjs
git commit -m "refactor(e2e): one shared tally for the browser checks (#269)

Three copy-pasted copies of check() and the closing summary become one
module. Adds skip(), which requires a reason and prints it, and makes
finish() exit non-zero when no check passed — a suite that skipped
everything has proved nothing and must not report success.

Pure refactor: no suite changes what it asserts."
```

---

## Task 5: Regime detection and the shared bootstrap

**Files:**
- Create: `frontend/e2e/regime.mjs`
- Modify: `frontend/e2e/fixedNow.mjs`, and the page factories in all three
  suites

**Interfaces:**
- Consumes: `check` from `./results.mjs`.
- Produces:
  ```js
  export async function enterList(page)   // → 'in-season' | 'off-season'
  export function currentRegime()         // → the cached regime; THROWS if none yet
  ```
  and from `fixedNow.mjs`, unchanged exports `FIXED_NOW` / `pinClock`, now
  honoring `E2E_NOW`.

### The route decision, and why it is a step rather than an assumption

Off-season, `enterList` has two ways to get day sections on screen:

- **Tap a mid-season rail chip.** The rail is rendered above the landing (it
  lives in the sticky header, outside the empty/list branch, and
  `scopeHasWindow` is true post-season because the window is non-null, merely
  empty). `railTarget` (`src/app/dayRailNavigation.ts:36`) accepts any target
  inside `navBounds`, and a target before `window.startDay` sets
  `expandStart`. So tapping `2026-07-15` widens the window to
  `[2026-07-15, …)`, mounting the back half of the season.
- **Click "Browse the 2026 season."** Sets the scope to `season`.

**Prefer the rail chip.** The archive button sets the view window to the
*entire* season, which makes `navigationTargets` return `earlierDay: null` —
there is no event day before the window — so the "Show earlier" button
disappears and checks 4/5 in `verify-rail.mjs` fail with `no button` on a
perfectly correct app. The rail-chip route reproduces the in-season *shape*:
event days on both sides of the window, which is what those checks assume.

- [ ] **Step 1: Add the `E2E_NOW` override**

In `frontend/e2e/fixedNow.mjs`, replace the `FIXED_NOW` export with:

```js
/**
 * Mid-morning Institution time on the run's own calendar day — or on
 * `E2E_NOW`'s day, when it is set.
 *
 * `E2E_NOW` exists so the off-season regime can be exercised on any date. It
 * takes either a bare `yyyy-mm-dd` (pinned to the same mid-morning rule) or a
 * full instant, which wins as given. Unset — which is every CI run of the
 * three date-agnostic suites — the behaviour is exactly what it was.
 */
function resolveFixedNow() {
  const override = process.env.E2E_NOW;
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) {
    return new Date(`${override}T14:00:00Z`);
  }
  if (override) {
    const parsed = new Date(override);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`E2E_NOW is not a date: ${override}`);
    }
    return parsed;
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
    .format(new Date());
  return new Date(`${today}T14:00:00Z`);
}

export const FIXED_NOW = resolveFixedNow();
```

Leave `pinClock` exactly as it is, including its comment about
`setFixedTime` versus `install`.

- [ ] **Step 2: Determine empirically which off-season route works**

Before writing `regime.mjs`, find out what the app actually does. Build and
serve the branch, pin the clock past the season, and look:

```bash
cd frontend
npm run build
npm run preview &            # serves the built output on :3000
# find the feed's last 2026 event day:
curl -s https://www.chqcal.org/cache/calendar-cache/all-events-2026.json \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const days=[...new Set(JSON.parse(s).data.map(e=>e.startDate.slice(0,10)))].sort();
      console.log('first',days[0],'last',days[days.length-1]);})"
```

Then, with `E2E_NOW` set to five days past that last day, open the page in a
scratch Playwright script and check, in order:

1. Does `[data-testid="off-season-landing"]` appear?
2. Is `[data-day-rail]` present, with enabled chips
   (`aria-disabled !== 'true'`)?
3. Does clicking a mid-season enabled chip produce `[data-day-key]` within a
   few seconds?
4. After that, is there a button matching `/show earlier/i`?

Record the answers in the commit message.

**If (3) is false**, the rail-over-landing path is dead. Two consequences,
both required: `enterList` falls back to the "Browse the … season" button,
**and** `page.tsx` must hide the rail over the landing rather than offer
enabled chips that do nothing — pass `scopeHasWindow={dateWindow !== null &&
filteredEvents.length > 0}` or equivalent, matching the treatment the rail
already gives an off-season `this-week`. Do not ship enabled controls that
are no-ops.

**If (4) is false** even after the chip tap, checks 4/5 must skip off-season
too; add them to Task 6's skip list with that reason.

- [ ] **Step 3: Write `regime.mjs`**

```js
/**
 * Which regime the app is in, and how to get a populated list on screen
 * either way.
 *
 * Every suite used to open with `waitForSelector('[data-day-key]')`. That is
 * correct in season and a 30-second hang out of it: from the season's last
 * event day until the years manifest rolls over on October 1, the default
 * window is empty, so no day section is ever written (#269).
 *
 * The race below replaces that hang with an answer. Off-season it then taps a
 * mid-season rail chip, which widens the view window to that day and mounts
 * the back half of the season — deliberately NOT the landing's "Browse the …
 * season" button, which sets the window to the whole season and so leaves no
 * event day before it. That would remove the "Show earlier" affordance and
 * fail checks 4/5 on a correct app. The chip route reproduces the in-season
 * shape: event days on both sides of the window.
 */
import { check } from './results.mjs';

let regime = null;

/**
 * The regime this run is in.
 *
 * Throws rather than guessing when no page has bootstrapped yet: a check that
 * consults the regime before one has been established is an ordering bug, and
 * a wrong default would silently run the wrong branch.
 */
export function currentRegime() {
  if (regime === null) {
    throw new Error('currentRegime() before any enterList() — ordering bug');
  }
  return regime;
}

const LANDING = '[data-testid="off-season-landing"]';
const EMPTY = '[data-testid="empty-state"]';
const DAY = '[data-day-key]';

/**
 * Wait for a populated day list, entering the season first if the default
 * screen is the off-season landing. Call instead of
 * `waitForSelector('[data-day-key]')`, after `goto`.
 */
export async function enterList(page) {
  const first = await Promise.race([
    page.waitForSelector(DAY, { timeout: 30000 }).then(() => 'day'),
    page.waitForSelector(LANDING, { timeout: 30000 }).then(() => 'landing'),
    page.waitForSelector(EMPTY, { timeout: 30000 }).then(() => 'empty'),
  ]).catch(() => 'nothing');

  if (first === 'nothing') {
    // Loudly, with what the page actually had. A bare 30s timeout is what
    // #269 was: six minutes of a suite proving nothing and then failing with
    // no diagnosis.
    const found = await page.evaluate(() => ({
      dayKeys: document.querySelectorAll('[data-day-key]').length,
      rail: !!document.querySelector('[data-day-rail]'),
      main: document.querySelector('main')?.innerText?.slice(0, 200) ?? '(no main)',
    }));
    throw new Error(
      `enterList: no day section, landing or empty state after 30s — ${JSON.stringify(found)}`
    );
  }

  if (first === 'day') {
    announce('in-season');
    return regime;
  }

  if (first === 'empty') {
    throw new Error(
      'enterList: the default screen is the generic empty state, which means ' +
      'the feed came back empty or a filter leaked in from storage'
    );
  }

  announce('off-season');
  await enterSeasonFromLanding(page);
  await page.waitForSelector(DAY, { timeout: 30000 });
  return regime;
}

/**
 * Tap the enabled rail chip nearest the middle of the rail — the one with the
 * most content on both sides of it, so "show earlier" and "expand end" both
 * have somewhere to go.
 */
async function enterSeasonFromLanding(page) {
  const target = await page.$$eval('[data-day-rail] [data-chip]', els => {
    const enabled = els
      .map(e => ({ key: e.dataset.chip, ok: e.getAttribute('aria-disabled') !== 'true' }))
      .filter(c => c.ok);
    return enabled.length ? enabled[Math.floor(enabled.length / 2)].key : null;
  });

  if (target) {
    await page.evaluate(
      k => document.querySelector(`[data-day-rail] [data-chip="${k}"]`).click(),
      target
    );
    await page.waitForTimeout(1500);
    if (await page.$(DAY)) return;
  }

  // Fallback: the landing's own archive button. Sets the scope to the whole
  // season, so `earlierDay` is null and "Show earlier" is absent — checks
  // that need it skip (see verify-rail's skip list).
  const archive = page.getByRole('button', { name: /^Browse the \d{4} season$/ });
  if (await archive.count() === 0) {
    throw new Error('enterList: no enabled rail chip and no archive button on the landing');
  }
  await archive.click();
}

let announced = false;
function announce(value) {
  regime = value;
  if (announced) return;
  announced = true;
  // One line per RUN, not per page: verify-rail opens twelve pages, and
  // twelve identical lines is noise that hides the one thing worth reading.
  console.log(`regime: ${value}`);
  check('0 regime detected', true, value);
}
```

- [ ] **Step 4: Point the three suites at it**

In each suite, add `import { enterList } from './regime.mjs';` and replace the
bootstrap wait:

- `verify-rail.mjs:77` — `await page.waitForSelector('[data-day-key]', { timeout: 30000 });`
- `verify-timezone.mjs:28` — same line
- `verify-filter-reveal.mjs:55` — `await page.waitForSelector('[data-day-key]');`

each becomes:

```js
  await enterList(page);
```

`verify-filter-reveal.mjs` has no pinned clock today (its own comment says it
is not hour-sensitive). Leave that as it is — `E2E_NOW` reaches it through
Task 7's suite, and adding a clock pin here would change what it measures for
no reason.

- [ ] **Step 5: Run all three, in season, against production**

```bash
cd frontend
URL=https://www.chqcal.org/ node e2e/verify-rail.mjs
URL=https://www.chqcal.org/ node e2e/verify-timezone.mjs
URL=https://www.chqcal.org/ node e2e/verify-filter-reveal.mjs
```

Expected: `regime: in-season` printed once per suite, and the same pass counts
recorded in Task 4 Step 3, plus the new `0 regime detected` check.

- [ ] **Step 6: Run all three pinned past the season**

With `LAST` set to the feed's last 2026 event day:

```bash
cd frontend
npm run build && npm run preview &
E2E_NOW=<LAST + 5 days> URL=http://localhost:3000/ node e2e/verify-rail.mjs
E2E_NOW=<LAST + 5 days> URL=http://localhost:3000/ node e2e/verify-timezone.mjs
```

Expected: `regime: off-season` printed once, and the suites reach real
measurements instead of hanging. Some checks will fail at this point — that is
Task 6's job, and the failures should be checks 3 and 11 specifically. Record
which ones fail; if anything *other* than 3 and 11 fails, investigate before
proceeding rather than adding it to the skip list.

- [ ] **Step 7: Commit**

```bash
git add frontend/e2e/regime.mjs frontend/e2e/fixedNow.mjs \
        frontend/e2e/verify-rail.mjs frontend/e2e/verify-timezone.mjs \
        frontend/e2e/verify-filter-reveal.mjs
git commit -m "fix(e2e): the browser checks work off-season (#269)

Every suite opened with waitForSelector('[data-day-key]'), which from the
season's last event day until the manifest rolls over on October 1 is a
30s hang — verify-rail alone opens twelve pages, so the job burned six
minutes proving nothing before failing with no diagnosis.

enterList() races the day section against the landing and the empty state,
and off-season taps a mid-season rail chip to widen the window into the
season. Deliberately not the landing's archive button: that sets the
window to the WHOLE season, leaving no event day before it, which removes
'Show earlier' and would fail checks 4/5 on a correct app.

E2E_NOW pins the clock to any date so the regime can be exercised."
```

---

## Task 6: Regime-aware skips in `verify-rail.mjs`

**Files:**
- Modify: `frontend/e2e/verify-rail.mjs`

**Interfaces:**
- Consumes: `skip` from `./results.mjs`, `currentRegime` from `./regime.mjs`.
- Produces: nothing importable.

### Which checks have no subject off-season, and why

**Check 3 — "persisted 'this-week' migration"** (lines ~169–189). It seeds
`localStorage` with `dateFilter: 'this-week'` and asserts at 3b that day
sections render. Off-season, `'this-week'` resolves to no window at all —
`viewWindow` returns `null` from `baseWindow` — and the rail hides rather than
offering chips that cannot move the list. That is documented, intended
behaviour (`page.tsx`'s `scopeHasWindow` comment). 3b would be asserting the
opposite of the contract.

Note that this page also cannot go through `enterList`'s off-season branch:
`hasNonDefaultFilters` is true with `'this-week'` set, so the reader gets
`EmptyState`, not the landing. The guard must therefore come **before**
`newPage()` is called, not inside it.

**Check 11 — "⟳ Now"** (lines ~301–366). Its subject is navigating away from
today and back. Off-season, today is outside `navBounds`, `reachableTodayKey`
returns `null`, and the button is correctly absent — `page.tsx:307-312` says
so explicitly. There is nothing to navigate back to.

- [ ] **Step 1: Add the imports**

In `verify-rail.mjs`, extend the existing import:

```js
import { check, skip, finish } from './results.mjs';
import { enterList, currentRegime } from './regime.mjs';
```

- [ ] **Step 2: Guard check 3**

Replace the opening of the check-3 block. It currently starts:

```js
// ------------------------------------------- 3. persisted 'this-week' migration
{
  const page = await newPage({
```

with:

```js
// ------------------------------------------- 3. persisted 'this-week' migration
//
// `currentRegime()` throws if no page has bootstrapped yet, which makes the
// ordering dependency on checks 1-2 loud rather than silent. The guard is
// outside `newPage()` on purpose: with `this-week` persisted the reader has a
// non-default filter, so off-season they get the generic empty state and not
// the landing — `enterList` has no branch that could rescue this page.
if (currentRegime() === 'off-season') {
  skip('3 persisted this-week migration',
    "off-season 'this-week' resolves to no window at all, by design — the rail " +
    'hides and no day section mounts, so 3b would assert against the contract');
} else {
  const page = await newPage({
```

and close the block by replacing its final `await page.close();\n}` with
`await page.close();\n}` inside the new `else` — i.e. the existing block body
is now the `else` arm. Keep the braces balanced; run the suite to confirm the
file still parses.

- [ ] **Step 3: Guard check 11**

Replace:

```js
// ------------------------------------------------------------------ 11. ⟳ Now
{
  const page = await newPage();
```

with:

```js
// ------------------------------------------------------------------ 11. ⟳ Now
if (currentRegime() === 'off-season') {
  skip('11 ⟳ Now',
    'today is outside navBounds off-season, so reachableTodayKey is null and ' +
    'the button is correctly absent (page.tsx:307-312) — there is no ' +
    'navigation back to today to test');
} else {
  const page = await newPage();
```

and, as with check 3, make the existing body the `else` arm.

- [ ] **Step 4: Run in season**

```bash
cd frontend
URL=https://www.chqcal.org/ node e2e/verify-rail.mjs
```

Expected: `regime: in-season`, `0 skipped`, and the same pass count as
Task 5 Step 5. In season nothing skips — that is the point of gating on the
regime rather than on "did it work".

- [ ] **Step 5: Run pinned past the season**

```bash
cd frontend
npm run build && npm run preview &
E2E_NOW=<LAST + 5 days> URL=http://localhost:3000/ node e2e/verify-rail.mjs
```

Expected: `regime: off-season`, `0 failed`, exactly 2 skipped, both named in
the `SKIPPED:` block. If any check still fails, do **not** add it to the skip
list without first establishing that the app is right and the check has no
subject — the whole value of this suite is that it fails when the app is
wrong.

- [ ] **Step 6: Commit**

```bash
git add frontend/e2e/verify-rail.mjs
git commit -m "fix(e2e): skip the two rail checks with no off-season subject (#269)

Check 3 asserts day sections render with a persisted 'this-week'; that
scope resolves to no window at all off-season, by design, so 3b would
assert against the contract. Check 11's subject is navigating back to
today, which off-season is outside navBounds and correctly unreachable.

Both skips print their reason and are counted; every geometry check still
runs, against the season entered by enterList."
```

---

## Task 7: The regime matrix suite

**Files:**
- Create: `frontend/e2e/verify-offseason.mjs`
- Modify: `frontend/package.json`, `frontend/e2e/README.md`

**Interfaces:**
- Consumes: `check`, `finish` from `./results.mjs`.
- Produces: nothing importable; it is an entry point.

### What this suite is for

The off-season path is unreachable eleven months of the year. Without a suite
that pins the clock, it would be proved once and then rot — and the next time
anyone found out would be the following September, in exactly the same way.

Matrix dates derive from the feed, never hardcoded. A literal `2026-09-15`
would be wrong the moment the 2027 season is published.

### The one entry that needs a stub, and why

`defaultYear` comes from the server-generated manifest, not the client clock:
`useAvailableYears` sets it from the fetched `years.json`, and
`getDefaultYear()` in `src/lib/constants.ts` is only the fallback for a failed
fetch. So pinning the clock to October 1 does **not** reproduce the
self-heal — live production still serves `defaultYear: 2026`. One
`page.route` interception of that three-field JSON is the only way to exercise
the mechanism the whole issue rests on.

- [ ] **Step 1: Write the suite**

Create `frontend/e2e/verify-offseason.mjs`:

```js
/**
 * The off-season regimes, pinned.
 *
 * From the season's last event day until the years manifest rolls over on
 * October 1, the default window is empty and the app shows the off-season
 * landing instead of a day list (#269). That path is unreachable for eleven
 * months of the year, so without this suite it would be proved once and then
 * rot — and the next anyone heard of it would be the following September, in
 * exactly the same way.
 *
 * Every pinned instant is derived from the feed rather than written down. A
 * literal date would be wrong the moment the next season is published, which
 * is the same staleness that made the old `chips[lastMounted + 6]` target
 * fail in the season's tail.
 */
import { chromium } from 'playwright';
import { check, finish } from './results.mjs';

const URL = process.env.URL ?? 'http://localhost:3000/';
const FEED = 'https://www.chqcal.org/cache/calendar-cache';

const browser = await chromium.launch();

/** The default year's first and last event day, straight from the feed. */
async function seasonEdges() {
  const manifest = await (await fetch(`${FEED}/years.json`)).json();
  const year = manifest.defaultYear;
  const feed = await (await fetch(`${FEED}/all-events-${year}.json`)).json();
  const days = [...new Set(feed.data.map(e => e.startDate.slice(0, 10)))].sort();
  return { year, years: manifest.years, first: days[0], last: days[days.length - 1] };
}

/** `yyyy-mm-dd` shifted by whole calendar days, via UTC so no DST is involved. */
function shift(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * Open the app with the clock pinned to `day` at mid-morning Institution
 * time, optionally serving a stubbed years manifest.
 */
async function pinnedPage(day, { manifest } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 900 },
    timezoneId: 'America/New_York',
  });
  const page = await ctx.newPage();
  page.once('close', () => { ctx.close().catch(() => {}); });
  if (manifest) {
    await page.route('**/years.json', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifest) })
    );
  }
  await page.clock.setFixedTime(new Date(`${day}T14:00:00Z`));
  await page.goto(URL, { waitUntil: 'networkidle' });
  // The app caches the manifest in localStorage for an hour, which would let
  // a real manifest from an earlier entry outlive its stub. Clear and reload.
  if (manifest) {
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
  }
  return page;
}

/** What the main panel settled on, once it settled on anything. */
async function screenState(page) {
  await Promise.race([
    page.waitForSelector('[data-day-key]', { timeout: 30000 }),
    page.waitForSelector('[data-testid="off-season-landing"]', { timeout: 30000 }),
    page.waitForSelector('[data-testid="empty-state"]', { timeout: 30000 }),
  ]).catch(() => {});
  return page.evaluate(() => ({
    days: document.querySelectorAll('[data-day-key]').length,
    landing: !!document.querySelector('[data-testid="off-season-landing"]'),
    empty: !!document.querySelector('[data-testid="empty-state"]'),
    heading: document.querySelector('[data-testid="off-season-landing"] h3')?.textContent?.trim() ?? null,
    countdown: document.querySelector('[data-testid="off-season-countdown"]')?.textContent?.trim() ?? null,
    buttons: [...document.querySelectorAll('[data-testid="off-season-landing"] button')]
      .map(b => b.textContent.trim()),
  }));
}

const edges = await seasonEdges();
console.log(`feed: default year ${edges.year}, events ${edges.first} … ${edges.last}`);
check('0 feed has a season to reason about', !!edges.first && !!edges.last,
  `${edges.first} … ${edges.last}`);

// ------------------------------------------------- 1. post-season, just after
{
  const day = shift(edges.last, 5);
  const page = await pinnedPage(day);
  const s = await screenState(page);
  check('1a landing replaces the empty list', s.landing && s.days === 0,
    `day=${day} landing=${s.landing} days=${s.days} empty=${s.empty}`);
  check('1b it says the season has ended', s.heading === 'See you next season', s.heading);
  check('1c the archive is offered', s.buttons.some(b => /^Browse the \d{4} season$/.test(b)),
    s.buttons.join(' | '));

  // The affordance the harness itself depends on: clicking it must produce a
  // list. If this fails, `enterList`'s fallback route is dead.
  await page.getByRole('button', { name: /^Browse the \d{4} season$/ }).click();
  await page.waitForSelector('[data-day-key]', { timeout: 15000 }).catch(() => {});
  const after = await page.evaluate(() => document.querySelectorAll('[data-day-key]').length);
  check('1d browsing the archive mounts the season', after > 0, `${after} day sections`);
  await page.close();
}

// ------------------------------------------- 2. post-season, the September 30 edge
{
  const day = shift(edges.last, 19);
  const page = await pinnedPage(day);
  const s = await screenState(page);
  check('2a still the landing three weeks later', s.landing && s.days === 0,
    `day=${day} landing=${s.landing} days=${s.days}`);
  check('2b still says the season has ended', s.heading === 'See you next season', s.heading);
  await page.close();
}

// ------------------------------------------------------------- 3. pre-season
{
  // Far enough back that the `next` scope's 91-day empty-input window cannot
  // reach the season — closer than that and real events are in the window,
  // which is `in-season` and a different assertion.
  const day = shift(edges.first, -120);
  const page = await pinnedPage(day);
  const s = await screenState(page);
  check('3a landing before the season opens', s.landing && s.days === 0,
    `day=${day} landing=${s.landing} days=${s.days}`);
  check('3b it says the season has not started', s.heading === 'Almost showtime', s.heading);
  check('3c it counts down to the opening', /season begins [A-Z][a-z]+ \d{1,2}$/.test(s.countdown ?? ''),
    s.countdown);
  // No year-aware "browse a past season" exists, so pre-season offers none.
  check('3d no buttons pre-season', s.buttons.length === 0, s.buttons.join(' | '));
  await page.close();
}

// -------------------------------------------------------------- 4. in season
{
  const day = shift(edges.last, -30);
  const page = await pinnedPage(day);
  const s = await screenState(page);
  check('4a a real list mid-season, no landing', s.days > 0 && !s.landing,
    `day=${day} days=${s.days} landing=${s.landing}`);
  await page.close();
}

// ----------------------------------------------- 5. the October manifest rollover
{
  // `defaultYear` is server-generated, not derived from the client clock
  // (`useAvailableYears` reads years.json; `getDefaultYear()` is only the
  // failed-fetch fallback). So pinning past October 1 does NOT reproduce the
  // rollover — production still serves the current default. Stubbing the
  // manifest is the only way to exercise the mechanism #269 self-heals by.
  const nextYear = edges.year + 1;
  const day = shift(edges.last, 25);
  const page = await pinnedPage(day, {
    manifest: { years: [...new Set([...edges.years, nextYear])], defaultYear: nextYear, generated: '' },
  });
  const s = await screenState(page);
  check('5a rolling the manifest forward lands on the next season',
    s.landing || s.days > 0,
    `day=${day} defaultYear=${nextYear} landing=${s.landing} days=${s.days} heading=${s.heading}`);
  // Whatever the next year's feed holds, it must never claim that year's
  // season has already ended — the reader is before it, not after it.
  check('5b it never says the next season has ended',
    s.heading !== 'See you next season', s.heading);
  await page.close();
}

await browser.close();
finish();
```

- [ ] **Step 2: Run it against production**

```bash
cd frontend
URL=https://www.chqcal.org/ node e2e/verify-offseason.mjs
```

Expected: all checks pass. Entry 5's outcome depends on what the next year's
feed holds — if 2027 has no events yet, `5a` sees the pre-season landing; if it
does, a list. Both satisfy `5a`, and `5b` is the assertion that actually
discriminates.

Note this suite must run against a build that has Tasks 1–3 in it. Running it
against `https://www.chqcal.org/` before those deploy will fail every landing
check, correctly — use the local preview server until the branch ships.

- [ ] **Step 3: Add it to `test:browser`**

In `frontend/package.json`:

```json
"test:browser": "node e2e/verify-rail.mjs && node e2e/verify-filter-reveal.mjs && node e2e/verify-timezone.mjs && node e2e/verify-offseason.mjs"
```

No workflow change is needed: `.github/workflows/build-and-test.yml`'s
`browser-checks` job already runs `npm run test:browser` against the
`vite preview` server, and `vite.config.ts` proxies `/cache` to production for
both the dev and preview servers.

- [ ] **Step 4: Document it**

In `frontend/e2e/README.md`, add a section after "Running":

````markdown
## Regimes

The calendar has three: before the season opens, during it, and after the last
event until the years manifest rolls over on October 1. The middle one is the
only one where the default screen is a day list.

Every suite therefore bootstraps through `enterList` (`regime.mjs`) rather
than `waitForSelector('[data-day-key]')`. It races the day section against the
off-season landing and the generic empty state, and off-season taps a
mid-season rail chip to widen the view window into the season. It prints one
`regime:` line per run.

Two `verify-rail` checks have no subject off-season and skip with a printed
reason: check 3 (`this-week` resolves to no window at all, by design) and
check 11 (today is outside `navBounds`, so `⟳ Now` is correctly absent). A
suite where *no* check passed exits non-zero — an all-skip run has proved
nothing.

Pin the clock to any date with `E2E_NOW`:

```bash
# five days past the season's last event day
E2E_NOW=2026-09-15 URL=http://localhost:3000/ node e2e/verify-rail.mjs
```

`verify-offseason.mjs` runs a five-entry matrix over pinned instants derived
from the feed — post-season, the September 30 edge, pre-season, mid-season,
and the October manifest rollover. It exists because the off-season path is
unreachable eleven months of the year and would otherwise rot between
Septembers. The rollover entry stubs `years.json`: `defaultYear` is
server-generated, so pinning the clock alone cannot reproduce it.
````

- [ ] **Step 5: Commit**

```bash
git add frontend/e2e/verify-offseason.mjs frontend/package.json frontend/e2e/README.md
git commit -m "test(e2e): a pinned regime matrix for the off-season path (#269)

The off-season path is unreachable eleven months a year, so proving it
once means finding out it broke the following September. This runs five
regimes on every CI push — post-season, the Sep 30 edge, pre-season,
mid-season, and the October manifest rollover.

Pinned instants derive from the feed, never hardcoded: a literal date goes
stale the moment the next season is published.

The rollover entry stubs years.json because defaultYear is
server-generated — pinning the clock alone leaves production serving the
current default, so it cannot reproduce the self-heal at all."
```

---

## Task 8: Falsification pass and PR

**Files:** none changed permanently. Every edit in this task is reverted.

This is the task that decides whether any of the above is worth anything. A
guard that has never been seen to fail is not known to be a guard. Where a
falsification *passes*, suspect the harness before believing the code.

**Critical mechanical note:** `npm run build` gates the bundle on the unit
suite, so injecting a defect to falsify a *browser* check makes the build fail
and silently serves the **previous** bundle — the suite then passes against
code that does not contain your defect. Use `npx vite build` (which skips the
unit suite) and grep `out/assets/*.js` to confirm the injection actually
landed before drawing any conclusion.

- [ ] **Step 1: Break the landing, confirm the harness fails loudly**

In `page.tsx`, temporarily render `<EmptyState />` unconditionally in the
empty branch. Then:

```bash
cd frontend && npx vite build && npm run preview &
E2E_NOW=<LAST + 5 days> URL=http://localhost:3000/ node e2e/verify-rail.mjs
```

Expected: `enterList` throws
`the default screen is the generic empty state…` — a named diagnosis in
seconds, not a 30-second hang. Revert.

- [ ] **Step 2: Break the archive entry, confirm the geometry checks fail**

In `regime.mjs`, make `enterSeasonFromLanding` return immediately without
clicking anything. Rebuild with `npx vite build`, then run pinned.

Expected: the run fails — `enterList`'s `waitForSelector(DAY)` times out.
It must NOT report a green run over an empty page. Revert.

- [ ] **Step 3: Confirm the all-skip guard**

Already falsified in Task 4 Step 4. Re-run it to confirm the guard survived
the later tasks:

```bash
cd frontend && node --input-type=module -e "
import { skip, finish } from './e2e/results.mjs';
skip('temp', 'falsification');
finish();
"; echo "exit=$?"
```

Expected: `exit=1`.

- [ ] **Step 4: Break the season-start comparison, confirm the matrix fails**

In `landingState.ts`, change `if (now < start)` to `if (false)`. Rebuild with
`npx vite build`, grep the bundle to confirm the change is in it, then:

```bash
URL=http://localhost:3000/ node e2e/verify-offseason.mjs
```

Expected: entry 3 fails — `3b` reports `See you next season` where
`Almost showtime` belongs. If it passes, the matrix is not discriminating and
the pre-season entry needs a closer look before you trust it. Revert.

- [ ] **Step 5: Full verification**

```bash
cd frontend && npm run build
cd ../backend && npm run validate && npm run build
cd ../frontend
URL=https://www.chqcal.org/ npm run test:browser
```

Backend is untouched by this work, but the project's verification checklist
runs it and a red backend build is not this branch's excuse.

Then the pinned off-season run, which is the one that matters:

```bash
npm run preview &
E2E_NOW=<LAST + 5 days> URL=http://localhost:3000/ node e2e/verify-rail.mjs
E2E_NOW=<LAST + 5 days> URL=http://localhost:3000/ node e2e/verify-timezone.mjs
E2E_NOW=<LAST + 5 days> URL=http://localhost:3000/ node e2e/verify-filter-reveal.mjs
```

Expected: `regime: off-season`, 0 failed, exactly 2 skipped across the three
suites (both in `verify-rail`), and real measurements in the geometry checks —
not vacuous passes. Read the `detail` values; a check reporting `0px` where it
should report a real distance is passing for the wrong reason.

- [ ] **Step 6: Open the PR**

```bash
git push -u origin fix/269-off-season-landing
gh pr create --title "fix: an off-season landing, and browser checks that survive it (#269)" --body "$(cat <<'BODY'
Closes #269.

## What was going to happen

From 2026-09-11 to 2026-09-30 all three browser-check suites would have gone
red on `main` with no code change, and every visitor to chqcal.org would have
seen "No events found — try adjusting your filters" with no filters set.

The last 2026 event day is 2026-09-10, the manifest still says
`defaultYear: 2026`, and the current year's default scope is `next` — whose
window falls back to `startDate + 91 days` on empty input. Zero matches means
`EmptyState`, which writes no `data-day-key`, which every suite waits 30s for.
`verify-rail` opens twelve pages, so the job burned ~6 minutes proving nothing.

It self-heals on October 1 when the manifest rolls to 2027, and recurs every
year in the same shape.

## What this does

**The web gets an off-season landing**, porting iOS's `LandingState` and
`OffSeasonLandingView`. It names why the list is empty, counts down to the
next opening, and offers the archive and a next-season preview. `EmptyState`
is unchanged apart from a test id and still handles the case it was written
for — the reader filtered to nothing.

**The browser checks became regime-aware.** `enterList` races the day section
against the landing, and off-season taps a mid-season rail chip to widen the
window into the season, so every geometry check still runs. Only two checks
skip, both with printed reasons and no subject off-season. A suite where no
check passed now exits non-zero.

**`verify-offseason.mjs`** runs a five-entry regime matrix on every push so
the path cannot rot during the eleven months it is unreachable.

## Two findings worth reading

- **Pinning the clock cannot reproduce the October 1 self-heal.**
  `defaultYear` is server-generated; `getDefaultYear()` is only the
  failed-fetch fallback. That entry stubs `years.json`.
- **The landing's own "Browse the … season" button is the wrong way in for the
  harness.** It sets the window to the whole season, leaving no event day
  before it, which removes "Show earlier" and would fail checks 4/5 on a
  correct app. The rail-chip route reproduces the in-season shape.

## Verification

Falsified rather than assumed — the landing removed, the archive entry
disabled, the all-skip guard, and the season-start comparison each broken in
turn and each confirmed to go red. `npx vite build` was used for those, since
`npm run build` gates on the unit suite and would have served the previous
bundle.

Pinned past the season: `regime: off-season`, 0 failed, 2 skipped.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01CZUXs5vAgdfPGRx8GtCRAn
BODY
)"
```

- [ ] **Step 7: Iterate the PR to green**

Follow the project's PR-iteration rule in `~/.claude/CLAUDE.md`: address
review comments, request fresh reviews, resolve threads, fix failing checks,
repeat until no pending reviewers, all threads resolved or outdated, all
checks passed, and `mergeable_state` is `clean`. Then post the closing comment
and **ask the user to merge** — never merge automatically.

**Expand Copilot's collapsed `Suppressed comments` block every round.** On
this project it has hidden real findings there while the visible summary said
"generated no new comments" — 4 of 8 rounds on the last batch, including that
batch's only real behavioural finding.

---

## Self-Review

**Spec coverage.** Spec §A1 → Task 1. §A2 → Task 2. §A3 (the rail-over-landing
verification the spec made the implementation's job) → Task 5 Step 2, with the
`scopeHasWindow` remedy spelled out if the tap does not land. §A4 → Tasks 1–3.
§B1 → Task 5 Step 1. §B2 → Task 5 Step 3. §B3 → Task 4. §B4 → Task 7. §B5 →
Task 7 Step 3. "How the fix is proven" → Task 8.

**One deliberate departure from the spec**, recorded here rather than buried:
the spec described `enterList` as clicking "Browse the … season". Reading
`navigationTargets` and `railTarget` showed that route sets the view window to
the whole season, which makes `earlierDay` null and breaks checks 4/5 on
correct code. The plan makes the rail chip the primary route and keeps the
archive button as the fallback — and Task 7's check `1d` still asserts the
archive button works, since the landing offers it to real readers regardless.

**A second, smaller one:** the spec listed `EmptyState.tsx` as unchanged. It
gains one `data-testid` so `enterList` can distinguish "you filtered to
nothing" from "the season is over" without a 30-second timeout. No behaviour
changes.

**Type consistency.** `LandingState`'s field names (`endedSeasonYear`,
`nextSeasonYear`, `opening`, `daysUntil`) are identical across Tasks 1, 2 and
3. `determineLandingState` takes `yearHasEvents` in Task 1 and is called with
`yearHasEvents: events.length > 0` in Task 3. `check`/`skip`/`finish` have one
signature each, used identically in Tasks 4, 6 and 7. `enterList(page)` and
`currentRegime()` match between Tasks 5 and 6.
