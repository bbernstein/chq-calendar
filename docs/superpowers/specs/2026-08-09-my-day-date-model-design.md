# My Day — date model and day navigation

**Status:** Design approved 2026-08-09. Implementation not started.
**Issue:** [#192](https://github.com/bbernstein/chq-calendar/issues/192) — iOS: My Day should show today by default.

## Problem

The issue reports that My Day "always shows the first day with favorites by
default." That premise is wrong, and the correction matters because it
changes what needs fixing.

`DayPlan.defaultDayKey` (`ios/ChqCalendarShared/Domain/DayPlan.swift:127`)
already returns today's key when today has favorites, and `MyDayView` already
uses it. The plan rendered below the day strip is today's plan. Three
separate presentation defects make it look like it isn't:

1. **The strip never scrolls to the selection.**
   `MyDayView.dayChipsRow` (`MyDayView.swift:130`) is a bare
   `ScrollView(.horizontal)` with no `ScrollViewReader` and no
   `scrollPosition`. It always renders parked at its leading edge — the
   earliest starred day of the season. In Week 7 the correctly-selected chip
   sits roughly fifty chips off-screen to the right.

2. **The screen never states which day it is showing.** `summaryHeader`
   renders `"3 events · first 9:15 AM · last 8:15 PM"`. There is no date
   anywhere on the screen. The only indicator of the selected day is the
   highlighted chip, which is the thing that is off-screen.

3. **Chip labels omit the month.** `ChqTime.compactDayLabel` is `"EEE d"`, so
   a chip reads `"Sun 9"`. (Within one season these are in fact unique — two
   dates sharing a weekday and a day-of-month must be exactly 28 days apart,
   which only February permits — but a reader still cannot tell June from
   August without counting.)

There is also a genuine default-selection defect underneath the presentation
ones: when today has *no* starred events, `defaultDayKey` skips forward to the
next day that does. Once empty days are selectable (below), skipping is no
longer the right behavior — a visitor with nothing starred today wants to see
that today is empty, not to be silently relocated to Thursday.

## Decisions

Each of these was chosen over stated alternatives during design.

| Decision | Rejected alternative | Why |
|---|---|---|
| The strip shows **every calendar day** in its window, empty days included and tappable | Only days with starred events (today's behavior) | A sparse strip re-flows whenever the user stars or unstars anything, so chip positions are unpredictable. A dense strip is a stable calendar and makes gaps in the plan visible. |
| **One continuous strip**, windowed relative to today | Paging one season week at a time | A season week runs noon Saturday to noon Saturday, so `SeasonCalendar.weekNumbers(spanningDayOf:)` legitimately returns *two* week numbers for a boundary Saturday. Paging would force an arbitrary answer to "which page is Aug 8 on." A continuous strip never has to answer it. |
| Default window **today − 7 … today + 14** | Whole season always visible | The season is 64 days. The near past is worth keeping (what did I go to yesterday), the far past is not, and two weeks forward covers the planning horizon. |
| **One tap per end**, jumping to the season edge, ends independent | Incremental week-at-a-time; single whole-season toggle | Reaching Week 1 from Week 7 should not take six taps, and opening the past should not drag the whole future along. |
| No-today case: **whole season, scrolled to nearest starred day** | Window anchored to the season edge; always park at season start | Off-season or in a past year the relative window is meaningless. A user reviewing last August should not land in June. |
| **Month on every chip** | Month dividers; sticky scrolled month header | Unambiguous wherever the strip is scrolled, needs no scroll-offset observation, and is a pure label function that a unit test can pin. |
| Empty day offers a **day-scoped browse button** | Message only; plain "Browse Events" | An empty day that is a dead end weakens the whole case for showing empty days. Requires a new single-day date filter (§3). |
| Chip signals: **fill = selected, word "Today" = today, star-count line = count, dashed + secondary = empty** | Corner badge + accent ring for today; dots for count | A day can be empty *and* today *and* selected simultaneously. Any scheme that spends fill or stroke color on both "today" and "selected" collides in exactly that case. Moving "today" into the text escapes the collision entirely. |

## 1. `DayWindow` — new pure domain type

New file `ios/ChqCalendarShared/Domain/DayWindow.swift`. Follows `DayPlan`'s
convention: `nonisolated`, no `Date()` or I/O inside, `today` supplied by the
caller.

```swift
nonisolated struct DayWindow: Equatable, Sendable {
    /// Visible day keys, ascending, contiguous.
    let days: [String]
    /// Whether earlier days exist outside `days` and can be revealed.
    let canExpandEarlier: Bool
    /// Whether later days exist outside `days` and can be revealed.
    let canExpandLater: Bool
}
```

Day keys are `"yyyy-MM-dd"` throughout, matching `ChqTime.dayKey`. Lexicographic
string comparison on that format is chronological, so `ClosedRange<String>`
is a correct range type here.

### `bounds(year:starredDays:) -> ClosedRange<String>`

The outer limit of everything the strip can ever show.

- Season component: `ChqTime.dayKey(for:)` of `SeasonCalendar.weeks(forYear:)`'s
  `first.start` through `last.end`. For 2026 that is `2026-06-27` through
  `2026-08-29` — 64 days. `last.end` is an *exclusive* noon-Saturday boundary,
  but that Saturday morning still holds week-9 events, so its day key is
  included.
- **Widened to contain any starred day outside the season.** Lower bound is
  `min(seasonStart, starredDays.first)`, upper is `max(seasonEnd, starredDays.last)`.
  Without this a starred pre-season or post-season event would be permanently
  unreachable from the strip.

### `make(bounds:today:showsEarlier:showsLater:) -> DayWindow`

- **`today ∈ bounds`** — the default slice is `[today − 7, today + 14]`
  clamped to `bounds`. `showsEarlier` extends the lower end to
  `bounds.lowerBound`; `showsLater` extends the upper end to
  `bounds.upperBound`. The two are independent.
  `canExpandEarlier` is `sliceLower > bounds.lowerBound`, and symmetrically
  for `canExpandLater` — so the controls vanish on their own near the season
  edges rather than expanding into nothing.
- **`today ∉ bounds`** — `days` is the whole of `bounds`, and both
  `canExpand` flags are `false`. Nothing is hidden, so no control is offered.
  The `showsEarlier`/`showsLater` inputs are ignored in this branch.

Constants `defaultDaysBefore = 7` and `defaultDaysAfter = 14` are `static let`
on `DayWindow`.

### `defaultSelection(bounds:today:starredDays:) -> String?`

- `starredDays.isEmpty` → `nil`. The view shows its all-season empty state in
  that case, so there is no day to select. This preserves the existing
  `myDayDefaultDayIsNilWithNoFavoritedDays` test.
- `today ∈ bounds` → **`today`, unconditionally — including when today has no
  starred events.** This is the fix for the issue title.
- Otherwise → `DayPlan.defaultDayKey(available: starredDays, now: today)`,
  which already returns the earliest future starred day when today precedes
  them all (the pre-season case) and the latest starred day when today follows
  them all (the post-season and past-year cases). Falls back to the nearer
  bound if that returns `nil`.

`DayPlan.defaultDayKey` is **reused, not replaced**, so its five existing tests
in `DayPlanTests` keep pinning behavior this design still depends on.

### Supporting `ChqTime` helpers

Both pure, both new:

- `day(_ key: String, offsetBy days: Int) -> String?`
- `dayKeys(from: String, through: String) -> [String]`

Arithmetic goes through `ChqTime.calendar` (`startOfDay` + `date(byAdding: .day)`),
never through string manipulation or 86 400-second addition, so the helpers
stay correct across DST transitions. A Chautauqua season never spans one, but
these are general-purpose helpers and are tested against March and November
transitions accordingly.

## 2. `MyDayView`

### Day strip

`ScrollViewReader` wrapping a horizontal `ScrollView` over `window.days`.

`scrollTo(selectedDay, anchor: .center)` fires on first appearance, on every
selection change, and **again after an expansion**. The last case is not
redundant: revealing earlier days prepends items, which shifts the content
under the user's finger; re-scrolling to the same anchor holds the selected
day still, matching the approved behavior that expanding must not move you.

### Chip

Three lines, fixed height:

| Line | Content |
|---|---|
| 1 | `"Today"` when the chip's key equals today's key, otherwise the weekday (`"EEE"`) |
| 2 | `"MMM d"` — e.g. `"Aug 9"` |
| 3 | star glyph + starred count when the count is non-zero; **blank but still occupying its line** when zero, so chip heights never jitter |

State encoding, chosen so all four signals compose:

- **Fill** means *selected* and means nothing else. Selected chips are
  accent-filled with white content.
- **Today** is carried by the word `"Today"` in line 1. Because it lives in the
  text, it survives being selected, being empty, or both, without needing a
  ring that an accent fill would swallow.
- **Empty** is a dashed 1 pt stroke plus `.secondary` content. A selected empty
  chip keeps the dashed stroke, rendered in white over the accent fill, so
  emptiness stays readable while selected.
- **Count** is line 3.

New `ChqTime` labels: `weekdayLabel(for:)` (`"EEE"`) and `monthDayLabel(for:)`
(`"MMM d"`). The existing `compactDayLabel` (`"EEE d"`) is shared with
`GroundsMapView`'s upcoming-events rows and is **not** modified.

VoiceOver label per chip: full day title, then `"today"` when applicable, then
`"3 starred events"` or `"no starred events"`. `.isSelected` trait as today.

### End controls

A chevron chip pinned at each end of the strip, present only when the
corresponding `canExpand` flag is true. Tapping toggles that end; the label
becomes `"Hide"` while expanded. The visible chip stays narrow — the count
lives in the accessibility label (`"Show 42 earlier days"`), not on screen.

`showsEarlier` and `showsLater` are two `@State` booleans. They survive tab
switches for the life of the process but reset on launch, so the app always
reopens on the tight window.

### Selected-day header

Above the existing summary line, which is unchanged:

```
Sunday, August 9   [Today]
3 events · first 9:15 AM · last 8:15 PM
```

The trailing badge reads `Today`, `Tomorrow`, or `Yesterday` and is absent
otherwise. The title includes the year when `model.isCurrentYear` is false,
via a new `ChqTime.dayTitle(for:includingYear:)`. Keying off `isCurrentYear`
rather than comparing against `now()` reuses the signal the rest of the app
already threads through for exactly this distinction.

### Today button

Toolbar, `.topBarTrailing`. Present only when
`bounds.contains(todayKey) && selectedDay != todayKey` — so it is absent in a
past season, where there is no today to return to, and absent when you are
already on today.

### Empty-day state

A `ContentUnavailableView` naming the day, with a `Browse Aug 9 events` action
that calls `AppModel.browseDay(_:)` (§3) and then `switchToEvents()`.

The existing all-season empty state ("Star events to build your day") is
unchanged and still takes precedence whenever nothing at all is starred — a
64-chip strip of uniformly empty days would be worse than the empty state it
replaced.

### Simplification this enables

The strip is now driven by the calendar, not by the favorites set. Unstarring
a day's last event can no longer remove that day from the strip. Two pieces of
machinery exist solely to handle that vanished case and are deleted:

- `MyDayView.nearestDay(to:in:)`
- the `.onChange(of: model.myDayAvailableDays)` hook

`reconcileSelection` collapses to: if the selected day falls outside the
current bounds, reset it to `DayWindow.defaultSelection`. It is driven by
`.task` and by `.onChange(of:)` on the bounds, which change only when the
snapshot or `selectedYear` changes.

### `AppModel` additions

Computed properties alongside the existing `myDayAvailableDays`, so the view
stays free of domain arithmetic:

- `var myDayBounds: ClosedRange<String>?` — `nil` without a snapshot. Season
  bounds are computable from `selectedYear` alone, but before the first
  snapshot lands `selectedYear` is still `AppModel.placeholderYear`, so
  returning `nil` there keeps a placeholder season out of the UI. Mirrors the
  guard `myDayAvailableDays` already uses.
- `func myDayWindow(showsEarlier: Bool, showsLater: Bool) -> DayWindow`
- `var myDayStarredCounts: [String: Int]`
- `var myDayDefaultDay: String?` — reimplemented over `DayWindow.defaultSelection`
- `func browseDay(_ dayKey: String)`

`myDayStarredCounts` is backed by a new
`DayPlan.starredCountsByDay(favorites:events:) -> [String: Int]` that makes
**one** pass over the event list. Calling the existing `dayPlan(for:)` once per
visible chip would mean 22 full passes per render.

## 3. Single-day date filter on the Events tab

The capability the empty-day browse button needs. It does not exist today:
`DateScope` offers `next`, `today`, `thisWeek`, `season`, `all`, plus week
numbers, and none of those name an arbitrary date.

### `DateScope.day`

New case with raw value `"day"` and `label` `"Day"`. The user-facing pill text
comes from `DateFilterLabel`, not from `label`.

### `FilterSelection.selectedDayKey: String?`

**Session-only**, following the precedent `searchText` and `extraDays` already
set: omitted from `UserStateStore.PersistedFilters`, and `saveFilters` writes
`.next` in place of a live `.day` scope. A date pinned three days ago and
silently restored on launch would be worse than no restore.

`isDefault` and `hasDateFilters` need no change — `.day ≠ .next` and
`.day ≠ .all` already produce the right answers.

### `EventFilter`

A `.day` case matching `ChqTime.dayKey(for: $0.start) == sel.selectedDayKey`,
falling through to no filtering when `selectedDayKey` is `nil`.

**`.day` must be exempt from the `isCurrentYear` downgrade.**
`EventFilter.apply` currently reads:

```swift
let scope: DateScope = isCurrentYear ? sel.dateScope : .all
```

That downgrade is correct for `.next`, `.today`, and `.thisWeek`, which are
time-relative and meaningless in a season that has no "now". `.day` names an
absolute date and is meaningful in every season; letting it be downgraded
would silently un-filter the list in exactly the past-season case the button
is most useful for. The line becomes:

```swift
let scope: DateScope = (isCurrentYear || sel.dateScope == .day) ? sel.dateScope : .all
```

### `DateFilterLabel` — needs the same exemption as `EventFilter`

`.day` renders the date itself — `"Sun, Aug 9"`, and `"Sun, Aug 9, 2025"` when
`isCurrentYear` is false. It does not render `"Day"`.

`DateFilterLabel.text` opens its no-weeks branch with:

```swift
guard isCurrentYear else { return "All Year" }
```

That shortcut is correct **only** because every time-relative scope is
downgraded to `.all` for a non-current year, which makes `"All Year"` a true
statement about what the list is showing. `.day` breaks that invariant: it
survives the downgrade, so a past-season day filter would be applied to the
list while the pill claimed `"All Year"` — the pill lying about the filter,
which is the precise failure mode this function's doc comment already warns
about for `.next`. The `.day` case must be handled **before** that guard.

This is the second of exactly two places where `.day`'s absolute-date nature
has to be spelled out. They must agree, and a test pins each.

### `DateFilterSheet.visibleScopes` — unchanged

`.day` is a **derived** scope, never offered in the picker. `visibleScopes` is
a fixed row of presets (`[.next, .today, .season, .all]` for the current year,
`[.all]` otherwise) and an arbitrary date cannot be chosen from a fixed row.
`.day` arrives only from My Day, appears as the date pill, and is cleared by
selecting any other scope.

### `AppModel.browseDay(_ dayKey: String)`

Sets `dateScope = .day` and `selectedDayKey`. Clears `selectedWeeks` — a
standing week filter can exclude the very day the user asked for — and
`extraDays`, which is a `.next`-only concept. Leaves `searchText`,
`selectedLocations`, `selectedCategories`, and `showFavoritesOnly` alone:
those are standing preferences, not date state.

## 4. Testing

Pure-domain tests carry the weight, matching how `DayPlan` is covered.

**`DayWindowTests`** (new)
- bounds widen to contain a starred day outside the season, at each end
- window clamps at the season start, at the season end, and is full-width in
  the middle
- each end expands independently; `canExpand` flags go false at the bounds
- no-today pre-season: whole season, both flags false, selection is the first
  starred day
- no-today post-season: whole season, selection is the last starred day
- **today is selected by default when today has zero starred events** — the
  regression this issue is about
- `defaultSelection` is `nil` when nothing is starred

**`ChqTimeTests`** — `day(_:offsetBy:)` and `dayKeys(from:through:)` across the
March and November DST transitions; `weekdayLabel`, `monthDayLabel`, and
`dayTitle(for:includingYear:)`.

**`EventFilterTests`** — `.day` matches only that NY calendar day; `.day`
survives `isCurrentYear == false`; a `nil` day key filters nothing.

**`DateFilterLabelTests`** — `.day` with and without the year, and
specifically **`.day` with `isCurrentYear == false` returning the date rather
than `"All Year"`**, pinning the exemption against the early guard.

**`UserStateStoreTests`** — a `.day` scope round-trips as `.next`;
`selectedDayKey` is never written to disk.

**`MyDayModelTests`** — `browseDay` sets and clears exactly the intended
fields; `myDayBounds` / `myDayWindow` / `myDayStarredCounts` wiring.

### One existing test changes its expectation

`MyDayModelTests.myDayDefaultDayFallsBackToNextFutureDayWhenTodayIsUnavailable`
pins today's behavior: with `now = 2026-07-17` and starred days on `07-15` and
`07-20`, `myDayDefaultDay` returns `"2026-07-20"`. Under this design it returns
`"2026-07-17"` — today, which is in season and simply has nothing starred.

**That test is asserting the bug this issue reports.** Its expectation, name,
and comment all change together. It is called out here rather than quietly
edited during implementation.

No other existing test changes. In particular `DayPlanTests` is untouched,
because `DayPlan.defaultDayKey` keeps its current contract and is still the
engine for the no-today branch.

## 5. Screenshot obligation

`07-my-day` is a covered shot in `ios/Scripts/screenshot-plan.json` and this
work changes it visibly, so per `CLAUDE.md` the branch must run:

```bash
ios/Scripts/capture-screenshots.sh
python3 ios/Scripts/compose-screenshots.py
```

and commit the updated `docs/app-store/screenshots.manifest.json` and
`docs/app-store/screenshots/review/` copies. `.github/workflows/app-store-assets.yml`
enforces it.

The shot's frozen clock is `2026-07-27 07:00:00` with favorites
`101207,99511,96951` seeded. July 27 2026 is a Monday in Week 5, so the new
window spans `2026-07-20` through `2026-08-10` with both expand controls
visible — a good showcase. Confirm the seeded favorites still land inside that
window; if they do not, the shot will feature three empty days and the seed
list should be revisited as part of the work.

## 6. Out of scope

- **Issue #156** (`extraDays` not reset when the date scope changes). `browseDay`
  zeroing `extraDays` is local correctness for one call site and does not fix
  the general case.
- **Issue #186** (year-aware `browsePastSeason(year:)`). This design handles a
  past season correctly *once selected*, but adds no new way to select one.
- Conflict or walking-gap indicators on the chips themselves. The summary
  header already carries overlap and tight-walk badges for the selected day.
