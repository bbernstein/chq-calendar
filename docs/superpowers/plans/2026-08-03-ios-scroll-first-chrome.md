# iOS Scroll-First Redesign — PR 1 (Chrome) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four-row filter bar above the event list with a floating two-pill capsule at the bottom edge, backed by two sheets, so the scrolling list gets ~150pt of screen back and the collapse driver can be deleted.

**Architecture:** Three pure `Domain` types (label text, badge count, scroll→bar state) carry all the logic and all the tests. The bar itself is an `.overlay(alignment: .bottom)` over a `List` whose bottom content margin is *constant* — the list's geometry never changes when the bar changes state, which is what makes `FilterBarCollapse` unnecessary rather than merely improved. Both pills present detented sheets that filter live.

**Tech Stack:** SwiftUI, Swift 6 (strict concurrency), Swift Testing (`import Testing`, `@Test`, `#expect`), Xcode 26 synchronized folder groups, `xcodebuild` on a simulator.

**Source spec:** `docs/superpowers/specs/2026-08-03-ios-ux-scroll-first-redesign-design.md`

## Global Constraints

- **Deployment target stays `IPHONEOS_DEPLOYMENT_TARGET = 18.0`.** Do not raise it. Do not use any iOS 26 API (`glassEffect`, `GlassEffectContainer`, `.buttonStyle(.glass)`, `scrollEdgeEffect`, `tabBarMinimizeBehavior`).
- **Swift 6 language mode.** Pure domain types are declared `nonisolated` and `Sendable`, matching `EventFilter`, `FacetCounts`, `ActiveFilterChips`. Views and `AppModel` are `@MainActor`.
- **Test framework is Swift Testing, not XCTest.** `import Testing`, tests are methods marked `@Test` inside a plain `struct`, assertions are `#expect(...)`.
- **New `.swift` files under `ios/ChqCalendar/` need no `project.pbxproj` edit** — the target uses a `PBXFileSystemSynchronizedRootGroup`. Deleting a file likewise needs no project edit.
- **CI does not build or test the iOS app.** Every verification step in this plan must be run locally. A green GitHub Actions run proves nothing about this work.
- **Never commit to `main`.** All work lands on `feat/ios-ux-scroll-first-redesign`.
- **Build/test command** (used verbatim throughout):
  ```bash
  cd ios && xcodebuild test \
    -project ChqCalendar.xcodeproj -scheme ChqCalendar \
    -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
    CODE_SIGNING_ALLOWED=NO
  ```
  Narrow to one suite with `-only-testing:ChqCalendarTests/<SuiteName>`.
- **Filtering semantics must not change.** `EventFilterTests`, `EventGroupingTests`, `SeasonCalendarTests`, `UserStateStoreTests` and `AppModelTests` must pass unchanged. A failure in any of them is a regression in this work, not a test to update. If one fails, stop and ask.

## Corrections to the spec

Two things the spec states that the code contradicts. Follow this plan, not the spec, where they differ:

1. The spec says `ActiveFilterChips` must be "extended to include favorites". **It already emits a `.favorites` chip** (`Domain/ActiveFilterChips.swift`). No change is needed there, and no new test is needed for it.
2. The spec lists `WeekStripState` as "retained if the date sheet reuses it". This plan **reuses it** (Task 6), so it and `WeekStripStateTests` stay.

---

### Task 1: `DateFilterLabel` — the date pill's text

**Files:**
- Create: `ios/ChqCalendar/Domain/DateFilterLabel.swift`
- Test: `ios/ChqCalendarTests/DateFilterLabelTests.swift`

**Interfaces:**
- Consumes: `FilterSelection` and `DateScope` from `Data/UserStateStore.swift`.
- Produces: `DateFilterLabel.text(for: FilterSelection, seasonWeekCount: Int) -> String`, used by Task 5's `FloatingFilterBar`.

**Design note to honor:** the label depends only on the selection and the season's week count — **not** on the current week. `FilterChipState` treats "only the current week selected" as equivalent to "This Week", but a summary pill must not render the same selection two different ways depending on today's date. Rule: if `selectedWeeks` is non-empty it wins and produces a week label; otherwise the scope produces the label. `.all` renders as `All Dates`, deliberately *not* `DateScope.all.label` (which is `"All"`), so it cannot be confused with `All Weeks`.

- [ ] **Step 1: Write the failing test**

Create `ios/ChqCalendarTests/DateFilterLabelTests.swift`:

```swift
import Testing
@testable import ChqCalendar

struct DateFilterLabelTests {
    private let nine = 9

    @Test func scopeOnlyLabels() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .next), seasonWeekCount: nine) == "Now")
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .today), seasonWeekCount: nine) == "Today")
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .thisWeek), seasonWeekCount: nine) == "This Week")
    }

    @Test func allScopeReadsAllDatesNotAll() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all), seasonWeekCount: nine) == "All Dates")
    }

    @Test func singleWeekIsSingular() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [6]),
            seasonWeekCount: nine) == "Week 6")
    }

    @Test func contiguousRunUsesEnDash() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [4, 5, 6]),
            seasonWeekCount: nine) == "Weeks 4\u{2013}6")
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [2, 3]),
            seasonWeekCount: nine) == "Weeks 2\u{2013}3")
    }

    @Test func scatteredUpToThreeAreListed() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [3, 6, 8]),
            seasonWeekCount: nine) == "Weeks 3, 6, 8")
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [1, 9]),
            seasonWeekCount: nine) == "Weeks 1, 9")
    }

    @Test func scatteredFourOrMoreCollapseToACount() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [1, 3, 5, 7]),
            seasonWeekCount: nine) == "4 Weeks")
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [1, 2, 3, 5, 9]),
            seasonWeekCount: nine) == "5 Weeks")
    }

    @Test func everyWeekReadsAllWeeks() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: Set(1...9)),
            seasonWeekCount: nine) == "All Weeks")
    }

    @Test func fullContiguousRunShorterThanTheSeasonIsStillARange() {
        // 1...8 of 9 is contiguous but not "all" — must not read "All Weeks".
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: Set(1...8)),
            seasonWeekCount: nine) == "Weeks 1\u{2013}8")
    }

    @Test func weeksWinOverScope() {
        // Both set is not reachable through AppModel today, but the label
        // must still be deterministic if it ever becomes reachable.
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .thisWeek, selectedWeeks: [2]),
            seasonWeekCount: nine) == "Week 2")
    }

    @Test func labelIsIndependentOfTheCurrentDate() {
        // Deliberate: no `currentWeek` parameter exists, so the same
        // selection can never render two different ways.
        let selection = FilterSelection(dateScope: .all, selectedWeeks: [6])
        #expect(DateFilterLabel.text(for: selection, seasonWeekCount: nine) == "Week 6")
        #expect(DateFilterLabel.text(for: selection, seasonWeekCount: 9) == "Week 6")
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  CODE_SIGNING_ALLOWED=NO \
  -only-testing:ChqCalendarTests/DateFilterLabelTests
```

Expected: **compile failure** — `cannot find 'DateFilterLabel' in scope`.

- [ ] **Step 3: Write the implementation**

Create `ios/ChqCalendar/Domain/DateFilterLabel.swift`:

```swift
import Foundation

/// The text shown on the calendar's date pill — a one-glance summary of
/// whatever date range is currently narrowing the list.
///
/// Depends on the selection and the season's week count and **nothing
/// else**. In particular it does not take the current week, even though
/// `FilterChipState` treats "only the current week is selected" as
/// equivalent to the `.thisWeek` scope. That equivalence is right for
/// deciding which *chips* light up; it is wrong for a summary label, where
/// it would mean one selection renders as "This Week" in July and "Week 6"
/// in September. A pill that changes its wording without the user touching
/// anything is worse than a pill that is merely less clever.
///
/// `.all` renders as "All Dates" rather than `DateScope.all.label`
/// ("All") so it cannot be misread against "All Weeks": the first means no
/// date filter at all, the second means every week explicitly selected.
nonisolated enum DateFilterLabel {
    /// Above this many scattered weeks, the list stops being scannable and
    /// a count is more honest than an enumeration.
    private static let maxListedWeeks = 3

    static func text(for selection: FilterSelection, seasonWeekCount: Int) -> String {
        let weeks = selection.selectedWeeks.sorted()

        guard !weeks.isEmpty else {
            switch selection.dateScope {
            case .all: return "All Dates"
            case .next, .today, .thisWeek: return selection.dateScope.label
            }
        }

        if weeks.count == seasonWeekCount, weeks == Array(1...seasonWeekCount) {
            return "All Weeks"
        }

        if weeks.count == 1 {
            return "Week \(weeks[0])"
        }

        if isContiguous(weeks) {
            return "Weeks \(weeks[0])\u{2013}\(weeks[weeks.count - 1])"
        }

        if weeks.count <= maxListedWeeks {
            return "Weeks " + weeks.map(String.init).joined(separator: ", ")
        }

        return "\(weeks.count) Weeks"
    }

    /// `sorted` is assumed sorted ascending and free of duplicates, which a
    /// `Set<Int>.sorted()` always is.
    private static func isContiguous(_ sorted: [Int]) -> Bool {
        guard let first = sorted.first, let last = sorted.last else { return false }
        return last - first + 1 == sorted.count
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Same command as Step 2. Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add ios/ChqCalendar/Domain/DateFilterLabel.swift ios/ChqCalendarTests/DateFilterLabelTests.swift
git commit -m "feat(ios): DateFilterLabel — date pill summary text

Pure selection -> string, with rules for the cases a naive join gets
wrong: contiguous runs collapse to an en-dash range, four or more
scattered weeks collapse to a count, and all nine reads 'All Weeks'
(distinct from 'All Dates', which means no date filter at all).

Deliberately takes no current-week parameter so one selection can never
render two different ways depending on today's date."
```

---

### Task 2: `ActiveFilterCount` — the filter pill's badge

**Files:**
- Create: `ios/ChqCalendar/Domain/ActiveFilterCount.swift`
- Test: `ios/ChqCalendarTests/ActiveFilterCountTests.swift`

**Interfaces:**
- Consumes: `FilterSelection`.
- Produces: `ActiveFilterCount.value(for: FilterSelection) -> Int`, used by Task 5's `FloatingFilterBar`.

**Design note:** date scope and weeks are excluded — they have their own pill. Favorites-only *is* counted, which is the whole reason `AppModel.toggleFavoritesOnly` is moving into the sheet (spec D6): if favorites could be on while the badge read `2`, the badge would be lying. The search term counts as one, trimmed, matching `FilterSelection.hasNonDateFilters`.

- [ ] **Step 1: Write the failing test**

Create `ios/ChqCalendarTests/ActiveFilterCountTests.swift`:

```swift
import Testing
@testable import ChqCalendar

struct ActiveFilterCountTests {
    @Test func defaultSelectionCountsZero() {
        #expect(ActiveFilterCount.value(for: FilterSelection()) == 0)
    }

    @Test func dateScopeAndWeeksNeverCount() {
        // Both have their own pill; counting them would double-report.
        #expect(ActiveFilterCount.value(
            for: FilterSelection(dateScope: .today)) == 0)
        #expect(ActiveFilterCount.value(
            for: FilterSelection(dateScope: .all, selectedWeeks: [1, 2, 3])) == 0)
    }

    @Test func eachVenueAndCategoryCountsOnce() {
        #expect(ActiveFilterCount.value(for: FilterSelection(
            selectedLocations: ["Amphitheater", "Norton Hall"])) == 2)
        #expect(ActiveFilterCount.value(for: FilterSelection(
            selectedCategories: ["Music"])) == 1)
    }

    @Test func favoritesOnlyCountsOne() {
        #expect(ActiveFilterCount.value(
            for: FilterSelection(showFavoritesOnly: true)) == 1)
    }

    @Test func searchTermCountsOnceRegardlessOfWordCount() {
        #expect(ActiveFilterCount.value(
            for: FilterSelection(searchText: "burns")) == 1)
        #expect(ActiveFilterCount.value(
            for: FilterSelection(searchText: "ken burns lecture")) == 1)
    }

    @Test func whitespaceOnlySearchDoesNotCount() {
        // Matches FilterSelection.hasNonDateFilters, which trims.
        #expect(ActiveFilterCount.value(for: FilterSelection(searchText: "   ")) == 0)
        #expect(ActiveFilterCount.value(for: FilterSelection(searchText: "\n\t")) == 0)
    }

    @Test func contributorsSum() {
        let selection = FilterSelection(
            searchText: "burns",
            dateScope: .all,
            selectedWeeks: [4, 5],
            selectedLocations: ["Amphitheater", "Norton Hall"],
            selectedCategories: ["Music"],
            showFavoritesOnly: true)
        // 1 search + 2 venues + 1 category + 1 favorites; weeks excluded.
        #expect(ActiveFilterCount.value(for: selection) == 5)
    }

    @Test func agreesWithHasNonDateFilters() {
        // The badge is visible exactly when the reset affordance would be.
        let cases = [
            FilterSelection(),
            FilterSelection(searchText: "x"),
            FilterSelection(searchText: "  "),
            FilterSelection(dateScope: .all, selectedWeeks: [2]),
            FilterSelection(selectedLocations: ["Amphitheater"]),
            FilterSelection(showFavoritesOnly: true),
        ]
        for selection in cases {
            #expect((ActiveFilterCount.value(for: selection) > 0) == selection.hasNonDateFilters)
        }
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  CODE_SIGNING_ALLOWED=NO \
  -only-testing:ChqCalendarTests/ActiveFilterCountTests
```

Expected: **compile failure** — `cannot find 'ActiveFilterCount' in scope`.

- [ ] **Step 3: Write the implementation**

Create `ios/ChqCalendar/Domain/ActiveFilterCount.swift`:

```swift
import Foundation

/// How many filters the filter pill's badge reports.
///
/// Date scope and week selection are excluded: they are summarised by the
/// date pill sitting next to it, and counting them in both places would
/// double-report one decision.
///
/// Everything else is included, favorites-only especially. That inclusion
/// is why favorites moved off the bar and into the filter sheet — a single
/// number is only worth showing if it accounts for every filter that can
/// narrow the list, and a favorites toggle living outside the count would
/// make the badge quietly wrong.
///
/// The search term counts once however many words it has, and is trimmed
/// first so a whitespace-only term — which matches everything and produces
/// no chip — does not register. Both rules match
/// `FilterSelection.hasNonDateFilters`, and a test pins the two together.
nonisolated enum ActiveFilterCount {
    static func value(for selection: FilterSelection) -> Int {
        var count = selection.selectedLocations.count + selection.selectedCategories.count
        if !selection.searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            count += 1
        }
        if selection.showFavoritesOnly {
            count += 1
        }
        return count
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Same command as Step 2. Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add ios/ChqCalendar/Domain/ActiveFilterCount.swift ios/ChqCalendarTests/ActiveFilterCountTests.swift
git commit -m "feat(ios): ActiveFilterCount — filter pill badge count

Counts venues, categories, a trimmed search term, and favorites-only;
excludes date scope and weeks, which the adjacent date pill summarises.

Pinned against FilterSelection.hasNonDateFilters so the badge appears
exactly when a non-date filter is narrowing the list."
```

---

### Task 3: `BarPresentation` — scroll direction to bar state

**Files:**
- Create: `ios/ChqCalendar/Domain/BarPresentation.swift`
- Test: `ios/ChqCalendarTests/BarPresentationTests.swift`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `enum BarState: Equatable, Sendable { case expanded, compact }`
  - `struct BarPresentation: Equatable, Sendable` with `var state: BarState { get }` and `mutating func received(offset: CGFloat, insetTop: CGFloat) -> BarState?` — returns the new state **only when it changed**, `nil` otherwise. Used by Task 9's `EventListView`.

**Design note — why this is trivial compared to `FilterBarCollapse`:** that type had to distrust its own input, because collapsing changed the list's height, which changed the geometry it was reading, which could re-trigger a collapse. Here the bar is an overlay over a list whose content margin is constant, so **no state this type returns can change the geometry it reads**. There is no settle window, no measured give-back, no oscillation to defend against. Keep it that simple; if a step here starts to feel like it needs a settling flag, something upstream has been built wrong.

- [ ] **Step 1: Write the failing test**

Create `ios/ChqCalendarTests/BarPresentationTests.swift`:

```swift
import Testing
import CoreGraphics
@testable import ChqCalendar

struct BarPresentationTests {
    @Test func startsExpanded() {
        let bar = BarPresentation()
        #expect(bar.state == .expanded)
    }

    @Test func smallScrollDownDoesNotCompact() {
        var bar = BarPresentation()
        _ = bar.received(offset: 0, insetTop: 0)
        #expect(bar.received(offset: 20, insetTop: 0) == nil)
        #expect(bar.state == .expanded)
    }

    @Test func accumulatedScrollDownPastThresholdCompacts() {
        var bar = BarPresentation()
        _ = bar.received(offset: 0, insetTop: 0)
        #expect(bar.received(offset: 20, insetTop: 0) == nil)
        #expect(bar.received(offset: 45, insetTop: 0) == .compact)
        #expect(bar.state == .compact)
    }

    @Test func repeatedDownwardSamplesAfterCompactingReturnNil() {
        var bar = BarPresentation()
        _ = bar.received(offset: 0, insetTop: 0)
        _ = bar.received(offset: 100, insetTop: 0)
        #expect(bar.state == .compact)
        #expect(bar.received(offset: 200, insetTop: 0) == nil)
        #expect(bar.received(offset: 300, insetTop: 0) == nil)
    }

    @Test func scrollingBackUpPastThresholdExpands() {
        var bar = BarPresentation()
        _ = bar.received(offset: 0, insetTop: 0)
        _ = bar.received(offset: 400, insetTop: 0)
        #expect(bar.state == .compact)
        #expect(bar.received(offset: 380, insetTop: 0) == nil)
        #expect(bar.received(offset: 355, insetTop: 0) == .expanded)
    }

    @Test func directionChangeResetsAccumulation() {
        var bar = BarPresentation()
        _ = bar.received(offset: 0, insetTop: 0)
        // 30 down — not enough.
        #expect(bar.received(offset: 30, insetTop: 0) == nil)
        // 10 up — resets the downward accumulation.
        #expect(bar.received(offset: 20, insetTop: 0) == nil)
        // 30 down again is only 30 from the reversal point, still not enough.
        #expect(bar.received(offset: 50, insetTop: 0) == nil)
        #expect(bar.state == .expanded)
    }

    @Test func reachingTheTopForcesExpandedRegardlessOfAccumulation() {
        var bar = BarPresentation()
        _ = bar.received(offset: 0, insetTop: 0)
        _ = bar.received(offset: 500, insetTop: 0)
        #expect(bar.state == .compact)
        // A jump straight to the top (scroll-to-top tap) expands immediately,
        // without needing `threshold` points of upward travel first.
        #expect(bar.received(offset: 0, insetTop: 0) == .expanded)
    }

    @Test func rubberBandAboveTheTopIsTreatedAsTheTop() {
        var bar = BarPresentation()
        _ = bar.received(offset: 0, insetTop: 0)
        _ = bar.received(offset: 500, insetTop: 0)
        #expect(bar.received(offset: -60, insetTop: 0) == .expanded)
    }

    @Test func topIsMeasuredAgainstTheContentInsetNotZero() {
        // A List under a nav bar reports a negative resting offset equal to
        // -insetTop; that resting position is "the top", not offset 0.
        var bar = BarPresentation()
        _ = bar.received(offset: -140, insetTop: 140)
        _ = bar.received(offset: 400, insetTop: 140)
        #expect(bar.state == .compact)
        #expect(bar.received(offset: -140, insetTop: 140) == .expanded)
    }

    @Test func firstSampleNeverChangesState() {
        // Nothing to compare against yet, so no delta can be computed.
        var bar = BarPresentation()
        #expect(bar.received(offset: 900, insetTop: 0) == nil)
        #expect(bar.state == .expanded)
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  CODE_SIGNING_ALLOWED=NO \
  -only-testing:ChqCalendarTests/BarPresentationTests
```

Expected: **compile failure** — `cannot find 'BarPresentation' in scope`.

- [ ] **Step 3: Write the implementation**

Create `ios/ChqCalendar/Domain/BarPresentation.swift`:

```swift
import CoreGraphics

/// Whether the floating filter bar shows full labels or shrinks to icons.
nonisolated enum BarState: Equatable, Sendable {
    case expanded
    case compact
}

/// Turns a stream of scroll offsets into `BarState` changes.
///
/// Compare with the `FilterBarCollapseDriver` this replaces, which had to
/// distrust its own input: that bar was a `safeAreaInset`, so collapsing it
/// changed the list's height, which changed the geometry it was reading,
/// which could re-trigger a collapse. Hence its settle window, its measured
/// give-back, and its refusal to act on lists that barely overflow.
///
/// None of that applies here. The bar is an overlay over a list whose bottom
/// content margin is a constant, so **no state this type returns can change
/// the geometry it reads**. Direction plus a threshold is genuinely the whole
/// algorithm. If this ever seems to need a settling flag, the bar has stopped
/// being an overlay and the fix belongs upstream, not here.
nonisolated struct BarPresentation: Equatable, Sendable {
    /// How far the user must travel in one direction before the bar reacts.
    /// Small enough to feel responsive, large enough that a finger tremor or
    /// a bounce at the end of a fling does not toggle it.
    static let threshold: CGFloat = 40

    private(set) var state: BarState = .expanded

    /// `nil` until the first sample — the first offset establishes a
    /// reference point and can produce no delta.
    private var lastOffset: CGFloat?

    /// Signed distance travelled since the last direction change. Positive
    /// is scrolling further into the content.
    private var accumulated: CGFloat = 0

    init() {}

    /// Feeds one scroll sample. Returns the new state if it changed, `nil`
    /// otherwise, so callers only animate on an actual transition.
    ///
    /// `insetTop` is the list's top content inset: a `List` at rest under a
    /// navigation bar reports `contentOffset.y == -insetTop`, not `0`, so
    /// "at the top" has to be measured against the inset rather than zero.
    mutating func received(offset: CGFloat, insetTop: CGFloat) -> BarState? {
        defer { lastOffset = offset }

        // At (or rubber-banded above) the top, the bar is always whole —
        // immediately, without waiting for `threshold` points of travel, so
        // that a scroll-to-top tap lands with the bar already expanded.
        if offset <= -insetTop {
            accumulated = 0
            return transition(to: .expanded)
        }

        guard let lastOffset else { return nil }

        let delta = offset - lastOffset
        guard delta != 0 else { return nil }

        // A reversal restarts the measurement from here, so 30pt down then
        // 30pt down again with a pause between them does not silently add up
        // to a collapse the user never asked for.
        if (delta > 0) != (accumulated > 0) {
            accumulated = 0
        }
        accumulated += delta

        if accumulated >= Self.threshold {
            return transition(to: .compact)
        }
        if accumulated <= -Self.threshold {
            return transition(to: .expanded)
        }
        return nil
    }

    private mutating func transition(to next: BarState) -> BarState? {
        guard state != next else { return nil }
        state = next
        accumulated = 0
        return next
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Same command as Step 2. Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add ios/ChqCalendar/Domain/BarPresentation.swift ios/ChqCalendarTests/BarPresentationTests.swift
git commit -m "feat(ios): BarPresentation — scroll direction to bar state

Direction plus a 40pt threshold, with reversals resetting accumulation
and the top of the list forcing expanded immediately.

Deliberately far simpler than the FilterBarCollapseDriver it replaces:
that type needed a settle window because collapsing a safeAreaInset
changed the geometry it was reading. An overlay over a constant content
margin cannot do that, so there is nothing to defend against."
```

---

### Task 4: Selection-aware `FacetCounts` (#152)

**Files:**
- Modify: `ios/ChqCalendar/Domain/FacetCounts.swift` (replace `build(from:)`)
- Modify: `ios/ChqCalendar/App/AppModel.swift:35-45` (recompute on filter/favorites/year change), `:375-381` (`count(for:in:)` unchanged in signature)
- Modify: `ios/ChqCalendarTests/FacetCountsTests.swift`

**Interfaces:**
- Consumes: `EventFilter.apply(_:to:favorites:now:year:isCurrentYear:)`, `FilterSelection`, `FilterFacet`.
- Produces: `FacetCounts.build(events:selection:favorites:now:year:isCurrentYear:) -> FacetCounts`. `AppModel.count(for:in:)` keeps its existing signature, so no call site changes.

**Design note — exclude each facet's own dimension.** A venue count must be computed with every filter applied *except* the venue selection. Otherwise, with Amphitheater selected, every other venue reports 0 and a second venue can never be added — the counts would actively prevent the multi-select they exist to inform. This is the standard faceted-search rule and it is the single easiest thing to get wrong in this task.

- [ ] **Step 1: Write the failing test**

Replace the contents of `ios/ChqCalendarTests/FacetCountsTests.swift`:

```swift
import Testing
import Foundation
@testable import ChqCalendar

struct FacetCountsTests {
    /// A fixed instant inside the 2026 season. `isCurrentYear: false` is
    /// passed everywhere below, which forces `EventFilter` to treat any
    /// time-relative scope as `.all` — so these tests exercise the facet
    /// logic without depending on the wall clock.
    private func date(_ string: String) throws -> Date {
        try #require(ChqTime.parse(string))
    }

    private func sample() throws -> [Event] {
        [
            makeEvent(id: "1", start: try date("2026-07-01 10:00:00"),
                      title: "Event 1", location: "Amphitheater", categories: ["Music"]),
            makeEvent(id: "2", start: try date("2026-07-02 10:00:00"),
                      title: "Event 2", location: "Amphitheater", categories: ["Lectures"]),
            makeEvent(id: "3", start: try date("2026-07-03 10:00:00"),
                      title: "Event 3", location: "Norton Hall", categories: ["Music"]),
            makeEvent(id: "4", start: try date("2026-08-10 10:00:00"),
                      title: "Event 4", location: "Norton Hall", categories: ["Opera"]),
            makeEvent(id: "5", start: try date("2026-08-11 10:00:00"),
                      title: "Event 5", location: "Bratton Theater", categories: ["Theater"]),
        ]
    }

    private func counts(
        _ selection: FilterSelection,
        favorites: Set<String> = []
    ) throws -> FacetCounts {
        FacetCounts.build(
            events: try sample(),
            selection: selection,
            favorites: favorites,
            now: try date("2026-07-01 09:00:00"),
            year: 2026,
            isCurrentYear: false)
    }

    @Test func unfilteredCountsEveryEvent() throws {
        let c = try counts(FilterSelection(dateScope: .all))
        #expect(c.locations["amphitheater"] == 2)
        #expect(c.locations["norton hall"] == 2)
        #expect(c.locations["bratton theater"] == 1)
        #expect(c.categories["music"] == 2)
    }

    @Test func anotherFacetNarrowsTheCounts() throws {
        // This is #152's repro shape: a category selection must move the
        // venue numbers.
        let c = try counts(FilterSelection(dateScope: .all, selectedCategories: ["Music"]))
        #expect(c.locations["amphitheater"] == 1)
        #expect(c.locations["norton hall"] == 1)
        #expect(c.locations["bratton theater"] == nil || c.locations["bratton theater"] == 0)
    }

    @Test func aFacetDoesNotNarrowItself() throws {
        // With Amphitheater selected, other venues must still report the
        // counts they would add — otherwise a second venue could never be
        // picked, because every alternative would read 0.
        let c = try counts(FilterSelection(dateScope: .all, selectedLocations: ["Amphitheater"]))
        #expect(c.locations["amphitheater"] == 2)
        #expect(c.locations["norton hall"] == 2)
        #expect(c.locations["bratton theater"] == 1)
    }

    @Test func aFacetStillNarrowsTheOtherFacet() throws {
        // The venue selection is excluded from venue counts but not from
        // category counts.
        let c = try counts(FilterSelection(dateScope: .all, selectedLocations: ["Amphitheater"]))
        #expect(c.categories["music"] == 1)
        #expect(c.categories["lectures"] == 1)
        #expect(c.categories["opera"] == nil || c.categories["opera"] == 0)
    }

    @Test func searchNarrowsBothFacets() throws {
        let c = try counts(FilterSelection(searchText: "Event 1", dateScope: .all))
        #expect(c.locations["amphitheater"] == 1)
        #expect(c.locations["norton hall"] == nil || c.locations["norton hall"] == 0)
    }

    @Test func favoritesOnlyNarrowsBothFacets() throws {
        let c = try counts(
            FilterSelection(dateScope: .all, showFavoritesOnly: true),
            favorites: ["1"])
        #expect(c.locations["amphitheater"] == 1)
        #expect(c.categories["music"] == 1)
        #expect(c.locations["norton hall"] == nil || c.locations["norton hall"] == 0)
    }

    @Test func keysAreLowercasedOnBothFacets() throws {
        let c = try counts(FilterSelection(dateScope: .all))
        #expect(c.locations["Amphitheater"] == nil)
        #expect(c.locations["amphitheater"] != nil)
    }

    @Test func emptyEventsProduceEmptyCounts() throws {
        let c = FacetCounts.build(
            events: [],
            selection: FilterSelection(dateScope: .all),
            favorites: [],
            now: try date("2026-07-01 09:00:00"),
            year: 2026,
            isCurrentYear: false)
        #expect(c == .empty)
    }
}
```

> `makeEvent(id:start:title:location:categories:...)` is a **free function** in `ios/ChqCalendarTests/TestSupport.swift` (not a static on a type), and `ChqTime.parse(_:)` returns an optional `Date` — hence `try #require(...)` and the throwing test methods. Do not add a second event-construction helper.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  CODE_SIGNING_ALLOWED=NO \
  -only-testing:ChqCalendarTests/FacetCountsTests
```

Expected: **compile failure** — `build(from:)` has no `selection:` parameter.

- [ ] **Step 3: Rewrite `FacetCounts`**

Replace `ios/ChqCalendar/Domain/FacetCounts.swift` entirely:

```swift
import Foundation

/// How many events each venue and category would contribute, **given every
/// other filter currently active**.
///
/// Keys are lowercased on both sides: locations key on lowercased
/// `displayLocation`, categories on `filterTokens` (already lowercased) —
/// exactly what `EventFilter` compares against, so a name with a count here
/// is always a name `EventFilter` can match, and vice versa.
///
/// Each facet is counted against the selection **with its own dimension
/// removed**. This is the standard faceted-search rule and it is load-
/// bearing: counting venues with the venue selection applied would make
/// every unselected venue read 0 the moment one was picked, so the numbers
/// would prevent the multi-select they exist to inform.
///
/// Earlier versions counted the unfiltered snapshot once and never
/// recomputed, which is why Week 6 + Amphitheater could show a category
/// count of 1302 — the season-wide total (issue #152). Recomputing is two
/// `EventFilter.apply` passes per rebuild, so `AppModel` rebuilds only when
/// the selection, favorites, or loaded snapshot actually changes, never per
/// render.
nonisolated struct FacetCounts: Equatable, Sendable {
    let locations: [String: Int]
    let categories: [String: Int]

    static let empty = FacetCounts(locations: [:], categories: [:])

    static func build(
        events: [Event],
        selection: FilterSelection,
        favorites: Set<String>,
        now: Date,
        year: Int,
        isCurrentYear: Bool
    ) -> FacetCounts {
        func filtered(_ sel: FilterSelection) -> [Event] {
            EventFilter.apply(
                sel,
                to: events,
                favorites: favorites,
                now: now,
                year: year,
                isCurrentYear: isCurrentYear)
        }

        var withoutLocations = selection
        withoutLocations.selectedLocations = []
        var locations: [String: Int] = [:]
        for event in filtered(withoutLocations) {
            if let location = event.displayLocation?.lowercased() {
                locations[location, default: 0] += 1
            }
        }

        var withoutCategories = selection
        withoutCategories.selectedCategories = []
        var categories: [String: Int] = [:]
        for event in filtered(withoutCategories) {
            for token in event.filterTokens {
                categories[token, default: 0] += 1
            }
        }

        return FacetCounts(locations: locations, categories: categories)
    }
}
```

- [ ] **Step 4: Rebuild counts from `AppModel` whenever inputs change**

In `ios/ChqCalendar/App/AppModel.swift`, replace the `snapshot` property and the `facetCounts` declaration (currently lines 35–45), and add observers to `filter`, `favorites`, `selectedYear`, and `defaultYear`:

```swift
    var snapshot: CalendarSnapshot? {
        didSet {
            normalizePersistedFilterCasing()
            rebuildFacetCounts()
        }
    }

    /// Per-venue / per-category event counts for the current selection.
    ///
    /// Rebuilt only when an input actually changes — the snapshot, the
    /// filter, the favorites set, or the year — never on render. Each
    /// rebuild is two `EventFilter.apply` passes over the snapshot (see
    /// `FacetCounts`), which is affordable at that cadence and would not be
    /// per-render.
    private(set) var facetCounts: FacetCounts = .empty

    var filter: FilterSelection {
        didSet {
            guard filter != oldValue else { return }
            rebuildFacetCounts()
        }
    }

    var favorites: Set<String> {
        didSet {
            guard favorites != oldValue else { return }
            rebuildFacetCounts()
        }
    }

    var selectedYear: Int {
        didSet {
            guard selectedYear != oldValue else { return }
            rebuildFacetCounts()
        }
    }

    var defaultYear: Int {
        didSet {
            guard defaultYear != oldValue else { return }
            rebuildFacetCounts()
        }
    }
```

Delete the old `var filter: FilterSelection`, `var favorites: Set<String>`, `var selectedYear: Int`, and `var defaultYear: Int` declarations (currently lines 51–55) so they are not declared twice.

Then add this private method next to `persistFilter()`:

```swift
    /// Recomputes `facetCounts` against the current selection.
    ///
    /// `normalizePersistedFilterCasing()` can mutate `filter`, whose own
    /// `didSet` calls back into here — so loading a snapshot may rebuild
    /// twice. That is one extra pass, once, on snapshot load; the result is
    /// identical either way, and suppressing it would need a re-entrancy
    /// flag that costs more clarity than the pass costs time.
    private func rebuildFacetCounts() {
        guard let snapshot else {
            facetCounts = .empty
            return
        }
        facetCounts = FacetCounts.build(
            events: snapshot.events,
            selection: filter,
            favorites: favorites,
            now: now(),
            year: selectedYear,
            isCurrentYear: isCurrentYear)
    }
```

- [ ] **Step 5: Run the full suite**

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  CODE_SIGNING_ALLOWED=NO
```

Expected: `FacetCountsTests` passes, and **`AppModelTests`, `EventFilterTests`, `UserStateStoreTests` still pass unchanged**. If an `AppModelTests` case fails on a count value, read it carefully: a test asserting a season-wide total is now asserting the old bug and should be updated *with a note in the commit message*; a test asserting filtering behavior failing means this task broke something and must be fixed, not edited. If you cannot tell which, stop and ask.

- [ ] **Step 6: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add ios/ChqCalendar/Domain/FacetCounts.swift ios/ChqCalendar/App/AppModel.swift ios/ChqCalendarTests/FacetCountsTests.swift
git commit -m "fix(ios): facet counts respect the current selection (#152)

Counts were built once from the unfiltered snapshot, so Week 6 +
Amphitheater still reported the season-wide category total. They are now
rebuilt from EventFilter whenever the snapshot, selection, favorites, or
year changes.

Each facet is counted with its own dimension removed from the selection.
Counting venues with the venue selection applied would make every
unselected venue read 0 as soon as one was picked, so the numbers would
block the multi-select they exist to inform."
```

---

### Task 5: `ChromeSurface` and `FloatingFilterBar`

**Files:**
- Create: `ios/ChqCalendar/Features/Chrome/ChromeSurface.swift`
- Create: `ios/ChqCalendar/Features/Chrome/FloatingFilterBar.swift`

**Interfaces:**
- Consumes: `DateFilterLabel.text(for:seasonWeekCount:)` (Task 1), `ActiveFilterCount.value(for:)` (Task 2), `BarState` (Task 3).
- Produces:
  - `View.chromeSurface() -> some View` — the single definition of the app's chrome material and shape.
  - `FloatingFilterBar(dateLabel: String, filterCount: Int, state: BarState, onDate: () -> Void, onFilters: () -> Void)`. Deliberately takes plain values rather than `AppModel`, so it renders in a `#Preview` and has no `@MainActor` model dependency.

**Design note — this is the Liquid Glass seam.** Every chrome surface in the app goes through `chromeSurface()`. When the deployment target reaches iOS 26, adopting Liquid Glass is an edit to that one function behind an `@available` check, and no call site changes. Do not scatter `.regularMaterial` anywhere else.

- [ ] **Step 1: Write `ChromeSurface`**

Create `ios/ChqCalendar/Features/Chrome/ChromeSurface.swift`:

```swift
import SwiftUI

/// The one place the app's floating-chrome material and shape are defined.
///
/// Liquid Glass (`glassEffect`, `GlassEffectContainer`) is an iOS 26 API and
/// this app's deployment target is 18.0, so chrome ships on
/// `.regularMaterial` in a capsule. That is a temporary state, and this
/// modifier exists so it is a *cheap* temporary state: when the floor moves
/// to 26, glass is adopted by editing this function behind an `@available`
/// check, and not one call site changes.
///
/// Nothing else in the app should reach for a chrome material directly.
extension View {
    func chromeSurface() -> some View {
        self
            .background(.regularMaterial, in: Capsule())
            .overlay(
                Capsule().strokeBorder(.separator.opacity(0.6), lineWidth: 0.5))
            .shadow(color: .black.opacity(0.14), radius: 10, y: 4)
    }
}
```

- [ ] **Step 2: Write `FloatingFilterBar`**

Create `ios/ChqCalendar/Features/Chrome/FloatingFilterBar.swift`:

```swift
import SwiftUI

/// The app's entire standing chrome: two pills in a capsule floating over
/// the event list.
///
/// Takes plain values rather than `AppModel` so it previews without a model
/// and so its two states can be eyeballed side by side.
///
/// The two states differ in **label text and width only — never in height**.
/// That is not cosmetic: `EventListView` reserves a constant bottom content
/// margin for this bar, and a height change here would move the list under
/// the user mid-scroll, which is exactly the failure mode the previous
/// `safeAreaInset` bar had. A 44pt minimum is also the accessibility floor
/// for a touch target, so the constraint costs nothing.
struct FloatingFilterBar: View {
    let dateLabel: String
    let filterCount: Int
    let state: BarState
    let onDate: () -> Void
    let onFilters: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            // The date label never abbreviates, in either state: it is
            // precisely the thing a scrolling user wants to keep reading.
            // Only the filter pill gives up its word.
            BarPill(
                systemImage: "calendar",
                label: dateLabel,
                badge: nil,
                isProminent: true,
                action: onDate)
                .accessibilityLabel("Date range: \(dateLabel). Double tap to change.")

            BarPill(
                systemImage: "line.3.horizontal.decrease",
                label: state == .expanded ? "Filters" : nil,
                badge: filterCount > 0 ? filterCount : nil,
                isProminent: false,
                action: onFilters)
                .accessibilityLabel(filtersAccessibilityLabel)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .chromeSurface()
        .padding(.bottom, 10)
    }

    private var filtersAccessibilityLabel: String {
        filterCount == 0
            ? "Filters, none active. Double tap to change."
            : "Filters, \(filterCount) active. Double tap to change."
    }
}

/// One pill in the bar. `label` is optional so the compact state can drop
/// the word without changing the pill's height.
private struct BarPill: View {
    let systemImage: String
    let label: String?
    let badge: Int?
    let isProminent: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: systemImage)
                    .font(.footnote.weight(.semibold))
                if let label {
                    Text(label)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                }
                if let badge {
                    Text("\(badge)")
                        .font(.caption2.weight(.bold))
                        .monospacedDigit()
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(badgeBackground, in: Capsule())
                        .foregroundStyle(badgeForeground)
                }
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .foregroundStyle(isProminent ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            .background(
                isProminent
                    ? AnyShapeStyle(Color.accentColor)
                    : AnyShapeStyle(.quaternary),
                in: Capsule())
        }
        .buttonStyle(.plain)
        .contentTransition(.identity)
    }

    private var badgeBackground: AnyShapeStyle {
        isProminent ? AnyShapeStyle(.white.opacity(0.3)) : AnyShapeStyle(Color.accentColor)
    }

    private var badgeForeground: AnyShapeStyle {
        isProminent ? AnyShapeStyle(.white) : AnyShapeStyle(.white)
    }
}

#Preview("Expanded") {
    ZStack {
        Color.gray.opacity(0.3)
        VStack {
            Spacer()
            FloatingFilterBar(
                dateLabel: "Weeks 4\u{2013}6", filterCount: 3, state: .expanded,
                onDate: {}, onFilters: {})
        }
    }
}

#Preview("Compact") {
    ZStack {
        Color.gray.opacity(0.3)
        VStack {
            Spacer()
            FloatingFilterBar(
                dateLabel: "Now", filterCount: 0, state: .compact,
                onDate: {}, onFilters: {})
        }
    }
}
```

- [ ] **Step 3: Build to verify it compiles**

```bash
cd ios && xcodebuild build \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  CODE_SIGNING_ALLOWED=NO
```

Expected: **BUILD SUCCEEDED**.

- [ ] **Step 4: Eyeball both previews in Xcode**

Open `FloatingFilterBar.swift` in Xcode and resume the canvas. Confirm both previews render, and that the **Expanded and Compact pills are the same height** — this is the invariant Task 9 depends on. Also switch the canvas to Dark Appearance and confirm the material and border are still visible.

- [ ] **Step 5: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add ios/ChqCalendar/Features/Chrome/
git commit -m "feat(ios): ChromeSurface and FloatingFilterBar

The app's whole standing chrome: a date pill and a filter pill in a
floating capsule, taking plain values so it previews without AppModel.

The two states differ in label text and width only, never in height —
EventListView reserves a constant bottom margin for this bar, so a
height change here would move the list under the user mid-scroll.

All chrome material routes through one chromeSurface() modifier, so
adopting Liquid Glass when the deployment floor reaches iOS 26 is a
single-file edit rather than a sweep."
```

---

### Task 6: `DateFilterSheet`

**Files:**
- Create: `ios/ChqCalendar/Features/Filters/DateFilterSheet.swift`

**Interfaces:**
- Consumes: `AppModel.selectScope(_:)`, `AppModel.selectWeek(_:)`, `AppModel.isCurrentYear`, `AppModel.currentWeek`, `AppModel.dayGroups`, `FilterChipState.isScopeSelected(_:selection:currentWeek:)`, `FilterChipState.isWeekSelected(_:selection:currentWeek:)`, `SeasonCalendar.weeks(forYear:)`, `WeekStripState` (existing, for past/current week styling — read the file and reuse whatever it already exposes rather than duplicating the logic).
- Produces: `DateFilterSheet(model: AppModel)`, presented by Task 9.

**Design note:** scope and weeks stay mutually exclusive — that behavior already lives in `AppModel.selectScope`/`selectWeek` and must not be reimplemented here. This view only renders state and forwards taps. `visibleScopes` mirrors the rule the old `FilterBarView` had: all four scopes for the current year, `[.all]` otherwise.

- [ ] **Step 1: Write the view**

Create `ios/ChqCalendar/Features/Filters/DateFilterSheet.swift`:

```swift
import SwiftUI

/// The date pill's sheet: a scope row and a grid of the season's nine weeks.
///
/// Scope and week selection are mutually exclusive — one date range, two
/// ways of naming it. That rule lives in `AppModel.selectScope` and
/// `AppModel.selectWeek` and is deliberately not restated here; this view
/// renders state and forwards taps.
struct DateFilterSheet: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss

    private var visibleScopes: [DateScope] {
        model.isCurrentYear ? DateScope.allCases : [.all]
    }

    private var weekNumbers: [Int] {
        SeasonCalendar.weeks(forYear: model.selectedYear).map(\.number)
    }

    private var matchCount: Int {
        model.dayGroups.reduce(0) { $0 + $1.events.count }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    section("When") {
                        FlowLayout(spacing: 8) {
                            ForEach(visibleScopes, id: \.self) { scope in
                                SheetChip(
                                    label: scope.label,
                                    isSelected: model.isCurrentYear
                                        ? FilterChipState.isScopeSelected(
                                            scope, selection: model.filter,
                                            currentWeek: model.currentWeek)
                                        : true
                                ) {
                                    model.selectScope(scope)
                                }
                            }
                        }
                    }

                    if model.isCurrentYear || !weekNumbers.isEmpty {
                        section("Weeks") {
                            LazyVGrid(
                                columns: Array(
                                    repeating: GridItem(.flexible(), spacing: 8), count: 3),
                                spacing: 8
                            ) {
                                ForEach(weekNumbers, id: \.self) { number in
                                    SheetChip(
                                        label: "Week \(number)",
                                        isSelected: FilterChipState.isWeekSelected(
                                            number, selection: model.filter,
                                            currentWeek: model.currentWeek)
                                    ) {
                                        model.selectWeek(number)
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(20)
            }
            .navigationTitle("Dates")
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) {
                SheetDismissButton(count: matchCount) { dismiss() }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackgroundInteraction(.enabled(upThrough: .medium))
    }

    @ViewBuilder
    private func section(
        _ title: String,
        @ViewBuilder content: () -> some View
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.caption.weight(.bold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)
            content()
        }
    }
}

/// A selectable pill inside a sheet. Distinct from `FloatingFilterBar`'s
/// `BarPill`, which is a control that opens something rather than a value
/// that toggles.
struct SheetChip: View {
    let label: String
    var count: Int?
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.caption2.weight(.bold))
                }
                Text(label)
                    .lineLimit(1)
                if let count {
                    Text("\(count)")
                        .monospacedDigit()
                        .foregroundStyle(isSelected ? .white.opacity(0.7) : .secondary)
                }
            }
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .foregroundStyle(isSelected ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            .background(
                isSelected
                    ? AnyShapeStyle(Color.accentColor)
                    : AnyShapeStyle(.quaternary),
                in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}

/// The footer both sheets share. It **dismisses** — filters have already
/// applied live behind the sheet. There is no staged selection to commit,
/// so there is nothing to cancel either.
struct SheetDismissButton: View {
    let count: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text("Show \(count.formatted()) event\(count == 1 ? "" : "s")")
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.borderedProminent)
        .padding(.horizontal, 20)
        .padding(.bottom, 12)
        .background(.bar)
    }
}
```

> `FlowLayout` already exists at `ios/ChqCalendar/Support/FlowLayout.swift`. Read it first and match its initializer — if it does not take a `spacing:` argument, adapt the call rather than changing `FlowLayout`.

- [ ] **Step 2: Build to verify it compiles**

```bash
cd ios && xcodebuild build \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  CODE_SIGNING_ALLOWED=NO
```

Expected: **BUILD SUCCEEDED**.

- [ ] **Step 3: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add ios/ChqCalendar/Features/Filters/DateFilterSheet.swift
git commit -m "feat(ios): DateFilterSheet — scope row and week grid

Medium/large detented sheet behind the date pill, with background
interaction enabled so the list stays live and scrollable while dates
are picked.

Scope/week exclusivity is left where it already lives, in
AppModel.selectScope and selectWeek, rather than restated here.

Adds SheetChip and SheetDismissButton, shared with the filter sheet."
```

---

### Task 7: `FacetChipCloud` and `FacetAllList`

**Files:**
- Create: `ios/ChqCalendar/Features/Filters/FacetChipCloud.swift`
- Create: `ios/ChqCalendar/Features/Filters/FacetAllList.swift`

**Interfaces:**
- Consumes: `AppModel.available(_:)`, `.isSelected(_:in:)`, `.toggle(_:in:)`, `.count(for:in:)`, `.selectedCount(_:)`, `FilterFacet`, `DisplayNames.location(_:)` / `.category(_:)`, `SheetChip` (Task 6).
- Produces: `FacetChipCloud(model:facet:)` and `FacetAllList(model:facet:)`, both used by Task 8's `FilterSheet`.

**Design note — ordering is the whole feature.** With 76 venues, the cloud shows selected values first (so a selection is never scrolled off), then the highest-count remaining values, capped. The old recents strip is retired: count-ordering surfaces the same venues without the stale-name problem tracked as #157, and `AppModel.recentNames` becomes unused by this view (leave the model method alone — Task 9 does not delete it, and `RecentFilters` still persists).

- [ ] **Step 1: Write `FacetChipCloud`**

Create `ios/ChqCalendar/Features/Filters/FacetChipCloud.swift`:

```swift
import SwiftUI

/// One facet's chips inside the filter sheet: everything selected, then the
/// highest-count values that remain, then a link to the rest.
///
/// Ordering is the feature. The feed carries 76 distinct venues, so no flat
/// alphabetical list fits and no fixed subset is right for everyone.
/// Selected-first guarantees a selection is never scrolled out of sight;
/// count-descending after that puts the venues that actually host events at
/// the top.
///
/// This replaces the old recents strip, which showed names remembered from a
/// previous session that might not exist in the loaded year at all (#157).
/// Count-ordering surfaces the same frequently-used values without ever
/// offering a name the current snapshot cannot match.
struct FacetChipCloud: View {
    let model: AppModel
    let facet: FilterFacet

    /// Roughly two rows of chips on an iPhone. Everything beyond this lives
    /// behind the drill-down.
    private static let visibleLimit = 8

    private var allNames: [String] { model.available(facet) }

    private var ordered: [String] {
        let selected = allNames.filter { model.isSelected($0, in: facet) }
        let rest = allNames
            .filter { !model.isSelected($0, in: facet) }
            .sorted { model.count(for: $0, in: facet) > model.count(for: $1, in: facet) }
        return selected + rest.prefix(max(0, Self.visibleLimit - selected.count))
    }

    private func displayName(_ name: String) -> String {
        switch facet {
        case .venues: return DisplayNames.location(name)
        case .categories: return DisplayNames.category(name)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(facet.title)
                    .font(.caption.weight(.bold))
                    .textCase(.uppercase)
                    .foregroundStyle(.secondary)
                Spacer()
                if allNames.count > Self.visibleLimit {
                    NavigationLink {
                        FacetAllList(model: model, facet: facet)
                    } label: {
                        Text("All \(allNames.count)")
                            .font(.caption.weight(.semibold))
                    }
                }
            }

            FlowLayout(spacing: 8) {
                ForEach(ordered, id: \.self) { name in
                    SheetChip(
                        label: displayName(name),
                        count: model.count(for: name, in: facet),
                        isSelected: model.isSelected(name, in: facet)
                    ) {
                        model.toggle(name, in: facet)
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 2: Write `FacetAllList`**

Create `ios/ChqCalendar/Features/Filters/FacetAllList.swift`:

```swift
import SwiftUI

/// The full list of one facet's values, pushed from `FacetChipCloud`.
///
/// This is the only facet-scoped search field in the app. It sits one level
/// below the event search (which stays in the navigation bar's `.searchable`
/// on the calendar screen), and its navigation title names the facet, so the
/// two can't be mistaken for each other.
///
/// It pushes inside the sheet's own `NavigationStack` and takes the large
/// detent, so the sheet never dismisses and the event list underneath keeps
/// its scroll position.
struct FacetAllList: View {
    let model: AppModel
    let facet: FilterFacet

    @State private var query = ""

    private func displayName(_ name: String) -> String {
        switch facet {
        case .venues: return DisplayNames.location(name)
        case .categories: return DisplayNames.category(name)
        }
    }

    private var selected: [String] {
        model.available(facet).filter { model.isSelected($0, in: facet) }
    }

    private var matches: [String] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let unselected = model.available(facet).filter { !model.isSelected($0, in: facet) }
        guard !trimmed.isEmpty else { return unselected }
        return unselected.filter {
            displayName($0).localizedCaseInsensitiveContains(trimmed)
                || $0.localizedCaseInsensitiveContains(trimmed)
        }
    }

    var body: some View {
        List {
            if !selected.isEmpty {
                Section("Selected") {
                    ForEach(selected, id: \.self) { row(for: $0) }
                }
            }
            Section(selected.isEmpty ? "" : "All \(facet.title)") {
                ForEach(matches, id: \.self) { row(for: $0) }
            }
        }
        .listStyle(.insetGrouped)
        .searchable(text: $query, prompt: "Search \(facet.title.lowercased())")
        .navigationTitle(facet.title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func row(for name: String) -> some View {
        Button {
            model.toggle(name, in: facet)
        } label: {
            HStack {
                Image(systemName: model.isSelected(name, in: facet) ? "checkmark" : "")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 16)
                Text(displayName(name))
                    .foregroundStyle(.primary)
                Spacer()
                Text("\(model.count(for: name, in: facet))")
                    .font(.footnote)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityAddTraits(model.isSelected(name, in: facet) ? [.isSelected] : [])
    }
}
```

- [ ] **Step 3: Build to verify it compiles**

```bash
cd ios && xcodebuild build \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  CODE_SIGNING_ALLOWED=NO
```

Expected: **BUILD SUCCEEDED**.

- [ ] **Step 4: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add ios/ChqCalendar/Features/Filters/FacetChipCloud.swift ios/ChqCalendar/Features/Filters/FacetAllList.swift
git commit -m "feat(ios): facet chip cloud and full-list drill-down

Selected values first so a selection is never scrolled out of sight,
then count-descending, capped at eight; everything past that lives
behind an 'All n' push inside the sheet's own NavigationStack.

Retires the recents strip. Count-ordering surfaces the same
frequently-used venues without ever offering a name remembered from a
year the current snapshot cannot match (#157)."
```

---

### Task 8: `FilterSheet`

**Files:**
- Create: `ios/ChqCalendar/Features/Filters/FilterSheet.swift`

**Interfaces:**
- Consumes: `FacetChipCloud` (Task 7), `SheetChip` / `SheetDismissButton` (Task 6), `ActiveFilterChips.build(selection:)`, `AppModel.remove(_:)`, `.clearNonDateFilters()`, `.toggleFavoritesOnly()`, `.favorites`, `.filter`, `.dayGroups`.
- Produces: `FilterSheet(model: AppModel)`, presented by Task 9.

**Note:** `ActiveFilterChips.build` **already emits a favorites chip** — do not add one. Read `Domain/ActiveFilterChips.swift` before writing this view.

- [ ] **Step 1: Write the view**

Create `ios/ChqCalendar/Features/Filters/FilterSheet.swift`:

```swift
import SwiftUI

/// The filter pill's sheet: what is active, the two facets, and favorites.
///
/// Everything applies live — the list behind the sheet re-filters on every
/// tap, visible at the medium detent. The footer button only dismisses.
/// There is no staged selection, so there is nothing to cancel and no way
/// for the sheet's state and the model's to disagree.
///
/// Favorites lives here rather than in the bar so the pill's badge can
/// account for every filter that narrows the list. See `ActiveFilterCount`.
struct FilterSheet: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss

    private var chips: [ActiveFilterChip] {
        ActiveFilterChips.build(selection: model.filter)
    }

    private var matchCount: Int {
        model.dayGroups.reduce(0) { $0 + $1.events.count }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if !chips.isEmpty {
                        activeSection
                    }
                    FacetChipCloud(model: model, facet: .venues)
                    FacetChipCloud(model: model, facet: .categories)
                    favoritesSection
                }
                .padding(20)
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !chips.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Clear All") { model.clearNonDateFilters() }
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                SheetDismissButton(count: matchCount) { dismiss() }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackgroundInteraction(.enabled(upThrough: .medium))
    }

    private var activeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Active")
                .font(.caption.weight(.bold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)
            FlowLayout(spacing: 8) {
                ForEach(chips) { chip in
                    Button {
                        model.remove(chip)
                    } label: {
                        HStack(spacing: 5) {
                            Text(chip.label).lineLimit(1)
                            Image(systemName: "xmark")
                                .font(.caption2.weight(.bold))
                                .opacity(0.7)
                        }
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 12)
                        .frame(minHeight: 44)
                        .foregroundStyle(.white)
                        .background(Color.accentColor, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(chip.accessibilityLabel)
                }
            }
        }
    }

    private var favoritesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Only Show")
                .font(.caption.weight(.bold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)
            SheetChip(
                label: "Favorites",
                count: model.favorites.count,
                isSelected: model.filter.showFavoritesOnly
            ) {
                model.toggleFavoritesOnly()
            }
        }
    }
}
```

- [ ] **Step 2: Build to verify it compiles**

```bash
cd ios && xcodebuild build \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  CODE_SIGNING_ALLOWED=NO
```

Expected: **BUILD SUCCEEDED**.

- [ ] **Step 3: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add ios/ChqCalendar/Features/Filters/FilterSheet.swift
git commit -m "feat(ios): FilterSheet — active chips, both facets, favorites

Applies live at the medium detent; the footer button only dismisses, so
there is no staged selection that can disagree with the model.

Favorites moves here from the bar so the filter pill's badge accounts
for every filter that narrows the list."
```

---

### Task 9: Mount the bar and delete the old filter bar

**Files:**
- Modify: `ios/ChqCalendar/Features/Calendar/EventListView.swift` (remove the top `safeAreaInset` and all collapse machinery; add the bottom overlay, the constant content margin, the scroll observer, and the two sheets)
- Delete: `ios/ChqCalendar/Domain/FilterBarCollapse.swift`
- Delete: `ios/ChqCalendar/Features/Filters/FilterBarView.swift`
- Delete: `ios/ChqCalendar/Features/Filters/FacetRowView.swift`
- Delete: `ios/ChqCalendar/Features/Filters/WeekStripView.swift`
- Delete: `ios/ChqCalendar/Features/Filters/ResetFilterRow.swift`
- Delete: `ios/ChqCalendarTests/FilterBarCollapseTests.swift`

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: the assembled screen. Nothing later depends on new symbols from this task.

**Before deleting**, grep for each symbol so nothing is left dangling:

```bash
cd /Users/bernard/src/chq/chq-calendar/ios
grep -rn "FilterBarView\|FacetRowView\|WeekStripView\|ResetFilterRow\|FilterBarCollapse\|ScrollGeometrySample" ChqCalendar/ ChqCalendarTests/
```

`WeekStripState` and `WeekStripStateTests` are **kept** — `DateFilterSheet` uses the season's week list, and `WeekStripState` may still be referenced. Only delete `WeekStripView`. If the grep shows `WeekStripState` has become unreferenced by any non-test file, leave it and its tests in place anyway rather than expanding this task's blast radius; note it for a follow-up.

- [ ] **Step 1: Rewrite `EventListView`'s chrome wiring**

In `ios/ChqCalendar/Features/Calendar/EventListView.swift`:

Replace the state block (currently lines 25–72 — `isFilterBarCollapsed`, `collapseDriver`, `reduceMotion`, `scenePhase`, `estimatedCollapseGiveBack`, `collapseAnimationDuration`) with:

```swift
    @State private var isAboutPresented = false

    /// Which pill's sheet is up, if any.
    @State private var activeSheet: FilterBarSheet?

    /// Drives the bar's expanded/compact state from the scroll stream.
    /// Not `@Observable` — it is fed from a scroll callback and its own
    /// bookkeeping must not invalidate this body.
    @State private var barPresentation = BarPresentation()

    /// Mirrors `barPresentation.state` so the bar re-renders on a change.
    @State private var barState: BarState = .expanded

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Height reserved at the bottom of the list for the floating bar.
    ///
    /// **Constant by design.** The bar is an overlay and this margin never
    /// changes, so the list's geometry is unaffected by the bar's state —
    /// which is what makes the whole collapse-oscillation problem
    /// unreachable rather than merely mitigated. `@ScaledMetric` so the
    /// reservation grows with Dynamic Type; it still does not vary with
    /// scroll position, which is the property that matters.
    @ScaledMetric(relativeTo: .subheadline) private var barReservedHeight: CGFloat = 76

    private enum FilterBarSheet: String, Identifiable {
        case date
        case filters
        var id: String { rawValue }
    }
```

Replace the `body` with:

```swift
    var body: some View {
        content
            .navigationTitle("CHQ Calendar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbarContent }
            .sheet(isPresented: $isAboutPresented) { AboutView() }
            .sheet(item: $activeSheet) { sheet in
                switch sheet {
                case .date: DateFilterSheet(model: model)
                case .filters: FilterSheet(model: model)
                }
            }
            .overlay(alignment: .bottom) {
                // Only once there is a snapshot to filter against — during
                // launch or the offline/error states the pills would
                // summarise nothing.
                if model.snapshot != nil {
                    FloatingFilterBar(
                        dateLabel: DateFilterLabel.text(
                            for: model.filter,
                            seasonWeekCount: SeasonCalendar.weeks(
                                forYear: model.selectedYear).count),
                        filterCount: ActiveFilterCount.value(for: model.filter),
                        state: barState,
                        onDate: {
                            KeyboardDismisser.dismiss()
                            activeSheet = .date
                        },
                        onFilters: {
                            KeyboardDismisser.dismiss()
                            activeSheet = .filters
                        })
                    .animation(
                        reduceMotion ? nil : .easeInOut(duration: 0.2), value: barState)
                }
            }
    }
```

Delete the `listWasReplaced()` method and every call to it (the three `.onAppear(perform: listWasReplaced)` sites in `content`), and delete the `.onChange(of: scenePhase)` that called `collapseDriver.settled()`. Nothing replaces them: with no collapse machinery there is no per-list state to reset.

In `list(days:)`, replace the `.onScrollGeometryChange` block with:

```swift
        .contentMargins(.bottom, barReservedHeight, for: .scrollContent)
        .onScrollGeometryChange(for: ScrollSample.self) { geometry in
            ScrollSample(
                offset: geometry.contentOffset.y,
                insetTop: geometry.contentInsets.top)
        } action: { _, sample in
            guard let next = barPresentation.received(
                offset: sample.offset, insetTop: sample.insetTop) else { return }
            barState = next
        }
```

Add this type at file scope (bottom of the file), replacing whatever `ScrollGeometrySample` the collapse driver defined:

```swift
/// The two numbers `BarPresentation` needs from the scroll stream.
private struct ScrollSample: Equatable {
    let offset: CGFloat
    let insetTop: CGFloat
}
```

Leave `filtered`, the banners, the `n of m events` caption row, the day sections, and the `Show next day` footer exactly as they are — this task changes chrome, not list content.

- [ ] **Step 2: Delete the old filter bar**

```bash
cd /Users/bernard/src/chq/chq-calendar
git rm ios/ChqCalendar/Domain/FilterBarCollapse.swift \
       ios/ChqCalendar/Features/Filters/FilterBarView.swift \
       ios/ChqCalendar/Features/Filters/FacetRowView.swift \
       ios/ChqCalendar/Features/Filters/WeekStripView.swift \
       ios/ChqCalendar/Features/Filters/ResetFilterRow.swift \
       ios/ChqCalendarTests/FilterBarCollapseTests.swift
```

- [ ] **Step 3: Build and fix what breaks**

```bash
cd ios && xcodebuild build \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  CODE_SIGNING_ALLOWED=NO
```

Expected failures to fix, all in `CalendarView.swift`'s `#if DEBUG` block: `model.uiTestShowFilters` was consumed by the now-deleted `FilterBarView`. **Leave `AppModel.uiTestShowFilters` in place** — Task 10 rewires it. For this step, only make it compile.

- [ ] **Step 4: Run the full suite**

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  CODE_SIGNING_ALLOWED=NO
```

Expected: everything passes. `FilterBarCollapseTests` is gone; `FilterChipStateTests`, `WeekStripStateTests`, `ActiveFilterChipsTests`, `FacetCountsTests`, `AppModelTests`, `EventFilterTests` all still pass.

- [ ] **Step 5: Verify by hand on the simulator**

Run the app (⌘R in Xcode, or `xcodebuild build` then launch the simulator). Confirm all of:

1. The bar floats at the bottom over the list; list content scrolls under it.
2. Scrolling **down** compacts it (the word "Filters" disappears); scrolling **up** expands it.
3. The list does **not** shift vertically when the bar changes state. Watch a row near the middle of the screen — it must not move. This is the invariant the whole design rests on; if it moves, the content margin is not constant and something in Step 1 was mis-transcribed.
4. The last event in the list can be scrolled clear of the bar.
5. Tapping the date pill opens the date sheet; picking a week updates the list behind it and the pill's label.
6. Tapping the filter pill opens the filter sheet; picking a venue updates the badge, the list, and the other facet's counts.
7. `All n →` pushes inside the sheet without dismissing it.
8. The search field still appears on a pull-down and still filters.

- [ ] **Step 6: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add ios/ChqCalendar/Features/Calendar/EventListView.swift
git commit -m "feat(ios): mount the floating bar, delete the old filter bar

EventListView loses its top safeAreaInset and gains a bottom overlay
plus a constant bottom content margin. Because the margin never changes,
the bar's state cannot alter the list's geometry — which is what makes
FilterBarCollapse unnecessary rather than merely improved.

Deletes FilterBarCollapse (350 lines) and its tests, FilterBarView,
FacetRowView, WeekStripView, and ResetFilterRow. Closes #153 and #154:
there are no pinned rows to choose between and no give-back to measure."
```

---

### Task 10: Rewire the screenshot hook and regenerate App Store assets

**Files:**
- Modify: `ios/ChqCalendar/Features/Calendar/EventListView.swift` (consume `uiTestShowFilters`)
- Modify: `ios/ChqCalendar/App/AppModel.swift:501-503` (doc comment only)
- Modify: `docs/app-store/screenshots.manifest.json` and `docs/app-store/screenshots/review/` (regenerated)
- Read: `docs/app-store/listing-copy.md`, `docs/app-store/listing-fields.json`, `ios/Scripts/screenshot-plan.json`

**Why this is its own task:** `-uitest-show-filters` used to expand `FilterBarView`'s Venues panel, which no longer exists. Left alone, the capture script still succeeds — it just photographs the wrong screen. A silent wrong-output failure deserves its own gate.

- [ ] **Step 1: Consume the hook in `EventListView`**

Add to `EventListView`, inside the existing `#if DEBUG` conventions of the file (or add a `#if DEBUG` block if none exists there yet):

```swift
    #if DEBUG
    // MARK: UI-test hooks (DEBUG only)

    /// `-uitest-show-filters` used to expand `FilterBarView`'s Venues panel.
    /// That view is gone, so the equivalent "show me the filter UI" state is
    /// now the filter sheet. Both `onAppear` (flag already true when this
    /// view mounts) and `onChange` (view mounted from a warm cache before
    /// `start()` flipped the flag) are needed to catch either ordering.
    private func presentFilterSheetIfNeeded() {
        if model.uiTestShowFilters {
            model.uiTestShowFilters = false
            activeSheet = .filters
        }
    }
    #endif
```

and attach it to `content` inside `body`:

```swift
            #if DEBUG
            .onAppear(perform: presentFilterSheetIfNeeded)
            .onChange(of: model.uiTestShowFilters) { _, _ in presentFilterSheetIfNeeded() }
            #endif
```

Update the doc comment on `AppModel.uiTestShowFilters` so it names `EventListView` rather than `FilterBarView`.

- [ ] **Step 2: Verify the hook actually presents the sheet**

```bash
cd ios && xcodebuild build \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  CODE_SIGNING_ALLOWED=NO
```

Then launch with the flag and confirm visually that the **filter sheet** is up:

```bash
xcrun simctl launch --console booted org.chqcal.app -uitest-show-filters
```

If the app is not installed on the booted simulator, install it from the build's `.app` product first, or run the scheme once from Xcode. Do not proceed until you have seen the sheet — this is the whole point of the task.

- [ ] **Step 3: Regenerate screenshots**

```bash
cd /Users/bernard/src/chq/chq-calendar
ios/Scripts/capture-screenshots.sh
python3 ios/Scripts/compose-screenshots.py
```

Two known local prerequisites, neither documented in `ios/README.md`: **Pillow** must be installed for `compose-screenshots.py`, and the system `bash` 3.2 shadows the Homebrew `bash` the capture script needs. If the script fails on either, fix the environment — do not edit the scripts.

`check-screenshots.py` is known to false-positive its stuck-alert heuristic on `02-filters` (the chips read as an alert-shaped box). If it flags only that shot and the image is visibly correct, proceed.

- [ ] **Step 4: Review every regenerated shot**

Open each image under `docs/app-store/screenshots/review/`. Confirm none shows the old four-row filter bar, and that `02-filters` shows the new filter sheet rather than an empty list. A shot of the wrong screen is the exact failure this task exists to prevent.

- [ ] **Step 5: Re-read the listing copy for invalidated claims**

Read `docs/app-store/listing-copy.md` and `docs/app-store/listing-fields.json`. Any sentence describing the filter UI — rows of chips, a filter bar, tapping a star on a row — is now wrong. Update the copy. If nothing needs changing, say so explicitly in the commit message rather than silently skipping.

- [ ] **Step 6: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add ios/ChqCalendar/Features/Calendar/EventListView.swift ios/ChqCalendar/App/AppModel.swift docs/app-store/
git commit -m "chore(ios): rewire -uitest-show-filters, regenerate App Store assets

The hook expanded FilterBarView's Venues panel, which this branch
deletes. Left alone the capture script would still have succeeded and
simply photographed the wrong screen, so it now presents the filter
sheet instead.

Regenerates screenshots and the manifest, and re-reads the listing copy
for claims the new chrome invalidates."
```

---

### Task 11: Update the plan's own documentation trail

**Files:**
- Modify: `ios/README.md` (architecture section — the filter-bar description is now wrong)
- Modify: `docs/app-store/RELEASE_CHECKLIST.md` (release note)

- [ ] **Step 1: Fix `ios/README.md`**

Read the "Architecture" section of `ios/README.md`. Any description of `FilterBarView`, the four-row bar, the week strip, or collapse-on-scroll is now false. Replace it with the floating bar, the two sheets, and a one-line note that `BarPresentation` is deliberately trivial because the bar is an overlay over a constant content margin.

While in the file, add the two undocumented local prerequisites found during Task 10: Pillow, and that system bash 3.2 shadows the Homebrew bash the capture script needs.

- [ ] **Step 2: Add a release note**

Append to `docs/app-store/RELEASE_CHECKLIST.md`, in whatever "release notes" or "what's new" section it keeps:

```markdown
- **Filtering moved to the bottom of the screen.** The four-row filter bar is
  replaced by two pills — a date range and a filter count — floating over the
  event list, each opening a sheet. Roughly a third more of the screen is
  event list.
- **Tapping the star on a row no longer toggles a favorite.** Swipe right on a
  row, or press and hold it. Favorited events still show a star.
```

(The second bullet lands with PR 2, which makes the row change. Write it now so it is not forgotten, and move it if PR 2 slips.)

- [ ] **Step 3: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add ios/README.md docs/app-store/RELEASE_CHECKLIST.md
git commit -m "docs(ios): describe the floating filter bar, note the release change

README's architecture section still described the four-row filter bar
and collapse-on-scroll. Also records two undocumented local
prerequisites for the screenshot scripts (Pillow; Homebrew bash being
shadowed by system bash 3.2)."
```

---

### Task 12: Open the PR

- [ ] **Step 1: Run the full suite one last time**

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  CODE_SIGNING_ALLOWED=NO
```

Expected: all tests pass. Record the actual pass/fail count in the PR body — do not write "tests pass" without having read the output.

- [ ] **Step 2: Push and open the PR**

```bash
cd /Users/bernard/src/chq/chq-calendar
git push -u origin feat/ios-ux-scroll-first-redesign
```

Open the PR with a body covering: what changed, the constant-content-margin decision and why it deletes the collapse driver, that #152 is fixed and #153/#154/#157 are closed as obsolete, the device-verification checklist from Task 9 Step 5 with results, and the screenshot regeneration. The `app-store-assets.yml` guard requires either a changed manifest (which Task 10 produces) or a `[skip-screenshots: <reason>]` opt-out — this PR regenerates, so no opt-out is needed.

**Do not merge.** Request the merge from the repository owner.

---

## Self-Review

**Spec coverage:** D1 → Tasks 5, 9. D2 → Task 9. D3 → untouched by design, confirmed in Task 9 Step 5.8. D4 → Tasks 6, 8 (`SheetDismissButton`). D5 → Task 4. D6 → Tasks 2, 8. D7/D8 → PR 2, out of scope here. Date pill label table → Task 1. Filter pill badge → Task 2. Bar states → Tasks 3, 5. Sheets → Tasks 6–8. Glass readiness → Task 5. App Store assets → Task 10. Deletions → Task 9.

**Spec items deliberately not covered here:** the row and day-header redesign (spec §Rows, D7) is PR 2 and gets its own plan. `#156` (`extraDays` not reset by `selectScope`) is listed in the spec as "fold in if it falls out naturally" — nothing in this plan touches `selectScope`, so it does not fall out; leave it filed.

**Known follow-ups this plan creates:** `AppModel.recentNames(_:)` and `RecentFilters` become unreferenced by any view once `FacetRowView` is deleted (Task 9). The plan deliberately leaves them in place rather than widening its blast radius; file an issue to remove them or to reintroduce recents inside the sheet.
