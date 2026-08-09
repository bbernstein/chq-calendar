# My Day Date Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework My Day's day navigation so it opens on today, always states which day it is showing, and lets the user reach any day of the season without scrolling past two months of history.

**Architecture:** A new pure domain type `DayWindow` (alongside the existing `DayPlan`) owns all the date arithmetic: the outer bounds the strip can show, the windowed slice it shows right now, and which day to open on. `MyDayView` becomes a thin renderer over it. A second, smaller strand adds `DateScope.day` — a single-day filter on the Events tab — so an empty day in My Day can offer a "Browse Aug 9 events" action instead of being a dead end.

**Tech Stack:** Swift 6, SwiftUI, Swift Testing (`@Test` / `#expect` / `#require`), Xcode 26.6, iOS 18+ deployment target.

**Spec:** `docs/superpowers/specs/2026-08-09-my-day-date-model-design.md`
**Issue:** [#192](https://github.com/bbernstein/chq-calendar/issues/192)
**Branch:** `feat/my-day-192` (already created, spec already committed at `206052c`)

## Global Constraints

- **Never commit to `main`.** All work lands on `feat/my-day-192`.
- **Day keys are `"yyyy-MM-dd"` strings** produced by `ChqTime.dayKey(for:)`. Their lexicographic order is chronological, which is what makes `ClosedRange<String>` a correct range type. Never compare or offset them with string manipulation — always go through `ChqTime.calendar`.
- **All new domain types live in `ios/ChqCalendarShared/Domain/`, are `nonisolated`, `Equatable`, `Sendable`, and take `today`/`now` as a parameter.** No `Date()` inside domain code — that is what makes it testable. `DayPlan.swift` is the reference for this style.
- **All dates are America/New_York**, via `ChqTime.zone` / `ChqTime.calendar`. Never `Calendar.current`.
- **Test framework is Swift Testing**, not XCTest: `import Testing`, `@testable import ChqCalendar`, `@Test func name()`, `#expect(...)`, `try #require(...)`.
- **Verification command** (run from `ios/`):
  ```bash
  xcodebuild test \
    -project ChqCalendar.xcodeproj -scheme ChqCalendar \
    -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
    CODE_SIGNING_ALLOWED=NO
  ```
  Swap the `-destination` for a locally installed simulator if that one is missing (`xcrun simctl list devices available`). The suite is at 605 tests before this work.
- **Do not modify `ChqTime.compactDayLabel`.** It is `"EEE d"` and is shared with `GroundsMapView`'s upcoming-events rows. This work adds new formatters rather than changing it.
- **`DayPlan.defaultDayKey` keeps its current contract and its five existing tests.** It is reused for the no-today branch, not replaced.

---

### Task 1: `ChqTime` day arithmetic and labels

**Files:**
- Modify: `ios/ChqCalendarShared/Support/ChqTime.swift`
- Create: `ios/ChqCalendarTests/ChqTimeTests.swift`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `ChqTime.day(_ key: String, offsetBy days: Int) -> String?`
  - `ChqTime.dayKeys(from: String, through: String) -> [String]`
  - `ChqTime.weekdayLabel(for date: Date) -> String` — `"Sun"`
  - `ChqTime.monthDayLabel(for date: Date) -> String` — `"Aug 9"`
  - `ChqTime.dayTitle(for date: Date, includingYear: Bool) -> String` — `"Sunday, August 9"` / `"Sunday, August 9, 2025"`
  - `ChqTime.pillDayLabel(for date: Date, includingYear: Bool) -> String` — `"Sun, Aug 9"` / `"Sun, Aug 9, 2025"`

- [ ] **Step 1: Write the failing tests**

Create `ios/ChqCalendarTests/ChqTimeTests.swift`:

```swift
import Foundation
import Testing
@testable import ChqCalendar

/// Pins the day-key arithmetic and chip/pill label formatters added for the
/// My Day date model (#192). The DST cases matter even though a Chautauqua
/// season never spans a transition: these are general-purpose helpers, and
/// arithmetic done by adding 86_400 seconds instead of a calendar day would
/// pass every in-season test and silently break anywhere else.
struct ChqTimeTests {
    // MARK: - day(_:offsetBy:)

    @Test func dayOffsetMovesForwardAndBackward() {
        #expect(ChqTime.day("2026-08-09", offsetBy: 1) == "2026-08-10")
        #expect(ChqTime.day("2026-08-09", offsetBy: -1) == "2026-08-08")
        #expect(ChqTime.day("2026-08-09", offsetBy: 0) == "2026-08-09")
    }

    @Test func dayOffsetCrossesMonthAndYearBoundaries() {
        #expect(ChqTime.day("2026-07-31", offsetBy: 1) == "2026-08-01")
        #expect(ChqTime.day("2026-01-01", offsetBy: -1) == "2025-12-31")
    }

    @Test func dayOffsetIsCorrectAcrossTheSpringForwardTransition() {
        // 2026-03-08 is the second Sunday of March: clocks jump 2am -> 3am,
        // so that NY day is only 23 hours long.
        #expect(ChqTime.day("2026-03-07", offsetBy: 1) == "2026-03-08")
        #expect(ChqTime.day("2026-03-08", offsetBy: 1) == "2026-03-09")
        #expect(ChqTime.day("2026-03-07", offsetBy: 2) == "2026-03-09")
    }

    @Test func dayOffsetIsCorrectAcrossTheFallBackTransition() {
        // 2026-11-01 is the first Sunday of November: that NY day is 25
        // hours long.
        #expect(ChqTime.day("2026-11-01", offsetBy: 1) == "2026-11-02")
        #expect(ChqTime.day("2026-10-31", offsetBy: 2) == "2026-11-02")
    }

    @Test func dayOffsetIsNilForAnUnparseableKey() {
        #expect(ChqTime.day("not-a-day", offsetBy: 1) == nil)
    }

    // MARK: - dayKeys(from:through:)

    @Test func dayKeysIsInclusiveOfBothEnds() {
        #expect(ChqTime.dayKeys(from: "2026-08-09", through: "2026-08-12")
            == ["2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12"])
    }

    @Test func dayKeysReturnsASingleDayWhenEndsMatch() {
        #expect(ChqTime.dayKeys(from: "2026-08-09", through: "2026-08-09") == ["2026-08-09"])
    }

    @Test func dayKeysIsEmptyWhenTheRangeIsInverted() {
        #expect(ChqTime.dayKeys(from: "2026-08-12", through: "2026-08-09").isEmpty)
    }

    @Test func dayKeysIsEmptyForAnUnparseableKey() {
        #expect(ChqTime.dayKeys(from: "nope", through: "2026-08-09").isEmpty)
        #expect(ChqTime.dayKeys(from: "2026-08-09", through: "nope").isEmpty)
    }

    @Test func dayKeysSpansTheFallBackTransitionWithoutRepeatingADay() {
        #expect(ChqTime.dayKeys(from: "2026-10-31", through: "2026-11-02")
            == ["2026-10-31", "2026-11-01", "2026-11-02"])
    }

    @Test func dayKeysCoversTheWhole2026Season() {
        // Season 2026 runs Sat Jun 27 through Sat Aug 29 inclusive.
        #expect(ChqTime.dayKeys(from: "2026-06-27", through: "2026-08-29").count == 64)
    }

    // MARK: - Labels

    @Test func weekdayAndMonthDayLabels() throws {
        let date = try #require(ChqTime.parse("2026-08-09 10:00:00"))
        #expect(ChqTime.weekdayLabel(for: date) == "Sun")
        #expect(ChqTime.monthDayLabel(for: date) == "Aug 9")
    }

    @Test func dayTitleAddsTheYearOnlyWhenAsked() throws {
        let date = try #require(ChqTime.parse("2025-08-23 10:00:00"))
        #expect(ChqTime.dayTitle(for: date, includingYear: false) == "Saturday, August 23")
        #expect(ChqTime.dayTitle(for: date, includingYear: true) == "Saturday, August 23, 2025")
    }

    @Test func dayTitleWithoutYearMatchesTheExistingOverload() throws {
        let date = try #require(ChqTime.parse("2026-08-09 10:00:00"))
        #expect(ChqTime.dayTitle(for: date, includingYear: false) == ChqTime.dayTitle(for: date))
    }

    @Test func pillDayLabelAddsTheYearOnlyWhenAsked() throws {
        let date = try #require(ChqTime.parse("2025-08-23 10:00:00"))
        #expect(ChqTime.pillDayLabel(for: date, includingYear: false) == "Sat, Aug 23")
        #expect(ChqTime.pillDayLabel(for: date, includingYear: true) == "Sat, Aug 23, 2025")
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  CODE_SIGNING_ALLOWED=NO 2>&1 | tail -40
```

Expected: compile failure — `type 'ChqTime' has no member 'day'` (and the other five new members).

- [ ] **Step 3: Add the formatters**

In `ios/ChqCalendarShared/Support/ChqTime.swift`, after the existing `compactDayFormatter` (around line 71), add:

```swift
    /// `"EEE"`, e.g. `"Sun"` — the top line of a My Day chip (#192).
    /// Deliberately separate from `compactDayFormatter` (`"EEE d"`), which
    /// `GroundsMapView` also uses and which must not change.
    private static let weekdayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "EEE"
        return formatter
    }()

    /// `"MMM d"`, e.g. `"Aug 9"` — the date line of a My Day chip. The
    /// month is on *every* chip so a chip is unambiguous wherever the strip
    /// happens to be scrolled (#192).
    private static let monthDayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "MMM d"
        return formatter
    }()

    /// `"EEEE, MMMM d, yyyy"` — `dayTitle` for a season that isn't the
    /// current one, where the year is load-bearing.
    private static let dayTitleWithYearFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "EEEE, MMMM d, yyyy"
        return formatter
    }()

    /// `"EEE, MMM d"`, e.g. `"Sun, Aug 9"` — the Events-tab date pill for a
    /// `.day` scope.
    private static let pillDayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "EEE, MMM d"
        return formatter
    }()

    /// `"EEE, MMM d, yyyy"`, e.g. `"Sat, Aug 23, 2025"`.
    private static let pillDayWithYearFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "EEE, MMM d, yyyy"
        return formatter
    }()
```

- [ ] **Step 4: Add the label accessors**

In the same file, after the existing `compactDayLabel(for:)` function:

```swift
    /// `"EEE"`, e.g. `"Sun"`.
    static func weekdayLabel(for date: Date) -> String {
        weekdayFormatter.string(from: date)
    }

    /// `"MMM d"`, e.g. `"Aug 9"`.
    static func monthDayLabel(for date: Date) -> String {
        monthDayFormatter.string(from: date)
    }

    /// `dayTitle`, optionally carrying the year. Callers pass
    /// `includingYear: !isCurrentYear` — the same signal the rest of the app
    /// already threads through to distinguish the live season from an
    /// archived one.
    static func dayTitle(for date: Date, includingYear: Bool) -> String {
        includingYear ? dayTitleWithYearFormatter.string(from: date) : dayTitle(for: date)
    }

    /// `"EEE, MMM d"` (optionally `", yyyy"`), e.g. `"Sun, Aug 9"` — the
    /// Events-tab date pill for a `.day` scope.
    static func pillDayLabel(for date: Date, includingYear: Bool) -> String {
        includingYear
            ? pillDayWithYearFormatter.string(from: date)
            : pillDayFormatter.string(from: date)
    }
```

- [ ] **Step 5: Add the day arithmetic**

In the same file, after `endOfDay(_:)`:

```swift
    /// `key` shifted by `days` NY calendar days, or `nil` when `key` isn't a
    /// parseable `"yyyy-MM-dd"` day key.
    ///
    /// Goes through `calendar.date(byAdding: .day:)` rather than adding
    /// 86_400 seconds, so a day that is 23 or 25 hours long across a DST
    /// transition still counts as one day.
    static func day(_ key: String, offsetBy days: Int) -> String? {
        guard
            let date = parse("\(key) 00:00:00"),
            let shifted = calendar.date(byAdding: .day, value: days, to: date)
        else { return nil }
        return dayKey(for: shifted)
    }

    /// Every day key from `from` through `through`, inclusive and ascending.
    /// Empty when either key is unparseable or `through` precedes `from`.
    static func dayKeys(from: String, through: String) -> [String] {
        guard
            from <= through,
            let startDate = parse("\(from) 00:00:00"),
            parse("\(through) 00:00:00") != nil
        else { return [] }

        var result: [String] = []
        var cursor = startDate
        var key = dayKey(for: cursor)
        while key <= through {
            result.append(key)
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
            key = dayKey(for: cursor)
        }
        return result
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run the verification command from Global Constraints.
Expected: PASS, suite total grows by 15 tests.

- [ ] **Step 7: Commit**

```bash
git add ios/ChqCalendarShared/Support/ChqTime.swift ios/ChqCalendarTests/ChqTimeTests.swift
git commit -m "feat(ios): ChqTime day arithmetic and My Day labels (#192)

Adds day(_:offsetBy:) and dayKeys(from:through:), both routed through
ChqTime.calendar so a 23- or 25-hour DST day still counts as one day,
plus the weekday/month-day/pill/with-year label formatters the My Day
strip and the .day date pill need.

compactDayLabel is deliberately untouched: it is EEE d and GroundsMapView
shares it."
```

---

### Task 2: `DayPlan.starredCountsByDay`

**Files:**
- Modify: `ios/ChqCalendarShared/Domain/DayPlan.swift`
- Modify: `ios/ChqCalendarTests/DayPlanTests.swift`

**Interfaces:**
- Consumes: nothing from Task 1
- Produces: `DayPlan.starredCountsByDay(favorites: Set<String>, events: [Event]) -> [String: Int]`

- [ ] **Step 1: Write the failing tests**

Append to `ios/ChqCalendarTests/DayPlanTests.swift`, inside the existing `DayPlanTests` struct (add a `// MARK: - starredCountsByDay` section at the end):

```swift
    // MARK: - starredCountsByDay

    @Test func starredCountsByDayCountsOnlyFavoritedEvents() throws {
        let morning = try #require(ChqTime.parse("2026-08-09 10:00:00"))
        let evening = try #require(ChqTime.parse("2026-08-09 20:00:00"))
        let nextDay = try #require(ChqTime.parse("2026-08-10 10:00:00"))
        let events = [
            makeEvent(id: "a", start: morning),
            makeEvent(id: "b", start: evening),
            makeEvent(id: "c", start: nextDay),
            makeEvent(id: "unstarred", start: morning),
        ]

        let counts = DayPlan.starredCountsByDay(favorites: ["a", "b", "c"], events: events)

        #expect(counts == ["2026-08-09": 2, "2026-08-10": 1])
    }

    @Test func starredCountsByDayOmitsDaysWithNoFavorites() throws {
        let start = try #require(ChqTime.parse("2026-08-09 10:00:00"))
        let counts = DayPlan.starredCountsByDay(
            favorites: [], events: [makeEvent(id: "a", start: start)])

        #expect(counts.isEmpty)
        // A caller reading a missing key gets nil and must treat it as 0.
        #expect(counts["2026-08-09"] == nil)
    }

    @Test func starredCountsByDayIncludesCancelledEvents() throws {
        // Consistent with `build`, which keeps cancelled events on the
        // timeline: a day the user starred something on still reads as a
        // day with something on it.
        let start = try #require(ChqTime.parse("2026-08-09 10:00:00"))
        let counts = DayPlan.starredCountsByDay(
            favorites: ["a"],
            events: [makeEvent(id: "a", start: start, status: .cancelled)])

        #expect(counts == ["2026-08-09": 1])
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run the verification command.
Expected: compile failure — `type 'DayPlan' has no member 'starredCountsByDay'`.

- [ ] **Step 3: Write the implementation**

In `ios/ChqCalendarShared/Domain/DayPlan.swift`, after `availableDayKeys`:

```swift
    /// How many favorited events fall on each NY calendar day, in a single
    /// pass over `events`. Days with no favorited events are absent from the
    /// dictionary; a caller reading a missing key gets `nil` and should
    /// treat it as `0`.
    ///
    /// Cancelled events are counted, matching `build`, which keeps them on
    /// the timeline: a day the user starred something on still reads as a
    /// day with something on it.
    ///
    /// Exists so `MyDayView` can label its ~22 visible chips without calling
    /// `build` once per chip — each `build` walks the whole event list, so
    /// per-chip calls would be 22 full passes per render (#192).
    static func starredCountsByDay(favorites: Set<String>, events: [Event]) -> [String: Int] {
        var counts: [String: Int] = [:]
        for event in events where favorites.contains(event.id) {
            counts[ChqTime.dayKey(for: event.start), default: 0] += 1
        }
        return counts
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the verification command.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ios/ChqCalendarShared/Domain/DayPlan.swift ios/ChqCalendarTests/DayPlanTests.swift
git commit -m "feat(ios): DayPlan.starredCountsByDay (#192)

One pass over the event list producing per-day favorited counts, so the
My Day strip can label ~22 chips without calling dayPlan(for:) once per
chip — each of those walks the whole event list."
```

---

### Task 3: `DayWindow.bounds`

**Files:**
- Create: `ios/ChqCalendarShared/Domain/DayWindow.swift`
- Create: `ios/ChqCalendarTests/DayWindowTests.swift`

**Interfaces:**
- Consumes: `ChqTime.dayKey(for:)` (existing), `SeasonCalendar.weeks(forYear:)` (existing)
- Produces:
  - `struct DayWindow` with stored properties `days: [String]`, `canExpandEarlier: Bool`, `canExpandLater: Bool`, `hiddenEarlierCount: Int`, `hiddenLaterCount: Int`
  - `DayWindow.defaultDaysBefore = 7`, `DayWindow.defaultDaysAfter = 14`
  - `DayWindow.bounds(year: Int, starredDays: [String]) -> ClosedRange<String>`

**Note on the 2026 season, used by every test in Tasks 3–7:** `SeasonCalendar.seasonStart(year: 2026)` is **Saturday June 27 2026** at noon (June 1 2026 is a Monday, so the first Sunday is June 7, the fourth is June 28, and the Saturday before it is June 27). Nine weeks later `weeks.last.end` is **Saturday August 29 2026** at noon. Season bounds are therefore `"2026-06-27"..."2026-08-29"`, **64 days**. Week 7 begins Saturday **August 8** (June 27 + 42 days).

- [ ] **Step 1: Write the failing tests**

Create `ios/ChqCalendarTests/DayWindowTests.swift`:

```swift
import Foundation
import Testing
@testable import ChqCalendar

/// Pins `DayWindow`, the date model behind the My Day strip (#192).
///
/// All fixtures use the 2026 season, which runs Saturday June 27 through
/// Saturday August 29 inclusive — 64 days. `weeks.last.end` is an exclusive
/// noon-Saturday boundary, but that Saturday morning still holds week-9
/// events, so its day key belongs in the bounds.
struct DayWindowTests {
    private let year = 2026
    private let seasonFirst = "2026-06-27"
    private let seasonLast = "2026-08-29"

    // MARK: - bounds

    @Test func boundsSpanTheWholeSeasonWhenNothingIsStarredOutsideIt() {
        let bounds = DayWindow.bounds(year: year, starredDays: ["2026-07-15", "2026-08-09"])

        #expect(bounds.lowerBound == seasonFirst)
        #expect(bounds.upperBound == seasonLast)
    }

    @Test func boundsSpanTheSeasonWithNoStarredDaysAtAll() {
        let bounds = DayWindow.bounds(year: year, starredDays: [])

        #expect(bounds.lowerBound == seasonFirst)
        #expect(bounds.upperBound == seasonLast)
    }

    @Test func boundsWidenToContainAStarredDayBeforeTheSeason() {
        // Without this widening a starred pre-season event would be
        // permanently unreachable from the strip.
        let bounds = DayWindow.bounds(year: year, starredDays: ["2026-06-20", "2026-08-09"])

        #expect(bounds.lowerBound == "2026-06-20")
        #expect(bounds.upperBound == seasonLast)
    }

    @Test func boundsWidenToContainAStarredDayAfterTheSeason() {
        let bounds = DayWindow.bounds(year: year, starredDays: ["2026-07-15", "2026-09-05"])

        #expect(bounds.lowerBound == seasonFirst)
        #expect(bounds.upperBound == "2026-09-05")
    }

    @Test func boundsWidenAtBothEndsAtOnce() {
        let bounds = DayWindow.bounds(year: year, starredDays: ["2026-06-20", "2026-09-05"])

        #expect(bounds.lowerBound == "2026-06-20")
        #expect(bounds.upperBound == "2026-09-05")
    }

    @Test func boundsToleratesUnsortedStarredDays() {
        let bounds = DayWindow.bounds(
            year: year, starredDays: ["2026-09-05", "2026-07-15", "2026-06-20"])

        #expect(bounds.lowerBound == "2026-06-20")
        #expect(bounds.upperBound == "2026-09-05")
    }

    @Test func boundsCoverSixtyFourDaysForThe2026Season() {
        let bounds = DayWindow.bounds(year: year, starredDays: [])

        #expect(ChqTime.dayKeys(from: bounds.lowerBound, through: bounds.upperBound).count == 64)
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run the verification command.
Expected: compile failure — `cannot find 'DayWindow' in scope`.

- [ ] **Step 3: Create `DayWindow` with `bounds`**

Create `ios/ChqCalendarShared/Domain/DayWindow.swift`:

```swift
import Foundation

/// Which calendar days the My Day strip can show, and which subset of them
/// it is showing right now (#192).
///
/// Pure domain logic in the shape of `DayPlan`: no `Date()`, no I/O —
/// `today` is always supplied by the caller. Day keys are `ChqTime.dayKey`
/// strings (`"yyyy-MM-dd"`), whose lexicographic order is chronological,
/// which is what makes `ClosedRange<String>` a correct range type here.
///
/// The strip is driven by the *calendar*, not by the favorites set: every
/// day in the window is shown and tappable, including days with nothing
/// starred. A strip built only from starred days re-flows whenever the user
/// stars or unstars anything, so chip positions are unpredictable; a
/// calendar-driven one is stable and makes gaps in the plan visible.
nonisolated struct DayWindow: Equatable, Sendable {
    /// Visible day keys, ascending and contiguous.
    let days: [String]
    /// Whether an "earlier" control belongs on the leading edge. Stays
    /// `true` once that end is expanded, so the control can toggle back —
    /// it reports "this end *has* something to expand", not "something is
    /// hidden right now". For the latter, see `hiddenEarlierCount`.
    let canExpandEarlier: Bool
    /// As `canExpandEarlier`, for the trailing edge.
    let canExpandLater: Bool
    /// How many days are hidden before `days.first` right now — `0` once
    /// that end is expanded. Drives the control's VoiceOver label ("Show 42
    /// earlier days"); the visible chip stays narrow.
    let hiddenEarlierCount: Int
    /// As `hiddenEarlierCount`, for the trailing edge.
    let hiddenLaterCount: Int

    /// How many days before and after `today` the default (unexpanded)
    /// window covers. The near past is worth keeping — "what did I go to
    /// yesterday" — and two weeks forward covers the planning horizon.
    static let defaultDaysBefore = 7
    static let defaultDaysAfter = 14

    /// The outer limit of everything the strip can ever show: `year`'s
    /// season, widened to contain any starred day outside it.
    ///
    /// The season component runs from the opening Saturday through the day
    /// of `weeks.last.end`. That `end` is an *exclusive* noon-Saturday
    /// boundary, but that Saturday morning still holds week-9 events, so its
    /// day key belongs in the range. For 2026 this is
    /// `"2026-06-27"..."2026-08-29"` — 64 days.
    ///
    /// The widening is not cosmetic: without it a starred pre- or
    /// post-season event would be permanently unreachable from the strip.
    /// `starredDays` need not be sorted.
    static func bounds(year: Int, starredDays: [String]) -> ClosedRange<String> {
        // `SeasonCalendar.weeks` always returns exactly 9 weeks.
        let weeks = SeasonCalendar.weeks(forYear: year)
        var lower = ChqTime.dayKey(for: weeks[0].start)
        var upper = ChqTime.dayKey(for: weeks[weeks.count - 1].end)

        if let earliestStarred = starredDays.min() {
            lower = Swift.min(lower, earliestStarred)
        }
        if let latestStarred = starredDays.max() {
            upper = Swift.max(upper, latestStarred)
        }
        return lower...upper
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the verification command.
Expected: PASS, 7 new tests.

- [ ] **Step 5: Commit**

```bash
git add ios/ChqCalendarShared/Domain/DayWindow.swift ios/ChqCalendarTests/DayWindowTests.swift
git commit -m "feat(ios): DayWindow.bounds (#192)

The outer limit of the My Day strip: the season, widened to contain any
starred day outside it. Without the widening a starred pre- or
post-season event would be permanently unreachable from the strip.

The upper bound is the day of weeks.last.end even though that noon-
Saturday boundary is exclusive — that Saturday morning still holds
week-9 events."
```

---

### Task 4: `DayWindow.make`

**Files:**
- Modify: `ios/ChqCalendarShared/Domain/DayWindow.swift`
- Modify: `ios/ChqCalendarTests/DayWindowTests.swift`

**Interfaces:**
- Consumes: `DayWindow.bounds` (Task 3), `ChqTime.day(_:offsetBy:)` and `ChqTime.dayKeys(from:through:)` (Task 1)
- Produces: `DayWindow.make(bounds: ClosedRange<String>, today: String, showsEarlier: Bool, showsLater: Bool) -> DayWindow`

- [ ] **Step 1: Write the failing tests**

Append to `DayWindowTests`, after the `bounds` section:

```swift
    // MARK: - make

    /// Mid-season: Sunday August 9 2026, comfortably inside the season with
    /// room to expand at both ends.
    private var midSeasonBounds: ClosedRange<String> {
        DayWindow.bounds(year: year, starredDays: [])
    }

    @Test func defaultWindowIsSevenBackAndFourteenForward() {
        let window = DayWindow.make(
            bounds: midSeasonBounds, today: "2026-08-09",
            showsEarlier: false, showsLater: false)

        #expect(window.days.first == "2026-08-02")
        #expect(window.days.last == "2026-08-23")
        #expect(window.days.count == 22)
        #expect(window.days.contains("2026-08-09"))
    }

    @Test func defaultWindowReportsBothEndsAsExpandable() {
        let window = DayWindow.make(
            bounds: midSeasonBounds, today: "2026-08-09",
            showsEarlier: false, showsLater: false)

        #expect(window.canExpandEarlier)
        #expect(window.canExpandLater)
        // Jun 27 .. Aug 1 inclusive
        #expect(window.hiddenEarlierCount == 36)
        // Aug 24 .. Aug 29 inclusive
        #expect(window.hiddenLaterCount == 6)
    }

    @Test func expandingEarlierReachesTheSeasonStartWithoutTouchingTheOtherEnd() {
        let window = DayWindow.make(
            bounds: midSeasonBounds, today: "2026-08-09",
            showsEarlier: true, showsLater: false)

        #expect(window.days.first == seasonFirst)
        #expect(window.days.last == "2026-08-23")
        #expect(window.hiddenEarlierCount == 0)
        #expect(window.hiddenLaterCount == 6)
        // Still true: the control stays put so it can toggle back.
        #expect(window.canExpandEarlier)
        #expect(window.canExpandLater)
    }

    @Test func expandingLaterReachesTheSeasonEndWithoutTouchingTheOtherEnd() {
        let window = DayWindow.make(
            bounds: midSeasonBounds, today: "2026-08-09",
            showsEarlier: false, showsLater: true)

        #expect(window.days.first == "2026-08-02")
        #expect(window.days.last == seasonLast)
        #expect(window.hiddenEarlierCount == 36)
        #expect(window.hiddenLaterCount == 0)
    }

    @Test func expandingBothEndsShowsTheWholeSeason() {
        let window = DayWindow.make(
            bounds: midSeasonBounds, today: "2026-08-09",
            showsEarlier: true, showsLater: true)

        #expect(window.days.first == seasonFirst)
        #expect(window.days.last == seasonLast)
        #expect(window.days.count == 64)
    }

    @Test func windowClampsAtTheSeasonStartAndDropsTheEarlierControl() {
        // Opening day: there is nothing before it, so the control must not
        // be offered rather than expanding into nothing.
        let window = DayWindow.make(
            bounds: midSeasonBounds, today: seasonFirst,
            showsEarlier: false, showsLater: false)

        #expect(window.days.first == seasonFirst)
        #expect(window.days.last == "2026-07-11")
        #expect(!window.canExpandEarlier)
        #expect(window.hiddenEarlierCount == 0)
        #expect(window.canExpandLater)
    }

    @Test func windowClampsAtTheSeasonEndAndDropsTheLaterControl() {
        let window = DayWindow.make(
            bounds: midSeasonBounds, today: seasonLast,
            showsEarlier: false, showsLater: false)

        #expect(window.days.first == "2026-08-22")
        #expect(window.days.last == seasonLast)
        #expect(window.canExpandEarlier)
        #expect(!window.canExpandLater)
        #expect(window.hiddenLaterCount == 0)
    }

    @Test func windowIsTheWholeSeasonWhenTodayIsBeforeIt() {
        // Pre-season: the relative window is meaningless, so everything is
        // shown and there is nothing to reveal.
        let window = DayWindow.make(
            bounds: midSeasonBounds, today: "2026-05-01",
            showsEarlier: false, showsLater: false)

        #expect(window.days.first == seasonFirst)
        #expect(window.days.last == seasonLast)
        #expect(window.days.count == 64)
        #expect(!window.canExpandEarlier)
        #expect(!window.canExpandLater)
        #expect(window.hiddenEarlierCount == 0)
        #expect(window.hiddenLaterCount == 0)
    }

    @Test func windowIsTheWholeSeasonWhenTodayIsAfterIt() {
        let window = DayWindow.make(
            bounds: midSeasonBounds, today: "2026-10-15",
            showsEarlier: false, showsLater: false)

        #expect(window.days.count == 64)
        #expect(!window.canExpandEarlier)
        #expect(!window.canExpandLater)
    }

    @Test func windowIgnoresExpansionFlagsWhenTodayIsOutsideBounds() {
        let collapsed = DayWindow.make(
            bounds: midSeasonBounds, today: "2026-10-15",
            showsEarlier: false, showsLater: false)
        let expanded = DayWindow.make(
            bounds: midSeasonBounds, today: "2026-10-15",
            showsEarlier: true, showsLater: true)

        #expect(collapsed == expanded)
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run the verification command.
Expected: compile failure — `type 'DayWindow' has no member 'make'`.

- [ ] **Step 3: Write the implementation**

Append to `DayWindow` in `ios/ChqCalendarShared/Domain/DayWindow.swift`, after `bounds`:

```swift
    /// The slice of `bounds` the strip shows right now.
    ///
    /// When `today` is inside `bounds`, the default slice runs
    /// `today - defaultDaysBefore ... today + defaultDaysAfter`, clamped to
    /// `bounds`; `showsEarlier` and `showsLater` extend each end
    /// independently out to the bound, so opening the past never drags the
    /// whole future along.
    ///
    /// The `canExpand` flags are computed from the *default* slice, not the
    /// current one, so a control stays on screen after its end is expanded
    /// and can toggle back. They go `false` only when the default slice
    /// already reached that bound — a control near a season edge disappears
    /// on its own rather than expanding into nothing.
    ///
    /// When `today` is outside `bounds` — off-season, or any past season —
    /// a window measured from "today" is meaningless, so the whole of
    /// `bounds` is shown, both flags are `false`, and `showsEarlier` /
    /// `showsLater` are ignored.
    static func make(
        bounds: ClosedRange<String>,
        today: String,
        showsEarlier: Bool,
        showsLater: Bool
    ) -> DayWindow {
        guard bounds.contains(today) else {
            return DayWindow(
                days: ChqTime.dayKeys(from: bounds.lowerBound, through: bounds.upperBound),
                canExpandEarlier: false,
                canExpandLater: false,
                hiddenEarlierCount: 0,
                hiddenLaterCount: 0)
        }

        let defaultLower = ChqTime.day(today, offsetBy: -defaultDaysBefore) ?? bounds.lowerBound
        let defaultUpper = ChqTime.day(today, offsetBy: defaultDaysAfter) ?? bounds.upperBound
        let clampedLower = Swift.max(defaultLower, bounds.lowerBound)
        let clampedUpper = Swift.min(defaultUpper, bounds.upperBound)

        let lower = showsEarlier ? bounds.lowerBound : clampedLower
        let upper = showsLater ? bounds.upperBound : clampedUpper

        // `dayKeys` is inclusive of both ends, so the number of days
        // strictly outside the clamp is the inclusive span minus the shared
        // boundary day.
        let hiddenEarlier = showsEarlier
            ? 0
            : Swift.max(0, ChqTime.dayKeys(from: bounds.lowerBound, through: clampedLower).count - 1)
        let hiddenLater = showsLater
            ? 0
            : Swift.max(0, ChqTime.dayKeys(from: clampedUpper, through: bounds.upperBound).count - 1)

        return DayWindow(
            days: ChqTime.dayKeys(from: lower, through: upper),
            canExpandEarlier: clampedLower > bounds.lowerBound,
            canExpandLater: clampedUpper < bounds.upperBound,
            hiddenEarlierCount: hiddenEarlier,
            hiddenLaterCount: hiddenLater)
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the verification command.
Expected: PASS, 10 new tests.

- [ ] **Step 5: Commit**

```bash
git add ios/ChqCalendarShared/Domain/DayWindow.swift ios/ChqCalendarTests/DayWindowTests.swift
git commit -m "feat(ios): DayWindow.make (#192)

The visible slice: today-7..today+14 clamped to the season, with each end
independently expandable to the season edge.

canExpand is computed from the default slice rather than the current one,
so a control stays on screen after expanding and can toggle back, while
still disappearing near a season edge instead of expanding into nothing.

Off-season and in a past season there is no 'today' to measure from, so
the whole of bounds is shown and the expansion flags are ignored."
```

---

### Task 5: `DayWindow.defaultSelection`

**Files:**
- Modify: `ios/ChqCalendarShared/Domain/DayWindow.swift`
- Modify: `ios/ChqCalendarTests/DayWindowTests.swift`

**Interfaces:**
- Consumes: `DayWindow.bounds` (Task 3), `DayPlan.defaultDayKey(available:now:)` (existing, unchanged)
- Produces: `DayWindow.defaultSelection(bounds: ClosedRange<String>, today: String, starredDays: [String]) -> String?`

- [ ] **Step 1: Write the failing tests**

Append to `DayWindowTests`:

```swift
    // MARK: - defaultSelection

    @Test func defaultSelectionIsTodayWhenTodayHasStarredEvents() {
        let selection = DayWindow.defaultSelection(
            bounds: midSeasonBounds, today: "2026-08-09",
            starredDays: ["2026-07-15", "2026-08-09"])

        #expect(selection == "2026-08-09")
    }

    @Test func defaultSelectionIsTodayEvenWhenTodayHasNothingStarred() {
        // The regression #192 is about. Skipping an empty today to the next
        // starred day relocates a visitor who asked "what am I doing today"
        // and answers a different question instead.
        let selection = DayWindow.defaultSelection(
            bounds: midSeasonBounds, today: "2026-07-17",
            starredDays: ["2026-07-15", "2026-07-20"])

        #expect(selection == "2026-07-17")
    }

    @Test func defaultSelectionIsTodayOnASeasonBoundaryDay() {
        #expect(DayWindow.defaultSelection(
            bounds: midSeasonBounds, today: seasonFirst,
            starredDays: ["2026-08-09"]) == seasonFirst)
        #expect(DayWindow.defaultSelection(
            bounds: midSeasonBounds, today: seasonLast,
            starredDays: ["2026-08-09"]) == seasonLast)
    }

    @Test func defaultSelectionIsNilWhenNothingIsStarred() {
        // The view shows its all-season empty state, so there is no day to
        // select. A 64-chip strip of uniformly empty days would be worse.
        #expect(DayWindow.defaultSelection(
            bounds: midSeasonBounds, today: "2026-08-09", starredDays: []) == nil)
    }

    @Test func defaultSelectionIsTheFirstStarredDayPreSeason() {
        let selection = DayWindow.defaultSelection(
            bounds: midSeasonBounds, today: "2026-05-01",
            starredDays: ["2026-07-15", "2026-08-09"])

        #expect(selection == "2026-07-15")
    }

    @Test func defaultSelectionIsTheLastStarredDayPostSeason() {
        let selection = DayWindow.defaultSelection(
            bounds: midSeasonBounds, today: "2026-10-15",
            starredDays: ["2026-07-15", "2026-08-09"])

        #expect(selection == "2026-08-09")
    }

    @Test func defaultSelectionIsTheLastStarredDayForAPastSeason() {
        // Viewing 2025 from August 2026: no "today" exists in that season,
        // and a user reviewing last August should not land in June.
        let bounds2025 = DayWindow.bounds(year: 2025, starredDays: ["2025-07-05", "2025-08-23"])
        let selection = DayWindow.defaultSelection(
            bounds: bounds2025, today: "2026-08-09",
            starredDays: ["2025-07-05", "2025-08-23"])

        #expect(selection == "2025-08-23")
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run the verification command.
Expected: compile failure — `type 'DayWindow' has no member 'defaultSelection'`.

- [ ] **Step 3: Write the implementation**

Append to `DayWindow`, after `make`:

```swift
    /// Which day the planner opens to.
    ///
    /// - Nothing starred at all → `nil`. The view shows its all-season
    ///   empty state, so there is no day to select.
    /// - `today` inside `bounds` → **`today`, even when today has nothing
    ///   starred.** This is the fix for #192: the previous behavior skipped
    ///   an empty today forward to the next day that did have favorites,
    ///   which relocates a visitor who asked "what am I doing today" and
    ///   answers a different question. Now that every day in the window is
    ///   selectable, an empty today can simply show as empty.
    /// - Otherwise → `DayPlan.defaultDayKey`, which already returns the
    ///   earliest future starred day when `today` precedes them all (the
    ///   pre-season case) and the latest starred day when `today` follows
    ///   them all (post-season, and any past season). Reused rather than
    ///   reimplemented, so its existing tests keep pinning it.
    static func defaultSelection(
        bounds: ClosedRange<String>,
        today: String,
        starredDays: [String]
    ) -> String? {
        guard !starredDays.isEmpty else { return nil }
        if bounds.contains(today) { return today }
        guard let todayDate = ChqTime.parse("\(today) 00:00:00") else {
            return starredDays.min()
        }
        // `defaultDayKey` is non-nil whenever `available` is non-empty,
        // which the guard above has already established; the coalesce keeps
        // this a total function rather than relying on that from a distance.
        return DayPlan.defaultDayKey(available: starredDays, now: todayDate) ?? starredDays.min()
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the verification command.
Expected: PASS, 7 new tests. `DayPlanTests` is unaffected.

- [ ] **Step 5: Commit**

```bash
git add ios/ChqCalendarShared/Domain/DayWindow.swift ios/ChqCalendarTests/DayWindowTests.swift
git commit -m "feat(ios): DayWindow.defaultSelection (#192)

Opens on today whenever today is in season — including when today has
nothing starred, which is the actual defect behind #192. The old
behavior skipped an empty today forward to the next starred day, which
answers a different question than the one the user asked.

Off-season and in past seasons it delegates to DayPlan.defaultDayKey,
which already returns the first future starred day pre-season and the
last starred day post-season. Reused, not reimplemented."
```

---

### Task 6: `MyDayChipContent`

**Files:**
- Create: `ios/ChqCalendarShared/Domain/MyDayChipContent.swift`
- Create: `ios/ChqCalendarTests/MyDayChipContentTests.swift`

**Interfaces:**
- Consumes: `ChqTime.weekdayLabel`, `ChqTime.monthDayLabel`, `ChqTime.dayTitle(for:includingYear:)` (Task 1)
- Produces: `struct MyDayChipContent` with `topLine: String`, `dateLine: String`, `starCount: Int`, `isToday: Bool`, `accessibilityLabel: String`, `isEmpty: Bool`, and `MyDayChipContent.make(dayKey: String, todayKey: String, starCount: Int, includingYear: Bool) -> MyDayChipContent?`

- [ ] **Step 1: Write the failing tests**

Create `ios/ChqCalendarTests/MyDayChipContentTests.swift`:

```swift
import Foundation
import Testing
@testable import ChqCalendar

/// Pins the My Day chip's labelling rules (#192), which are what the issue
/// was actually about — the old chip read "Sun 9" with no month, and nothing
/// on screen said which day was selected.
///
/// Split out of the SwiftUI view precisely so these rules are testable
/// without a view host.
struct MyDayChipContentTests {
    @Test func ordinaryChipShowsWeekdayAndMonthDay() throws {
        let content = try #require(MyDayChipContent.make(
            dayKey: "2026-08-10", todayKey: "2026-08-09", starCount: 2, includingYear: false))

        #expect(content.topLine == "Mon")
        #expect(content.dateLine == "Aug 10")
        #expect(!content.isToday)
        #expect(!content.isEmpty)
    }

    @Test func todaysChipReplacesTheWeekdayWithTheWordToday() {
        // Today is carried in the *text* rather than a ring or a fill,
        // because a day can be today, empty, and selected at once. Fill
        // means selected and nothing else.
        let content = MyDayChipContent.make(
            dayKey: "2026-08-09", todayKey: "2026-08-09", starCount: 3, includingYear: false)

        #expect(content?.topLine == "Today")
        #expect(content?.isToday == true)
    }

    @Test func everyChipCarriesItsMonthSoItIsUnambiguousInIsolation() throws {
        let june = try #require(MyDayChipContent.make(
            dayKey: "2026-06-28", todayKey: "2026-08-09", starCount: 1, includingYear: false))
        let august = try #require(MyDayChipContent.make(
            dayKey: "2026-08-09", todayKey: "2026-07-01", starCount: 1, includingYear: false))

        #expect(june.dateLine == "Jun 28")
        #expect(august.dateLine == "Aug 9")
    }

    @Test func zeroStarCountReadsAsEmpty() throws {
        let content = try #require(MyDayChipContent.make(
            dayKey: "2026-08-11", todayKey: "2026-08-09", starCount: 0, includingYear: false))

        #expect(content.isEmpty)
        #expect(content.starCount == 0)
    }

    @Test func accessibilityLabelNamesTheDayTheCountAndTodayness() throws {
        let today = try #require(MyDayChipContent.make(
            dayKey: "2026-08-09", todayKey: "2026-08-09", starCount: 3, includingYear: false))
        #expect(today.accessibilityLabel == "Sunday, August 9, today, 3 starred events")

        let other = try #require(MyDayChipContent.make(
            dayKey: "2026-08-10", todayKey: "2026-08-09", starCount: 1, includingYear: false))
        #expect(other.accessibilityLabel == "Monday, August 10, 1 starred event")

        let empty = try #require(MyDayChipContent.make(
            dayKey: "2026-08-11", todayKey: "2026-08-09", starCount: 0, includingYear: false))
        #expect(empty.accessibilityLabel == "Tuesday, August 11, no starred events")
    }

    @Test func accessibilityLabelCarriesTheYearForAnArchivedSeason() throws {
        let content = try #require(MyDayChipContent.make(
            dayKey: "2025-08-23", todayKey: "2026-08-09", starCount: 2, includingYear: true))

        #expect(content.accessibilityLabel == "Saturday, August 23, 2025, 2 starred events")
        // The visible lines stay compact regardless — the year would not fit.
        #expect(content.topLine == "Sat")
        #expect(content.dateLine == "Aug 23")
    }

    @Test func makeIsNilForAnUnparseableDayKey() {
        #expect(MyDayChipContent.make(
            dayKey: "not-a-day", todayKey: "2026-08-09", starCount: 0, includingYear: false) == nil)
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run the verification command.
Expected: compile failure — `cannot find 'MyDayChipContent' in scope`.

- [ ] **Step 3: Write the implementation**

Create `ios/ChqCalendarShared/Domain/MyDayChipContent.swift`:

```swift
import Foundation

/// The text and state one My Day day-chip renders (#192).
///
/// Split out of the SwiftUI view so the labelling rules — which are what the
/// issue was actually about — are unit-testable without a view host.
///
/// **The state encoding.** A day can be empty *and* today *and* selected at
/// once, so the four signals must not compete for the same channel:
///
/// - **Fill** means *selected*, and means nothing else. It is owned by the
///   view, not by this type.
/// - **Today** is carried by the word `"Today"` in `topLine`. Because it
///   lives in the text, it survives being selected, being empty, or both. A
///   ring or accent border would be swallowed by the selected fill in
///   exactly the case where it matters most.
/// - **Empty** is `isEmpty`, which the view renders as a dashed stroke plus
///   secondary content.
/// - **Count** is `starCount`, on its own line.
nonisolated struct MyDayChipContent: Equatable, Sendable {
    /// `"Today"` for today's chip, otherwise the weekday (`"Sun"`).
    let topLine: String
    /// `"MMM d"` — e.g. `"Aug 9"`. The month is on *every* chip so a chip is
    /// unambiguous wherever the strip happens to be scrolled. The old chip
    /// was `"EEE d"` ("Sun 9"), which cannot distinguish June from August
    /// without counting.
    let dateLine: String
    let starCount: Int
    let isToday: Bool
    /// Spoken as one phrase, e.g. `"Sunday, August 9, today, 3 starred events"`.
    let accessibilityLabel: String

    var isEmpty: Bool { starCount == 0 }

    /// `nil` when `dayKey` isn't a parseable `"yyyy-MM-dd"` day key.
    ///
    /// `includingYear` affects only `accessibilityLabel`: the visible lines
    /// stay compact because a year does not fit on a chip, but a screen
    /// reader announcing an archived season's day should say which year.
    static func make(
        dayKey: String,
        todayKey: String,
        starCount: Int,
        includingYear: Bool
    ) -> MyDayChipContent? {
        guard let date = ChqTime.parse("\(dayKey) 00:00:00") else { return nil }

        let isToday = dayKey == todayKey
        let countPhrase = starCount == 0
            ? "no starred events"
            : "\(starCount) starred event\(starCount == 1 ? "" : "s")"
        let spokenParts = [
            ChqTime.dayTitle(for: date, includingYear: includingYear),
            isToday ? "today" : nil,
            countPhrase,
        ].compactMap { $0 }

        return MyDayChipContent(
            topLine: isToday ? "Today" : ChqTime.weekdayLabel(for: date),
            dateLine: ChqTime.monthDayLabel(for: date),
            starCount: starCount,
            isToday: isToday,
            accessibilityLabel: spokenParts.joined(separator: ", "))
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the verification command.
Expected: PASS, 7 new tests.

- [ ] **Step 5: Commit**

```bash
git add ios/ChqCalendarShared/Domain/MyDayChipContent.swift ios/ChqCalendarTests/MyDayChipContentTests.swift
git commit -m "feat(ios): MyDayChipContent (#192)

The chip's labelling rules, extracted from the view so they are testable
without a view host — the month-on-every-chip rule and the accessibility
phrasing are what the issue was actually about.

Today is carried by the word 'Today' replacing the weekday rather than by
a ring, because a day can be today and empty and selected at once and a
ring is swallowed by the selected fill in exactly that case."
```

---

### Task 7: `AppModel` My Day accessors

**Files:**
- Modify: `ios/ChqCalendar/App/AppModel.swift:386-395` (the existing `myDayAvailableDays` / `myDayDefaultDay` block)
- Modify: `ios/ChqCalendarTests/MyDayModelTests.swift`

**Interfaces:**
- Consumes: `DayWindow.bounds` / `.make` / `.defaultSelection` (Tasks 3–5), `DayPlan.starredCountsByDay` (Task 2)
- Produces:
  - `AppModel.myDayBounds: ClosedRange<String>?`
  - `AppModel.myDayWindow(showsEarlier: Bool, showsLater: Bool) -> DayWindow`
  - `AppModel.myDayStarredCounts: [String: Int]`
  - `AppModel.myDayDefaultDay: String?` (rewritten)

**⚠️ This task changes one existing test's expectation.** `MyDayModelTests.myDayDefaultDayFallsBackToNextFutureDayWhenTodayIsUnavailable` currently asserts that with `now = 2026-07-17` and starred days on `07-15`/`07-20`, the default is `"2026-07-20"`. **That test is pinning the bug #192 reports.** Step 3 renames it and flips its expectation to `"2026-07-17"`. This is the only existing test that changes; it was called out in the spec and approved.

- [ ] **Step 1: Write the failing tests**

Append to `MyDayModelTests` in `ios/ChqCalendarTests/MyDayModelTests.swift`, after the `myDayDefaultDay` section:

```swift
    // MARK: - myDayBounds / myDayWindow / myDayStarredCounts

    @Test func myDayBoundsIsNilWithoutASnapshot() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )
        #expect(model.myDayBounds == nil)
    }

    @Test func myDayBoundsSpansThe2026SeasonWidenedByStarredDays() throws {
        let now = try #require(ChqTime.parse("2026-08-09 08:00:00"))
        let model = makeSnapshotModel(
            events: [makeEvent(id: "a", start: try #require(ChqTime.parse("2026-09-05 10:00:00")))],
            now: now,
            favorites: ["a"])

        let bounds = try #require(model.myDayBounds)
        #expect(bounds.lowerBound == "2026-06-27")
        #expect(bounds.upperBound == "2026-09-05")
    }

    @Test func myDayWindowIsEmptyWithoutASnapshot() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )
        let window = model.myDayWindow(showsEarlier: false, showsLater: false)

        #expect(window.days.isEmpty)
        #expect(!window.canExpandEarlier)
        #expect(!window.canExpandLater)
    }

    @Test func myDayWindowHonorsTheInjectedClock() throws {
        let now = try #require(ChqTime.parse("2026-08-09 08:00:00"))
        let model = makeSnapshotModel(
            events: [makeEvent(id: "a", start: try #require(ChqTime.parse("2026-08-09 10:00:00")))],
            now: now,
            favorites: ["a"])

        let window = model.myDayWindow(showsEarlier: false, showsLater: false)

        #expect(window.days.first == "2026-08-02")
        #expect(window.days.last == "2026-08-23")
    }

    @Test func myDayStarredCountsBucketsFavoritesByDay() throws {
        let now = try #require(ChqTime.parse("2026-08-09 08:00:00"))
        let model = makeSnapshotModel(
            events: [
                makeEvent(id: "a", start: try #require(ChqTime.parse("2026-08-09 10:00:00"))),
                makeEvent(id: "b", start: try #require(ChqTime.parse("2026-08-09 20:00:00"))),
                makeEvent(id: "c", start: try #require(ChqTime.parse("2026-08-10 10:00:00"))),
            ],
            now: now,
            favorites: ["a", "b"])

        #expect(model.myDayStarredCounts == ["2026-08-09": 2])
    }

    @Test func myDayStarredCountsIsEmptyWithoutASnapshot() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )
        #expect(model.myDayStarredCounts.isEmpty)
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run the verification command.
Expected: compile failure — `value of type 'AppModel' has no member 'myDayBounds'`.

- [ ] **Step 3: Update the existing test that pins the bug**

In `ios/ChqCalendarTests/MyDayModelTests.swift`, replace the whole
`myDayDefaultDayFallsBackToNextFutureDayWhenTodayIsUnavailable` test
(currently at lines 111–126) with:

```swift
    @Test func myDayDefaultDayPicksTodayEvenWhenTodayHasNothingStarred() throws {
        // Injected "now" falls between the two favorited days, so today has
        // nothing starred on it. It is still what the planner opens to.
        //
        // This test previously asserted "2026-07-20" — the next day that had
        // favorites. That was the defect #192 reported: skipping an empty
        // today relocates a visitor who asked "what am I doing today" and
        // answers a different question. Now that every day in the window is
        // selectable, an empty today shows as empty.
        let between = try #require(ChqTime.parse("2026-07-17 09:00:00"))
        let model = makeSnapshotModel(
            events: [
                makeEvent(id: "a", start: try #require(ChqTime.parse("2026-07-15 10:00:00"))),
                makeEvent(id: "b", start: try #require(ChqTime.parse("2026-07-20 10:00:00"))),
            ],
            now: between,
            favorites: ["a", "b"])

        #expect(model.myDayDefaultDay == "2026-07-17")
    }
```

The other two `myDayDefaultDay` tests are unchanged and must keep passing:
`myDayDefaultDayHonorsInjectedNowWhenTodayIsAvailable` (today is in bounds →
`"2026-07-20"`) and `myDayDefaultDayIsNilWithNoFavoritedDays` (no starred days
→ `nil`).

- [ ] **Step 4: Write the implementation**

In `ios/ChqCalendar/App/AppModel.swift`, replace the existing `myDayDefaultDay`
computed property (lines 391–396, the one delegating to `DayPlan.defaultDayKey`)
and add the three new accessors, so the block after `myDayAvailableDays` reads:

```swift
    /// The outer limit of the My Day strip — see `DayWindow.bounds`.
    ///
    /// `nil` without a snapshot. Season bounds are computable from
    /// `selectedYear` alone, but until the first snapshot lands
    /// `selectedYear` is still the placeholder year, and a placeholder
    /// season has no business reaching the UI. Mirrors the guard
    /// `myDayAvailableDays` already uses.
    var myDayBounds: ClosedRange<String>? {
        guard snapshot != nil else { return nil }
        return DayWindow.bounds(year: selectedYear, starredDays: myDayAvailableDays)
    }

    /// The slice of `myDayBounds` the strip shows for a given expansion
    /// state — see `DayWindow.make`. An empty window without a snapshot.
    func myDayWindow(showsEarlier: Bool, showsLater: Bool) -> DayWindow {
        guard let bounds = myDayBounds else {
            return DayWindow(
                days: [], canExpandEarlier: false, canExpandLater: false,
                hiddenEarlierCount: 0, hiddenLaterCount: 0)
        }
        return DayWindow.make(
            bounds: bounds,
            today: ChqTime.dayKey(for: now()),
            showsEarlier: showsEarlier,
            showsLater: showsLater)
    }

    /// Starred-event counts per day, for the chip labels. One pass over the
    /// event list — see `DayPlan.starredCountsByDay` for why this is not
    /// `dayPlan(for:)` called once per visible chip.
    var myDayStarredCounts: [String: Int] {
        guard let snapshot else { return [:] }
        return DayPlan.starredCountsByDay(favorites: favorites, events: snapshot.events)
    }

    /// Which day `MyDayView` opens to by default — see
    /// `DayWindow.defaultSelection`. `nil` when there are no favorited days
    /// at all (including when there's no snapshot yet), which is the case
    /// where the view shows its all-season empty state instead.
    var myDayDefaultDay: String? {
        guard let bounds = myDayBounds else { return nil }
        return DayWindow.defaultSelection(
            bounds: bounds,
            today: ChqTime.dayKey(for: now()),
            starredDays: myDayAvailableDays)
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run the verification command.
Expected: PASS. 6 new tests; one renamed test with a flipped expectation; `DayPlanTests` untouched.

- [ ] **Step 6: Commit**

```bash
git add ios/ChqCalendar/App/AppModel.swift ios/ChqCalendarTests/MyDayModelTests.swift
git commit -m "feat(ios): AppModel My Day window accessors (#192)

Adds myDayBounds, myDayWindow(showsEarlier:showsLater:) and
myDayStarredCounts, and rebuilds myDayDefaultDay on
DayWindow.defaultSelection so the planner opens on today even when today
has nothing starred.

Flips one existing expectation:
myDayDefaultDayFallsBackToNextFutureDayWhenTodayIsUnavailable was pinning
the reported bug — with today between two starred days it asserted the
planner jumps forward. Renamed to
myDayDefaultDayPicksTodayEvenWhenTodayHasNothingStarred. The other two
myDayDefaultDay tests are unchanged."
```

---

### Task 8: `DateScope.day` end to end

**Files:**
- Modify: `ios/ChqCalendarShared/Data/UserStateStore.swift:5-21` (`DateScope`), `:29-60` (`FilterSelection`), `:238-251` (`saveFilters`)
- Modify: `ios/ChqCalendarShared/Domain/EventFilter.swift:34` (the scope line) and the scope `switch`
- Modify: `ios/ChqCalendarShared/Domain/DateFilterLabel.swift` (the no-weeks branch)
- Modify: `ios/ChqCalendarShared/Domain/FilterChipState.swift:39-73` (both `switch`es)
- Modify: `ios/ChqCalendarTests/UserStateStoreTests.swift`, `EventFilterTests.swift`, `DateFilterLabelTests.swift`, `FilterChipStateTests.swift`

**Interfaces:**
- Consumes: `ChqTime.pillDayLabel(for:includingYear:)` (Task 1)
- Produces: `DateScope.day` (raw value `"day"`), `FilterSelection.selectedDayKey: String?` (session-only), `UserStateStore.saveFilters` substituting `.next` for a live `.day` scope. No other new API — the rest is three behavioral exemptions.

**Why this is one task and not three.** Swift `switch`es over a same-module
enum are exhaustive, so the moment `.day` is added to `DateScope` it breaks
compilation in `EventFilter.apply`, `DateFilterLabel.text`, and
**both** `switch`es in `FilterChipState.isScopeSelected` at once. Splitting
them would mean committing a red build. They land together.

**The through-line.** `.day` names an **absolute** date, unlike every other
scope, which describes a window relative to "now". `EventFilter` therefore
exempts it from the `isCurrentYear ? scope : .all` downgrade — and **every
other place that reasons about that downgrade has to make the same
exemption, or it will describe a filter that isn't the one being applied.**
There are exactly three such places. They must agree, and a test pins each.

- [ ] **Step 1: Write the failing tests**

Append to `UserStateStoreTests` in `ios/ChqCalendarTests/UserStateStoreTests.swift`:

```swift
    // MARK: - .day scope is session-only

    @Test func dayScopeIsPersistedAsNextAndTheDayKeyIsNeverWritten() {
        // A date pinned three days ago and silently restored on launch would
        // be worse than not restoring at all — same reasoning as
        // searchText/extraDays. `.day` names an absolute date, so it cannot
        // survive a relaunch the way a relative scope can.
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = UserStateStore(defaults: defaults, now: { Date() })

        store.saveFilters(FilterSelection(
            dateScope: .day,
            selectedDayKey: "2026-08-09",
            selectedLocations: ["Amphitheater"]))
        let loaded = store.loadFilters()

        #expect(loaded?.dateScope == .next)
        #expect(loaded?.selectedDayKey == nil)
        // The rest of the selection still round-trips normally.
        #expect(loaded?.selectedLocations == ["Amphitheater"])
    }

    @Test func nonDayScopesStillRoundTripUnchanged() {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = UserStateStore(defaults: defaults, now: { Date() })

        store.saveFilters(FilterSelection(dateScope: .season))

        #expect(store.loadFilters()?.dateScope == .season)
    }

    @Test func dayScopeIsNotDefaultAndCountsAsADateFilter() {
        let selection = FilterSelection(dateScope: .day, selectedDayKey: "2026-08-09")

        #expect(!selection.isDefault)
        #expect(selection.hasDateFilters)
        #expect(!selection.hasNonDateFilters)
    }
```

Append to `EventFilterTests` in `ios/ChqCalendarTests/EventFilterTests.swift`:

```swift
    // MARK: - .day scope

    @Test func dayScopeMatchesOnlyThatNYCalendarDay() throws {
        let onDay = try #require(ChqTime.parse("2026-08-09 10:00:00"))
        let lateOnDay = try #require(ChqTime.parse("2026-08-09 23:30:00"))
        let nextDay = try #require(ChqTime.parse("2026-08-10 00:30:00"))
        let events = [
            makeEvent(id: "a", start: onDay),
            makeEvent(id: "b", start: lateOnDay),
            makeEvent(id: "c", start: nextDay),
        ]
        let now = try #require(ChqTime.parse("2026-08-01 09:00:00"))

        let result = EventFilter.apply(
            FilterSelection(dateScope: .day, selectedDayKey: "2026-08-09"),
            to: events, favorites: [], now: now, year: 2026, isCurrentYear: true)

        #expect(result.map(\.id) == ["a", "b"])
    }

    @Test func dayScopeSurvivesANonCurrentYear() throws {
        // The exemption that matters. Every *time-relative* scope is
        // downgraded to .all for a past season because it has no "now" —
        // but .day names an absolute date and is meaningful in any season.
        // Downgrading it would silently un-filter the list in exactly the
        // case the browse-this-day button is most useful for.
        let onDay = try #require(ChqTime.parse("2025-08-23 10:00:00"))
        let otherDay = try #require(ChqTime.parse("2025-08-24 10:00:00"))
        let now = try #require(ChqTime.parse("2026-08-09 09:00:00"))

        let result = EventFilter.apply(
            FilterSelection(dateScope: .day, selectedDayKey: "2025-08-23"),
            to: [makeEvent(id: "a", start: onDay), makeEvent(id: "b", start: otherDay)],
            favorites: [], now: now, year: 2025, isCurrentYear: false)

        #expect(result.map(\.id) == ["a"])
    }

    @Test func timeRelativeScopesAreStillDowngradedForANonCurrentYear() throws {
        // Guards the exemption against over-reach: only .day is exempt.
        let old = try #require(ChqTime.parse("2025-08-23 10:00:00"))
        let now = try #require(ChqTime.parse("2026-08-09 09:00:00"))

        let result = EventFilter.apply(
            FilterSelection(dateScope: .today),
            to: [makeEvent(id: "a", start: old)],
            favorites: [], now: now, year: 2025, isCurrentYear: false)

        #expect(result.map(\.id) == ["a"])
    }

    @Test func dayScopeWithNoDayKeyFiltersNothing() throws {
        let first = try #require(ChqTime.parse("2026-08-09 10:00:00"))
        let second = try #require(ChqTime.parse("2026-08-10 10:00:00"))
        let now = try #require(ChqTime.parse("2026-08-01 09:00:00"))

        let result = EventFilter.apply(
            FilterSelection(dateScope: .day, selectedDayKey: nil),
            to: [makeEvent(id: "a", start: first), makeEvent(id: "b", start: second)],
            favorites: [], now: now, year: 2026, isCurrentYear: true)

        #expect(result.map(\.id) == ["a", "b"])
    }
```

Append to `DateFilterLabelTests` in `ios/ChqCalendarTests/DateFilterLabelTests.swift`:

```swift
    @Test func dayScopeRendersTheDateNotTheWord() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .day, selectedDayKey: "2026-08-09"),
            seasonWeekCount: nine, isCurrentYear: true) == "Sun, Aug 9")
    }

    @Test func dayScopeCarriesTheYearForANonCurrentSeason() {
        // The pill must not say "All Year" here. `.day` survives
        // EventFilter's non-current-year downgrade, so the list really is
        // filtered to one day and a pill claiming otherwise would be lying.
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .day, selectedDayKey: "2025-08-23"),
            seasonWeekCount: nine, isCurrentYear: false) == "Sat, Aug 23, 2025")
    }

    @Test func dayScopeWithoutADayKeyReadsAllYear() {
        // Nothing is actually being filtered, so "All Year" is true.
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .day, selectedDayKey: nil),
            seasonWeekCount: nine, isCurrentYear: true) == "All Year")
    }

    @Test func weekSelectionStillWinsOverADayScope() {
        // The weeks branch runs first and is unchanged.
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .day, selectedDayKey: "2026-08-09", selectedWeeks: [6]),
            seasonWeekCount: nine, isCurrentYear: true) == "Week 6")
    }
```

Append to `FilterChipStateTests` in `ios/ChqCalendarTests/FilterChipStateTests.swift`:

```swift
    // MARK: - .day scope

    @Test func dayScopeUnselectsTheAllChipOnAPastSeason() {
        // The subtle one. On a past season every *relative* scope is ignored
        // by the pipeline, which is why "All" lights up whenever no weeks
        // are selected. `.day` is exempt from that downgrade, so dates
        // really are being filtered — and "All" must not claim otherwise.
        #expect(!FilterChipState.isScopeSelected(
            .all,
            selection: FilterSelection(dateScope: .day, selectedDayKey: "2025-08-23"),
            currentWeek: nil,
            isCurrentYear: false))
    }

    @Test func allChipStaysSelectedOnAPastSeasonWithoutADayOrWeekFilter() {
        // Guards the fix above against over-reach: a persisted relative
        // scope still leaves "All" selected, since the pipeline ignores it.
        #expect(FilterChipState.isScopeSelected(
            .all,
            selection: FilterSelection(dateScope: .next),
            currentWeek: nil,
            isCurrentYear: false))
    }

    @Test func dayScopeUnselectsTheAllChipOnTheCurrentSeason() {
        #expect(!FilterChipState.isScopeSelected(
            .all,
            selection: FilterSelection(dateScope: .day, selectedDayKey: "2026-08-09"),
            currentWeek: 7,
            isCurrentYear: true))
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run the verification command.
Expected: compile failure — `type 'DateScope' has no member 'day'`.

- [ ] **Step 3: Add the `DateScope` case**

In `ios/ChqCalendarShared/Data/UserStateStore.swift`, add the case and its label:

```swift
nonisolated enum DateScope: String, Codable, CaseIterable, Sendable {
    case next
    case today
    case thisWeek = "this-week"
    case season
    case all
    /// A single named calendar day, held in `FilterSelection.selectedDayKey`.
    ///
    /// **Derived, not pickable.** It is never offered in
    /// `DateFilterSheet.visibleScopes` — an arbitrary date cannot be chosen
    /// from a fixed row of presets — and arrives only from My Day's
    /// empty-day "Browse …" action (#192).
    ///
    /// Unlike every other case here it names an **absolute** date, not a
    /// window relative to "now". That is why both `EventFilter.apply` and
    /// `DateFilterLabel.text` exempt it from their non-current-year
    /// downgrade to `.all`: a named day is just as meaningful in an archived
    /// season as in the live one.
    case day

    var label: String {
        switch self {
        case .next: return "Now"
        case .today: return "Today"
        case .thisWeek: return "This Week"
        case .season: return "All Season"
        case .all: return "All Year"
        // Never user-facing: `DateFilterLabel` renders the date itself.
        case .day: return "Day"
        }
    }
}
```

`.day` joins `CaseIterable`. There is exactly one `DateScope.allCases` call
site — `DateFilterLabelTests.offYearAlwaysReadsAllYear` — handled in Step 9.
No production code iterates `DateScope.allCases`;
`DateFilterSheet.visibleScopes` is a hardcoded list and is deliberately
unchanged, which is what keeps `.day` derived-not-pickable.

- [ ] **Step 4: Add `selectedDayKey` to `FilterSelection`**

Add the stored property, extend the memberwise `init`, and update the type's
doc comment. The property goes after `selectedWeeks`:

```swift
    /// The single day a `.day` scope names, as a `ChqTime.dayKey`
    /// (`"yyyy-MM-dd"`). Meaningful only while `dateScope == .day`.
    ///
    /// **Session-only**, like `searchText` and `extraDays`: never persisted
    /// by `UserStateStore`. Restoring a date pinned days ago would be worse
    /// than not restoring at all (#192).
    var selectedDayKey: String?
```

and in `init`, add the parameter in the same position with a `nil` default:

```swift
    init(
        searchText: String = "",
        dateScope: DateScope = .next,
        selectedWeeks: Set<Int> = [],
        selectedDayKey: String? = nil,
        selectedLocations: [String] = [],
        selectedCategories: [String] = [],
        showFavoritesOnly: Bool = false,
        extraDays: Int = 0
    ) {
        self.searchText = searchText
        self.dateScope = dateScope
        self.selectedWeeks = selectedWeeks
        self.selectedDayKey = selectedDayKey
        self.selectedLocations = selectedLocations
        self.selectedCategories = selectedCategories
        self.showFavoritesOnly = showFavoritesOnly
        self.extraDays = extraDays
    }
```

Also update the struct's existing doc comment, which currently says
"`searchText` and `extraDays` are session-only", to name `selectedDayKey`
alongside them.

`isDefault` and `hasDateFilters` need **no change**: `.day != .next` already
makes `isDefault` false, and `.day != .all` already makes `hasDateFilters`
true.

- [ ] **Step 5: Substitute `.next` for `.day` in `saveFilters`**

In `UserStateStore.saveFilters`, change the `dateScope` argument and extend the
doc comment:

```swift
    /// Persists `f`'s facets, stamped with the current time. `searchText`,
    /// `extraDays`, and `selectedDayKey` are deliberately dropped — they're
    /// session-only — and a live `.day` scope is persisted as `.next`, since
    /// without its day key it would mean nothing on the way back in.
    func saveFilters(_ f: FilterSelection) {
        let persisted = PersistedFilters(
            dateScope: f.dateScope == .day ? .next : f.dateScope,
            selectedWeeks: f.selectedWeeks,
            selectedLocations: f.selectedLocations,
            selectedCategories: f.selectedCategories,
            showFavoritesOnly: f.showFavoritesOnly,
            lastSaved: now()
        )
        guard let data = try? Self.encoder.encode(persisted) else { return }
        defaults.set(data, forKey: Self.filtersKey)
    }
```

Also update `loadFilters`' doc comment, which lists which fields come back at
their defaults, to include `selectedDayKey`.

- [ ] **Step 6: Exempt `.day` in `EventFilter` and add its case**

In `ios/ChqCalendarShared/Domain/EventFilter.swift`, change the scope line
(currently line 34):

```swift
        // `.day` is exempt from the non-current-year downgrade: it names an
        // absolute NY calendar day, not a window relative to "now", so it is
        // just as meaningful in an archived season as in the live one.
        // Downgrading it would silently un-filter the list in exactly the
        // case My Day's browse-this-day action is most useful for (#192).
        let scope: DateScope = (isCurrentYear || sel.dateScope == .day) ? sel.dateScope : .all
```

and add the case to the `switch`, after `case .today`:

```swift
        case .day:
            // A `nil` key means no day was ever set — filter nothing rather
            // than filtering everything out.
            if let dayKey = sel.selectedDayKey {
                result = result.filter { ChqTime.dayKey(for: $0.start) == dayKey }
            }
```

Also update `apply`'s doc comment, which currently says
`isCurrentYear == false` forces "any time-relative `dateScope`
(`.next`/`.today`/`.thisWeek`)" to behave as `.all` — add that `.day` is
excluded because it is not time-relative.

- [ ] **Step 7: Exempt `.day` in `DateFilterLabel`**

In `ios/ChqCalendarShared/Domain/DateFilterLabel.swift`, replace the no-weeks
branch:

```swift
        guard !weeks.isEmpty else {
            // `.day` is handled *before* the `isCurrentYear` shortcut below.
            // That shortcut is correct only because every other scope is
            // downgraded to `.all` for a non-current year, which makes
            // "All Year" a true statement about what the list is showing.
            // `.day` survives that downgrade (see `EventFilter.apply`), so
            // taking the shortcut would leave the pill claiming "All Year"
            // over a day-filtered list — the pill lying about the filter,
            // which is exactly the failure this type's doc comment warns
            // about for `.next` (#192).
            if selection.dateScope == .day,
               let dayKey = selection.selectedDayKey,
               let date = ChqTime.parse("\(dayKey) 00:00:00") {
                return ChqTime.pillDayLabel(for: date, includingYear: !isCurrentYear)
            }

            guard isCurrentYear else { return "All Year" }
            switch selection.dateScope {
            case .all: return DateScope.all.label            // "All Year"
            case .next, .today, .thisWeek, .season: return selection.dateScope.label
            // Only reachable when `selectedDayKey` is nil or unparseable, in
            // which case `EventFilter` filters nothing — so "All Year" is
            // true, not a lie.
            case .day: return DateScope.all.label
            }
        }
```

- [ ] **Step 8: Exempt `.day` in `FilterChipState` — including a real bug**

`FilterChipState.isScopeSelected` has **two** exhaustive `switch`es over
`DateScope`, and the non-current-year one contains more than a compile break.
It currently answers the "All" chip with:

```swift
            case .all:
                return selection.selectedWeeks.isEmpty
```

That is sound only while weeks are the single date filter that survives a
past season. `.day` now survives too, so with a day filter active on an
archived season this would light the "All" chip over a list filtered down to
one day. Replace the whole `guard isCurrentYear else` block's `switch` with:

```swift
            switch scope {
            case .all:
                // The weeks stage of `EventFilter` runs regardless of
                // `isCurrentYear`, and `.day` is exempt from the downgrade
                // outright (it names an absolute date rather than a window
                // around "now") — so those are the two date filters still in
                // force on a past season, and either one un-selects "All"
                // exactly as it does on the current year. With neither,
                // nothing is filtering dates, which is precisely what "All"
                // means.
                return selection.selectedWeeks.isEmpty && selection.dateScope != .day
            case .day:
                // Never rendered as a chip — `.day` is derived, not
                // pickable — but answered honestly rather than left to the
                // caller, per this type's existing convention. Unlike the
                // relative scopes below, the pipeline does *not* ignore this
                // one on a past season.
                return selection.dateScope == .day
            case .next, .today, .season, .thisWeek:
                // Unreachable through `DateFilterSheet`, whose
                // `visibleScopes` collapses to `[.all]` off the current
                // year — but answered rather than trusted to the caller.
                // The pipeline is ignoring these scopes, so no chip
                // claiming one may light up.
                return false
            }
```

and add the matching case to the current-year `switch` at the end of the
function, between `.all` and the `.next, .today, .season` group:

```swift
        case .day:
            // Never rendered as a chip; answered rather than trusted. The
            // `.all` case above already excludes it, since `.day` is not
            // `.all`.
            return selection.dateScope == .day
```

Also update the `isCurrentYear` parameter's doc comment, which currently
states flatly that a `false` value makes the stored `dateScope`
"**meaningless** — the pipeline forces it to `.all`". Add that `.day` is the
one exception.

- [ ] **Step 9: Narrow the `DateScope.allCases` loop test**

`DateFilterLabelTests.offYearAlwaysReadsAllYear` iterates every scope and
asserts each reads "All Year" off-year. It still *passes* with `.day` added,
because the loop builds selections with no `selectedDayKey` — but it would
now read as proof of something false. Narrow it and say so:

```swift
    @Test func offYearAlwaysReadsAllYearForEveryRelativeScope() {
        // Off the current year the pipeline ignores every *relative* scope,
        // so the pill must say so regardless of what is persisted.
        //
        // `.day` is excluded deliberately: it names an absolute date and is
        // exempt from that downgrade, so off-year it renders the date rather
        // than "All Year" — see `dayScopeCarriesTheYearForANonCurrentSeason`.
        // Left in the loop it would pass only by accident, because these
        // selections carry no `selectedDayKey`.
        for scope in DateScope.allCases where scope != .day {
            #expect(DateFilterLabel.text(
                for: FilterSelection(dateScope: scope),
                seasonWeekCount: nine, isCurrentYear: false) == "All Year")
        }
    }
```

- [ ] **Step 10: Run the tests to verify they pass**

Run the verification command.
Expected: PASS, 14 new tests, one existing loop test narrowed and renamed.

- [ ] **Step 11: Commit**

```bash
git add ios/ChqCalendarShared/Data/UserStateStore.swift \
        ios/ChqCalendarShared/Domain/EventFilter.swift \
        ios/ChqCalendarShared/Domain/DateFilterLabel.swift \
        ios/ChqCalendarShared/Domain/FilterChipState.swift \
        ios/ChqCalendarTests/UserStateStoreTests.swift \
        ios/ChqCalendarTests/EventFilterTests.swift \
        ios/ChqCalendarTests/DateFilterLabelTests.swift \
        ios/ChqCalendarTests/FilterChipStateTests.swift
git commit -m "feat(ios): DateScope.day, a single-day filter for the Events tab (#192)

Lets My Day's empty-day state offer 'Browse Aug 9 events' instead of
being a dead end.

Scope and day key are both session-only: saveFilters substitutes .next
for a live .day scope, because a date pinned three days ago and silently
restored on launch would be worse than not restoring at all. Same
precedent as searchText and extraDays. .day is derived, not pickable —
it never appears in visibleScopes.

.day names an ABSOLUTE date, unlike every other scope, so it is exempt
from the isCurrentYear-to-.all downgrade. Three places reason about that
downgrade and all three needed the exemption:

- EventFilter.apply, or a past-season day filter silently does nothing.
- DateFilterLabel, or the pill claims 'All Year' over a filtered list.
- FilterChipState.isScopeSelected, which was a live bug and not just a
  compile break: its past-season branch answered the All chip with
  selectedWeeks.isEmpty, which would have lit All over a day-filtered
  archived season.

Landed as one commit because Swift switch exhaustiveness breaks all
three the moment the enum case is added."
```

---

### Task 9: `AppModel.browseDay`

**Files:**
- Modify: `ios/ChqCalendar/App/AppModel.swift` (near `selectScope` / `setWeekSelection`, around line 929)
- Modify: `ios/ChqCalendarTests/MyDayModelTests.swift`

**Interfaces:**
- Consumes: `DateScope.day`, `FilterSelection.selectedDayKey` (Task 8)
- Produces: `AppModel.browseDay(_ dayKey: String)`

- [ ] **Step 1: Write the failing tests**

Append to `MyDayModelTests`:

```swift
    // MARK: - browseDay

    @Test func browseDayPinsTheScopeAndClearsConflictingDateState() throws {
        let now = try #require(ChqTime.parse("2026-08-09 08:00:00"))
        let model = makeSnapshotModel(events: [], now: now)
        model.filter.selectedWeeks = [3]
        model.filter.extraDays = 2

        model.browseDay("2026-08-09")

        #expect(model.filter.dateScope == .day)
        #expect(model.filter.selectedDayKey == "2026-08-09")
        // A standing week filter can exclude the very day the user asked
        // for, and extraDays is a `.next`-only concept.
        #expect(model.filter.selectedWeeks.isEmpty)
        #expect(model.filter.extraDays == 0)
    }

    @Test func browseDayLeavesStandingNonDatePreferencesAlone() throws {
        let now = try #require(ChqTime.parse("2026-08-09 08:00:00"))
        let model = makeSnapshotModel(events: [], now: now)
        model.filter.searchText = "yoga"
        model.filter.selectedLocations = ["Amphitheater"]
        model.filter.selectedCategories = ["Music"]
        model.filter.showFavoritesOnly = true

        model.browseDay("2026-08-09")

        #expect(model.filter.searchText == "yoga")
        #expect(model.filter.selectedLocations == ["Amphitheater"])
        #expect(model.filter.selectedCategories == ["Music"])
        #expect(model.filter.showFavoritesOnly)
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run the verification command.
Expected: compile failure — `value of type 'AppModel' has no member 'browseDay'`.

- [ ] **Step 3: Write the implementation**

In `ios/ChqCalendar/App/AppModel.swift`, immediately after `setWeekSelection`:

```swift
    /// Pins the event list to one named calendar day — the action behind My
    /// Day's empty-day "Browse …" button (#192).
    ///
    /// Clears `selectedWeeks`, since a standing week filter can exclude the
    /// very day the user asked for, and `extraDays`, which is a `.next`-only
    /// concept. Deliberately leaves `searchText`, venues, categories, and
    /// favorites-only alone: those are the user's standing preferences, not
    /// date state.
    func browseDay(_ dayKey: String) {
        filter.dateScope = .day
        filter.selectedDayKey = dayKey
        filter.selectedWeeks = []
        filter.extraDays = 0
        persistFilter()
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the verification command.
Expected: PASS, 2 new tests.

- [ ] **Step 5: Commit**

```bash
git add ios/ChqCalendar/App/AppModel.swift ios/ChqCalendarTests/MyDayModelTests.swift
git commit -m "feat(ios): AppModel.browseDay (#192)

Pins the event list to one calendar day. Clears selectedWeeks — a
standing week filter can exclude the very day the user asked for — and
extraDays, which only means anything under .next. Leaves search, venues,
categories, and favorites-only intact: standing preferences, not date
state."
```

---

### Task 10: `MyDayView` — chip view, strip, scrolling, expand controls

**Files:**
- Modify: `ios/ChqCalendar/Features/MyDay/MyDayView.swift`

**Interfaces:**
- Consumes: `MyDayChipContent.make` (Task 6), `AppModel.myDayWindow` / `.myDayStarredCounts` / `.myDayBounds` / `.myDayDefaultDay` (Task 7), `AppModel.now` (existing, internal `let`)
- Produces: no new domain API. The view file gains `private struct MyDayChip` (rewritten) and `private struct MyDayExpandControl`.

This task replaces the strip only. The summary header, timeline, and empty
state stay as they are until Task 12, so the app builds and runs at the end of
this task.

- [ ] **Step 1: Replace the `MyDayChip` view**

At the bottom of `ios/ChqCalendar/Features/MyDay/MyDayView.swift`, replace the
whole existing `private struct MyDayChip` with:

```swift
/// One selectable day chip in `MyDayView`'s strip (#192).
///
/// All labelling lives in `MyDayChipContent` so it can be tested without a
/// view host; this type owns only the visual encoding of the four states,
/// which must compose because a day can be empty *and* today *and* selected
/// at once:
///
/// - **Fill** = selected, and nothing else uses fill.
/// - **Today** = the word `"Today"` in `content.topLine` — carried in text
///   precisely so a selected fill cannot swallow it.
/// - **Empty** = dashed stroke plus secondary content, kept (in white) even
///   while selected.
/// - **Count** = the third line, which always occupies its space so chip
///   heights never jitter as events are starred and unstarred.
private struct MyDayChip: View {
    let content: MyDayChipContent
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Text(content.topLine)
                    .font(.caption.weight(content.isToday ? .bold : .regular))
                Text(content.dateLine)
                    .font(.subheadline.weight(isSelected ? .semibold : .regular))
                countLine
            }
            .frame(minWidth: 58)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(
                isSelected ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.thinMaterial),
                in: RoundedRectangle(cornerRadius: 12)
            )
            .overlay {
                if content.isEmpty {
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(
                            isSelected ? Color.white.opacity(0.7) : Color.secondary.opacity(0.5),
                            style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                }
            }
            .foregroundStyle(foreground)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(content.accessibilityLabel)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    /// Always rendered, blank when the count is zero, so every chip is the
    /// same height whether or not anything is starred on it.
    @ViewBuilder
    private var countLine: some View {
        if content.starCount > 0 {
            Label("\(content.starCount)", systemImage: "star.fill")
                .font(.caption2)
                .labelStyle(.titleAndIcon)
        } else {
            Text(" ").font(.caption2)
        }
    }

    private var foreground: AnyShapeStyle {
        if isSelected { return AnyShapeStyle(.white) }
        return content.isEmpty ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary)
    }
}
```

- [ ] **Step 2: Add the expand control view**

Append to the same file, after `MyDayChip`:

```swift
/// The chevron chip at each end of `MyDayView`'s strip, revealing the rest of
/// the season in that direction (#192).
///
/// The visible chip stays narrow — the count lives in the accessibility
/// label, not on screen.
private struct MyDayExpandControl: View {
    enum Direction { case earlier, later }

    let direction: Direction
    let isExpanded: Bool
    let hiddenCount: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.subheadline.weight(.semibold))
                .frame(width: 34, height: 62)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }

    private var symbol: String {
        switch (direction, isExpanded) {
        case (.earlier, false): return "chevron.left"
        case (.earlier, true): return "chevron.right"
        case (.later, false): return "chevron.right"
        case (.later, true): return "chevron.left"
        }
    }

    private var accessibilityLabel: String {
        switch (direction, isExpanded) {
        case (.earlier, false): return "Show \(hiddenCount) earlier days"
        case (.earlier, true): return "Hide earlier days"
        case (.later, false): return "Show \(hiddenCount) later days"
        case (.later, true): return "Hide later days"
        }
    }
}
```

- [ ] **Step 3: Add the expansion state and rewrite the strip**

In `MyDayView`, add two `@State` properties after `selectedDay`:

```swift
    /// Whether each end of the strip is expanded to the season edge.
    /// Session-scoped deliberately: these survive tab switches for the life
    /// of the process but reset on launch, so the app always reopens on the
    /// tight window (#192).
    @State private var showsEarlier = false
    @State private var showsLater = false
```

Replace `dayChipsRow(availableDays:selectedDay:)` entirely with:

```swift
    private var todayKey: String { ChqTime.dayKey(for: model.now()) }

    private func dayChipsRow(window: DayWindow, selectedDay: String) -> some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if window.canExpandEarlier {
                        MyDayExpandControl(
                            direction: .earlier,
                            isExpanded: showsEarlier,
                            hiddenCount: window.hiddenEarlierCount
                        ) {
                            showsEarlier.toggle()
                        }
                    }

                    ForEach(window.days, id: \.self) { day in
                        if let content = MyDayChipContent.make(
                            dayKey: day,
                            todayKey: todayKey,
                            starCount: model.myDayStarredCounts[day] ?? 0,
                            includingYear: !model.isCurrentYear
                        ) {
                            MyDayChip(content: content, isSelected: day == selectedDay) {
                                self.selectedDay = day
                            }
                            .id(day)
                        }
                    }

                    if window.canExpandLater {
                        MyDayExpandControl(
                            direction: .later,
                            isExpanded: showsLater,
                            hiddenCount: window.hiddenLaterCount
                        ) {
                            showsLater.toggle()
                        }
                    }
                }
                .padding(.horizontal)
            }
            .onAppear { scroll(proxy, to: selectedDay) }
            .onChange(of: selectedDay) { _, day in scroll(proxy, to: day) }
            // Expanding an end prepends or appends chips, which shifts the
            // content under the user. Re-anchoring on the same day holds the
            // selection still, so revealing the past never moves you.
            .onChange(of: showsEarlier) { _, _ in scroll(proxy, to: selectedDay) }
            .onChange(of: showsLater) { _, _ in scroll(proxy, to: selectedDay) }
        }
    }

    private func scroll(_ proxy: ScrollViewProxy, to day: String) {
        withAnimation(.easeInOut(duration: 0.2)) {
            proxy.scrollTo(day, anchor: .center)
        }
    }
```

- [ ] **Step 4: Point `planContent` at the new strip**

In `planContent(for:availableDays:)`, change the signature and the
`dayChipsRow` call so the view computes the window once:

```swift
    private func planContent(for day: String) -> some View {
        let plan = model.dayPlan(for: day)
        let window = model.myDayWindow(showsEarlier: showsEarlier, showsLater: showsLater)
        return VStack(alignment: .leading, spacing: 12) {
            if siriTipVisible {
                SiriTipView(intent: MyScheduleIntent(), isVisible: $siriTipVisible)
                    .padding(.horizontal)
            }
            dayChipsRow(window: window, selectedDay: day)
            summaryHeader(for: plan)
            Divider()
                .padding(.horizontal)
            timeline(for: plan)
        }
        .padding(.top, 8)
    }
```

and update `content` so the selected day no longer has to be in
`availableDays` — the strip is calendar-driven now, so any day in bounds is
valid:

```swift
    @ViewBuilder
    private var content: some View {
        if model.myDayAvailableDays.isEmpty {
            emptyState
        } else if let selectedDay, let bounds = model.myDayBounds, bounds.contains(selectedDay) {
            planContent(for: selectedDay)
        } else {
            // One frame, between the bounds changing and `reconcileSelection`
            // running for them.
            Color.clear
        }
    }
```

Delete the now-unused `compactDayLabel(for:)` and `fullDayTitle(for:)` helpers
from `MyDayView` — `MyDayChipContent` owns both jobs.

- [ ] **Step 5: Delete the dead reconciliation machinery**

This belongs in *this* commit, not a later one. `content` above now admits any
day inside the bounds, including days with nothing starred — but
`reconcileSelection` still throws the selection away whenever the selected day
is missing from `availableDays`. Left as-is, selecting an empty day and then
starring anything at all would change `availableDays`, fire the old
`onChange`, and jump the user somewhere else.

The deeper reason the machinery can go: the strip is driven by the calendar
now, so a day can no longer vanish because its last starred event was
unstarred. That vanishing case is the only thing `nearestDay` ever existed
for.

Delete `nearestDay(to:in:)` entirely, delete the
`.onChange(of: model.myDayAvailableDays)` modifier from `body`, and replace
`reconcileSelection(in:)` with:

```swift
    /// Keeps `selectedDay` inside the current bounds.
    ///
    /// Since #192 the strip is driven by the calendar rather than by the
    /// favorites set, so a day can no longer vanish because its last starred
    /// event was unstarred — the only things that move the bounds are a new
    /// snapshot and a year switch. The previous `nearestDay` fallback existed
    /// solely for the vanishing case and is gone with it.
    private func reconcileSelection(in bounds: ClosedRange<String>?) {
        guard let bounds else { return }
        if let selectedDay, bounds.contains(selectedDay) { return }
        selectedDay = model.myDayDefaultDay
    }
```

and change the two modifiers on `body` to:

```swift
        .task { reconcileSelection(in: model.myDayBounds) }
        .onChange(of: model.myDayBounds) { _, newBounds in
            reconcileSelection(in: newBounds)
        }
```

- [ ] **Step 6: Build and run the suite**

Run the verification command.
Expected: PASS. No new tests in this task — the logic it uses is already
pinned by Tasks 4, 6, and 7; this step confirms the view compiles and nothing
regressed.

- [ ] **Step 7: Commit**

```bash
git add ios/ChqCalendar/Features/MyDay/MyDayView.swift
git commit -m "feat(ios): calendar-driven My Day strip (#192)

Replaces the favorites-driven chip row with a windowed calendar strip
that actually scrolls to the selection — the bare ScrollView never did,
so it always rendered parked at the earliest starred day of the season
while the correct day sat fifty chips off-screen.

Chips now carry their month, so a chip is unambiguous wherever the strip
is scrolled, plus a star count and a distinct empty treatment. Chevron
controls at each end reveal the rest of the season, and re-anchor on the
selected day afterwards so expanding never moves you.

Deletes nearestDay and the onChange-on-availableDays hook in the same
commit rather than a later one: with empty days now selectable, keeping
the old reconciliation would jump the user away the moment they starred
anything while sitting on an empty day. Both existed only to handle a day
vanishing from the strip, which a calendar-driven strip cannot do."
```

---

### Task 11: `MyDayView` — day header, Today button, empty day

**Files:**
- Modify: `ios/ChqCalendar/Features/MyDay/MyDayView.swift`

**Interfaces:**
- Consumes: `ChqTime.dayTitle(for:includingYear:)`, `ChqTime.day(_:offsetBy:)` and `ChqTime.monthDayLabel(for:)` (Task 1), `AppModel.browseDay` (Task 9), `todayKey` (Task 10)
- Produces: no new API

- [ ] **Step 1: Add the selected-day header**

In `MyDayView`, add above `summaryHeader`:

```swift
    /// Names the day being shown. The screen previously stated this
    /// *nowhere* — the only indicator was the highlighted chip, which was
    /// reliably off-screen (#192).
    private func selectedDayHeader(for day: String) -> some View {
        HStack(spacing: 8) {
            Text(dayTitle(for: day))
                .font(.headline)
            if let badge = relativeBadge(for: day) {
                Text(badge)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.accentColor, in: Capsule())
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal)
    }

    private func dayTitle(for dayKey: String) -> String {
        guard let date = ChqTime.parse("\(dayKey) 00:00:00") else { return dayKey }
        return ChqTime.dayTitle(for: date, includingYear: !model.isCurrentYear)
    }

    private func relativeBadge(for dayKey: String) -> String? {
        let today = todayKey
        if dayKey == today { return "Today" }
        if dayKey == ChqTime.day(today, offsetBy: 1) { return "Tomorrow" }
        if dayKey == ChqTime.day(today, offsetBy: -1) { return "Yesterday" }
        return nil
    }
```

- [ ] **Step 2: Add the empty-day state and wire both into `planContent`**

Add below `emptyState`:

```swift
    /// A day inside the window with nothing starred on it. Offers a way to
    /// fill the gap rather than being a dead end — which is the whole reason
    /// empty days are shown at all (#192).
    private func emptyDayState(for day: String) -> some View {
        let label = ChqTime.parse("\(day) 00:00:00").map(ChqTime.monthDayLabel(for:)) ?? day
        return ContentUnavailableView {
            Label("Nothing starred yet", systemImage: "star")
        } description: {
            Text("You haven't starred anything for this day.")
        } actions: {
            Button("Browse \(label) events") {
                model.browseDay(day)
                switchToEvents()
            }
        }
    }
```

and update `planContent` to show the header and to branch on an empty plan:

```swift
    private func planContent(for day: String) -> some View {
        let plan = model.dayPlan(for: day)
        let window = model.myDayWindow(showsEarlier: showsEarlier, showsLater: showsLater)
        return VStack(alignment: .leading, spacing: 12) {
            if siriTipVisible {
                SiriTipView(intent: MyScheduleIntent(), isVisible: $siriTipVisible)
                    .padding(.horizontal)
            }
            dayChipsRow(window: window, selectedDay: day)
            selectedDayHeader(for: day)
            if plan.items.isEmpty {
                emptyDayState(for: day)
                    .frame(maxHeight: .infinity)
            } else {
                summaryHeader(for: plan)
                Divider()
                    .padding(.horizontal)
                timeline(for: plan)
            }
        }
        .padding(.top, 8)
    }
```

- [ ] **Step 3: Add the Today button**

In `body`, add a toolbar to the `content` view, after `.navigationTitle("My Day")`:

```swift
                .toolbar {
                    // Absent in a past season — there is no today to return
                    // to — and absent when you are already on today.
                    if let bounds = model.myDayBounds,
                       bounds.contains(todayKey),
                       selectedDay != todayKey {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Today") { selectedDay = todayKey }
                        }
                    }
                }
```

- [ ] **Step 4: Build and run the suite**

Run the verification command.
Expected: PASS, 605+ tests, no regressions.

- [ ] **Step 5: Manual smoke check in the simulator**

Open `ios/ChqCalendar.xcodeproj` in Xcode, run on an iPhone 17 simulator, star
several events across different weeks, then open My Day. Confirm:

- it opens on today, with today's chip visible without scrolling
- the header names the day and shows a `Today` badge
- a day with nothing starred shows the empty-day view and its browse button
  lands on the Events tab filtered to that day
- tapping the leading chevron reveals the season back to June 27 **without**
  the strip jumping away from the selected day
- selecting another day makes a `Today` button appear in the toolbar

- [ ] **Step 6: Commit**

```bash
git add ios/ChqCalendar/Features/MyDay/MyDayView.swift
git commit -m "feat(ios): My Day states which day it is showing (#192)

Adds the selected-day header with a Today/Tomorrow/Yesterday badge. The
screen previously named the day nowhere at all — the only indicator was
the highlighted chip, which was reliably off-screen, so the planner
looked like it had opened on the wrong day even when it hadn't.

Adds a Today button for getting back, and an empty-day state whose browse
button pins the Events tab to that day rather than leaving a dead end."
```

---

### Task 12: Screenshots, full verification, PR

**Files:**
- Modify: `docs/app-store/screenshots.manifest.json`, `docs/app-store/screenshots/review/` (regenerated)
- Possibly modify: `ios/Scripts/screenshot-plan.json`

**Interfaces:** none — this task ships the work.

- [ ] **Step 1: Run the full suite one more time**

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' \
  CODE_SIGNING_ALLOWED=NO 2>&1 | tail -30
```

Expected: all tests pass. Record the total for the PR body.

- [ ] **Step 2: Regenerate the App Store screenshots**

`07-my-day` is a covered shot and this work changes it visibly, so `CLAUDE.md`
and `.github/workflows/app-store-assets.yml` both require regeneration:

```bash
ios/Scripts/capture-screenshots.sh
python3 ios/Scripts/compose-screenshots.py
```

- [ ] **Step 3: Inspect the regenerated My Day shot**

The shot's frozen clock is `2026-07-27 07:00:00` with favorites
`101207,99511,96951` seeded (`ios/Scripts/screenshot-plan.json`). July 27 2026
is a Monday in Week 5, so the new window spans `2026-07-20` through
`2026-08-10` and both expand controls should be visible.

Open the regenerated `07-my-day` review copy and confirm the three seeded
favorites land inside that window. **If they don't, the shot will feature a
strip of empty days** — in that case update the `-uitest-seed-favorites` IDs in
`screenshot-plan.json` to events near July 27 2026, re-run Step 2, and mention
the change in the PR body.

- [ ] **Step 4: Commit the regenerated assets**

```bash
git add docs/app-store/screenshots.manifest.json docs/app-store/screenshots/review/ ios/Scripts/screenshot-plan.json
git commit -m "chore(ios): regenerate My Day screenshots (#192)

07-my-day now shows the windowed calendar strip, the selected-day header,
and the star counts."
```

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin feat/my-day-192
gh pr create --title "iOS: My Day opens on today and navigates the season (#192)" --body "$(cat <<'BODY'
Closes #192.

Spec: `docs/superpowers/specs/2026-08-09-my-day-date-model-design.md`
Plan: `docs/superpowers/plans/2026-08-09-my-day-date-model.md`

## What the issue got right, and what it got wrong

The issue reports that My Day "always shows the first day with favorites by
default." It doesn't — `DayPlan.defaultDayKey` already returned today's key
when today had favorites, so the plan below the strip was already today's
plan. Three presentation defects made it look otherwise:

- the day strip was a bare `ScrollView` that never scrolled to the selection,
  so it always rendered parked at the earliest starred day of the season
- the screen stated the selected day **nowhere** — the only indicator was the
  highlighted chip, which was the thing off-screen
- chips read `"Sun 9"`, with no month

Underneath those there was one real selection defect: a today with *zero*
starred events was skipped forward to the next day that had some.

## What changed

- New pure `DayWindow` domain type: season bounds (widened to reach any
  starred day outside the season), a `today-7 … today+14` window with each end
  independently expandable to the season edge, and a default selection that is
  **today whenever today is in season, starred or not**.
- The strip shows every calendar day in its window, not only starred days, so
  chip positions no longer re-flow when you star or unstar something.
- Chips carry weekday, month and day, and a star count. `"Today"` replaces the
  weekday on today's chip — carried in text rather than a ring because a day
  can be today *and* empty *and* selected at once, and a ring is swallowed by
  the selected fill in exactly that case.
- A selected-day header with a Today/Tomorrow/Yesterday badge, and a Today
  button for getting back.
- Empty days are tappable and offer "Browse <date> events", which required a
  new single-day `DateScope.day` on the Events tab.
- `MyDayView.nearestDay` and the `onChange`-on-`availableDays` hook are
  deleted: both existed only to handle a day vanishing from the strip, which a
  calendar-driven strip cannot do.

## Two subtle points worth a reviewer's eye

`DateScope.day` names an **absolute** date, so it must be exempt from the
`isCurrentYear ? scope : .all` downgrade that `.next`/`.today`/`.thisWeek`
rightly get. That exemption is needed in **two** places, and they have to
agree: `EventFilter.apply`'s scope line, and `DateFilterLabel`'s early
`guard isCurrentYear else { return "All Year" }`. Missing the second would
leave the pill claiming "All Year" over a day-filtered list. A test pins each.

One existing test changed its expectation:
`myDayDefaultDayFallsBackToNextFutureDayWhenTodayIsUnavailable` was asserting
the reported bug. It is renamed to
`myDayDefaultDayPicksTodayEvenWhenTodayHasNothingStarred` and now expects
today. No other existing test changed; `DayPlanTests` is untouched, since
`DayPlan.defaultDayKey` is reused for the off-season branch rather than
replaced.

## Verification

- Full iOS suite green
- `07-my-day` screenshots regenerated and manifest committed
- Manual simulator pass: opens on today, expanding the past does not move the
  selection, empty-day browse lands on the right day
BODY
)"
```

- [ ] **Step 6: Iterate the PR**

Follow the project's PR-iteration loop: address review comments, request fresh
reviews, resolve threads, fix failing checks, and repeat until there are no
pending reviewers, all threads are resolved or outdated, all checks pass, and
`mergeable_state` is clean. **Do not merge** — hand that to the user.

Note the known false alarm: the `@claude` mention auto-runner is
approval-gated, so its runs sit at `action_required` and hold
`mergeStateStatus` at `UNSTABLE` even when everything real is green. That is
not a blocker.

---

## Coverage check against the spec

| Spec section | Task(s) |
|---|---|
| §1 `DayWindow.bounds` | 3 |
| §1 `DayWindow.make` | 4 |
| §1 `DayWindow.defaultSelection` | 5 |
| §1 `ChqTime` helpers | 1 |
| §2 strip, scrolling, expand controls | 10 |
| §2 chip content and state encoding | 6, 10 |
| §2 selected-day header | 11 |
| §2 Today button | 11 |
| §2 empty-day state | 11 |
| §2 `nearestDay` / `onChange` deletion | 10 |
| §2 `AppModel` additions | 7, 9 |
| §2 `DayPlan.starredCountsByDay` | 2 |
| §3 `DateScope.day`, `selectedDayKey`, persistence | 8 |
| §3 `EventFilter` + `DateFilterLabel` exemptions | 8 |
| §3 `visibleScopes` unchanged | 8 (verified, not modified) |
| §3 `AppModel.browseDay` | 9 |
| §4 all test suites | 1–9 |
| §4 the one changed existing test | 7 |
| §5 screenshot obligation | 12 |
| §6 out of scope | not implemented, by design |

### Found during plan self-review, not in the spec

`FilterChipState.isScopeSelected` is a **third** place that reasons about the
`isCurrentYear`-to-`.all` downgrade, and the spec named only two. It is also
the one where missing the `.day` exemption is a behavioral bug rather than a
compile error: its past-season branch answers the "All" chip with
`selection.selectedWeeks.isEmpty`, which would light "All" over a
day-filtered archived season. Covered by Task 8, Step 8.

The same review pass established that `DateScope.allCases` has exactly one
call site (a test, narrowed in Task 8 Step 9) and that no production code
iterates it.
