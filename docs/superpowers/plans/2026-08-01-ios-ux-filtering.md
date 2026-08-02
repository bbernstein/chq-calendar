# iOS UX — Filtering, Week Strip, Active Filters, and Density — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the iOS app's filtering UX up to the web app's — mutually exclusive date ranges, a week strip that shows where "now" is, one-tap repeat filtering by venue and category, visible and individually removable active filters, and a top-of-screen that wastes no space.

**Architecture:** All decision logic goes into `nonisolated` pure types under `ios/ChqCalendar/Domain/` so it can be unit-tested without a view host; SwiftUI views stay dumb and call straight through to `AppModel`. `AppModel` (`@MainActor`, `@Observable`) remains the single source of truth and the only thing that persists. The modal `FilterSheetView` is deleted and replaced by two inline, self-contained facet rows.

**Tech Stack:** Swift 6, SwiftUI, Swift Testing (`@Test` / `#expect`), iOS 17 deployment target, Xcode 26.

**Spec:** `docs/superpowers/specs/2026-08-01-ios-ux-filtering-design.md`

## Global Constraints

- **Branch:** `feat/ios-ux-filtering`. Never commit to `main`.
- **Deployment target is iOS 17.0.** Do not use iOS 18+ API (`onScrollGeometryChange`, `onScrollPhaseChange`, `navigationSubtitle`). `Layout`, `ScrollViewReader`, `scrollDismissesKeyboard`, and `searchable` are all iOS 16/17-safe.
- **Swift 6 language mode, strict concurrency.** Domain types are declared `nonisolated`. Static stored properties must be `let` (a `static let` satisfies a protocol's `static var … { get }` requirement).
- **The Xcode project uses `PBXFileSystemSynchronizedRootGroup`** for both `ChqCalendar` and `ChqCalendarTests`. New `.swift` files under those directories are picked up automatically. **Never edit `project.pbxproj`.**
- **No UIKit imports in `Domain/` or `App/`.** `AppModel` must keep compiling and testing without a UI host. The one UIKit escape hatch lives in `Support/KeyboardDismisser.swift` and is called only from views.
- **Test command** (run from the repo root):
  ```bash
  cd ios && xcodebuild test \
    -project ChqCalendar.xcodeproj -scheme ChqCalendar \
    -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
    CODE_SIGNING_ALLOWED=NO -quiet
  ```
  To run one suite, append `-only-testing:ChqCalendarTests/<SuiteName>`.
- **Test conventions:** `struct <Name>Tests` with `@Test func …`, `#expect(…)`, `try #require(…)`. `AppModel` tests are in a `@MainActor struct`. Isolated defaults via `UserDefaults(suiteName: UUID().uuidString)!`. Dates via `ChqTime.parse("yyyy-MM-dd HH:mm:ss")` (America/New_York). Events via `makeEvent(…)` from `TestSupport.swift`.
- **Season week math for 2026** (used throughout the tests): week 1 starts `2026-06-27 12:00`, each week runs noon Saturday → noon Saturday. Week 5 is `07-25 12:00 → 08-01 12:00`; **week 6 is `08-01 12:00 → 08-08 12:00`**; week 9 ends `2026-08-29 12:00`.
- **Commit trailers** on every commit:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01L9PjUZ7iWv2QHKSpGQ3D36
  ```
- **Run the full test command before every commit.** Do not commit on a red build.

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `ios/ChqCalendar/Domain/FilterChipState.swift` | Pure: which scope/week chips render selected |
| `ios/ChqCalendar/Domain/WeekStripState.swift` | Pure: past/current/upcoming per week, initial scroll target |
| `ios/ChqCalendar/Domain/ActiveFilterChips.swift` | Pure: the removable-chip list for the reset row |
| `ios/ChqCalendar/Domain/FacetCounts.swift` | Pure: per-venue / per-category event counts |
| `ios/ChqCalendar/Domain/FilterBarCollapse.swift` | Pure: collapse/expand state machine with hysteresis |
| `ios/ChqCalendar/Support/KeyboardDismisser.swift` | The single UIKit resign-first-responder call |
| `ios/ChqCalendar/Support/FlowLayout.swift` | Wrapping `Layout` for the expansion panels |
| `ios/ChqCalendar/Features/Filters/FacetRowView.swift` | One facet row: label + recents + inline expansion |
| `ios/ChqCalendar/Features/Filters/ResetFilterRow.swift` | Clear all / Keep dates / active-filter chips |
| `ios/ChqCalendarTests/FilterChipStateTests.swift` | |
| `ios/ChqCalendarTests/WeekStripStateTests.swift` | |
| `ios/ChqCalendarTests/ActiveFilterChipsTests.swift` | |
| `ios/ChqCalendarTests/FacetCountsTests.swift` | |
| `ios/ChqCalendarTests/FilterBarCollapseTests.swift` | |
| `ios/ChqCalendarTests/FilterSelectionTests.swift` | |

**Modified:** `App/AppModel.swift`, `Data/UserStateStore.swift`, `Domain/EventFilter.swift`, `Features/Filters/FilterBarView.swift`, `Features/Filters/WeekStripView.swift`, `Features/Calendar/EventListView.swift`, `Features/About/AboutInfo.swift`, `ios/Scripts/screenshot-plan.json`, and the matching test files.

**Deleted:** `Features/Filters/FilterSheetView.swift` (Task 5).

---

### Task 1: Date-range exclusivity

Spec section A. Scope and weeks stop intersecting; the current-week chip and "This Week" become two expressions of one range.

**Files:**
- Create: `ios/ChqCalendar/Domain/FilterChipState.swift`
- Create: `ios/ChqCalendarTests/FilterChipStateTests.swift`
- Modify: `ios/ChqCalendar/App/AppModel.swift:259-271` (replace `setScope`/`toggleWeek`)
- Modify: `ios/ChqCalendar/Features/Filters/FilterBarView.swift:16-23`
- Modify: `ios/ChqCalendar/Features/Filters/WeekStripView.swift:14-23`
- Modify: `ios/ChqCalendarTests/AppModelTests.swift:250-279`

**Interfaces:**
- Consumes: `FilterSelection` (`Data/UserStateStore.swift`), `DateScope`, `AppModel.currentWeek: Int?`.
- Produces: `FilterChipState.isScopeSelected(_:selection:currentWeek:) -> Bool`, `FilterChipState.isWeekSelected(_:selection:currentWeek:) -> Bool`, `AppModel.selectScope(_ scope: DateScope)`, `AppModel.selectWeek(_ n: Int)`. **`setScope` and `toggleWeek` no longer exist after this task.**

- [ ] **Step 1: Write the failing test**

Create `ios/ChqCalendarTests/FilterChipStateTests.swift`:

```swift
import Testing
@testable import ChqCalendar

struct FilterChipStateTests {
    @Test func thisWeekSelectedWhenScopeIsThisWeek() {
        let sel = FilterSelection(dateScope: .thisWeek)
        #expect(FilterChipState.isScopeSelected(.thisWeek, selection: sel, currentWeek: 6))
        #expect(FilterChipState.isWeekSelected(6, selection: sel, currentWeek: 6))
        #expect(!FilterChipState.isWeekSelected(5, selection: sel, currentWeek: 6))
    }

    @Test func thisWeekSelectedWhenOnlyCurrentWeekIsSelected() {
        let sel = FilterSelection(dateScope: .all, selectedWeeks: [6])
        #expect(FilterChipState.isScopeSelected(.thisWeek, selection: sel, currentWeek: 6))
    }

    @Test func thisWeekNotSelectedWhenCurrentWeekIsOneOfSeveral() {
        let sel = FilterSelection(dateScope: .all, selectedWeeks: [6, 7])
        #expect(!FilterChipState.isScopeSelected(.thisWeek, selection: sel, currentWeek: 6))
        #expect(FilterChipState.isWeekSelected(6, selection: sel, currentWeek: 6))
        #expect(FilterChipState.isWeekSelected(7, selection: sel, currentWeek: 6))
    }

    @Test func allSelectedOnlyWhenNoWeeksAreSelected() {
        #expect(FilterChipState.isScopeSelected(
            .all, selection: FilterSelection(dateScope: .all), currentWeek: 6))
        #expect(!FilterChipState.isScopeSelected(
            .all, selection: FilterSelection(dateScope: .all, selectedWeeks: [3]), currentWeek: 6))
    }

    @Test func nowAndTodayTrackScopeDirectly() {
        let sel = FilterSelection(dateScope: .next)
        #expect(FilterChipState.isScopeSelected(.next, selection: sel, currentWeek: 6))
        #expect(!FilterChipState.isScopeSelected(.today, selection: sel, currentWeek: 6))
    }

    @Test func outOfSeasonNilCurrentWeekNeverCrossLightsChips() {
        #expect(!FilterChipState.isScopeSelected(
            .thisWeek, selection: FilterSelection(dateScope: .all, selectedWeeks: [6]), currentWeek: nil))
        #expect(!FilterChipState.isWeekSelected(
            6, selection: FilterSelection(dateScope: .thisWeek), currentWeek: nil))
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ios && xcodebuild test -project ChqCalendar.xcodeproj -scheme ChqCalendar -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' CODE_SIGNING_ALLOWED=NO -quiet -only-testing:ChqCalendarTests/FilterChipStateTests`

Expected: compile failure — `cannot find 'FilterChipState' in scope`.

- [ ] **Step 3: Write the implementation**

Create `ios/ChqCalendar/Domain/FilterChipState.swift`:

```swift
import Foundation

/// Pure derivations for which date-range chips render as selected.
///
/// The iOS equivalents of the web's `isThisWeekActive` and
/// `isWeekHighlighted` (frontend/src/app/page.tsx). "This Week" and the
/// current week's own chip describe the *same* range, so choosing either
/// lights both — that equivalence is the whole reason these live here
/// rather than being read straight off `FilterSelection`.
nonisolated enum FilterChipState {
    static func isScopeSelected(
        _ scope: DateScope,
        selection: FilterSelection,
        currentWeek: Int?
    ) -> Bool {
        switch scope {
        case .thisWeek:
            if selection.dateScope == .thisWeek { return true }
            // Selecting *only* the current week is the same range as
            // "This Week"; selecting it alongside others is not.
            guard let currentWeek else { return false }
            return selection.selectedWeeks == [currentWeek]
        case .all:
            // "All" means unfiltered dates, so a week selection un-selects it
            // even though `dateScope` is still `.all`.
            return selection.dateScope == .all && selection.selectedWeeks.isEmpty
        case .next, .today:
            return selection.dateScope == scope
        }
    }

    static func isWeekSelected(
        _ n: Int,
        selection: FilterSelection,
        currentWeek: Int?
    ) -> Bool {
        if selection.selectedWeeks.contains(n) { return true }
        return selection.dateScope == .thisWeek && currentWeek == n
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the same `-only-testing:ChqCalendarTests/FilterChipStateTests` command. Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing AppModel tests**

In `ios/ChqCalendarTests/AppModelTests.swift`, **delete** the two tests `setScopeMutatesAndPersistsFilter` and `toggleWeekMutatesAndPersistsFilter` (lines 252–279) and rename the section header on line 250 to `// MARK: - selectScope / selectWeek / clearFilters`. Insert in their place:

```swift
    /// Week 6 of the 2026 season is 08-01 12:00 → 08-08 12:00, so this
    /// instant puts `model.currentWeek == 6`.
    private func makeInSeasonModel(defaults: UserDefaults) throws -> AppModel {
        let now = try #require(ChqTime.parse("2026-08-03 12:00:00"))
        return AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: defaults, now: { Date() }),
            now: { now }
        )
    }

    @Test func selectScopeClearsWeeksAndPersists() throws {
        let defaults = makeDefaults()
        let model = try makeInSeasonModel(defaults: defaults)
        model.selectWeek(3)
        #expect(model.filter.selectedWeeks == [3])

        model.selectScope(.today)

        #expect(model.filter.dateScope == .today)
        #expect(model.filter.selectedWeeks.isEmpty)
        let reloaded = UserStateStore(defaults: defaults, now: { Date() }).loadFilters()
        #expect(reloaded?.dateScope == .today)
        #expect(reloaded?.selectedWeeks.isEmpty == true)
    }

    @Test func reselectingTheActiveScopeIsANoOp() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        model.selectScope(.today)
        model.selectScope(.today)
        #expect(model.filter.dateScope == .today)
    }

    @Test func selectingCurrentWeekBecomesThisWeekScope() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        #expect(model.currentWeek == 6)

        model.selectWeek(6)

        #expect(model.filter.dateScope == .thisWeek)
        #expect(model.filter.selectedWeeks.isEmpty)
        #expect(FilterChipState.isScopeSelected(
            .thisWeek, selection: model.filter, currentWeek: model.currentWeek))
        #expect(FilterChipState.isWeekSelected(
            6, selection: model.filter, currentWeek: model.currentWeek))
    }

    @Test func selectingAnotherWeekWhileNowIsActiveReplacesTheScope() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        #expect(model.filter.dateScope == .next)

        model.selectWeek(3)

        #expect(model.filter.dateScope == .all)
        #expect(model.filter.selectedWeeks == [3])
    }

    @Test func weeksAccumulateOnceScopeIsAll() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        model.selectWeek(3)
        model.selectWeek(4)
        #expect(model.filter.selectedWeeks == [3, 4])

        model.selectWeek(3)
        #expect(model.filter.selectedWeeks == [4])
    }

    @Test func deselectingTheLastWeekLeavesScopeAll() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        model.selectWeek(3)
        model.selectWeek(3)
        #expect(model.filter.selectedWeeks.isEmpty)
        #expect(model.filter.dateScope == .all)
    }

    @Test func selectingCurrentWeekAgainStaysThisWeek() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        model.selectWeek(6)
        model.selectWeek(6)
        #expect(model.filter.dateScope == .thisWeek)
        #expect(model.filter.selectedWeeks.isEmpty)
    }
```

Also update `clearFiltersResetsFacetsButKeepsSearchTextAndExtraDays` (line 329): replace `model.toggleWeek(4)` with `model.selectWeek(4)` and `model.setScope(.all)` with `model.selectScope(.all)`.

- [ ] **Step 6: Run tests to verify they fail**

Run: `… -only-testing:ChqCalendarTests/AppModelTests`
Expected: compile failure — `value of type 'AppModel' has no member 'selectWeek'`.

- [ ] **Step 7: Replace `setScope` / `toggleWeek` in `AppModel`**

In `ios/ChqCalendar/App/AppModel.swift`, replace lines 259–271 (the `setScope` and `toggleWeek` methods) with:

```swift
    /// Selects a date scope, clearing any week selection: the scope row and
    /// the week strip are two ways of expressing one date range, never two
    /// ranges to intersect.
    ///
    /// Re-tapping the active scope is a no-op. The web toggles back to
    /// "all" here, but it has no All button; iOS does, so the scope row
    /// behaves as a radio group instead.
    func selectScope(_ scope: DateScope) {
        guard filter.dateScope != scope || !filter.selectedWeeks.isEmpty else { return }
        filter.dateScope = scope
        filter.selectedWeeks = []
        persistFilter()
    }

    /// Mirrors the web's `handleWeekTap` (frontend/src/hooks/useScrollState.ts).
    func selectWeek(_ n: Int) {
        if n == currentWeek, filter.selectedWeeks.isEmpty {
            // The current week *is* "This Week" — same range, so store it as
            // the scope and let both chips light up.
            filter.dateScope = .thisWeek
        } else if filter.dateScope != .all {
            // A relative scope was active and the user picked a different
            // week: the week replaces the scope rather than narrowing it.
            filter.dateScope = .all
            filter.selectedWeeks = [n]
        } else if filter.selectedWeeks.contains(n) {
            filter.selectedWeeks.remove(n)
        } else {
            filter.selectedWeeks.insert(n)
        }
        persistFilter()
    }
```

- [ ] **Step 8: Wire the views**

In `ios/ChqCalendar/Features/Filters/FilterBarView.swift`, replace the `ForEach(visibleScopes…)` body (lines 16–23) with:

```swift
                    ForEach(visibleScopes, id: \.self) { scope in
                        FilterChip(
                            label: scope.label,
                            isSelected: model.isCurrentYear
                                ? FilterChipState.isScopeSelected(
                                    scope, selection: model.filter, currentWeek: model.currentWeek)
                                : true
                        ) {
                            model.selectScope(scope)
                        }
                    }
```

In `ios/ChqCalendar/Features/Filters/WeekStripView.swift`, replace the `ForEach(1...9…)` body (lines 14–23) with:

```swift
                ForEach(1...9, id: \.self) { number in
                    WeekChip(
                        number: number,
                        isSelected: FilterChipState.isWeekSelected(
                            number, selection: model.filter, currentWeek: model.currentWeek),
                        isCurrent: model.isCurrentYear && model.currentWeek == number,
                        theme: model.theme(forWeek: number)
                    ) {
                        model.selectWeek(number)
                    }
                }
```

- [ ] **Step 9: Run the full suite**

Run the full test command (no `-only-testing`). Expected: PASS, everything green.

- [ ] **Step 10: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add ios/ChqCalendar/Domain/FilterChipState.swift \
        ios/ChqCalendarTests/FilterChipStateTests.swift \
        ios/ChqCalendar/App/AppModel.swift \
        ios/ChqCalendar/Features/Filters/FilterBarView.swift \
        ios/ChqCalendar/Features/Filters/WeekStripView.swift \
        ios/ChqCalendarTests/AppModelTests.swift
git commit -m "feat(ios): make date scope and week selection mutually exclusive

selectScope/selectWeek replace setScope/toggleWeek and enforce the
invariant at the mutation site, so EventFilter's scope and week stages can
never both narrow. Mirrors the web's handleWeekTap: picking the current
week stores .thisWeek, so that chip and the This Week chip both light up
via FilterChipState -- the iOS equivalent of isThisWeekActive and
isWeekHighlighted.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01L9PjUZ7iWv2QHKSpGQ3D36"
```

---

### Task 2: Week strip — past/current styling and auto-scroll

Spec section B.

**Files:**
- Create: `ios/ChqCalendar/Domain/WeekStripState.swift`
- Create: `ios/ChqCalendarTests/WeekStripStateTests.swift`
- Modify: `ios/ChqCalendar/Features/Filters/WeekStripView.swift`

**Interfaces:**
- Consumes: `SeasonCalendar.weeks(forYear:)`, `SeasonWeek.contains(_:)`, `AppModel.isCurrentYear`, `AppModel.selectedYear`.
- Produces: `WeekTimeState` (`.past` / `.current` / `.upcoming`), `WeekStripState.timeState(week:now:year:)`, `WeekStripState.initialScrollTarget(now:year:)`.

- [ ] **Step 1: Write the failing test**

Create `ios/ChqCalendarTests/WeekStripStateTests.swift`:

```swift
import Foundation
import Testing
@testable import ChqCalendar

struct WeekStripStateTests {
    // 2026 season: week 1 starts 06-27 12:00; week 6 is 08-01 12:00 →
    // 08-08 12:00; week 9 ends 08-29 12:00.

    @Test func weekIsCurrentWhenNowFallsInsideIt() throws {
        let now = try #require(ChqTime.parse("2026-08-03 12:00:00"))
        #expect(WeekStripState.timeState(week: 6, now: now, year: 2026) == .current)
    }

    @Test func earlierWeeksArePast() throws {
        let now = try #require(ChqTime.parse("2026-08-03 12:00:00"))
        #expect(WeekStripState.timeState(week: 1, now: now, year: 2026) == .past)
        #expect(WeekStripState.timeState(week: 5, now: now, year: 2026) == .past)
    }

    @Test func laterWeeksAreUpcoming() throws {
        let now = try #require(ChqTime.parse("2026-08-03 12:00:00"))
        #expect(WeekStripState.timeState(week: 7, now: now, year: 2026) == .upcoming)
        #expect(WeekStripState.timeState(week: 9, now: now, year: 2026) == .upcoming)
    }

    /// The noon boundary is exclusive at the end and inclusive at the start,
    /// so at exactly 08-01 12:00 week 5 has just ended and week 6 has begun.
    @Test func noonSaturdayBoundaryFlipsWeek5ToPastAndWeek6ToCurrent() throws {
        let boundary = try #require(ChqTime.parse("2026-08-01 12:00:00"))
        #expect(WeekStripState.timeState(week: 5, now: boundary, year: 2026) == .past)
        #expect(WeekStripState.timeState(week: 6, now: boundary, year: 2026) == .current)

        let justBefore = boundary.addingTimeInterval(-1)
        #expect(WeekStripState.timeState(week: 5, now: justBefore, year: 2026) == .current)
        #expect(WeekStripState.timeState(week: 6, now: justBefore, year: 2026) == .upcoming)
    }

    @Test func nilNowMakesEveryWeekUpcoming() {
        for week in 1...9 {
            #expect(WeekStripState.timeState(week: week, now: nil, year: 2026) == .upcoming)
        }
    }

    @Test func beforeSeasonEverythingIsUpcomingAndThereIsNoScrollTarget() throws {
        let now = try #require(ChqTime.parse("2026-06-01 09:00:00"))
        #expect(WeekStripState.timeState(week: 1, now: now, year: 2026) == .upcoming)
        #expect(WeekStripState.initialScrollTarget(now: now, year: 2026) == nil)
    }

    @Test func inSeasonScrollTargetIsTheCurrentWeek() throws {
        let now = try #require(ChqTime.parse("2026-08-03 12:00:00"))
        #expect(WeekStripState.initialScrollTarget(now: now, year: 2026) == 6)
    }

    @Test func afterSeasonScrollTargetIsTheLastWeek() throws {
        let now = try #require(ChqTime.parse("2026-09-15 09:00:00"))
        #expect(WeekStripState.timeState(week: 9, now: now, year: 2026) == .past)
        #expect(WeekStripState.initialScrollTarget(now: now, year: 2026) == 9)
    }

    @Test func nilNowHasNoScrollTarget() {
        #expect(WeekStripState.initialScrollTarget(now: nil, year: 2026) == nil)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `… -only-testing:ChqCalendarTests/WeekStripStateTests`
Expected: compile failure — `cannot find 'WeekStripState' in scope`.

- [ ] **Step 3: Write the implementation**

Create `ios/ChqCalendar/Domain/WeekStripState.swift`:

```swift
import Foundation

/// Where a season week sits relative to "now".
nonisolated enum WeekTimeState: Equatable, Sendable {
    case past
    case current
    case upcoming
}

/// Pure inputs for how `WeekStripView` styles and scrolls its nine chips.
///
/// `now` is optional throughout: callers pass `nil` when the viewed year
/// isn't the current one. A past or future season has no "now" to be
/// relative to, so every week renders neutrally and the strip stays at
/// week 1 rather than guessing.
nonisolated enum WeekStripState {
    static func timeState(week n: Int, now: Date?, year: Int) -> WeekTimeState {
        guard let now,
              let week = SeasonCalendar.weeks(forYear: year).first(where: { $0.number == n })
        else {
            return .upcoming
        }
        if week.contains(now) { return .current }
        return week.end <= now ? .past : .upcoming
    }

    /// The week to scroll to the leading edge on first appearance, so the
    /// current week and everything after it are visible without swiping.
    /// `nil` means "leave it at week 1" — correct both before the season
    /// starts and for a non-current year.
    static func initialScrollTarget(now: Date?, year: Int) -> Int? {
        guard let now else { return nil }
        let weeks = SeasonCalendar.weeks(forYear: year)
        if let current = weeks.first(where: { $0.contains(now) }) {
            return current.number
        }
        guard let last = weeks.last else { return nil }
        // After the season: anchor on the final week. Before it: week 1 is
        // already the leading chip, so there is nothing to scroll to.
        return last.end <= now ? last.number : nil
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `… -only-testing:ChqCalendarTests/WeekStripStateTests`. Expected: PASS (9 tests).

- [ ] **Step 5: Rewrite `WeekStripView`**

Replace the entire contents of `ios/ChqCalendar/Features/Filters/WeekStripView.swift`:

```swift
import SwiftUI

/// The horizontal strip of 9 week chips ("1"–"9") shown as a row of
/// `FilterBarView`. A tap selects that week (see `AppModel.selectWeek`); a
/// long-press shows the week's theme in a context menu.
///
/// Chips are styled by `WeekTimeState` so a user mid-season can tell at a
/// glance what is behind them, what week they are in, and what is ahead —
/// and the strip scrolls the current week to the leading edge on first
/// appearance rather than starting at week 1.
struct WeekStripView: View {
    let model: AppModel

    /// Guards the one-shot initial scroll so it can't fight the user's own
    /// scrolling on subsequent re-renders.
    @State private var hasScrolledToInitialWeek = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(1...9, id: \.self) { number in
                        WeekChip(
                            number: number,
                            isSelected: FilterChipState.isWeekSelected(
                                number, selection: model.filter, currentWeek: model.currentWeek),
                            timeState: WeekStripState.timeState(
                                week: number, now: referenceNow, year: model.selectedYear),
                            theme: model.theme(forWeek: number)
                        ) {
                            model.selectWeek(number)
                        }
                        .id(number)
                    }
                }
                .padding(.horizontal)
            }
            .onAppear {
                guard !hasScrolledToInitialWeek else { return }
                hasScrolledToInitialWeek = true
                guard let target = WeekStripState.initialScrollTarget(
                    now: referenceNow, year: model.selectedYear
                ) else { return }
                // No animation: this is the strip's starting position, not a
                // transition the user should watch happen.
                proxy.scrollTo(target, anchor: .leading)
            }
        }
    }

    /// `nil` for a non-current year — see `WeekStripState`.
    private var referenceNow: Date? {
        model.isCurrentYear ? model.now() : nil
    }
}

private struct WeekChip: View {
    let number: Int
    let isSelected: Bool
    let timeState: WeekTimeState
    let theme: WeeklyTheme?
    let action: () -> Void

    var body: some View {
        let chip = Button(action: action) {
            Text("\(number)")
                .font(.subheadline.weight(timeState == .current ? .bold : .semibold))
                .frame(minWidth: 44, minHeight: 44)
                .foregroundStyle(foreground)
                .background(background, in: Capsule())
                .opacity(timeState == .past && !isSelected ? 0.55 : 1)
                .overlay {
                    if timeState == .current {
                        // Outset by 3pt so the ring stays visible when the
                        // chip is *also* selected — otherwise an accent ring
                        // on an accent fill disappears entirely.
                        Capsule()
                            .strokeBorder(.tint, lineWidth: 2)
                            .padding(-3)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)

        // Themeless weeks (shouldn't happen in practice, but the type is
        // optional) get no context menu attached at all, rather than one
        // with empty content.
        if let theme {
            chip.contextMenu { themeMenuContent(theme) }
        } else {
            chip
        }
    }

    private var foreground: some ShapeStyle {
        if isSelected { return AnyShapeStyle(.white) }
        switch timeState {
        case .past: return AnyShapeStyle(.secondary)
        case .current: return AnyShapeStyle(.tint)
        case .upcoming: return AnyShapeStyle(.primary)
        }
    }

    private var background: some ShapeStyle {
        if isSelected { return AnyShapeStyle(Color.accentColor) }
        return timeState == .past
            ? AnyShapeStyle(.ultraThinMaterial)
            : AnyShapeStyle(.thinMaterial)
    }

    @ViewBuilder
    private func themeMenuContent(_ theme: WeeklyTheme) -> some View {
        Text(theme.title)
            .font(.headline)
        Text("\(theme.startDate) – \(theme.endDate)")
        Text(theme.description)
    }

    private var accessibilityLabel: String {
        let prefix: String
        switch timeState {
        case .past: prefix = "Week \(number), past"
        case .current: prefix = "Week \(number), current week"
        case .upcoming: prefix = "Week \(number)"
        }
        guard let theme else { return prefix }
        return "\(prefix): \(theme.title)"
    }
}
```

- [ ] **Step 6: Expose the model's clock**

`WeekStripView` needs the same instant `AppModel` filters against. In `ios/ChqCalendar/App/AppModel.swift`, change the stored clock (line 52) from `private let now:` to:

```swift
    /// The injected clock. Exposed (rather than private) so views computing
    /// time-relative presentation — `WeekStripView`'s past/current styling —
    /// use the same instant the filter pipeline does, and so tests can pin
    /// both together.
    let now: @Sendable () -> Date
```

- [ ] **Step 7: Run the full suite**

Run the full test command. Expected: PASS.

- [ ] **Step 8: Verify in the simulator**

Build and run on iPhone 17. Confirm: weeks 1–5 render dimmed, week 6 has a visible ring and bold accent text, the strip opens with week 6 at the left edge, and selecting week 6 keeps the ring visible over the accent fill.

- [ ] **Step 9: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add ios/ChqCalendar/Domain/WeekStripState.swift \
        ios/ChqCalendarTests/WeekStripStateTests.swift \
        ios/ChqCalendar/Features/Filters/WeekStripView.swift \
        ios/ChqCalendar/App/AppModel.swift
git commit -m "feat(ios): distinguish past, current, and upcoming weeks; auto-scroll the strip

Past weeks dim, the current week gets a bold accent ring, and the ring is
drawn on a 3pt-outset capsule so it survives selection -- previously ring
and fill were both accentColor, so selecting the current week erased its
only marker. The strip now scrolls the current week to the leading edge on
first appearance instead of always starting at week 1.

WeekStripState keeps the past/current/upcoming decision and the scroll
target as pure functions, including the noon-Saturday boundary behavior.
AppModel.now is no longer private so the view styles against the same
instant the filter pipeline uses.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01L9PjUZ7iWv2QHKSpGQ3D36"
```

---

### Task 3: Inline title, filter-bar density, keyboard dismissal

Spec sections D (title/density only — collapse-on-scroll is Task 7) and D2.

**Files:**
- Create: `ios/ChqCalendar/Support/KeyboardDismisser.swift`
- Modify: `ios/ChqCalendar/Features/Calendar/EventListView.swift`
- Modify: `ios/ChqCalendar/Features/Filters/FilterBarView.swift`
- Modify: `ios/ChqCalendar/Features/Calendar/CalendarView.swift:69,74,81`

**Interfaces:**
- Produces: `KeyboardDismisser.dismiss()` — called from view code at every filter-mutation site. Later tasks (5, 6) add calls at their own new chip sites.

- [ ] **Step 1: Create the keyboard dismisser**

Create `ios/ChqCalendar/Support/KeyboardDismisser.swift`:

```swift
import UIKit

/// Resigns first responder app-wide, putting the keyboard away while
/// leaving the search field and its text intact.
///
/// Deliberately *not* the `dismissSearch` environment action: that tears
/// down the whole search interaction and clears the term. We want the
/// opposite — the search stays applied, the keyboard just stops covering
/// the filter bar.
///
/// A UIKit escape hatch because `@FocusState` cannot be bound to the
/// system `.searchable` field. Confined to `Support/` and called only from
/// views, so `AppModel` and `Domain/` stay UIKit-free and host-free in
/// tests.
@MainActor
enum KeyboardDismisser {
    static func dismiss() {
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil
        )
    }
}
```

- [ ] **Step 2: Switch to an inline navigation title**

In `ios/ChqCalendar/Features/Calendar/EventListView.swift`, replace line 29:

```swift
            .navigationTitle("Chautauqua Calendar")
```

with:

```swift
            // Inline, and shortened to fit beside the year and overflow
            // toolbar items. The large-title band was ~70pt of empty space
            // above the filter bar with no title text ever drawn in it.
            .navigationTitle("CHQ Calendar")
            .navigationBarTitleDisplayMode(.inline)
```

- [ ] **Step 3: Dismiss the keyboard on list scroll**

In the same file, add to the `list` view's modifier chain (after `.listStyle(.plain)`, line 89):

```swift
        .scrollDismissesKeyboard(.immediately)
```

- [ ] **Step 4: Dismiss on submit**

In `ios/ChqCalendar/Features/Calendar/CalendarView.swift`, both `.searchable` call sites (lines 69, 74 in `stackView`, line 81 in `splitView`) get `.submitLabel(.search)` and an `onSubmit`. Replace each

```swift
        .searchable(text: $searchDraft, prompt: "Search events")
```

with

```swift
        .searchable(text: $searchDraft, prompt: "Search events")
        .submitLabel(.search)
        .onSubmit(of: .search) { KeyboardDismisser.dismiss() }
```

- [ ] **Step 5: Dismiss on every filter interaction, and tighten the bar**

In `ios/ChqCalendar/Features/Filters/FilterBarView.swift`, change the outer `VStack` (line 13) and its padding (line 48):

```swift
        VStack(spacing: 6) {
```

```swift
        .padding(.vertical, 6)
```

Then route every mutation through the dismisser. Replace the three chip actions in the scope row:

```swift
                        ) {
                            KeyboardDismisser.dismiss()
                            model.selectScope(scope)
                        }
```

```swift
                    ) {
                        KeyboardDismisser.dismiss()
                        model.toggleFavoritesOnly()
                    }
```

```swift
                    ) {
                        KeyboardDismisser.dismiss()
                        isFilterSheetPresented = true
                    }
```

And in `ios/ChqCalendar/Features/Filters/WeekStripView.swift`, the week chip action:

```swift
                        ) {
                            KeyboardDismisser.dismiss()
                            model.selectWeek(number)
                        }
```

- [ ] **Step 6: Run the full suite**

Run the full test command. Expected: PASS (no test changes — this task is view-level).

- [ ] **Step 7: Verify in the simulator**

Build and run on iPhone 17. Confirm all four:
1. The gap between the toolbar row and the scope chips is gone. If a residual gap remains, **stop and diagnose it on its own evidence** — do not add negative padding.
2. Typing a search term then scrolling the list dismisses the keyboard, term still applied.
3. Tapping the return/search key dismisses the keyboard, term still applied.
4. Tapping a scope or week chip while the keyboard is up dismisses it, term still applied.

- [ ] **Step 8: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add ios/ChqCalendar/Support/KeyboardDismisser.swift \
        ios/ChqCalendar/Features/Calendar/EventListView.swift \
        ios/ChqCalendar/Features/Calendar/CalendarView.swift \
        ios/ChqCalendar/Features/Filters/FilterBarView.swift \
        ios/ChqCalendar/Features/Filters/WeekStripView.swift
git commit -m "feat(ios): inline title, tighter filter bar, dismissible search keyboard

The large-title navigation band drew no title text but reserved ~70pt
above the filter bar; an inline title reclaims it. Filter bar spacing and
vertical padding drop to 6pt, with 44pt hit targets unchanged.

The search keyboard previously held first responder for as long as a term
was present, covering the filter bar. It now releases on list scroll, on
the return key, and on any filter chip tap -- the term stays applied in
every case. KeyboardDismisser resigns first responder rather than calling
dismissSearch, which would tear down the search and clear the term.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01L9PjUZ7iWv2QHKSpGQ3D36"
```

---

### Task 4: Selection storage — original casing, ordered arrays

Spec section C5. **Lands before anything that renders a venue or category name.**

**Files:**
- Modify: `ios/ChqCalendar/Data/UserStateStore.swift:31-32,40-41,48-49,59-60,70-71,95-96,141-142`
- Modify: `ios/ChqCalendar/Domain/EventFilter.swift:73-82`
- Modify: `ios/ChqCalendar/App/AppModel.swift:273-296`
- Modify: `ios/ChqCalendar/Features/Filters/FilterSheetView.swift:25,37`
- Modify: `ios/ChqCalendarTests/AppModelTests.swift:281-311`
- Modify: `ios/ChqCalendarTests/EventFilterTests.swift`
- Modify: `ios/ChqCalendarTests/UserStateStoreTests.swift`

**Interfaces:**
- Produces: `FilterSelection.selectedLocations: [String]` and `.selectedCategories: [String]`, holding the feed's **original casing** in **selection order**. `AppModel.toggleLocation(_:)` / `.toggleCategory(_:)` unchanged in signature; comparison becomes case-insensitive.

- [ ] **Step 1: Write the failing tests**

In `ios/ChqCalendarTests/UserStateStoreTests.swift`, add:

```swift
    // MARK: - Selection storage (original casing, ordered)

    @Test func selectionsRoundTripPreservingCasingAndOrder() {
        let defaults = makeDefaults()
        let store = UserStateStore(defaults: defaults, now: { Date() })
        var filter = FilterSelection()
        filter.selectedLocations = ["Amphitheater", "Elizabeth S. Lenna Hall"]
        filter.selectedCategories = ["CSO", "CHQ Assembly"]

        store.saveFilters(filter)
        let reloaded = UserStateStore(defaults: defaults, now: { Date() }).loadFilters()

        #expect(reloaded?.selectedLocations == ["Amphitheater", "Elizabeth S. Lenna Hall"])
        #expect(reloaded?.selectedCategories == ["CSO", "CHQ Assembly"])
    }

    /// Payloads written by the shipped build stored these as JSON arrays of
    /// lowercased strings (they were `Set<String>`). Decoding must still
    /// yield the selections rather than throwing and silently wiping them.
    @Test func legacyLowercasedPayloadStillDecodes() throws {
        let defaults = makeDefaults()
        let legacy = """
        {"dateScope":"next","selectedWeeks":[3],\
        "selectedLocations":["amphitheater"],"selectedCategories":["cso"],\
        "showFavoritesOnly":false,"lastSaved":"2026-08-01T12:00:00Z"}
        """
        defaults.set(Data(legacy.utf8), forKey: "chq-filters")

        let now = try #require(ChqTime.parse("2026-08-02 12:00:00"))
        let loaded = UserStateStore(defaults: defaults, now: { now }).loadFilters()

        #expect(loaded?.selectedLocations == ["amphitheater"])
        #expect(loaded?.selectedCategories == ["cso"])
        #expect(loaded?.selectedWeeks == [3])
    }
```

In `ios/ChqCalendarTests/EventFilterTests.swift`, add:

```swift
    // MARK: - Case-insensitive venue/category matching

    @Test func originalCasedSelectionMatchesLowercasedEventFields() throws {
        let start = try #require(ChqTime.parse("2026-07-01 10:00:00"))
        let events = [
            makeEvent(id: "a", start: start, location: "Amphitheater", categories: ["CSO"]),
            makeEvent(id: "b", start: start, location: "Norton Hall", categories: ["CLSC"]),
        ]
        var filter = FilterSelection(dateScope: .all)
        filter.selectedLocations = ["Amphitheater"]

        let result = EventFilter.apply(
            filter, to: events, favorites: [], now: start, year: 2026, isCurrentYear: true)

        #expect(result.map(\.id) == ["a"])
    }

    @Test func differentlyCasedDuplicateDoesNotNarrowFurther() throws {
        let start = try #require(ChqTime.parse("2026-07-01 10:00:00"))
        let events = [
            makeEvent(id: "a", start: start, location: "Amphitheater"),
            makeEvent(id: "b", start: start, location: "Norton Hall"),
        ]
        var filter = FilterSelection(dateScope: .all)
        filter.selectedLocations = ["Amphitheater", "AMPHITHEATER"]

        let result = EventFilter.apply(
            filter, to: events, favorites: [], now: start, year: 2026, isCurrentYear: true)

        #expect(result.map(\.id) == ["a"])
    }

    @Test func categorySelectionMatchesFilterTokensCaseInsensitively() throws {
        let start = try #require(ChqTime.parse("2026-07-01 10:00:00"))
        let events = [
            makeEvent(id: "a", start: start, categories: ["CSO"]),
            makeEvent(id: "b", start: start, categories: ["CLSC"]),
        ]
        var filter = FilterSelection(dateScope: .all)
        filter.selectedCategories = ["CSO"]

        let result = EventFilter.apply(
            filter, to: events, favorites: [], now: start, year: 2026, isCurrentYear: true)

        #expect(result.map(\.id) == ["a"])
    }
```

In `ios/ChqCalendarTests/AppModelTests.swift`, replace the bodies of `toggleLocationMutatesAndPersistsFilterLowercased` (line 281) and `toggleCategoryMutatesAndPersistsFilterLowercased` (line 297) — including their names — with:

```swift
    @Test func toggleLocationStoresOriginalCasingAndPersists() {
        let defaults = makeDefaults()
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: defaults, now: { Date() })
        )

        model.toggleLocation("Hall Of Philosophy")
        #expect(model.filter.selectedLocations == ["Hall Of Philosophy"])
        #expect(UserStateStore(defaults: defaults, now: { Date() })
            .loadFilters()?.selectedLocations == ["Hall Of Philosophy"])

        // Removal is case-insensitive, matching the web's toggleInList.
        model.toggleLocation("hall of philosophy")
        #expect(model.filter.selectedLocations.isEmpty)
        #expect(UserStateStore(defaults: defaults, now: { Date() })
            .loadFilters()?.selectedLocations.isEmpty == true)
    }

    @Test func toggleCategoryStoresOriginalCasingAndPersists() {
        let defaults = makeDefaults()
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: defaults, now: { Date() })
        )

        model.toggleCategory("CSO")
        #expect(model.filter.selectedCategories == ["CSO"])
        #expect(UserStateStore(defaults: defaults, now: { Date() })
            .loadFilters()?.selectedCategories == ["CSO"])

        model.toggleCategory("cso")
        #expect(model.filter.selectedCategories.isEmpty)
    }

    @Test func selectionsKeepInsertionOrder() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )

        model.toggleLocation("Norton Hall")
        model.toggleLocation("Amphitheater")
        #expect(model.filter.selectedLocations == ["Norton Hall", "Amphitheater"])
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run the full test command.
Expected: FAIL — `toggleLocationStoresOriginalCasingAndPersists` fails because the model lowercases (`"hall of philosophy" != "Hall Of Philosophy"`), and `selectionsKeepInsertionOrder` fails to compile or produces an unordered result against `Set`.

- [ ] **Step 3: Change the storage type**

In `ios/ChqCalendar/Data/UserStateStore.swift`:

Lines 31–32, in `FilterSelection`:
```swift
    var selectedLocations: [String] = []
    var selectedCategories: [String] = []
```

Lines 40–41, in the initializer parameters:
```swift
        selectedLocations: [String] = [],
        selectedCategories: [String] = [],
```

Lines 95–96, in `PersistedFilters`:
```swift
        var selectedLocations: [String]
        var selectedCategories: [String]
```

Update the doc comment above `selectedLocations` (or add one) to record why:
```swift
    /// Venue and category selections hold the feed's **original casing** in
    /// selection order, matching the web's `selectedLocations` /
    /// `selectedTags`. Comparison is lowercased at the point of use
    /// (`EventFilter.apply`), not at the point of storage: the stored value
    /// is what gets rendered as a chip label, and `DisplayNames` is an
    /// exact-match dictionary keyed on the original casing.
```

`isDefault` (line 59-60) and `activeCount` (line 70-71) need no edit — `.isEmpty` and `.count` work identically on `Array`.

- [ ] **Step 4: Move the lowercasing into `EventFilter`**

In `ios/ChqCalendar/Domain/EventFilter.swift`, replace lines 73–82:

```swift
        // Lowercased once per call rather than per event — mirrors the web's
        // `selectedLocationsLowerSet` / `selectedTagsLowerSet` memos. The
        // selection itself stores original casing so it can be rendered as
        // chip labels; only the comparison is case-folded.
        if !sel.selectedLocations.isEmpty {
            let selected = Set(sel.selectedLocations.map { $0.lowercased() })
            result = result.filter { event in
                guard let location = event.displayLocation?.lowercased() else { return false }
                return selected.contains(location)
            }
        }

        if !sel.selectedCategories.isEmpty {
            let selected = Set(sel.selectedCategories.map { $0.lowercased() })
            result = result.filter { !selected.isDisjoint(with: $0.filterTokens) }
        }
```

- [ ] **Step 5: Make the toggles case-insensitive**

In `ios/ChqCalendar/App/AppModel.swift`, replace lines 273–296 (both toggle methods):

```swift
    /// Toggles `name` in `filter.selectedLocations`, storing the original
    /// casing and comparing case-insensitively — the web's `toggleInList`.
    func toggleLocation(_ name: String) {
        filter.selectedLocations = Self.toggling(name, in: filter.selectedLocations)
        persistFilter()
    }

    /// Toggles `name` in `filter.selectedCategories`. See `toggleLocation`.
    func toggleCategory(_ name: String) {
        filter.selectedCategories = Self.toggling(name, in: filter.selectedCategories)
        persistFilter()
    }

    /// Removes every case-insensitive match of `name`, or appends `name`
    /// (original casing) when there is none. Appending — rather than
    /// inserting — is what keeps the chip row in selection order.
    private static func toggling(_ name: String, in list: [String]) -> [String] {
        let key = name.lowercased()
        if list.contains(where: { $0.lowercased() == key }) {
            return list.filter { $0.lowercased() != key }
        }
        return list + [name]
    }
```

- [ ] **Step 6: Keep the sheet compiling**

`FilterSheetView` is deleted in Task 5, but must compile now. In `ios/ChqCalendar/Features/Filters/FilterSheetView.swift`, replace line 25:

```swift
                            isSelected: model.filter.selectedCategories
                                .contains { $0.lowercased() == category.lowercased() }
```

and line 37:

```swift
                            isSelected: model.filter.selectedLocations
                                .contains { $0.lowercased() == location.lowercased() }
```

- [ ] **Step 7: Run the full suite**

Run the full test command. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add ios/ChqCalendar/Data/UserStateStore.swift \
        ios/ChqCalendar/Domain/EventFilter.swift \
        ios/ChqCalendar/App/AppModel.swift \
        ios/ChqCalendar/Features/Filters/FilterSheetView.swift \
        ios/ChqCalendarTests/UserStateStoreTests.swift \
        ios/ChqCalendarTests/EventFilterTests.swift \
        ios/ChqCalendarTests/AppModelTests.swift
git commit -m "refactor(ios): store venue/category selections the web's way

selectedLocations/selectedCategories become ordered [String] holding the
feed's original casing, matching useFilterState. The lowercasing moves to
the comparison site: EventFilter.apply hoists a lowercased Set once per
call, mirroring the selectedLocationsLowerSet memo, and toggleLocation/
toggleCategory mirror toggleInList.

Two defects this pre-empts, both of which would surface once selections
are rendered as chips: DisplayNames is an exact-match dictionary keyed on
original casing, so a lowercased key would render 'elizabeth s. lenna
hall' instead of 'Lenna Hall'; and Set<String> has no stable iteration
order, so a chip row built from it would reshuffle between renders.

No migration needed -- Set<String> and [String] both encode as a JSON
array. A pinning test covers decoding a payload written by the shipped
build so the change cannot silently drop selections.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01L9PjUZ7iWv2QHKSpGQ3D36"
```

---

### Task 5: Venue and category facet rows; delete the filter sheet

Spec sections C1, C2, C3. The largest task — it is one deliverable because the rows are useless without recents, and deleting the sheet is what forces the inline panel to exist.

**Files:**
- Create: `ios/ChqCalendar/Domain/FacetCounts.swift`
- Create: `ios/ChqCalendar/Support/FlowLayout.swift`
- Create: `ios/ChqCalendar/Features/Filters/FacetRowView.swift`
- Create: `ios/ChqCalendarTests/FacetCountsTests.swift`
- Modify: `ios/ChqCalendar/Data/UserStateStore.swift` (add `RecentFilters` + accessors)
- Modify: `ios/ChqCalendar/App/AppModel.swift`
- Modify: `ios/ChqCalendar/Features/Filters/FilterBarView.swift`
- Modify: `ios/ChqCalendarTests/UserStateStoreTests.swift`
- Modify: `ios/ChqCalendarTests/AppModelTests.swift`
- **Delete:** `ios/ChqCalendar/Features/Filters/FilterSheetView.swift`

**Interfaces:**
- Consumes: `AppModel.toggleLocation/toggleCategory` (Task 4), `DisplayNames.visibleLocations/visibleCategories/location/category`, `KeyboardDismisser.dismiss()` (Task 3).
- Produces: `RecentFilters` (`locations: [String]`, `categories: [String]`, `static adding(_:to:max:) -> [String]`), `UserStateStore.loadRecents() -> RecentFilters`, `UserStateStore.saveRecents(_ r: RecentFilters)`, `FacetCounts` (`locations: [String: Int]`, `categories: [String: Int]`, `static build(from:) -> FacetCounts`, `static empty`), `AppModel.recents`, `AppModel.facetCounts`, `AppModel.available(_:) -> [String]`, `AppModel.recents(_:) -> [String]`, `AppModel.isSelected(_:in:) -> Bool`, `AppModel.toggle(_:in:)`, `FilterFacet` (`.venues` / `.categories`), `FlowLayout`.

- [ ] **Step 1: Write the failing persistence and counts tests**

In `ios/ChqCalendarTests/UserStateStoreTests.swift`, add:

```swift
    // MARK: - RecentFilters

    @Test func addingPutsNewestFirst() {
        var list: [String] = []
        list = RecentFilters.adding("Amphitheater", to: list)
        list = RecentFilters.adding("Norton Hall", to: list)
        #expect(list == ["Norton Hall", "Amphitheater"])
    }

    @Test func addingMovesAnExistingEntryToTheFrontWithoutDuplicating() {
        let list = RecentFilters.adding(
            "amphitheater", to: ["Norton Hall", "Amphitheater", "Lenna Hall"])
        #expect(list == ["amphitheater", "Norton Hall", "Lenna Hall"])
    }

    @Test func addingCapsAtTen() {
        var list = (1...10).map { "Venue \($0)" }
        list = RecentFilters.adding("Venue 11", to: list)
        #expect(list.count == 10)
        #expect(list.first == "Venue 11")
        #expect(!list.contains("Venue 10"))
    }

    @Test func recentsRoundTrip() {
        let defaults = makeDefaults()
        let store = UserStateStore(defaults: defaults, now: { Date() })
        store.saveRecents(RecentFilters(locations: ["Amphitheater"], categories: ["CSO"]))

        let reloaded = UserStateStore(defaults: defaults, now: { Date() }).loadRecents()
        #expect(reloaded.locations == ["Amphitheater"])
        #expect(reloaded.categories == ["CSO"])
    }

    @Test func missingRecentsKeyYieldsEmptyAndLeavesFiltersAlone() {
        let defaults = makeDefaults()
        let store = UserStateStore(defaults: defaults, now: { Date() })
        var filter = FilterSelection()
        filter.selectedWeeks = [2]
        store.saveFilters(filter)

        let reloaded = UserStateStore(defaults: defaults, now: { Date() })
        #expect(reloaded.loadRecents() == RecentFilters())
        #expect(reloaded.loadFilters()?.selectedWeeks == [2])
    }

    @Test func recentsExpireAfterThirtyDays() throws {
        let defaults = makeDefaults()
        let saved = try #require(ChqTime.parse("2026-06-01 12:00:00"))
        UserStateStore(defaults: defaults, now: { saved })
            .saveRecents(RecentFilters(locations: ["Amphitheater"], categories: []))

        let muchLater = saved.addingTimeInterval(31 * 24 * 3600)
        #expect(UserStateStore(defaults: defaults, now: { muchLater }).loadRecents()
            == RecentFilters())
    }
```

Create `ios/ChqCalendarTests/FacetCountsTests.swift`:

```swift
import Foundation
import Testing
@testable import ChqCalendar

struct FacetCountsTests {
    @Test func countsLocationsAndCategoriesLowercased() throws {
        let start = try #require(ChqTime.parse("2026-07-01 10:00:00"))
        let events = [
            makeEvent(id: "a", start: start, location: "Amphitheater", categories: ["CSO"]),
            makeEvent(id: "b", start: start, location: "Amphitheater", categories: ["CSO"]),
            makeEvent(id: "c", start: start, location: "Norton Hall", categories: ["CLSC"]),
        ]

        let counts = FacetCounts.build(from: events)

        #expect(counts.locations["amphitheater"] == 2)
        #expect(counts.locations["norton hall"] == 1)
        #expect(counts.categories["cso"] == 2)
        #expect(counts.categories["clsc"] == 1)
    }

    @Test func eventsWithoutALocationAreSkipped() throws {
        let start = try #require(ChqTime.parse("2026-07-01 10:00:00"))
        let counts = FacetCounts.build(from: [makeEvent(id: "a", start: start)])
        #expect(counts.locations.isEmpty)
    }

    @Test func emptyIsAllZeroes() {
        #expect(FacetCounts.empty.locations.isEmpty)
        #expect(FacetCounts.empty.categories.isEmpty)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run the full test command. Expected: compile failure — `cannot find 'RecentFilters' in scope`, `cannot find 'FacetCounts' in scope`.

- [ ] **Step 3: Add `RecentFilters` and its store accessors**

In `ios/ChqCalendar/Data/UserStateStore.swift`, add above the `UserStateStore` struct:

```swift
/// The user's most-recently-used venue and category filters, so repeating a
/// filter is one tap instead of a trip through a picker.
///
/// Persisted state but *not* filter input: `EventFilter` never sees this.
/// Names carry the feed's original casing, matching `FilterSelection`.
nonisolated struct RecentFilters: Codable, Equatable, Sendable {
    var locations: [String] = []
    var categories: [String] = []

    /// `item` moved to the front, any case-insensitive duplicate removed,
    /// truncated to `max`. The web's `addToRecent`, plus case-insensitive
    /// matching so "CSO" and "cso" can't both occupy a slot.
    static func adding(_ item: String, to list: [String], max: Int = 10) -> [String] {
        let key = item.lowercased()
        return ([item] + list.filter { $0.lowercased() != key }).prefix(max).map { $0 }
    }
}
```

Inside `UserStateStore`, add the key alongside `filtersKey`/`favoritesKey`:

```swift
    private static let recentsKey = "chq-recents"
```

a persisted wrapper alongside `PersistedFavorites`:

```swift
    private struct PersistedRecents: Codable {
        var recents: RecentFilters
        var lastSaved: Date
    }
```

and the accessors, after `saveFavorites`:

```swift
    /// Loads the persisted recents, or empty ones if nothing was saved or
    /// the saved state is 30+ days old. Stored under its own key rather
    /// than inside `PersistedFilters` so adding it can't affect decoding of
    /// an existing filters payload.
    func loadRecents() -> RecentFilters {
        guard
            let data = defaults.data(forKey: Self.recentsKey),
            let persisted = try? Self.decoder.decode(PersistedRecents.self, from: data),
            now().timeIntervalSince(persisted.lastSaved) < Self.expiry
        else {
            return RecentFilters()
        }
        return persisted.recents
    }

    func saveRecents(_ recents: RecentFilters) {
        let persisted = PersistedRecents(recents: recents, lastSaved: now())
        guard let data = try? Self.encoder.encode(persisted) else { return }
        defaults.set(data, forKey: Self.recentsKey)
    }
```

- [ ] **Step 4: Add `FacetCounts`**

Create `ios/ChqCalendar/Domain/FacetCounts.swift`:

```swift
import Foundation

/// How many events in the unfiltered snapshot each venue and category
/// matches, for the counts shown beside names in the expanded facet panels.
///
/// Keys are lowercased on both sides: locations key on lowercased
/// `displayLocation`, categories on `filterTokens` (already lowercased) —
/// exactly what `EventFilter` compares against, so a count can never
/// disagree with what tapping it produces.
nonisolated struct FacetCounts: Equatable, Sendable {
    let locations: [String: Int]
    let categories: [String: Int]

    static let empty = FacetCounts(locations: [:], categories: [:])

    /// One pass over `events` for both facets.
    static func build(from events: [Event]) -> FacetCounts {
        var locations: [String: Int] = [:]
        var categories: [String: Int] = [:]
        for event in events {
            for token in event.filterTokens {
                categories[token, default: 0] += 1
            }
            if let location = event.displayLocation?.lowercased() {
                locations[location, default: 0] += 1
            }
        }
        return FacetCounts(locations: locations, categories: categories)
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `… -only-testing:ChqCalendarTests/FacetCountsTests -only-testing:ChqCalendarTests/UserStateStoreTests`. Expected: PASS.

- [ ] **Step 6: Write the failing AppModel recents tests**

In `ios/ChqCalendarTests/AppModelTests.swift`, add:

```swift
    // MARK: - Recents

    @Test func selectingAFilterPushesItOntoRecents() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )

        model.toggleLocation("Amphitheater")
        model.toggleCategory("CSO")

        #expect(model.recents.locations == ["Amphitheater"])
        #expect(model.recents.categories == ["CSO"])
    }

    @Test func deselectingDoesNotReorderRecents() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )

        model.toggleLocation("Amphitheater")
        model.toggleLocation("Norton Hall")
        #expect(model.recents.locations == ["Norton Hall", "Amphitheater"])

        model.toggleLocation("Amphitheater")   // deselect
        #expect(model.recents.locations == ["Norton Hall", "Amphitheater"])
    }

    @Test func recentsPersistAcrossModelInstances() {
        let defaults = makeDefaults()
        let store = UserStateStore(defaults: defaults, now: { Date() })
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()), store: store)
        model.toggleLocation("Amphitheater")

        let reborn = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: defaults, now: { Date() })
        )
        #expect(reborn.recents.locations == ["Amphitheater"])
    }

    @Test func facetHelpersReadThroughToTheSelection() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )

        model.toggle("Amphitheater", in: .venues)
        #expect(model.isSelected("amphitheater", in: .venues))
        #expect(!model.isSelected("Amphitheater", in: .categories))
        #expect(model.recentNames(.venues) == ["Amphitheater"])
    }
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `… -only-testing:ChqCalendarTests/AppModelTests`. Expected: compile failure — `value of type 'AppModel' has no member 'recents'`.

- [ ] **Step 8: Add the facet API to `AppModel`**

In `ios/ChqCalendar/App/AppModel.swift`:

Change the `snapshot` declaration (line 35) so counts are computed once per snapshot rather than per render:

```swift
    var snapshot: CalendarSnapshot? {
        didSet {
            facetCounts = snapshot.map { FacetCounts.build(from: $0.events) } ?? .empty
        }
    }

    /// Per-venue / per-category event counts for the current snapshot.
    /// Recomputed only when `snapshot` changes — a full pass over ~1,500
    /// events is far too expensive to redo on every view render.
    private(set) var facetCounts: FacetCounts = .empty

    /// The user's most-recently-used venue and category filters.
    private(set) var recents: RecentFilters
```

In `init` (after `self.favorites = store.loadFavorites()`, line 72):

```swift
        self.recents = store.loadRecents()
```

Replace the two toggle **methods** written in Task 4 with versions that record recents. **Keep the `private static func toggling(_:in:)` helper** — both versions still call it.

`FilterFacet` (used below) is introduced in Step 10. The project will not compile between here and there; that is expected within this task.

```swift
    /// Toggles `name` in `filter.selectedLocations`, storing the original
    /// casing and comparing case-insensitively — the web's `toggleInList`.
    /// Selecting (not deselecting) also promotes `name` to the front of
    /// recents, matching `useFilterState`'s TOGGLE_LOCATION case.
    func toggleLocation(_ name: String) {
        let wasSelected = isSelected(name, in: .venues)
        filter.selectedLocations = Self.toggling(name, in: filter.selectedLocations)
        if !wasSelected {
            recents.locations = RecentFilters.adding(name, to: recents.locations)
            store.saveRecents(recents)
        }
        persistFilter()
    }

    /// Toggles `name` in `filter.selectedCategories`. See `toggleLocation`.
    func toggleCategory(_ name: String) {
        let wasSelected = isSelected(name, in: .categories)
        filter.selectedCategories = Self.toggling(name, in: filter.selectedCategories)
        if !wasSelected {
            recents.categories = RecentFilters.adding(name, to: recents.categories)
            store.saveRecents(recents)
        }
        persistFilter()
    }
```

And add the facet-generic accessors the views use, after `toggleCategory`:

```swift
    // MARK: Facet-generic accessors
    //
    // `FacetRowView` is one view driving either facet, so it reaches the
    // model through these rather than branching on the facet itself.

    /// Every venue/category present in the current snapshot, original
    /// casing, sorted by display name.
    func available(_ facet: FilterFacet) -> [String] {
        switch facet {
        case .venues: return visibleLocations
        case .categories: return visibleCategories
        }
    }

    /// Named `recentNames` rather than `recents(_:)` so it can't be misread
    /// against the `recents` property it reads from.
    func recentNames(_ facet: FilterFacet) -> [String] {
        switch facet {
        case .venues: return recents.locations
        case .categories: return recents.categories
        }
    }

    func isSelected(_ name: String, in facet: FilterFacet) -> Bool {
        let key = name.lowercased()
        switch facet {
        case .venues: return filter.selectedLocations.contains { $0.lowercased() == key }
        case .categories: return filter.selectedCategories.contains { $0.lowercased() == key }
        }
    }

    func toggle(_ name: String, in facet: FilterFacet) {
        switch facet {
        case .venues: toggleLocation(name)
        case .categories: toggleCategory(name)
        }
    }

    func count(for name: String, in facet: FilterFacet) -> Int {
        let key = name.lowercased()
        switch facet {
        case .venues: return facetCounts.locations[key] ?? 0
        case .categories: return facetCounts.categories[key] ?? 0
        }
    }

    /// How many of `facet`'s values are currently selected, for the row
    /// label ("Venues (2 selected)").
    func selectedCount(_ facet: FilterFacet) -> Int {
        switch facet {
        case .venues: return filter.selectedLocations.count
        case .categories: return filter.selectedCategories.count
        }
    }
```

- [ ] **Step 9: Add `FlowLayout`**

Create `ios/ChqCalendar/Support/FlowLayout.swift`:

```swift
import SwiftUI

/// Places subviews left-to-right, wrapping to a new line when the next one
/// would overflow the proposed width.
///
/// Used by the expanded facet panels. `LazyVGrid` is the obvious
/// alternative but sizes every cell to the widest column, and these chips
/// range from "CSO" to "Chautauqua Theater Company" — most of each row
/// would be empty.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(
        proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
    ) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > maxWidth {
                totalHeight += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }

        return CGSize(
            width: maxWidth == .infinity ? x : maxWidth,
            height: totalHeight + rowHeight
        )
    }

    func placeSubviews(
        in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
    ) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(
                at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
```

- [ ] **Step 10: Add `FacetRowView`**

Create `ios/ChqCalendar/Features/Filters/FacetRowView.swift`:

```swift
import SwiftUI

/// Which of the two orthogonal filter facets a `FacetRowView` drives.
///
/// "Venues" rather than the web's "Locations": every value in this list is
/// a place an event happens, and the shorter word leaves more of the row
/// for the chips that matter.
enum FilterFacet: String, Identifiable, CaseIterable, Sendable {
    case venues
    case categories

    var id: String { rawValue }

    var title: String {
        switch self {
        case .venues: return "Venues"
        case .categories: return "Categories"
        }
    }
}

/// One facet's row: a disclosure label, that facet's recently-used filters
/// inline beside it, and — when expanded — the full list in place.
///
/// The inline recents are the point of the whole control: applying a repeat
/// filter costs one tap with no preceding tap, and MRU ordering keeps the
/// filter you just used leftmost, hence always on screen and always one tap
/// from being removed. Mirrors `LocationFilter.tsx` / `CategoryFilter.tsx`.
struct FacetRowView: View {
    let model: AppModel
    let facet: FilterFacet
    let isExpanded: Bool
    let onToggleExpanded: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                disclosureLabel
                recentsStrip
            }
            .padding(.horizontal)

            if isExpanded {
                expandedPanel
                    .padding(.horizontal)
            }
        }
    }

    private var disclosureLabel: some View {
        Button {
            KeyboardDismisser.dismiss()
            onToggleExpanded()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.bold))
                    .rotationEffect(.degrees(isExpanded ? 90 : 0))
                Text(labelText)
                    .font(.subheadline.weight(.medium))
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            isExpanded ? "Hide all \(facet.title.lowercased())"
                       : "Show all \(facet.title.lowercased())")
    }

    private var labelText: String {
        let selected = model.selectedCount(facet)
        return selected > 0 ? "\(facet.title) (\(selected))" : facet.title
    }

    private var recentsStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(model.recentNames(facet), id: \.self) { name in
                    FacetChip(
                        label: displayName(name),
                        count: nil,
                        isSelected: model.isSelected(name, in: facet)
                    ) {
                        KeyboardDismisser.dismiss()
                        model.toggle(name, in: facet)
                    }
                }
            }
        }
    }

    private var expandedPanel: some View {
        ScrollView(.vertical, showsIndicators: true) {
            FlowLayout(spacing: 8) {
                ForEach(model.available(facet), id: \.self) { name in
                    FacetChip(
                        label: displayName(name),
                        count: model.count(for: name, in: facet),
                        isSelected: model.isSelected(name, in: facet)
                    ) {
                        KeyboardDismisser.dismiss()
                        model.toggle(name, in: facet)
                    }
                }
            }
            .padding(.vertical, 4)
        }
        // Capped so the panel never pushes the event list off screen —
        // the list staying visible and updating live underneath is the
        // whole reason this is inline rather than a sheet.
        .frame(maxHeight: 140)
    }

    private func displayName(_ name: String) -> String {
        switch facet {
        case .venues: return DisplayNames.location(name)
        case .categories: return DisplayNames.category(name)
        }
    }
}

private struct FacetChip: View {
    let label: String
    let count: Int?
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(label)
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.caption2.weight(.bold))
                }
                if let count {
                    Text("\(count)")
                        .font(.caption2)
                        .foregroundStyle(isSelected ? .white.opacity(0.7) : .secondary)
                }
            }
            .font(.subheadline)
            .lineLimit(1)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .foregroundStyle(isSelected ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            .background(
                isSelected ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.thinMaterial),
                in: Capsule()
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isSelected ? "\(label), selected" : label)
    }
}
```

- [ ] **Step 11: Wire the rows into `FilterBarView` and drop the sheet**

In `ios/ChqCalendar/Features/Filters/FilterBarView.swift`:

Replace `@State private var isFilterSheetPresented = false` (line 10) with:

```swift
    /// At most one facet panel is open at a time — two 140pt panels plus
    /// four rows would bury the list entirely.
    @State private var expandedFacet: FilterFacet?
```

Delete the entire `FilterChip(label: "Filters", …)` block (lines 34–41) and the `.sheet(isPresented:)` modifier (lines 50–52).

After `WeekStripView(model: model)` (line 46), add:

```swift
            ForEach(FilterFacet.allCases) { facet in
                FacetRowView(
                    model: model,
                    facet: facet,
                    isExpanded: expandedFacet == facet
                ) {
                    expandedFacet = expandedFacet == facet ? nil : facet
                }
            }
```

Replace the DEBUG hook body (`presentFilterSheetIfNeeded`, lines 66–73) with:

```swift
    #if DEBUG
    /// `-uitest-show-filters` used to present the filter sheet; the sheet is
    /// gone, so it now expands the Venues panel — the equivalent "show me
    /// the filter UI" state for the App Store screenshot.
    private func expandFacetIfNeeded() {
        if model.uiTestShowFilters {
            model.uiTestShowFilters = false
            expandedFacet = .venues
        }
    }
    #endif
```

and update both call sites (lines 61–62) from `presentFilterSheetIfNeeded` to `expandFacetIfNeeded`.

Delete the file:

```bash
git rm ios/ChqCalendar/Features/Filters/FilterSheetView.swift
```

- [ ] **Step 12: Remove `activeCount`**

`activeCount` existed only to badge the deleted Filters chip. Confirm nothing else uses it:

```bash
cd /Users/bernard/src/chq/chq-calendar && grep -rn "activeCount" ios/
```

Expected: only `Data/UserStateStore.swift` (declaration + the doc comment on line 24) and `ChqCalendarTests/UserStateStoreTests.swift`. Delete the `activeCount` computed property (lines 66–74) and the four tests under `// MARK: - FilterSelection.activeCount`. In the line-24 doc comment, change ``excluded from `isDefault`/`activeCount` `` to ``excluded from `isDefault` ``.

If the grep shows any other caller, keep the property and note why in the commit message.

- [ ] **Step 13: Run the full suite**

Run the full test command. Expected: PASS.

- [ ] **Step 14: Verify in the simulator**

Build and run on iPhone 17. Confirm:
1. Venues and Categories each have their own row; no chips are interleaved between them.
2. Tapping a venue chip filters immediately, with no sheet and no navigation.
3. That venue jumps to the front of its row and renders filled with a checkmark.
4. Tapping `Venues` expands the full list in place; the event list stays visible and updates live as chips are tapped.
5. Expanding Categories collapses Venues.

- [ ] **Step 15: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add ios/ChqCalendar/Domain/FacetCounts.swift \
        ios/ChqCalendar/Support/FlowLayout.swift \
        ios/ChqCalendar/Features/Filters/FacetRowView.swift \
        ios/ChqCalendarTests/FacetCountsTests.swift \
        ios/ChqCalendar/Data/UserStateStore.swift \
        ios/ChqCalendar/App/AppModel.swift \
        ios/ChqCalendar/Features/Filters/FilterBarView.swift \
        ios/ChqCalendarTests/UserStateStoreTests.swift \
        ios/ChqCalendarTests/AppModelTests.swift
git commit -m "feat(ios): inline venue and category filtering; delete the filter sheet

Adopts the web's two-facet structure (LocationFilter.tsx /
CategoryFilter.tsx). Venues and categories get a row each -- never
interleaved, since both are common and orthogonal -- with that facet's
most-recently-used filters inline beside the label. Applying a repeat
filter is now one tap with no preceding tap; MRU ordering keeps the filter
you just used leftmost, so it is always visible and always one tap from
removal.

Tapping the label expands that facet's full list IN PLACE rather than
presenting a modal, so the event list stays visible and updates live
underneath. That is the direct fix for filtering costing you your context.
FilterSheetView is deleted, and with it the Filters chip and
FilterSelection.activeCount, which existed only to badge that chip.

RecentFilters persists under its own chq-recents key with the same 30-day
expiry, so it cannot affect decoding of the existing filters payload.
FacetCounts moves the per-item counts out of the view and is recomputed in
snapshot's didSet -- a pass over ~1,500 events was previously redone on
every sheet appearance. FlowLayout wraps variable-width chips, which
LazyVGrid's fixed columns would size to the widest entry.

The -uitest-show-filters screenshot hook now expands the Venues panel.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01L9PjUZ7iWv2QHKSpGQ3D36"
```

---

### Task 6: Reset row and match count

Spec sections C4 and C6.

**Files:**
- Create: `ios/ChqCalendar/Domain/ActiveFilterChips.swift`
- Create: `ios/ChqCalendarTests/ActiveFilterChipsTests.swift`
- Create: `ios/ChqCalendarTests/FilterSelectionTests.swift`
- Create: `ios/ChqCalendar/Features/Filters/ResetFilterRow.swift`
- Modify: `ios/ChqCalendar/Data/UserStateStore.swift` (add the `has*Filters` predicates)
- Modify: `ios/ChqCalendar/App/AppModel.swift` (replace `clearFilters`)
- Modify: `ios/ChqCalendar/Features/Filters/FilterBarView.swift`
- Modify: `ios/ChqCalendar/Features/Calendar/EventListView.swift`
- Modify: `ios/ChqCalendarTests/AppModelTests.swift`

**Interfaces:**
- Consumes: `FilterSelection` (Task 4 types), `DisplayNames`, `KeyboardDismisser`.
- Produces: `ActiveFilterChip` (`id`, `kind`, `label`), `ActiveFilterChip.Kind` (`.search` / `.location(String)` / `.category(String)` / `.favorites`), `ActiveFilterChips.build(selection:) -> [ActiveFilterChip]`, `FilterSelection.hasDateFilters/hasNonDateFilters/hasFilters`, `AppModel.clearAll()`, `AppModel.clearNonDateFilters()`, `AppModel.remove(_ chip: ActiveFilterChip)`. **`clearFilters()` no longer exists after this task.**

- [ ] **Step 1: Write the failing tests**

Create `ios/ChqCalendarTests/ActiveFilterChipsTests.swift`:

```swift
import Testing
@testable import ChqCalendar

struct ActiveFilterChipsTests {
    @Test func emptySelectionYieldsNoChips() {
        #expect(ActiveFilterChips.build(selection: FilterSelection()).isEmpty)
    }

    @Test func whitespaceOnlySearchYieldsNoChip() {
        var filter = FilterSelection()
        filter.searchText = "   "
        #expect(ActiveFilterChips.build(selection: filter).isEmpty)
    }

    @Test func orderIsSearchThenLocationsThenCategoriesThenFavorites() {
        var filter = FilterSelection()
        filter.searchText = "Burns"
        filter.selectedLocations = ["Amphitheater", "Norton Hall"]
        filter.selectedCategories = ["CSO"]
        filter.showFavoritesOnly = true

        let chips = ActiveFilterChips.build(selection: filter)

        #expect(chips.map(\.kind) == [
            .search,
            .location("Amphitheater"),
            .location("Norton Hall"),
            .category("CSO"),
            .favorites,
        ])
    }

    @Test func searchChipQuotesTheTrimmedTerm() {
        var filter = FilterSelection()
        filter.searchText = "  Burns  "
        #expect(ActiveFilterChips.build(selection: filter).first?.label == "\"Burns\"")
    }

    @Test func displayNameShortcutIsApplied() {
        var filter = FilterSelection()
        filter.selectedLocations = ["Elizabeth S. Lenna Hall"]
        filter.selectedCategories = ["Chautauqua Symphony Orchestra/Classical Concerts"]

        let chips = ActiveFilterChips.build(selection: filter)

        #expect(chips.map(\.label) == ["Lenna Hall", "CSO"])
    }

    @Test func namesWithoutAShortcutPassThroughUnchanged() {
        var filter = FilterSelection()
        filter.selectedLocations = ["Amphitheater"]
        #expect(ActiveFilterChips.build(selection: filter).first?.label == "Amphitheater")
    }

    @Test func chipIdsAreUnique() {
        var filter = FilterSelection()
        filter.searchText = "Burns"
        filter.selectedLocations = ["Amphitheater"]
        filter.selectedCategories = ["Amphitheater"]   // same string, different facet
        filter.showFavoritesOnly = true

        let ids = ActiveFilterChips.build(selection: filter).map(\.id)
        #expect(Set(ids).count == ids.count)
    }
}
```

Create `ios/ChqCalendarTests/FilterSelectionTests.swift`:

```swift
import Testing
@testable import ChqCalendar

struct FilterSelectionTests {
    @Test func defaultSelectionHasADateFilterButNoNonDateFilter() {
        // The default scope is `.next` ("Now"), which is a date filter.
        let filter = FilterSelection()
        #expect(filter.hasDateFilters)
        #expect(!filter.hasNonDateFilters)
        #expect(filter.hasFilters)
    }

    @Test func scopeAllWithNoWeeksHasNoDateFilter() {
        let filter = FilterSelection(dateScope: .all)
        #expect(!filter.hasDateFilters)
        #expect(!filter.hasFilters)
    }

    @Test func weeksCountAsADateFilter() {
        let filter = FilterSelection(dateScope: .all, selectedWeeks: [3])
        #expect(filter.hasDateFilters)
    }

    @Test func whitespaceOnlySearchIsNotAFilter() {
        var filter = FilterSelection(dateScope: .all)
        filter.searchText = "   "
        #expect(!filter.hasNonDateFilters)
    }

    @Test func eachNonDateFacetCounts() {
        var search = FilterSelection(dateScope: .all)
        search.searchText = "Burns"
        #expect(search.hasNonDateFilters)

        var location = FilterSelection(dateScope: .all)
        location.selectedLocations = ["Amphitheater"]
        #expect(location.hasNonDateFilters)

        var category = FilterSelection(dateScope: .all)
        category.selectedCategories = ["CSO"]
        #expect(category.hasNonDateFilters)

        var favorites = FilterSelection(dateScope: .all)
        favorites.showFavoritesOnly = true
        #expect(favorites.hasNonDateFilters)
    }
}
```

In `ios/ChqCalendarTests/AppModelTests.swift`, **replace** `clearFiltersResetsFacetsButKeepsSearchTextAndExtraDays` (line 329) entirely with:

```swift
    @Test func clearAllClearsEverythingIncludingTheSearchTerm() {
        let defaults = makeDefaults()
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: defaults, now: { Date() })
        )

        model.filter.searchText = "opera"
        model.filter.extraDays = 2
        model.selectWeek(4)
        model.toggleLocation("Amphitheater")
        model.filter.showFavoritesOnly = true

        model.clearAll()

        #expect(model.filter.searchText.isEmpty)
        #expect(model.filter.extraDays == 0)
        #expect(model.filter.dateScope == .all)
        #expect(model.filter.selectedWeeks.isEmpty)
        #expect(model.filter.selectedLocations.isEmpty)
        #expect(!model.filter.showFavoritesOnly)
        #expect(!model.filter.hasFilters)
        #expect(UserStateStore(defaults: defaults, now: { Date() })
            .loadFilters()?.hasFilters == false)
    }

    @Test func clearNonDateFiltersKeepsScopeAndWeeks() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )

        model.selectWeek(4)
        model.filter.searchText = "opera"
        model.toggleLocation("Amphitheater")
        model.toggleCategory("CSO")
        model.filter.showFavoritesOnly = true

        model.clearNonDateFilters()

        #expect(model.filter.selectedWeeks == [4])
        #expect(model.filter.dateScope == .all)
        #expect(model.filter.searchText.isEmpty)
        #expect(model.filter.selectedLocations.isEmpty)
        #expect(model.filter.selectedCategories.isEmpty)
        #expect(!model.filter.showFavoritesOnly)
    }

    @Test func removingAChipClearsJustThatFilter() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )

        model.filter.searchText = "Burns"
        model.toggleLocation("Amphitheater")
        model.toggleCategory("CSO")

        let chips = ActiveFilterChips.build(selection: model.filter)
        for chip in chips { model.remove(chip) }

        #expect(model.filter.searchText.isEmpty)
        #expect(model.filter.selectedLocations.isEmpty)
        #expect(model.filter.selectedCategories.isEmpty)
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run the full test command. Expected: compile failure — `cannot find 'ActiveFilterChips' in scope`, `has no member 'hasFilters'`, `has no member 'clearAll'`.

- [ ] **Step 3: Add the predicates**

In `ios/ChqCalendar/Data/UserStateStore.swift`, inside `FilterSelection` after `isDefault`:

```swift
    /// Whether a date range is narrowing the results. Mirrors the web's
    /// `hasDateFilters`.
    var hasDateFilters: Bool {
        dateScope != .all || !selectedWeeks.isEmpty
    }

    /// Whether anything *other* than a date range is narrowing the results.
    /// `searchText` is trimmed so a whitespace-only term — which matches
    /// everything and produces no chip — doesn't count. Mirrors the web's
    /// `hasNonDateFilters`.
    var hasNonDateFilters: Bool {
        !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !selectedLocations.isEmpty
            || !selectedCategories.isEmpty
            || showFavoritesOnly
    }

    var hasFilters: Bool { hasDateFilters || hasNonDateFilters }
```

- [ ] **Step 4: Add `ActiveFilterChips`**

Create `ios/ChqCalendar/Domain/ActiveFilterChips.swift`:

```swift
import Foundation

/// One removable filter in the reset row.
nonisolated struct ActiveFilterChip: Identifiable, Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case search
        /// The stored name, in the feed's original casing — passed straight
        /// back to `AppModel.toggleLocation` to remove it.
        case location(String)
        case category(String)
        case favorites
    }

    let id: String
    let kind: Kind
    /// Display-ready: `DisplayNames` shortcut already applied.
    let label: String
}

/// Builds the reset row's chip list from the selection alone.
///
/// It needs nothing else because `FilterSelection` stores names in the
/// feed's original casing (see `EventFilter` for where the lowercasing
/// happens instead) — so `DisplayNames`' exact-match shortcuts just work.
nonisolated enum ActiveFilterChips {
    /// Order mirrors the web's `buildActiveChips`: search, locations,
    /// categories, favorites — and selection order within each group.
    ///
    /// Date scope and week are deliberately absent: their own controls sit
    /// directly above this row and already show selection, and unlike
    /// venues they cannot scroll out of view. "Clear all" still clears them.
    static func build(selection: FilterSelection) -> [ActiveFilterChip] {
        var chips: [ActiveFilterChip] = []

        let term = selection.searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !term.isEmpty {
            chips.append(ActiveFilterChip(id: "search", kind: .search, label: "\"\(term)\""))
        }

        for name in selection.selectedLocations {
            chips.append(ActiveFilterChip(
                id: "loc-\(name)", kind: .location(name), label: DisplayNames.location(name)))
        }

        for name in selection.selectedCategories {
            chips.append(ActiveFilterChip(
                id: "cat-\(name)", kind: .category(name), label: DisplayNames.category(name)))
        }

        if selection.showFavoritesOnly {
            chips.append(ActiveFilterChip(
                id: "favorites", kind: .favorites, label: "Favorites"))
        }

        return chips
    }
}
```

- [ ] **Step 5: Replace `clearFilters` with the two reset actions**

In `ios/ChqCalendar/App/AppModel.swift`, replace `clearFilters()` (lines 303–310, including its doc comment):

```swift
    /// "Show all events" — clears every filter, including the search term
    /// and `extraDays`, and drops the scope to `.all`. Mirrors the web's
    /// CLEAR_FILTERS.
    ///
    /// This deliberately clears `searchText`, which the previous
    /// `clearFilters()` preserved. That preservation only made sense while
    /// the term had no visible representation; now it is a chip in the reset
    /// row and individually removable, so leaving it behind after "Clear
    /// all" would be the surprising behavior.
    func clearAll() {
        filter = FilterSelection(dateScope: .all)
        persistFilter()
    }

    /// "Keep dates, show all" — clears search, venues, categories, and
    /// favorites-only, leaving the date scope and week selection intact.
    /// Mirrors the web's CLEAR_NON_DATE_FILTERS.
    func clearNonDateFilters() {
        filter.searchText = ""
        filter.selectedLocations = []
        filter.selectedCategories = []
        filter.showFavoritesOnly = false
        persistFilter()
    }

    /// Removes the single filter a reset-row chip represents.
    ///
    /// No `persistFilter()` here: the three toggles persist themselves, and
    /// `searchText` is session-only and never written to disk.
    func remove(_ chip: ActiveFilterChip) {
        switch chip.kind {
        case .search: filter.searchText = ""
        case .location(let name): toggleLocation(name)
        case .category(let name): toggleCategory(name)
        case .favorites: toggleFavoritesOnly()
        }
    }
```

Update the sole remaining caller — `ios/ChqCalendar/Features/Calendar/EventListView.swift:129`:

```swift
                model.clearAll()
```

- [ ] **Step 6: Run tests to verify they pass**

Run the full test command. Expected: PASS.

- [ ] **Step 7: Add `ResetFilterRow`**

Create `ios/ChqCalendar/Features/Filters/ResetFilterRow.swift`:

```swift
import SwiftUI

/// The last row of the filter bar, shown only while something is narrowing
/// the results: a reset, an optional "keep dates" reset, and every active
/// filter as a one-tap removable chip.
///
/// Mirrors the web's `ActiveFilters`. Venues and categories appear here as
/// well as in their own rows; that redundancy is deliberate, so there is
/// one predictable place listing everything — and it is the only place the
/// search term is visible at all once the system search field collapses.
struct ResetFilterRow: View {
    let model: AppModel

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                resetChip(
                    label: "Clear all",
                    systemImage: "xmark.circle.fill",
                    accessibility: "Clear all filters and show all events"
                ) {
                    model.clearAll()
                }

                if model.filter.hasDateFilters && model.filter.hasNonDateFilters {
                    resetChip(
                        label: "Keep dates",
                        systemImage: "calendar.badge.checkmark",
                        accessibility: "Keep date and week filters but clear all others"
                    ) {
                        model.clearNonDateFilters()
                    }
                }

                ForEach(ActiveFilterChips.build(selection: model.filter)) { chip in
                    Button {
                        KeyboardDismisser.dismiss()
                        model.remove(chip)
                    } label: {
                        HStack(spacing: 4) {
                            Text(chip.label)
                            Image(systemName: "xmark")
                                .font(.caption2.weight(.bold))
                                .opacity(0.7)
                        }
                        .font(.subheadline)
                        .lineLimit(1)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 44)
                        .foregroundStyle(.white)
                        .background(Color.accentColor, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove filter \(chip.label)")
                }
            }
            .padding(.horizontal)
        }
    }

    private func resetChip(
        label: String, systemImage: String, accessibility: String, action: @escaping () -> Void
    ) -> some View {
        Button {
            KeyboardDismisser.dismiss()
            action()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: systemImage)
                Text(label)
            }
            .font(.subheadline.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(.thinMaterial, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibility)
    }
}
```

- [ ] **Step 8: Wire the row in**

In `ios/ChqCalendar/Features/Filters/FilterBarView.swift`, after the `ForEach(FilterFacet.allCases)` block added in Task 5:

```swift
            if model.filter.hasFilters {
                ResetFilterRow(model: model)
            }
```

- [ ] **Step 9: Add the match count**

In `ios/ChqCalendar/Features/Calendar/EventListView.swift`, replace the `list` computed property's opening (lines 64–72) so `dayGroups` is read once:

```swift
    private var list: some View {
        // Bound once: `model.dayGroups` reruns the whole filter pipeline on
        // every access, so reading it for both the count and the sections
        // would filter ~1,500 events twice per render.
        let days = model.dayGroups
        let filtered = days.reduce(0) { $0 + $1.events.count }

        return List(selection: selection) {
            if let countdownDays = model.countdownDays {
                CountdownBanner(days: countdownDays)
            }
            if model.lastRefreshFailed {
                OfflineBanner()
            }

            if model.filter.hasFilters, let total = model.snapshot?.events.count {
                Text("\(filtered.formatted()) of \(total.formatted()) events")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .listRowSeparator(.hidden)
            }
```

Then replace the `ForEach(model.dayGroups)` on line 73 with `ForEach(days)`.

- [ ] **Step 10: Run the full suite**

Run the full test command. Expected: PASS.

- [ ] **Step 11: Verify in the simulator**

Build and run on iPhone 17. Confirm: typing a search term shows a `"term"` chip in the reset row; tapping its ✕ clears the term and the chip; "Keep dates" appears only when both a date filter and a non-date filter are active; "Clear all" empties the row and it disappears; the count line reads sensibly and vanishes when no filters are active.

- [ ] **Step 12: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add ios/ChqCalendar/Domain/ActiveFilterChips.swift \
        ios/ChqCalendar/Features/Filters/ResetFilterRow.swift \
        ios/ChqCalendarTests/ActiveFilterChipsTests.swift \
        ios/ChqCalendarTests/FilterSelectionTests.swift \
        ios/ChqCalendar/Data/UserStateStore.swift \
        ios/ChqCalendar/App/AppModel.swift \
        ios/ChqCalendar/Features/Filters/FilterBarView.swift \
        ios/ChqCalendar/Features/Calendar/EventListView.swift \
        ios/ChqCalendarTests/AppModelTests.swift
git commit -m "feat(ios): show every active filter as a removable chip, plus a match count

Mirrors the web's ActiveFilters: a reset row listing the search term, each
venue, each category, and favorites-only, every one removable in a tap,
alongside Clear all and a conditional Keep dates. The search term
especially -- once iOS collapses the system search field, this row is the
only thing on screen saying a term is still narrowing the results.

Date scope and week stay out of the row: their controls are two rows up,
already show selection, and cannot scroll out of view.

clearFilters() splits into clearAll() and clearNonDateFilters(), matching
CLEAR_FILTERS and CLEAR_NON_DATE_FILTERS. Behavior change: clearAll now
clears searchText, which clearFilters deliberately preserved. That only
made sense while the term had no visible representation.

The count line derives from the already-bound dayGroups rather than a
second EventFilter.apply -- dayGroups reruns the whole pipeline on every
access.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01L9PjUZ7iWv2QHKSpGQ3D36"
```

---

### Task 7: Collapse the filter bar on scroll

Spec section D (collapse). The bar is now four rows plus a conditional fifth — ~206pt pinned, which is too much to keep on screen while browsing.

**Files:**
- Create: `ios/ChqCalendar/Domain/FilterBarCollapse.swift`
- Create: `ios/ChqCalendarTests/FilterBarCollapseTests.swift`
- Modify: `ios/ChqCalendar/Features/Calendar/EventListView.swift`
- Modify: `ios/ChqCalendar/Features/Filters/FilterBarView.swift`

**Interfaces:**
- Produces: `FilterBarCollapse.next(isCollapsed:offset:pivot:threshold:) -> (isCollapsed: Bool, pivot: CGFloat)`; `FilterBarView(model:isCollapsed:)` gains an `isCollapsed` parameter.

- [ ] **Step 1: Write the failing test**

Create `ios/ChqCalendarTests/FilterBarCollapseTests.swift`:

```swift
import CoreGraphics
import Testing
@testable import ChqCalendar

struct FilterBarCollapseTests {
    @Test func staysExpandedForJitterBelowTheThreshold() {
        let result = FilterBarCollapse.next(isCollapsed: false, offset: 30, pivot: 0)
        #expect(result.isCollapsed == false)
        #expect(result.pivot == 0)
    }

    @Test func collapsesOnceTheThresholdIsReached() {
        let result = FilterBarCollapse.next(isCollapsed: false, offset: 40, pivot: 0)
        #expect(result.isCollapsed)
        #expect(result.pivot == 40)
    }

    @Test func whileCollapsedThePivotTracksTheDeepestPoint() {
        let result = FilterBarCollapse.next(isCollapsed: true, offset: 300, pivot: 40)
        #expect(result.isCollapsed)
        #expect(result.pivot == 300)
    }

    @Test func aShortScrollBackUpDoesNotExpand() {
        let result = FilterBarCollapse.next(isCollapsed: true, offset: 270, pivot: 300)
        #expect(result.isCollapsed)
        #expect(result.pivot == 300)
    }

    @Test func scrollingBackUpPastTheThresholdExpands() {
        let result = FilterBarCollapse.next(isCollapsed: true, offset: 260, pivot: 300)
        #expect(result.isCollapsed == false)
        #expect(result.pivot == 260)
    }

    @Test func reachingTheTopAlwaysExpands() {
        let result = FilterBarCollapse.next(isCollapsed: true, offset: 0, pivot: 900)
        #expect(result.isCollapsed == false)
        #expect(result.pivot == 0)
    }

    @Test func rubberBandOverscrollIsTreatedAsTheTop() {
        let result = FilterBarCollapse.next(isCollapsed: true, offset: -80, pivot: 900)
        #expect(result.isCollapsed == false)
        #expect(result.pivot == 0)
    }

    @Test func expandedPivotFollowsUpwardScrollSoTheNextCollapseIsMeasuredFresh() {
        // Expanded at 260 after scrolling up; continuing up to 100 must move
        // the pivot down, or a later 140pt downward scroll would not collapse.
        let result = FilterBarCollapse.next(isCollapsed: false, offset: 100, pivot: 260)
        #expect(result.isCollapsed == false)
        #expect(result.pivot == 100)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `… -only-testing:ChqCalendarTests/FilterBarCollapseTests`
Expected: compile failure — `cannot find 'FilterBarCollapse' in scope`.

- [ ] **Step 3: Write the implementation**

Create `ios/ChqCalendar/Domain/FilterBarCollapse.swift`:

```swift
import CoreGraphics

/// Decides whether the filter bar's secondary rows (venues, categories,
/// reset) are hidden, from the event list's scroll offset.
///
/// The `threshold` hysteresis is the whole point: a ~100pt layout change
/// must not fire on a few points of finger jitter. `pivot` records where
/// the current direction began, and the state flips only once the offset
/// has travelled `threshold` points away from it.
nonisolated enum FilterBarCollapse {
    /// `offset` is how far the list has scrolled down from its top, in
    /// points — 0 at the top, growing positive as content moves up.
    /// Negative values (rubber-band overscroll) are treated as 0.
    static func next(
        isCollapsed: Bool,
        offset: CGFloat,
        pivot: CGFloat,
        threshold: CGFloat = 40
    ) -> (isCollapsed: Bool, pivot: CGFloat) {
        let clamped = max(offset, 0)

        // At the top the bar is always whole, whatever the pivot was.
        if clamped <= 0 {
            return (false, 0)
        }

        if isCollapsed {
            // Track the deepest point reached so an upward swipe is measured
            // from there, not from wherever the collapse happened to fire.
            if clamped > pivot { return (true, clamped) }
            return clamped <= pivot - threshold ? (false, clamped) : (true, pivot)
        } else {
            if clamped < pivot { return (false, clamped) }
            return clamped >= pivot + threshold ? (true, clamped) : (false, pivot)
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `… -only-testing:ChqCalendarTests/FilterBarCollapseTests`. Expected: PASS (8 tests).

- [ ] **Step 5: Observe scroll offset in `EventListView`**

Add to `ios/ChqCalendar/Features/Calendar/EventListView.swift`, at file scope below the imports:

```swift
/// Publishes the event list's scroll offset up to `EventListView`.
///
/// `static let` rather than `static var`: a `let` satisfies the protocol's
/// `{ get }` requirement and keeps the type Sendable under Swift 6 strict
/// concurrency.
private struct ScrollOffsetKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}
```

Add state to the view, beside `isAboutPresented`:

```swift
    @State private var isFilterBarCollapsed = false
    @State private var collapsePivot: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let scrollSpace = "eventList"
```

Insert the sentinel as the **first** row of the `List`, above the countdown banner:

```swift
            GeometryReader { proxy in
                Color.clear.preference(
                    key: ScrollOffsetKey.self,
                    value: -proxy.frame(in: .named(Self.scrollSpace)).minY
                )
            }
            .frame(height: 0)
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
```

and add to the `List`'s modifier chain, after `.scrollDismissesKeyboard(.immediately)`:

```swift
        .coordinateSpace(.named(Self.scrollSpace))
        .onPreferenceChange(ScrollOffsetKey.self) { offset in
            // `onPreferenceChange`'s action is @Sendable, so the hop back to
            // the main actor is required to touch @State.
            Task { @MainActor in
                let next = FilterBarCollapse.next(
                    isCollapsed: isFilterBarCollapsed, offset: offset, pivot: collapsePivot)
                collapsePivot = next.pivot
                guard next.isCollapsed != isFilterBarCollapsed else { return }
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) {
                    isFilterBarCollapsed = next.isCollapsed
                }
            }
        }
```

Pass it to the bar in the `safeAreaInset` (line 41):

```swift
                    FilterBarView(model: model, isCollapsed: isFilterBarCollapsed)
```

- [ ] **Step 6: Honor the flag in `FilterBarView`**

In `ios/ChqCalendar/Features/Filters/FilterBarView.swift`, add the parameter beside `let model: AppModel`:

```swift
    /// When true, only the scope and week rows render — the bar's other
    /// ~100pt is given back to the event list while the user is browsing.
    var isCollapsed: Bool = false
```

Wrap the facet rows and reset row added in Tasks 5 and 6:

```swift
            if !isCollapsed {
                ForEach(FilterFacet.allCases) { facet in
                    FacetRowView(
                        model: model,
                        facet: facet,
                        isExpanded: expandedFacet == facet
                    ) {
                        expandedFacet = expandedFacet == facet ? nil : facet
                    }
                }

                if model.filter.hasFilters {
                    ResetFilterRow(model: model)
                }
            }
```

and close any open panel when the bar collapses, by adding to the `VStack`'s modifiers:

```swift
        .onChange(of: isCollapsed) { _, collapsed in
            if collapsed { expandedFacet = nil }
        }
```

- [ ] **Step 7: Run the full suite**

Run the full test command. Expected: PASS.

- [ ] **Step 8: Verify in the simulator**

Build and run on iPhone 17. Confirm: scrolling down hides the venue, category, and reset rows and leaves scope and weeks; scrolling up brings them back; small jitter does not toggle anything; reaching the top always shows the whole bar; an expanded panel closes when the bar collapses. Then enable Settings → Accessibility → Motion → Reduce Motion and confirm the change is instant rather than animated.

- [ ] **Step 9: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add ios/ChqCalendar/Domain/FilterBarCollapse.swift \
        ios/ChqCalendarTests/FilterBarCollapseTests.swift \
        ios/ChqCalendar/Features/Calendar/EventListView.swift \
        ios/ChqCalendar/Features/Filters/FilterBarView.swift
git commit -m "feat(ios): collapse the filter bar's secondary rows while scrolling

The bar is now four rows plus a conditional reset row -- roughly 206pt.
The web can afford that because its filter block scrolls away with the
page; on iOS it is a safeAreaInset that never moves. Scrolling down past a
threshold now hides the venue, category, and reset rows, leaving scope and
weeks at ~106pt, and scrolling back up or reaching the top restores them.

FilterBarCollapse keeps the decision as a pure state machine with
hysteresis so a ~100pt layout change cannot fire on finger jitter. Scroll
offset comes from a GeometryReader/PreferenceKey pair rather than
onScrollGeometryChange, which is iOS 18+ against this app's iOS 17 floor.
Animation is suppressed under Reduce Motion.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01L9PjUZ7iWv2QHKSpGQ3D36"
```

---

### Task 8: Quick links menu

Spec section E.

**Files:**
- Modify: `ios/ChqCalendar/Features/About/AboutInfo.swift`
- Modify: `ios/ChqCalendar/Features/Calendar/EventListView.swift:160-186`
- Modify: `ios/ChqCalendarTests/AboutInfoTests.swift`

**Interfaces:**
- Produces: `AboutInfo.quickLinks: [AboutInfo.Link]`.

- [ ] **Step 1: Write the failing test**

Add to `ios/ChqCalendarTests/AboutInfoTests.swift`:

```swift
    // MARK: - quickLinks

    @Test func quickLinksMatchTheWebHeader() {
        #expect(AboutInfo.quickLinks.map(\.id) == ["feedback", "programs", "questions"])
        #expect(AboutInfo.quickLinks.map(\.title) == ["Feedback", "Programs", "Questions"])
        #expect(AboutInfo.quickLinks.map { $0.url.absoluteString } == [
            "https://www.chqcal.org/feedback",
            "https://programs.chq.org/",
            "https://questions.chq.org/",
        ])
    }

    @Test func quickLinksAreDistinctFromTheAboutSheetLinks() {
        let aboutIDs = Set(AboutInfo.links.map(\.id))
        #expect(Set(AboutInfo.quickLinks.map(\.id)).isDisjoint(with: aboutIDs))
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `… -only-testing:ChqCalendarTests/AboutInfoTests`
Expected: compile failure — `type 'AboutInfo' has no member 'quickLinks'`.

- [ ] **Step 3: Add the links**

In `ios/ChqCalendar/Features/About/AboutInfo.swift`, after the `links` array:

```swift
    /// Destinations surfaced directly from the calendar toolbar, matching
    /// the web header's buttons (frontend/src/components/layout/Header.tsx).
    /// Kept separate from `links`, which are the About sheet's legal and
    /// attribution links.
    static let quickLinks: [Link] = [
        Link(id: "feedback", title: "Feedback", url: URL(string: "https://www.chqcal.org/feedback")!),
        Link(id: "programs", title: "Programs", url: URL(string: "https://programs.chq.org/")!),
        Link(id: "questions", title: "Questions", url: URL(string: "https://questions.chq.org/")!),
    ]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `… -only-testing:ChqCalendarTests/AboutInfoTests`. Expected: PASS.

- [ ] **Step 5: Replace the info button with an overflow menu**

In `ios/ChqCalendar/Features/Calendar/EventListView.swift`, replace the first `ToolbarItem` in `toolbarContent` (lines 162–169) with:

```swift
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                ForEach(AboutInfo.quickLinks) { link in
                    SwiftUI.Link(destination: link.url) {
                        Label(link.title, systemImage: "arrow.up.right.square")
                    }
                }
                Divider()
                Button {
                    isAboutPresented = true
                } label: {
                    Label("About", systemImage: "info.circle")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .accessibilityLabel("More")
        }
```

- [ ] **Step 6: Run the full suite**

Run the full test command. Expected: PASS.

- [ ] **Step 7: Verify in the simulator**

Build and run. Confirm the ⋯ menu opens with Feedback / Programs / Questions / About, that each link opens the right URL in Safari, and that About still presents the disclaimer sheet.

- [ ] **Step 8: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add ios/ChqCalendar/Features/About/AboutInfo.swift \
        ios/ChqCalendar/Features/Calendar/EventListView.swift \
        ios/ChqCalendarTests/AboutInfoTests.swift
git commit -m "feat(ios): add Feedback, Programs, and Questions to a toolbar menu

Mirrors the web header's three buttons, same URLs. The standalone info
button becomes an overflow menu carrying them plus About, so the
unaffiliated disclaimer stays one tap away for App Review.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01L9PjUZ7iWv2QHKSpGQ3D36"
```

---

### Task 9: Regenerate App Store screenshots and review listing copy

Required by `CLAUDE.md` — this changed `ios/ChqCalendar/Features/**` in ways a user can see.

**Files:**
- Modify: `docs/app-store/screenshots.manifest.json`, `docs/app-store/screenshots/review/*.png`
- Possibly modify: `docs/app-store/listing-copy.md`, `docs/app-store/listing-fields.json`

- [ ] **Step 1: Confirm the screenshot hook still lands somewhere real**

`-uitest-show-filters` was repointed in Task 5 from the deleted sheet to the Venues panel. Verify:

```bash
cd /Users/bernard/src/chq/chq-calendar && grep -rn "uitest-show-filters" ios/
```

Expected: `Features/Calendar/CalendarView.swift` (sets the flag) and `Features/Filters/FilterBarView.swift` (`expandFacetIfNeeded`). No reference to `FilterSheetView`.

Also update the shot's `presentsModal` flag in `ios/Scripts/screenshot-plan.json` — the `02-filters` shot no longer presents a modal:

```json
    {
      "id": "02-filters",
      "caption": "Narrow it to what you actually want.",
      "launchArgs": ["-uitest-show-filters"],
      "settleSeconds": 6,
      "deviceLaunchArgs": { "ipad-13": ["-uitest-select-linked-event"] }
    },
```

- [ ] **Step 2: Regenerate**

```bash
cd /Users/bernard/src/chq/chq-calendar
ios/Scripts/capture-screenshots.sh
python3 ios/Scripts/compose-screenshots.py
```

- [ ] **Step 3: Inspect every regenerated shot**

Open each PNG in `docs/app-store/screenshots/review/`. Confirm `01-season`, `02-filters`, and `03-search` show the new filter bar, that `02-filters` shows the expanded Venues panel rather than an empty modal, and that no shot shows a half-rendered or empty state. Re-run capture if any shot raced the data load.

- [ ] **Step 4: Re-read the listing copy**

```bash
cd /Users/bernard/src/chq/chq-calendar && cat docs/app-store/listing-copy.md
```

Check every claim about filtering and search against the shipped behavior. The captions in `screenshot-plan.json` are part of the listing too — "Narrow it to what you actually want." still holds for the inline panel. Update anything that describes a modal filter sheet. If nothing needs changing, say so explicitly in the commit message rather than silently leaving it.

- [ ] **Step 5: Run the full suite one final time**

Run the full test command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/bernard/src/chq/chq-calendar
git add docs/app-store/ ios/Scripts/screenshot-plan.json
git commit -m "docs(app-store): regenerate screenshots for the new filter bar

Required by the App Store upkeep rule -- 01-season, 02-filters, and
03-search all changed. 02-filters now shows the inline Venues panel
instead of the deleted modal sheet, so the shot's presentsModal flag is
dropped from screenshot-plan.json.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01L9PjUZ7iWv2QHKSpGQ3D36"
```

- [ ] **Step 7: Push and open the PR**

```bash
cd /Users/bernard/src/chq/chq-calendar
git push -u origin feat/ios-ux-filtering
```

Open a PR against `main`. If splitting for review size, Tasks 1–4 form the first PR ("date filtering & header density") and Tasks 5–9 the second. **Do not merge — request the merge from the user.**

---

## Deviations from the spec's sequencing

The spec lists eight commits; this plan has nine. Task 7 (collapse-on-scroll) and Task 8 (quick links) were one commit in the spec, but they share no code and a reviewer could reasonably accept one and reject the other, so they are split. Everything else maps one-to-one.
