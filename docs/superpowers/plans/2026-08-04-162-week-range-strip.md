# Dates Drawer Redesign: When Scopes + Week Range Strip (#162) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Dates filter sheet per issue #162: When options become Now · Today · All Season · All Year, and the 3×3 week-pill grid becomes a single-row drag-to-select range strip.

**Architecture:** Bottom-up: enum + filter + label + chip-state changes first (each pure, each tested), then the pure drag-reduction logic (`WeekStripDrag`), then the model API (`setWeekSelection` replaces `selectWeek`), then the view (`WeekRangeStrip`) and sheet wiring last, so every earlier task is verifiable before any UI exists.

**Tech Stack:** Swift 6, Swift Testing (`@Test`/`#expect`), SwiftUI (`DragGesture`, `UnevenRoundedRectangle`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-04-ios-gate-pass-weeks-links-design.md` (§ #162)
- `DateScope` gains `case season = "season"` (label "All Season"); `.all`'s label becomes "All Year"; `.thisWeek` keeps decoding but leaves the sheet UI.
- Week selection becomes single-week-or-contiguous-range, enforced by the strip; `FilterSelection.selectedWeeks` stays `Set<Int>` (no persistence change). Persisted non-contiguous sets still render and filter until the first strip touch replaces them.
- Commit-on-touch-up only — no model updates at drag frequency.
- Never commit to `main`. Branch: `feat/162-week-range-strip` off `main`.
- iOS tests run locally (CI has no macOS runner):
  `cd ios && xcodebuild test -project ChqCalendar.xcodeproj -scheme ChqCalendar -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' CODE_SIGNING_ALLOWED=NO`
  Scope a run to one suite with `-only-testing:ChqCalendarTests/<SuiteName>`.

---

### Task 1: `DateScope.season` + label changes

**Files:**
- Modify: `ios/ChqCalendar/Data/UserStateStore.swift` (the `DateScope` enum, lines ~5–19)
- Modify: `ios/ChqCalendarTests/UserStateStoreTests.swift` (lines ~21–24 pin all four labels, including `.all.label == "All"` — must change with the relabel)
- Test: `ios/ChqCalendarTests/FilterSelectionTests.swift` (add a `// MARK: - DateScope` section)

**Interfaces:**
- Produces: `DateScope.season` (raw `"season"`, label `"All Season"`), `.all.label == "All Year"`. Every later task consumes `.season`.

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b feat/162-week-range-strip
```

- [ ] **Step 2: Write the failing tests**

Add to `FilterSelectionTests.swift`:

```swift
    // MARK: - DateScope

    @Test func seasonScopeRawValueAndLabel() {
        #expect(DateScope.season.rawValue == "season")
        #expect(DateScope.season.label == "All Season")
    }

    @Test func allScopeLabelIsAllYear() {
        #expect(DateScope.all.label == "All Year")
    }

    @Test func legacyRawValuesStillDecode() throws {
        // Persisted selections predating this change must keep decoding.
        for (raw, expected): (String, DateScope) in
            [("next", .next), ("today", .today), ("this-week", .thisWeek), ("all", .all), ("season", .season)] {
            let decoded = try JSONDecoder().decode(DateScope.self, from: Data("\"\(raw)\"".utf8))
            #expect(decoded == expected)
        }
    }
```

- [ ] **Step 3: Run to verify failure**

```bash
cd ios && xcodebuild test -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' CODE_SIGNING_ALLOWED=NO \
  -only-testing:ChqCalendarTests/FilterSelectionTests
```

Expected: build FAILURE — `type 'DateScope' has no member 'season'`.

- [ ] **Step 4: Implement**

In `UserStateStore.swift`:

```swift
nonisolated enum DateScope: String, Codable, CaseIterable, Sendable {
    case next
    case today
    case thisWeek = "this-week"
    case season
    case all

    var label: String {
        switch self {
        case .next: return "Now"
        case .today: return "Today"
        case .thisWeek: return "This Week"
        case .season: return "All Season"
        case .all: return "All Year"
        }
    }
}
```

This will surface exhaustive-switch build errors in `EventFilter`, `FilterChipState`, and `DateFilterLabel` — **expected**; Tasks 2–4 fill them in. To keep this task compiling on its own, add the minimal arms now (each task then replaces its stub with tested behavior):

- `EventFilter.apply`: add `case .season: break` to the scope switch.
- `FilterChipState.isScopeSelected`: add `.season` alongside `.next, .today` in **both** switches (the `guard isCurrentYear` fallback's `return false` arm, and the main switch's `return selection.dateScope == scope` arm).
- `DateFilterLabel.text`: add `.season` alongside `.next, .today, .thisWeek` in the `guard weeks.isEmpty` switch (`return selection.dateScope.label`).

- [ ] **Step 5: Update the label-pinning test and run the full suite**

`UserStateStoreTests.swift:21–24` pins all four labels — update the `.all` line and add the new case:

```swift
        #expect(DateScope.next.label == "Now")
        #expect(DateScope.today.label == "Today")
        #expect(DateScope.thisWeek.label == "This Week")
        #expect(DateScope.season.label == "All Season")
        #expect(DateScope.all.label == "All Year")
```

Then run the full suite (command in Global Constraints). Expected: PASS. `DateFilterLabelTests` does **not** break here — `DateFilterLabel` hardcodes its `"All Dates"` strings rather than reading `.all.label`; those change (with their tests) in Task 3.

- [ ] **Step 6: Commit**

```bash
git add -A ios/
git commit -m "feat(ios): DateScope.season, All Year label (#162)"
```

---

### Task 2: `EventFilter` season scope

**Files:**
- Modify: `ios/ChqCalendar/Domain/EventFilter.swift` (the `switch scope` in `apply`, ~lines 36–66 — replace Task 1's `case .season: break` stub)
- Test: `ios/ChqCalendarTests/EventFilterTests.swift`

**Interfaces:**
- Consumes: `weeks` (already computed in `apply` as `SeasonCalendar.weeks(forYear: year)`), `makeEvent(id:start:...)` test helper.
- Produces: `.season` filtering — keep events with `weeks.first.start <= start < weeks.last.end`.

- [ ] **Step 1: Write the failing tests**

Add to `EventFilterTests.swift` (a `// MARK: - season scope` section). The suite's existing date-scope tests build selections with `FilterSelection(dateScope:)` and call `EventFilter.apply` — follow that shape:

```swift
    // MARK: - season scope

    @Test func seasonScopeKeepsOnlyInSeasonEvents() {
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let preSeason = makeEvent(id: "pre", start: weeks.first!.start.addingTimeInterval(-86400))
        let opening = makeEvent(id: "opening", start: weeks.first!.start)
        let midSeason = makeEvent(id: "mid", start: weeks[4].start.addingTimeInterval(3600))
        let lastMoment = makeEvent(id: "last", start: weeks.last!.end.addingTimeInterval(-1))
        let postSeason = makeEvent(id: "post", start: weeks.last!.end)

        let result = EventFilter.apply(
            FilterSelection(dateScope: .season),
            to: [preSeason, opening, midSeason, lastMoment, postSeason],
            favorites: [],
            now: weeks.first!.start,
            year: 2026,
            isCurrentYear: true)

        #expect(result.map(\.id) == ["opening", "mid", "last"])
    }

    @Test func seasonScopeIsIgnoredOffTheCurrentYear() {
        // Same collapse as every other scope: a non-current year has no
        // meaningful "season" *selection* — the pipeline forces .all.
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let postSeason = makeEvent(id: "post", start: weeks.last!.end)

        let result = EventFilter.apply(
            FilterSelection(dateScope: .season),
            to: [postSeason],
            favorites: [],
            now: weeks.first!.start,
            year: 2026,
            isCurrentYear: false)

        #expect(result.map(\.id) == ["post"])
    }
```

(Signature verified against `EventFilter.swift:18`: `apply(_ sel:, to:, favorites:, now:, year:, isCurrentYear:)`.)

- [ ] **Step 2: Run to verify failure**

```bash
cd ios && xcodebuild test ... -only-testing:ChqCalendarTests/EventFilterTests
```

Expected: `seasonScopeKeepsOnlyInSeasonEvents` FAILS (stub `break` keeps all five events). The off-year test passes already — it documents the collapse.

- [ ] **Step 3: Implement**

Replace the stub in `EventFilter.apply`:

```swift
        case .season:
            if let first = weeks.first, let last = weeks.last {
                result = result.filter { first.start <= $0.start && $0.start < last.end }
            }
```

- [ ] **Step 4: Run to verify pass, then full suite**

Suite-scoped run, then the full suite. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ios/ChqCalendar/Domain/EventFilter.swift ios/ChqCalendarTests/EventFilterTests.swift
git commit -m "feat(ios): season scope filters to the 9-week range (#162)"
```

---

### Task 3: `DateFilterLabel` — "All Season" / "All Year"

**Files:**
- Modify: `ios/ChqCalendar/Domain/DateFilterLabel.swift`
- Test: `ios/ChqCalendarTests/DateFilterLabelTests.swift` (three "All Dates" expectations: lines ~22, ~99, ~107)
- Test: `ios/ChqCalendarTests/FilterChipStateTests.swift` (line ~113 also asserts `DateFilterLabel.text(...) == "All Dates"` inside a chip-consistency test — update to "All Year")

**Interfaces:**
- Consumes: `DateScope.season` from Task 1.
- Produces: pill text — `.season` → "All Season", `.all` → "All Year" (replacing the special-cased "All Dates", including the non-current-year early return).

- [ ] **Step 1: Write the failing tests**

In `DateFilterLabelTests.swift`: change every `== "All Dates"` expectation (lines ~22, ~99, ~107) to `== "All Year"`, and rename `allScopeReadsAllDatesNotAll` → `allScopeReadsAllYear`. In `FilterChipStateTests.swift` line ~113, change its `== "All Dates"` to `== "All Year"` (and the "All Dates" wording in the doc comment above it). Then add to `DateFilterLabelTests.swift`:

```swift
    @Test func seasonScopeReadsAllSeason() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .season),
            seasonWeekCount: 9,
            isCurrentYear: true) == "All Season")
    }

    @Test func offYearAlwaysReadsAllYear() {
        // Off the current year the pipeline ignores every relative scope,
        // so the pill must say so regardless of what is persisted.
        for scope in DateScope.allCases {
            #expect(DateFilterLabel.text(
                for: FilterSelection(dateScope: scope),
                seasonWeekCount: 9,
                isCurrentYear: false) == "All Year")
        }
    }
```

(Match the existing tests' argument labels — open the file and copy a neighbor's call shape.)

- [ ] **Step 2: Run to verify failure**

`-only-testing:ChqCalendarTests/DateFilterLabelTests` — expected: new tests FAIL ("All Dates" returned).

- [ ] **Step 3: Implement**

In `DateFilterLabel.text`, the no-weeks guard becomes:

```swift
        guard !weeks.isEmpty else {
            guard isCurrentYear else { return "All Year" }
            switch selection.dateScope {
            case .all: return DateScope.all.label            // "All Year"
            case .next, .today, .thisWeek, .season: return selection.dateScope.label
            }
        }
```

Also update the type-level doc comment: the "`.all` renders as 'All Dates'" paragraph now explains that `.all` renders as "All Year", which is unambiguous against "All Weeks" for the same reason.

- [ ] **Step 4: Run to verify pass, then full suite. Commit**

```bash
git add ios/ChqCalendar/Domain/DateFilterLabel.swift ios/ChqCalendarTests/DateFilterLabelTests.swift ios/ChqCalendarTests/FilterChipStateTests.swift
git commit -m "feat(ios): date pill reads All Season / All Year (#162)"
```

---

### Task 4: `FilterChipState` season handling

**Files:**
- Modify: `ios/ChqCalendar/Domain/FilterChipState.swift` (replace Task 1's stub arms)
- Test: `ios/ChqCalendarTests/FilterChipStateTests.swift`

**Interfaces:**
- Produces: `.season` chip lights iff `selection.dateScope == .season` on the current year; never off-year (the sheet only offers "All Year" there).

- [ ] **Step 1: Write the failing tests**

```swift
    @Test func seasonChipFollowsTheScope() {
        #expect(FilterChipState.isScopeSelected(
            .season, selection: FilterSelection(dateScope: .season),
            currentWeek: 6, isCurrentYear: true))
        #expect(!FilterChipState.isScopeSelected(
            .season, selection: FilterSelection(dateScope: .all),
            currentWeek: 6, isCurrentYear: true))
    }

    @Test func seasonChipNeverLightsOffTheCurrentYear() {
        #expect(!FilterChipState.isScopeSelected(
            .season, selection: FilterSelection(dateScope: .season),
            currentWeek: nil, isCurrentYear: false))
    }
```

- [ ] **Step 2: Verify state**

If Task 1's stub already put `.season` in the `.next, .today` arms, these tests pass immediately — run them (`-only-testing:ChqCalendarTests/FilterChipStateTests`) and confirm. The value of the task is pinning the behavior; there may be nothing to implement.

- [ ] **Step 3: Commit**

```bash
git add ios/ChqCalendar/Domain/FilterChipState.swift ios/ChqCalendarTests/FilterChipStateTests.swift
git commit -m "test(ios): pin season chip selection rules (#162)"
```

---

### Task 5: `WeekStripDrag` — pure drag reduction

**Files:**
- Create: `ios/ChqCalendar/Domain/WeekStripDrag.swift`
- Create: `ios/ChqCalendarTests/WeekStripDragTests.swift`

**Interfaces:**
- Consumes: nothing app-specific (pure `Foundation`/`CoreGraphics` math).
- Produces (Task 7 consumes exactly these):
  - `WeekStripDrag.segment(atX: CGFloat, width: CGFloat, count: Int) -> Int` — 1-based, clamped to `1...count`.
  - `WeekStripDrag.range(anchor: Int, current: Int) -> ClosedRange<Int>`
  - `WeekStripDrag.commit(anchor: Int, current: Int, existing: Set<Int>) -> Set<Int>`
  - `WeekStripDrag.extended(from existing: Set<Int>, to n: Int) -> Set<Int>` (VoiceOver "extend" action)

- [ ] **Step 1: Write the failing tests**

Create `ios/ChqCalendarTests/WeekStripDragTests.swift`:

```swift
import CoreGraphics
import Testing
@testable import ChqCalendar

struct WeekStripDragTests {
    // MARK: - geometry

    @Test func segmentsSplitTheWidthEvenly() {
        // 9 segments over 360pt → 40pt each; x=0 is week 1, x=359.9 week 9.
        #expect(WeekStripDrag.segment(atX: 0, width: 360, count: 9) == 1)
        #expect(WeekStripDrag.segment(atX: 39.9, width: 360, count: 9) == 1)
        #expect(WeekStripDrag.segment(atX: 40, width: 360, count: 9) == 2)
        #expect(WeekStripDrag.segment(atX: 359.9, width: 360, count: 9) == 9)
    }

    @Test func outOfBoundsTouchesClampToTheEdges() {
        // Drags routinely leave the view's bounds mid-gesture.
        #expect(WeekStripDrag.segment(atX: -50, width: 360, count: 9) == 1)
        #expect(WeekStripDrag.segment(atX: 400, width: 360, count: 9) == 9)
    }

    // MARK: - range (issue #162 rules 2 & 3)

    @Test func rangeIsOrderedRegardlessOfDragDirection() {
        #expect(WeekStripDrag.range(anchor: 3, current: 6) == 3...6)
        #expect(WeekStripDrag.range(anchor: 6, current: 3) == 3...6)
        #expect(WeekStripDrag.range(anchor: 4, current: 4) == 4...4)
    }

    // MARK: - commit (issue #162 rule 1 + toggle-off)

    @Test func tapSelectsASingleWeekReplacingOthers() {
        #expect(WeekStripDrag.commit(anchor: 6, current: 6, existing: [3]) == [6])
        #expect(WeekStripDrag.commit(anchor: 6, current: 6, existing: [1, 2, 3]) == [6])
    }

    @Test func tapOnTheOnlySelectedWeekDeselects() {
        #expect(WeekStripDrag.commit(anchor: 4, current: 4, existing: [4]) == [])
    }

    @Test func tapOnAWeekInsideALargerSelectionSelectsJustIt() {
        // Not a toggle-off: the selection wasn't exactly this one week.
        #expect(WeekStripDrag.commit(anchor: 4, current: 4, existing: [3, 4, 5]) == [4])
    }

    @Test func dragCommitsTheContiguousRange() {
        #expect(WeekStripDrag.commit(anchor: 3, current: 6, existing: []) == [3, 4, 5, 6])
        // Retreating drag (3→8→back to 6) ends with current == 6: rule 3.
        #expect(WeekStripDrag.commit(anchor: 3, current: 6, existing: [9]) == [3, 4, 5, 6])
    }

    // MARK: - extend (VoiceOver custom action)

    @Test func extendGrowsTheSelectionIntoOneContiguousRange() {
        #expect(WeekStripDrag.extended(from: [3, 4], to: 7) == [3, 4, 5, 6, 7])
        #expect(WeekStripDrag.extended(from: [5], to: 2) == [2, 3, 4, 5])
        // Non-contiguous persisted selection: the result heals to one run.
        #expect(WeekStripDrag.extended(from: [2, 8], to: 5) == [2, 3, 4, 5, 6, 7, 8])
    }

    @Test func extendFromEmptyIsPlainSelection() {
        #expect(WeekStripDrag.extended(from: [], to: 5) == [5])
    }
}
```

- [ ] **Step 2: Run to verify build failure** (`cannot find 'WeekStripDrag'`), using `-only-testing:ChqCalendarTests/WeekStripDragTests`.

- [ ] **Step 3: Implement**

Create `ios/ChqCalendar/Domain/WeekStripDrag.swift`:

```swift
import CoreGraphics
import Foundation

/// Pure reduction logic for `WeekRangeStrip`'s single drag gesture, kept
/// out of the view so issue #162's selection rules are unit-testable:
/// tap replaces the selection with one week (rule 1), a drag selects the
/// anchor-to-finger range (rule 2), and retreating mid-drag shrinks it
/// (rule 3 — the range always tracks the *current* finger position).
nonisolated enum WeekStripDrag {
    /// The 1-based segment under x, clamped so drags that wander outside
    /// the strip's bounds stick to the nearest edge segment.
    static func segment(atX x: CGFloat, width: CGFloat, count: Int) -> Int {
        guard width > 0, count > 0 else { return 1 }
        let raw = Int(x / (width / CGFloat(count))) + 1
        return min(max(raw, 1), count)
    }

    static func range(anchor: Int, current: Int) -> ClosedRange<Int> {
        min(anchor, current)...max(anchor, current)
    }

    /// The selection to store on touch-up. A tap (anchor == current) on the
    /// week that is already the *entire* selection toggles it off; any other
    /// gesture replaces the selection with the dragged range.
    static func commit(anchor: Int, current: Int, existing: Set<Int>) -> Set<Int> {
        if anchor == current, existing == [anchor] { return [] }
        return Set(range(anchor: anchor, current: current))
    }

    /// VoiceOver's "extend selection" action: one contiguous run covering
    /// the existing selection and `n`. From nothing, plain selection.
    static func extended(from existing: Set<Int>, to n: Int) -> Set<Int> {
        guard let lo = existing.min(), let hi = existing.max() else { return [n] }
        return Set(min(lo, n)...max(hi, n))
    }
}
```

- [ ] **Step 4: Run to verify pass. Commit**

```bash
git add ios/ChqCalendar/Domain/WeekStripDrag.swift ios/ChqCalendarTests/WeekStripDragTests.swift
git commit -m "feat(ios): WeekStripDrag pure selection reduction (#162)"
```

---

### Task 6: `AppModel.setWeekSelection` replaces `selectWeek`

**Files:**
- Modify: `ios/ChqCalendar/App/AppModel.swift` (delete `selectWeek(_:)` at ~367–383; add `setWeekSelection(_:)`)
- Modify: `ios/ChqCalendarTests/AppModelTests.swift` (rewrites listed below)

**Interfaces:**
- Consumes: nothing new.
- Produces: `func setWeekSelection(_ weeks: Set<Int>)` — sets `filter.selectedWeeks`; any **non-empty** selection forces `filter.dateScope = .all`; empty leaves the scope untouched; persists. `selectScope` is unchanged. `selectWeek(_:)` no longer exists (its one production caller, `DateFilterSheet:88`, is rewritten in Task 7 — until then the sheet still compiles against `selectWeek`, so this task ends with the sheet temporarily calling `setWeekSelection` via a one-line shim described in Step 3).

- [ ] **Step 1: Rewrite the affected tests**

In `AppModelTests.swift`:

1. `selectScopeClearsWeeksAndPersists`: replace `model.selectWeek(3)` with `model.setWeekSelection([3])`.
2. `selectingCurrentWeekBecomesThisWeekScope` — **delete** (behavior removed by the spec: tapping the current week now selects it like any other week). Replace with:

```swift
    @Test func selectingTheCurrentWeekIsAnOrdinaryWeekSelection() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        #expect(model.currentWeek == 6)

        model.setWeekSelection([6])

        #expect(model.filter.dateScope == .all)
        #expect(model.filter.selectedWeeks == [6])
        #expect(FilterChipState.isWeekSelected(
            6, selection: model.filter, currentWeek: model.currentWeek))
    }
```

3. `selectingAnotherWeekWhileNowIsActiveReplacesTheScope`: replace `model.selectWeek(3)` with `model.setWeekSelection([3])` (assertions unchanged — scope becomes `.all`, weeks `[3]`).
4. `weeksAccumulateOnceScopeIsAll` — **delete** (accumulation is gone; range commits are covered by `WeekStripDragTests`). Replace with:

```swift
    @Test func setWeekSelectionReplacesWholesale() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        model.setWeekSelection([3, 4])
        #expect(model.filter.selectedWeeks == [3, 4])

        model.setWeekSelection([6])
        #expect(model.filter.selectedWeeks == [6])
    }
```

5. `deselectingTheLastWeekLeavesScopeAll`: rewrite body to

```swift
        let model = try makeInSeasonModel(defaults: makeDefaults())
        model.setWeekSelection([3])
        model.setWeekSelection([])
        #expect(model.filter.selectedWeeks.isEmpty)
        #expect(model.filter.dateScope == .all)
```

6. `selectingCurrentWeekAgainStaysThisWeek` — **delete** (the `.thisWeek` mapping is gone; toggle-off is `WeekStripDrag.commit`'s job, pinned in Task 5).
7. Mechanical replacements elsewhere: `model.selectWeek(4)` → `model.setWeekSelection([4])` (two sites, ~lines 423 and 446), `model.selectWeek(6)` → `model.setWeekSelection([6])` (~line 768).
8. Add the persistence test:

```swift
    @Test func setWeekSelectionPersists() throws {
        let defaults = makeDefaults()
        let model = try makeInSeasonModel(defaults: defaults)
        model.setWeekSelection([3, 4, 5])

        let reloaded = UserStateStore(defaults: defaults, now: { Date() }).loadFilters()
        #expect(reloaded?.selectedWeeks == [3, 4, 5])
        #expect(reloaded?.dateScope == .all)
    }
```

- [ ] **Step 2: Run to verify failure** (`-only-testing:ChqCalendarTests/AppModelTests`) — build FAILURE, `no member 'setWeekSelection'`.

- [ ] **Step 3: Implement**

In `AppModel.swift`, replace `selectWeek(_:)` (and its doc comment) with:

```swift
    /// Replaces the week selection wholesale — the strip owns tap/drag
    /// semantics (`WeekStripDrag.commit`); the model just stores the result.
    /// Any non-empty selection forces `.all`: weeks and relative scopes are
    /// mutually exclusive, one date range at a time.
    func setWeekSelection(_ weeks: Set<Int>) {
        if !weeks.isEmpty { filter.dateScope = .all }
        filter.selectedWeeks = weeks
        persistFilter()
    }
```

Temporary shim so the not-yet-rewritten sheet compiles: change `DateFilterSheet.swift:88` from `model.selectWeek(number)` to `model.setWeekSelection(WeekStripDrag.commit(anchor: number, current: number, existing: model.filter.selectedWeeks))`. (Task 7 deletes this whole grid.)

- [ ] **Step 4: Run the full suite** — expected PASS. **Commit**

```bash
git add ios/ChqCalendar/App/AppModel.swift ios/ChqCalendar/Features/Filters/DateFilterSheet.swift ios/ChqCalendarTests/AppModelTests.swift
git commit -m "feat(ios): setWeekSelection replaces selectWeek toggle logic (#162)"
```

---

### Task 7: `WeekRangeStrip` view + sheet rewiring

**Files:**
- Create: `ios/ChqCalendar/Features/Filters/WeekRangeStrip.swift`
- Modify: `ios/ChqCalendar/Features/Filters/DateFilterSheet.swift` (`visibleScopes`, the Weeks section, and the bottom `#Preview`)

**Interfaces:**
- Consumes: `WeekStripDrag` (Task 5), `AppModel.setWeekSelection` (Task 6), `FilterChipState.isWeekSelected`, `SeasonCalendar.weeks(forYear:)`.
- Produces: the strip UI. No new public API beyond the view.

- [ ] **Step 1: Create the strip view**

`ios/ChqCalendar/Features/Filters/WeekRangeStrip.swift`:

```swift
import SwiftUI

/// Issue #162's week selector: one joined bar of nine segments where the
/// selected run reads as a single continuous range, not nine buttons.
///
/// Interaction is one `DragGesture(minimumDistance: 0)`: touch-down anchors,
/// the finger's segment is the live endpoint, touch-up commits through
/// `WeekStripDrag.commit`. The model is updated once per gesture — the
/// provisional range during the drag is view-local state.
///
/// Trade-off, accepted in the design doc: the strip claims touches that
/// start on it, so the sheet can't be drag-dismissed from the strip itself.
struct WeekRangeStrip: View {
    let weekNumbers: [Int]
    /// The committed selection, as the chips see it (includes the
    /// `.thisWeek` ⇄ current-week equivalence via `FilterChipState`).
    let isSelected: (Int) -> Bool
    /// The selection `WeekStripDrag.commit` should treat as existing —
    /// `[currentWeek]` when a persisted `.thisWeek` scope is highlighting
    /// the current week, else the stored weeks. Keeping this a value (not
    /// re-derived here) leaves `FilterChipState` the single source of truth.
    let effectiveSelection: Set<Int>
    let commit: (Set<Int>) -> Void

    @State private var anchor: Int?
    @State private var provisional: ClosedRange<Int>?

    var body: some View {
        GeometryReader { geo in
            HStack(spacing: 0) {
                ForEach(weekNumbers, id: \.self) { number in
                    segment(number)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        let current = WeekStripDrag.segment(
                            atX: value.location.x, width: geo.size.width,
                            count: weekNumbers.count)
                        if anchor == nil { anchor = current }
                        provisional = WeekStripDrag.range(anchor: anchor ?? current, current: current)
                    }
                    .onEnded { value in
                        let current = WeekStripDrag.segment(
                            atX: value.location.x, width: geo.size.width,
                            count: weekNumbers.count)
                        commit(WeekStripDrag.commit(
                            anchor: anchor ?? current, current: current,
                            existing: effectiveSelection))
                        anchor = nil
                        provisional = nil
                    })
        }
        .frame(minHeight: 44)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func highlighted(_ number: Int) -> Bool {
        if let provisional { return provisional.contains(number) }
        return isSelected(number)
    }

    @ViewBuilder
    private func segment(_ number: Int) -> some View {
        let on = highlighted(number)
        // Round only the run's outer corners so a contiguous selection
        // renders as one capsule, not per-segment pills.
        let leadingEdge = on && !highlighted(number - 1)
        let trailingEdge = on && !highlighted(number + 1)

        Text("\(number)")
            .font(.subheadline.weight(.medium))
            .monospacedDigit()
            .lineLimit(1)
            .frame(maxWidth: .infinity, minHeight: 44)
            .foregroundStyle(on ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            .background(
                on ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.clear),
                in: UnevenRoundedRectangle(
                    topLeadingRadius: leadingEdge ? 12 : 0,
                    bottomLeadingRadius: leadingEdge ? 12 : 0,
                    bottomTrailingRadius: trailingEdge ? 12 : 0,
                    topTrailingRadius: trailingEdge ? 12 : 0))
            .accessibilityElement()
            .accessibilityLabel("Week \(number)")
            .accessibilityAddTraits(on ? [.isButton, .isSelected] : [.isButton])
            .accessibilityAction {
                commit(WeekStripDrag.commit(
                    anchor: number, current: number, existing: effectiveSelection))
            }
            .accessibilityAction(named: "Extend selection to week \(number)") {
                commit(WeekStripDrag.extended(from: effectiveSelection, to: number))
            }
    }
}
```

- [ ] **Step 2: Rewire `DateFilterSheet`**

1. `visibleScopes` becomes an explicit list (order and the `.thisWeek`/`.season` membership can no longer come from `allCases`):

```swift
    private var visibleScopes: [DateScope] {
        model.isCurrentYear ? [.next, .today, .season, .all] : [.all]
    }
```

2. Replace the whole `section("Weeks") { LazyVGrid ... }` block (including the bare-number comment — its `ViewThatFits` rationale dies with the grid) with:

```swift
                    section("Weeks") {
                        WeekRangeStrip(
                            weekNumbers: weekNumbers,
                            isSelected: { number in
                                FilterChipState.isWeekSelected(
                                    number, selection: model.filter,
                                    currentWeek: model.currentWeek)
                            },
                            effectiveSelection: effectiveWeekSelection,
                            commit: { model.setWeekSelection($0) })
                    }
```

3. Add the helper property (below `weekNumbers`):

```swift
    /// What a strip gesture should treat as already-selected. A persisted
    /// `.thisWeek` scope highlights the current week without any stored
    /// weeks — treating it as that one week makes tapping it deselect
    /// (rather than confusingly "re-select") on the first touch.
    private var effectiveWeekSelection: Set<Int> {
        if model.filter.selectedWeeks.isEmpty,
           model.filter.dateScope == .thisWeek,
           let currentWeek = model.currentWeek {
            return [currentWeek]
        }
        return model.filter.selectedWeeks
    }
```

4. Update the sheet's header doc comment ("a scope row and a grid of the season's nine weeks" → "a scope row and the nine-week range strip"; the `selectWeek` reference → `setWeekSelection`).
5. Replace the bottom `#Preview("Weeks grid — accessibility3")` with the strip equivalent (same intent — eyeball 44pt/truncation at `.accessibility3`):

```swift
#Preview("Week strip — accessibility3") {
    WeekRangeStrip(
        weekNumbers: Array(1...9),
        isSelected: { (4...6).contains($0) },
        effectiveSelection: [4, 5, 6],
        commit: { _ in })
    .padding(20)
    .environment(\.dynamicTypeSize, .accessibility3)
}
```

- [ ] **Step 3: Run the full suite**

Full-suite command. Expected: PASS (no remaining reference to `selectWeek` anywhere — `grep -rn "selectWeek" ios/` must return nothing).

- [ ] **Step 4: Manual verification in the simulator**

Launch, open the Dates sheet. Verify against the issue's three rules: (1) tap 4 → only week 4 selected; tap 4 again → cleared; (2) touch 3, slide to 6, release → 3–6 as one capsule; (3) touch 3, slide to 8, slide back to 6, release → 3–6. Verify When row shows Now · Today · All Season · All Year; All Season narrows the list (footer count drops if off-season events exist); pill label under the sheet reads "All Season"/"All Year"/"Weeks 3–6" as appropriate. Verify the strip at Settings → Accessibility → Larger Text (accessibility sizes) or via the `#Preview`.

- [ ] **Step 5: Commit**

```bash
git add ios/ChqCalendar/Features/Filters/WeekRangeStrip.swift ios/ChqCalendar/Features/Filters/DateFilterSheet.swift
git commit -m "feat(ios): week range strip + Now/Today/All Season/All Year (#162)"
```

---

### Task 8: Screenshots, listing copy, PR

**Files:**
- Modify (generated): `docs/app-store/screenshots.manifest.json`, `docs/app-store/screenshots/review/**` — only if a covered shot changed.

**Interfaces:**
- Consumes: `ios/Scripts/capture-screenshots.sh`, `ios/Scripts/compose-screenshots.py`, `ios/Scripts/screenshot-plan.json`.
- Produces: an open PR closing #162.

- [ ] **Step 1: Regenerate screenshots**

No shot in `screenshot-plan.json` opens the **Dates** sheet (`02-filters` opens the facet `FilterSheet`), but regenerate anyway — the honest opt-out requires having run it:

```bash
ios/Scripts/capture-screenshots.sh
python3 ios/Scripts/compose-screenshots.py
git status docs/app-store/
```

Commit manifest + review copies if changed; otherwise the PR uses `[skip-screenshots: regenerated, no covered shot changed — no shot opens the Dates sheet]`.

- [ ] **Step 2: Re-read listing copy**

`docs/app-store/listing-copy.md` + `listing-fields.json`: if any sentence describes week filtering (e.g. "filter by week"), confirm it still holds (it does — the capability is unchanged, only its control) and note that a future screenshot refresh could showcase the strip.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/162-week-range-strip
gh pr create --title "feat(ios): Dates drawer — week range strip + All Season/All Year scopes (#162)" --body "$(cat <<'EOF'
Closes #162.

When options are now Now · Today · All Season · All Year (new
`DateScope.season` filters to the 9-week range; "All" relabeled "All
Year"; "This Week" left the sheet — the strip covers it — but stays
decodable so persisted selections keep working).

The 3×3 week-pill grid is replaced by `WeekRangeStrip`: one joined bar of
nine segments whose selected run renders as a single capsule. One drag
gesture implements the issue's three rules — tap replaces the selection
with that week (tap again to clear), dragging selects anchor→finger, and
retreating mid-drag shrinks the range. Selection commits once on touch-up.
Week selection is now a single week or one contiguous range; persisted
non-contiguous sets still render and filter until first touch.

Pure logic (`WeekStripDrag`, season scope, labels, chip state) is fully
unit-tested; `AppModel.selectWeek`'s four-branch toggle is replaced by
`setWeekSelection`. VoiceOver: per-segment selection plus an "Extend
selection to week N" action.

iOS suite run locally (CI has no macOS runner): all tests pass.
Manually verified rules 1–3 in the simulator, plus accessibility3 sizing.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_012mchpBcoJsknvac53PhHBQ
EOF
)"
```

Add the screenshot opt-out line from Step 1 if the manifest didn't change.

---

## Untouched on purpose

- `WeekStripState` / `WeekTimeState` (`Domain/WeekStripState.swift`): orphaned since the four-row bar was deleted; its own header says to remove it in a dedicated change, not as a side effect. The strip does not consume it. Leave it and its tests alone.
- `FilterSelection` schema, `UserStateStore` persistence format: unchanged.
- The web app's week filter: out of scope (#162 is iOS-only).
