# Off-season landing and regime-aware browser checks (#269)

**Status:** Approved design, not yet implemented.
**Issue:** [#269](https://github.com/bbernstein/chq-calendar/issues/269)
**Date:** 2026-08-24

## Problem

From 2026-09-11 through 2026-09-30 all three browser-check suites will fail
on `main` without any code changing, and every visitor to chqcal.org will
land on "No events found."

Both failures have the same cause. The last 2026 event day in the feed is
2026-09-10; the next event day of any kind is 2027-06-27. The years manifest
says `defaultYear: 2026`, so the app scopes to 2026, and the default scope
for the current year is `next`, whose window is `[now − 1h, adaptiveEndDate)`.
With no 2026 events left, `getAdaptiveEndDate` takes its empty-input branch
(`dateHelpers.ts:146-158`) and returns `startDate + 91 days` — a window over
an empty stretch of September–December 2026. Zero matches means `page.tsx:620`
renders `<EmptyState />`, and `EmptyState` writes no day section, so
`data-day-key` (`daySections.ts:18`, written by `EventListView.tsx:43`) never
appears.

Each suite gates its page bootstrap on that attribute:

| File | Line | Wait |
|---|---|---|
| `frontend/e2e/verify-rail.mjs` | 77 | `waitForSelector('[data-day-key]', { timeout: 30000 })` |
| `frontend/e2e/verify-timezone.mjs` | 28 | same, 30 s |
| `frontend/e2e/verify-filter-reveal.mjs` | 55 | same, default timeout |

`verify-rail.mjs` alone calls `newPage()` twelve times, so the job burns
roughly six minutes doing nothing before it fails.

The outage self-heals on 2026-10-01, when `generateYearsManifest`'s
`now.getMonth() >= 9` check (`eventsCalendarDataSyncService.ts:988`) flips
`defaultYear` to 2027. That makes it a ~20-day window rather than a
year-long one, but it recurs every year in the same shape, and three weeks
of a red merge gate trains people to ignore the gate.

## Scope

Two changes, shipped together:

1. **The web gets an off-season landing.** iOS already has
   `OffSeasonLandingView`; the web has only the generic `EmptyState`. This
   closes a real user-facing gap and gives the harness something
   deterministic to assert.
2. **The browser checks become regime-aware.** In the off-season they enter
   the archive season and run the geometry checks there, rather than
   skipping them — the gate stays live for the three weeks instead of going
   dark exactly when a regression would ship unnoticed.

Explicitly **out of scope:** changing when `defaultYear` rolls over
(issue #269's option 3). That would change what every client — web, iOS,
widgets — defaults to, and needs its own thinking about what "the season has
ended" means for the archive.

## Part A — the app

### A1. `LandingState` derivation

New pure module `frontend/src/lib/utils/landingState.ts`, a port of
`ios/ChqCalendarShared/Domain/LandingState.swift`:

```ts
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

export function determineLandingState(input: {
  now: Date;
  selectedYear: number;
  availableYears: number[];
  /** `events.length > 0` — the selected year's full, unfiltered event set. */
  yearHasEvents: boolean;
}): LandingState;
```

Three rules:

1. `now < seasonStart(selectedYear)` → `pre-season`. An announced-but-empty
   future year and a fully-loaded future year both belong here; the countdown
   is the right screen either way.
2. Else, `yearHasEvents` → `post-season`, describing the lowest year in
   `availableYears` greater than `selectedYear`, or all-`null` when there is
   no later year.
3. Else → `in-season`, which renders the generic `EmptyState`.

**Rule 3 is a deliberate divergence from iOS and it is load-bearing.** iOS
takes `upcomingDefaultCount` and returns `.inSeason` when it is positive.
That parameter would be dead on web: the landing is reached only from inside
the `filteredEvents.length === 0` branch, so the count is always zero there
and iOS's rule 1 could never fire. Discriminating on the *year's* event set
instead is what catches the case iOS handles separately via `AppModel`'s
`guard snapshot != nil`: a failed or empty feed fetch during the season gives
`events: []` and `now >= seasonStart`, and a naive port would tell a July
visitor "See you next season." With rule 3 that visitor gets the generic
empty state, which is the honest screen for "we have no data", and the
landing is reserved for "we have the data and the season is genuinely over."

Season start is `getChautauquaSeasonWeeks(year)[0].start`, which already
computes the 4th Sunday of June in Institution time. Day counts go through
`chqParts`/`chqDateAt` so they are whole Institution *calendar* days rather
than 24-hour buckets — a `from`/`to` pair straddling the DST transition
still counts dates.

The function reads no clock. `page.tsx` supplies `now`, consistent with
whatever else it derives from the same instant.

### A2. `OffSeasonLanding` component

New `frontend/src/components/layout/OffSeasonLanding.tsx`. It replaces
`<EmptyState />` at `page.tsx:620` only when the reader has narrowed
nothing:

```tsx
loading ? <LoadingSpinner />
: filteredEvents.length === 0
    ? (landingState.kind !== 'in-season' && !filters.hasNonDefaultFilters
        ? <OffSeasonLanding … />
        : <EmptyState />)
    : <EventList … />
```

`EmptyState` stays exactly as it is, for the case it was written for: *you*
filtered this to nothing, so "try adjusting your filters" is true advice.

Content mirrors iOS:

- Heading — `"See you next season"` for `post-season`, `"Almost showtime"`
  for `pre-season`.
- Countdown card when an opening date is known: `"The 2027 season begins
  June 26"` plus `"N days away"` (`"1 day away"` singular). Omitted entirely
  for a `post-season` with no announced next year.
- Up to two buttons:
  - **"Preview the {next} season"** — `setSelectedYear(next)` then
    `setDateFilter('all')`. Rendered only for `post-season` with a known
    `nextSeasonYear`.
  - **"Browse the {ended} season"** — `setDateFilter('season')`, year
    untouched. Rendered only for `post-season`; `LandingState.archiveYear`
    is `null` for `pre-season` on iOS for a documented reason (there is no
    year-aware browse), and the web port keeps that restriction rather than
    inventing a divergence.
- Footnote: starred events and filters still work in past seasons.
- A stable `data-testid="off-season-landing"` for the harness to race
  against `[data-day-key]`.

**Two deliberate deltas from iOS**, recorded here so a later reader does not
read them as bugs:

- **The gate is `!filters.hasNonDefaultFilters`, not iOS's
  `filter.isDefault`.** Web's predicate treats scope `all` as a default too,
  because `all` is the archived year's own starting scope
  (`RECONCILE_FILTERS` with `isCurrentYear: false`). Consequence: a
  current-year reader on "All Year" with zero results gets the landing
  rather than "No events found". That can only happen when the selected year
  genuinely has no events — previewing an announced-but-empty 2027, say —
  where the countdown landing is the better screen. Taken deliberately in
  preference to inventing a stricter predicate that exists only for this
  branch.
- **The day rail stays visible above the landing.** It already renders over
  `EmptyState` by documented design (`DayRail.tsx:68`), it lives in the
  sticky header outside this branch, and post-season its chips still span
  the whole 2026 season (`navigableBounds` reads `events`, not
  `filteredEvents`). So it is a third way back into the archive, not a dead
  control.

### A3. Verification the implementation owes

The rail-over-landing path has never been exercised. The implementation must
confirm that a rail chip tap from the post-season landing actually lands on
that day — `scopeHasWindow` is true post-season (`dateWindow` is non-null,
just empty of events), so the chips are enabled and `goToDay` should expand
`windowStartDay`. If it does not land, the rail must hide over the landing
rather than offer taps that do nothing, matching the `scopeHasWindow`
precedent.

### A4. Tests

`landingState.test.ts`:
- each of the three rules
- `now` exactly at the season opening instant → `post-season`, not
  `pre-season` (the comparison is `<`, so the opening instant is in season)
- **`yearHasEvents: false` with `now` past the season start → `in-season`**,
  the failed-fetch case rule 3 exists for
- `yearHasEvents: false` with `now` before the season start → `pre-season`,
  the announced-but-empty future year
- a `from`/`to` pair straddling the DST transition, asserting calendar-day
  counting rather than 24-hour buckets
- `post-season` with no later year in `availableYears` → all three optional
  values `null`
- `availableYears` unsorted, and containing years below `selectedYear`

`OffSeasonLanding.test.tsx`:
- which buttons render per state, including both `null` cases
- what each button dispatches (`setSelectedYear` + `setDateFilter('all')`;
  `setDateFilter('season')` with the year untouched)
- countdown card omitted when `opening` is `null`
- `"1 day away"` singular

`page.tsx` integration:
- empty + default filters + off-season → landing
- empty + reader-applied filters + off-season → `EmptyState` (the case a
  naive implementation gets wrong)
- empty + default filters + feed failed to load (`events: []`) mid-season →
  `EmptyState`, never "See you next season"
- non-empty → `EventList`, landing absent

## Part B — the harness

### B1. `E2E_NOW` override

`frontend/e2e/fixedNow.mjs` keeps deriving `FIXED_NOW` from the run's own
calendar day at `14:00Z`. Added: when `E2E_NOW` is set it wins — either a
bare date (`2026-09-15`, pinned to the same `14:00Z` mid-morning rule) or a
full instant. The default path stays behaviourally identical to today's.

### B2. Shared regime bootstrap — `frontend/e2e/regime.mjs`

Each suite currently open-codes `waitForSelector('[data-day-key]')`. That
becomes one shared call:

```js
const regime = await enterList(page);   // 'in-season' | 'off-season'
```

`enterList` races `[data-day-key]` against
`[data-testid="off-season-landing"]`. If the landing wins, it records
`off-season`, clicks **"Browse the … season"**, and *then* waits for
`[data-day-key]` — so every geometry check downstream measures the fully
populated archive season instead of being skipped.

- It prints one regime line per *run*, not per page. A suite calling
  `newPage()` twelve times must not emit twelve lines.
- If neither selector appears it fails loudly with a diagnosis, rather than
  timing out at 30 s with nothing to say. That silent timeout is the exact
  failure mode this issue is about.

### B3. Shared tally with real skips — `frontend/e2e/results.mjs`

The three suites hold three copy-pasted copies of `check()` and the
`N/M checks passed` tally. Since all three are being touched anyway, they
collapse into one module exporting `check` / `skip` / `finish`.

`skip(name, reason)` prints `SKIP  name — reason` and counts separately, so
the summary reads `34 passed, 0 failed, 2 skipped`.

Two guards, because a silent skip is worse than a red gate:

- The reason is always supplied by the caller and always printed. Never
  inferred, never blank.
- `finish()` exits non-zero when **no check passed** — a suite that skipped
  everything, or ran nothing at all, is a failure and not a pass. Stated as
  "no check passed" rather than a skip/pass ratio deliberately: a ratio
  tripwire would false-fail the smaller suites (`verify-timezone` has around
  a dozen checks) for a legitimate two-skip off-season run.

Only checks inherently about *today* skip in the off-season regime — `11c ⟳
Now hides once back on today` and its neighbours. Post-season, today is
genuinely not in the archive window, so the app is right and the check has
no subject. Everything geometric runs.

### B4. New suite — `frontend/e2e/verify-offseason.mjs`

Matrix entries derive their pinned instant **from the feed**, not from
hardcoded dates, so they cannot go stale the way a literal `2026-09-15`
would. The suite reads the first and last event day for the default year
once, then runs:

| Entry | Pinned to | Asserts |
|---|---|---|
| post-season, early | last event day + 5 d | landing present, "See you next season", both buttons, archive click → `[data-day-key]` |
| post-season, late | last event day + 19 d | same (the September 30 edge) |
| pre-season | first event day − 120 d | landing present, "Almost showtime", countdown card, no preview button |
| in-season | last event day − 30 d | **no** landing; `[data-day-key]` present |
| Oct rollover | last event day + 25 d, `years.json` stubbed to `defaultYear: 2027` | app defaults to 2027 → pre-season landing for 2027 |

**The rollover entry needs that stub, and the reason is load-bearing.**
`defaultYear` comes from the server-generated manifest, not the client
clock: `useAvailableYears` sets it from the fetched `years.json`, and
`getDefaultYear()` in `constants.ts` is only the fallback for a failed
fetch. So pinning the clock to October 1 does *not* reproduce the self-heal
this issue describes — live production would still serve
`defaultYear: 2026` and the run would show a post-season landing. One
`page.route` interception of that three-field JSON is the only way to
exercise the mechanism the whole issue rests on. Everything else in that
entry stays live.

The 120-day pre-season offset is chosen so the `next` scope's 91-day empty
window cannot reach the season: pinning closer than ~91 days before opening
would put real events in the window and produce `in-season`.

### B5. CI

`frontend/package.json`'s `test:browser` gains
`&& node e2e/verify-offseason.mjs`. No workflow change is needed — the
`browser-checks` job in `.github/workflows/build-and-test.yml` already runs
`npm run test:browser` against the `vite preview` server, and the new suite
reuses the same `/cache` → `https://www.chqcal.org` proxy configured in
`vite.config.ts`. Expected cost is 1–2 minutes on top of the current ~6.

## How the fix is proven

Unit tests are not sufficient here; the whole class of defect in #269 is one
that a green unit suite could not see.

1. Run the three existing suites locally against production with
   `E2E_NOW=<last event day + 5 d>`. They must go green **for the right
   reason**: the printed regime line says `off-season`, the skip count is
   small and every skip is named, and the geometry checks report real
   measurements rather than passing vacuously.
2. Break each new guard deliberately and confirm each goes red:
   - stub the landing away → `enterList` must fail loudly, not hang
   - make `enterList` skip the archive click → the geometry checks must fail
     rather than silently measuring an empty page
   - force every check to `skip` → `finish()` must exit non-zero
   - break `determineLandingState`'s season-start comparison → the
     pre-season matrix entry must fail
3. Per the standing project rule, a falsification that *passes* is treated
   as a broken harness, not a working guard — re-run it against the
   unmodified code before believing it.

Note for step 2: `npm run build` gates the bundle on the unit suite, so
injecting a defect to falsify a *browser* check silently serves the previous
bundle. Use `npx vite build` and grep the output to confirm the injection
landed.

## Files touched

New:
- `frontend/src/lib/utils/landingState.ts`
- `frontend/src/lib/utils/landingState.test.ts`
- `frontend/src/components/layout/OffSeasonLanding.tsx`
- `frontend/src/components/layout/OffSeasonLanding.test.tsx`
- `frontend/e2e/regime.mjs`
- `frontend/e2e/results.mjs`
- `frontend/e2e/verify-offseason.mjs`

Modified:
- `frontend/src/app/page.tsx` — the branch at line 620, plus `landingState`
  derivation
- `frontend/e2e/fixedNow.mjs` — `E2E_NOW` override
- `frontend/e2e/verify-rail.mjs`, `verify-timezone.mjs`,
  `verify-filter-reveal.mjs` — use `enterList` and the shared tally
- `frontend/e2e/README.md` — document the regime bootstrap and `E2E_NOW`
- `frontend/package.json` — `test:browser`

Unchanged on purpose:
- `frontend/src/components/layout/EmptyState.tsx`
- `backend/src/services/eventsCalendarDataSyncService.ts`
- `.github/workflows/build-and-test.yml`
