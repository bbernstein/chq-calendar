# Date Navigation Phase 1b — iOS Shared Window Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give iOS the same derived `ViewWindow` the web gets in Phase 1a, collapse the `.day`/`isCurrentYear` exemption from three sites that must agree into one, and replace `extraDays` with explicit window bounds — **with zero user-visible behavior change**.

**Architecture:** Two new pure types in `ChqCalendarShared/Domain/`. `EffectiveScope` answers "which scope is the pipeline actually applying", which today is duplicated across `EventFilter`, `DateFilterLabel`, and `FilterChipState`. `ViewWindow` turns that scope into an instant range plus the day keys it covers. `EventFilter.apply`'s six-branch date `switch` becomes one range check. `FilterSelection` swaps `extraDays: Int` for two day-key fields.

**Tech Stack:** Swift 6, SwiftUI, Swift Testing (`import Testing`, `@Test`, `#expect`, `#require`).

**Spec:** `docs/superpowers/specs/2026-08-15-cross-platform-date-navigation-design.md` — see "Shared model", "ViewWindow", and "iOS surface".

**Counterpart:** `docs/superpowers/plans/2026-08-15-date-navigation-phase-1a-web-window-model.md` does the same job on the web. The two are independent — different codebases, no shared build — and can land in either order.

## Global Constraints

- **Zero behavior change.** This is the de-risking phase. The full iOS suite must pass at every commit. Characterization tests written in Task 1 must pass **unmodified** by every later task; if one goes red, the later task is wrong.
- **The window is half-open: `start <= x < endExclusive`.** Never inclusive-with-an-epsilon. Swift's `Date` wraps a `Double`, so there is no "last representable instant" to subtract to — an `end - 0.001` bound silently excludes `23:59:59.9995`, while JavaScript's integer-millisecond `Date` makes the same expression exact. The identical written rule would mean different things on the two platforms, which is precisely the drift this shared model exists to prevent.
- **Half-open is also what the codebase already does**, so four of six scopes need no conversion at all: `SeasonWeek.contains` is `start <= x && x < end`, `.season` is `< last.end`, the `.thisWeek` fallback is `< now + 7d`, and `dayKey` equality is exactly `[startOfDay(d), startOfDay(d+1))`. Carry those bounds through verbatim rather than re-deriving them.
- **`ChqTime.endOfDay` is not a window bound.** It returns `startOfDay + 1 day − 1 **second**` (`ChqTime.swift:195-199`) = `23:59:59.000`. Use the next day's `startOfDay` as the exclusive upper bound instead. `EventFilter.adaptiveEndDate` still returns an `endOfDay` value — convert it with `dayAfter(_:)`, and pin in a test that no representable event falls in the gap (event times are parsed from `"yyyy-MM-dd HH:mm:ss"`, so they carry no sub-second component).
- **`endDay` names the last day *shown*, not the boundary.** `.thisWeek` ends at noon Saturday so that Saturday counts; `.today` ends at midnight so the next day does not. One rule covers both — *the day containing the last instant strictly before `endExclusive`* — implemented once in `lastDayCovered(_:)` rather than reasoned about at each construction site.
- **Day keys are `ChqTime.dayKey` (`"yyyy-MM-dd"`, America/New_York).** Lexicographic order is chronological. Never do day arithmetic with `86_400` seconds — `ChqTime.day(_:offsetBy:)` goes through `Calendar` precisely because a DST day is 23 or 25 hours.
- **`windowStartDayKey` / `windowEndDayKey` are session-only.** `UserStateStore.saveFilters` builds a separate `PersistedFilters` struct (`UserStateStore.swift:279-290`) that already omits `searchText`, `extraDays`, and `selectedDayKey` — so **no persistence change is required**, and none may be added. They must also be excluded from `FilterSelection.isDefault`.
- **The `.day` exemption is the highest-risk change in this plan.** It currently lives in three places that must agree: `EventFilter.swift:42`, `DateFilterLabel.swift:74-78`, and `FilterChipState.swift:56, 66, 92, 101`. `FilterChipState` is the one where getting it wrong is a **silent behavioral bug** rather than a compile error. Task 1 pins all three before Task 2 touches any of them.
- **Screenshot obligation.** This plan modifies `ios/ChqCalendar/Features/Calendar/EventListView.swift` and `ios/ChqCalendarShared/**`, both matched by `.github/workflows/app-store-assets.yml`. **No pixel changes** — the "Show next day" button keeps its label, placement, and behavior. Opt out explicitly in the PR description with `[skip-screenshots: phase 1b is a pure refactor; no visible change — button label, placement and behavior are unchanged]`.
- **Version is 1.1.3** wherever a version is referenced. Do not reintroduce 1.1.2.

---

## File Structure

| File | Responsibility |
|---|---|
| `ios/ChqCalendarShared/Domain/EffectiveScope.swift` | **Create.** The single owner of "which scope does the pipeline actually apply", including the non-current-year downgrade and the `.day` exemption. |
| `ios/ChqCalendarShared/Domain/ViewWindow.swift` | **Create.** The instant range + day keys a scope resolves to. Mirrors the web's `dayWindow.ts`. |
| `ios/ChqCalendarTests/EffectiveScopeTests.swift` | **Create.** |
| `ios/ChqCalendarTests/ViewWindowTests.swift` | **Create.** |
| `ios/ChqCalendarTests/DateScopeExemptionTests.swift` | **Create.** Characterization tests across all three exemption sites, written before anything changes. |
| `ios/ChqCalendarShared/Domain/EventFilter.swift` | **Modify.** Date `switch` → one range check. |
| `ios/ChqCalendarShared/Domain/DateFilterLabel.swift` | **Modify.** Call `EffectiveScope`. |
| `ios/ChqCalendarShared/Domain/FilterChipState.swift` | **Modify.** Call `EffectiveScope`. |
| `ios/ChqCalendarShared/Data/UserStateStore.swift` | **Modify.** `FilterSelection`: `extraDays` → window keys. |
| `ios/ChqCalendar/App/AppModel.swift` | **Modify.** `showNextDay` → `expandWindowEnd`; `clearScopeLocalDateState` updated. |
| `ios/ChqCalendar/Features/Calendar/EventListView.swift` | **Modify.** One call-site rename. |

`EffectiveScope` and `ViewWindow` are separate types on purpose. "Which scope applies" is needed by three consumers that do not want a window (a label, a chip state, and the filter); only the filter wants the range. Merging them would force `DateFilterLabel` to build a window it never reads.

---

## Task 1: Characterize the `.day` / `isCurrentYear` exemption across all three sites

This is the de-risking step for the highest-risk change in the plan. Nothing is refactored here.

**Files:**
- Create: `ios/ChqCalendarTests/DateScopeExemptionTests.swift`

**Interfaces:**
- Consumes: `EventFilter.apply`, `DateFilterLabel.text`, `FilterChipState.isScopeSelected` as they exist today.
- Produces: nothing. A safety net for Tasks 2–5.

- [ ] **Step 1: Write the characterization tests**

Create `ios/ChqCalendarTests/DateScopeExemptionTests.swift`:

```swift
import Foundation
import Testing
@testable import ChqCalendar

/// Characterization tests for the `.day` / `isCurrentYear` exemption, which
/// today is duplicated across three types that must agree:
/// `EventFilter.apply`, `DateFilterLabel.text`, and
/// `FilterChipState.isScopeSelected`.
///
/// Written BEFORE the `EffectiveScope` refactor collapses them into one.
/// `FilterChipState` is the site where disagreement is a *silent* wrong
/// answer rather than a compile error, which is why the matrix below is
/// exhaustive rather than illustrative.
///
/// Do NOT edit these to make a later change pass. If one goes red, the
/// refactor is wrong.
struct DateScopeExemptionTests {

    private static let dayKey = "2026-07-15"

    private func selection(
        scope: DateScope, dayKey: String? = nil, weeks: Set<Int> = []
    ) -> FilterSelection {
        FilterSelection(dateScope: scope, selectedWeeks: weeks, selectedDayKey: dayKey)
    }

    // MARK: - EventFilter: which scope actually narrows the list

    @Test func dayScopeWithKeyFiltersOnAPastSeason() throws {
        // The exemption itself: `.day` names an absolute date, so it stays
        // in force even when `isCurrentYear` is false.
        let onDay = makeEvent(id: "on", start: try #require(ChqTime.parse("2026-07-15 10:00:00")))
        let offDay = makeEvent(id: "off", start: try #require(ChqTime.parse("2026-07-16 10:00:00")))
        let result = EventFilter.apply(
            selection(scope: .day, dayKey: Self.dayKey),
            to: [onDay, offDay],
            favorites: [],
            now: try #require(ChqTime.parse("2027-01-01 12:00:00")),
            year: 2026,
            isCurrentYear: false)
        #expect(result.map(\.id) == ["on"])
    }

    @Test func dayScopeWithoutKeyFiltersNothing() throws {
        let a = makeEvent(id: "a", start: try #require(ChqTime.parse("2026-07-15 10:00:00")))
        let b = makeEvent(id: "b", start: try #require(ChqTime.parse("2026-08-20 10:00:00")))
        let result = EventFilter.apply(
            selection(scope: .day, dayKey: nil),
            to: [a, b],
            favorites: [],
            now: try #require(ChqTime.parse("2026-07-15 12:00:00")),
            year: 2026,
            isCurrentYear: true)
        #expect(result.map(\.id) == ["a", "b"])
    }

    @Test func relativeScopesAreIgnoredOnAPastSeason() throws {
        // .next/.today/.thisWeek all downgrade to .all — a past season has
        // no "now".
        let far = makeEvent(id: "far", start: try #require(ChqTime.parse("2026-06-28 10:00:00")))
        let now = try #require(ChqTime.parse("2027-01-01 12:00:00"))
        for scope in [DateScope.next, .today, .thisWeek] {
            let result = EventFilter.apply(
                selection(scope: scope), to: [far], favorites: [],
                now: now, year: 2026, isCurrentYear: false)
            #expect(result.map(\.id) == ["far"], "scope \(scope) should not filter off-year")
        }
    }

    @Test func seasonScopeStillFiltersOnAPastSeason() throws {
        // .season is NOT relative to "now" either, but it is currently
        // downgraded anyway. Pinned so the refactor cannot quietly "fix" it.
        let outside = makeEvent(id: "outside", start: try #require(ChqTime.parse("2026-01-05 10:00:00")))
        let result = EventFilter.apply(
            selection(scope: .season), to: [outside], favorites: [],
            now: try #require(ChqTime.parse("2027-01-01 12:00:00")),
            year: 2026, isCurrentYear: false)
        #expect(result.map(\.id) == ["outside"], "season currently downgrades to all off-year")
    }

    @Test func weeksApplyRegardlessOfCurrentYear() throws {
        // The weeks stage sits OUTSIDE the scope switch, so it survives the
        // downgrade. Phase 1 must not change that.
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let inWeek1 = makeEvent(id: "w1", start: weeks[0].start.addingTimeInterval(3600))
        let inWeek5 = makeEvent(id: "w5", start: weeks[4].start.addingTimeInterval(3600))
        let result = EventFilter.apply(
            selection(scope: .next, weeks: [1]), to: [inWeek1, inWeek5], favorites: [],
            now: try #require(ChqTime.parse("2027-01-01 12:00:00")),
            year: 2026, isCurrentYear: false)
        #expect(result.map(\.id) == ["w1"])
    }

    // MARK: - DateFilterLabel

    @Test func labelNamesTheDayEvenOffYear() {
        let text = DateFilterLabel.text(
            for: selection(scope: .day, dayKey: Self.dayKey),
            seasonWeekCount: 9, isCurrentYear: false)
        #expect(text.contains("Jul") || text.contains("15"), "got \(text)")
    }

    @Test func labelSaysAllYearForAKeylessDay() {
        let text = DateFilterLabel.text(
            for: selection(scope: .day, dayKey: nil),
            seasonWeekCount: 9, isCurrentYear: true)
        #expect(text == "All Year")
    }

    @Test func labelSaysAllYearForRelativeScopesOffYear() {
        for scope in [DateScope.next, .today, .thisWeek, .season] {
            let text = DateFilterLabel.text(
                for: selection(scope: scope), seasonWeekCount: 9, isCurrentYear: false)
            #expect(text == "All Year", "scope \(scope) gave \(text)")
        }
    }

    @Test func labelPrefersTheDayOverAWeekSelection() {
        let text = DateFilterLabel.text(
            for: selection(scope: .day, dayKey: Self.dayKey, weeks: [3]),
            seasonWeekCount: 9, isCurrentYear: true)
        #expect(!text.contains("Week"), "got \(text)")
    }

    // MARK: - FilterChipState (silent-failure site)

    @Test func activeDayUnselectsAllOnBothYearAxes() {
        for isCurrentYear in [true, false] {
            let sel = selection(scope: .day, dayKey: Self.dayKey)
            #expect(
                FilterChipState.isScopeSelected(
                    .all, selection: sel, currentWeek: 3, isCurrentYear: isCurrentYear) == false,
                "All should be unselected with an active day, isCurrentYear=\(isCurrentYear)")
            #expect(
                FilterChipState.isScopeSelected(
                    .day, selection: sel, currentWeek: 3, isCurrentYear: isCurrentYear) == true)
        }
    }

    @Test func keylessDayReadsAsAllOnBothYearAxes() {
        for isCurrentYear in [true, false] {
            let sel = selection(scope: .day, dayKey: nil)
            #expect(
                FilterChipState.isScopeSelected(
                    .all, selection: sel, currentWeek: 3, isCurrentYear: isCurrentYear) == true,
                "isCurrentYear=\(isCurrentYear)")
            #expect(
                FilterChipState.isScopeSelected(
                    .day, selection: sel, currentWeek: 3, isCurrentYear: isCurrentYear) == false)
        }
    }

    @Test func offYearRelativeScopesNeverReadSelected() {
        for scope in [DateScope.next, .today, .thisWeek, .season] {
            #expect(
                FilterChipState.isScopeSelected(
                    scope, selection: selection(scope: scope),
                    currentWeek: 3, isCurrentYear: false) == false,
                "scope \(scope)")
        }
    }

    @Test func offYearAllIsSelectedOnlyWithoutWeeksOrDay() {
        #expect(FilterChipState.isScopeSelected(
            .all, selection: selection(scope: .next), currentWeek: 3, isCurrentYear: false) == true)
        #expect(FilterChipState.isScopeSelected(
            .all, selection: selection(scope: .next, weeks: [2]),
            currentWeek: 3, isCurrentYear: false) == false)
    }

    @Test func onlyCurrentWeekSelectedEqualsThisWeek() {
        #expect(FilterChipState.isScopeSelected(
            .thisWeek, selection: selection(scope: .all, weeks: [3]),
            currentWeek: 3, isCurrentYear: true) == true)
        #expect(FilterChipState.isScopeSelected(
            .thisWeek, selection: selection(scope: .all, weeks: [3, 4]),
            currentWeek: 3, isCurrentYear: true) == false)
    }
}
```

- [ ] **Step 2: Run them and verify they PASS against unchanged code**

Run:

```bash
cd ios && xcodebuild test \
  -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination "platform=iOS Simulator,id=$(xcrun simctl list devices available -j | python3 -c 'import json,sys;d=json.load(sys.stdin)["devices"];print([x["udid"] for k,v in d.items() if "iOS" in k for x in v if x["isAvailable"]][0])')" \
  -parallel-testing-enabled NO \
  -only-testing:ChqCalendarTests/DateScopeExemptionTests 2>&1 | tail -25
```

Expected: **PASS**, all tests. They characterize existing behavior.

Resolve the simulator UDID at runtime as above — never pin `OS=`, and keep `-parallel-testing-enabled NO`: the hosted macOS runners are 3-core and the suite is serialized deliberately.

If a test fails, it encodes a wrong assumption about current behavior. Fix the **test** to match reality and note what surprised you — that surprise is exactly what this task exists to surface. Do not change production code in this task.

- [ ] **Step 3: Commit**

```bash
git add ios/ChqCalendarTests/DateScopeExemptionTests.swift
git commit -m "test(ios): characterize the .day/isCurrentYear exemption before collapsing it

The exemption lives in three types that must agree — EventFilter,
DateFilterLabel and FilterChipState — and FilterChipState is the one where
disagreement is a silent wrong answer rather than a compile error. The
matrix is exhaustive rather than illustrative for that reason.

Pins both axes: an active .day survives the non-current-year downgrade, a
keyless .day filters nothing and must read as All everywhere, and the weeks
stage applies regardless of isCurrentYear because it sits outside the scope
switch."
```

---

## Task 2: `EffectiveScope` — one owner for the downgrade

**Files:**
- Create: `ios/ChqCalendarShared/Domain/EffectiveScope.swift`
- Create: `ios/ChqCalendarTests/EffectiveScopeTests.swift`
- Modify: `ios/ChqCalendarShared/Domain/EventFilter.swift:36-42`
- Modify: `ios/ChqCalendarShared/Domain/DateFilterLabel.swift:74-96`
- Modify: `ios/ChqCalendarShared/Domain/FilterChipState.swift:36-107`

**Interfaces:**
- Consumes: `DateScope`, `FilterSelection` (unchanged).
- Produces, for Tasks 3–5: `EffectiveScope.resolve(scope:selectedDayKey:isCurrentYear:) -> DateScope`.

- [ ] **Step 1: Write the failing tests**

Create `ios/ChqCalendarTests/EffectiveScopeTests.swift`:

```swift
import Foundation
import Testing
@testable import ChqCalendar

struct EffectiveScopeTests {

    @Test func currentYearKeepsEveryRelativeScope() {
        for scope in [DateScope.next, .today, .thisWeek, .season, .all] {
            #expect(
                EffectiveScope.resolve(scope: scope, selectedDayKey: nil, isCurrentYear: true) == scope,
                "scope \(scope)")
        }
    }

    @Test func pastSeasonDowngradesEveryScopeButDay() {
        for scope in [DateScope.next, .today, .thisWeek, .season] {
            #expect(
                EffectiveScope.resolve(scope: scope, selectedDayKey: nil, isCurrentYear: false) == .all,
                "scope \(scope)")
        }
    }

    @Test func activeDaySurvivesThePastSeasonDowngrade() {
        #expect(
            EffectiveScope.resolve(
                scope: .day, selectedDayKey: "2026-07-15", isCurrentYear: false) == .day)
    }

    @Test func keylessDayResolvesToAllOnBothYearAxes() {
        // A .day naming no date filters nothing, which is exactly what .all
        // means. Resolving it here is what lets all three consumers stop
        // special-casing it.
        for isCurrentYear in [true, false] {
            #expect(
                EffectiveScope.resolve(
                    scope: .day, selectedDayKey: nil, isCurrentYear: isCurrentYear) == .all,
                "isCurrentYear=\(isCurrentYear)")
        }
    }

    @Test func allStaysAll() {
        for isCurrentYear in [true, false] {
            #expect(
                EffectiveScope.resolve(
                    scope: .all, selectedDayKey: nil, isCurrentYear: isCurrentYear) == .all)
        }
    }

    @Test func resolvingIsIdempotent() {
        // Resolving a resolved scope must be a no-op, or a consumer that
        // resolves twice (or resolves an already-resolved value handed to it)
        // gets a different answer than one that resolves once.
        for scope in DateScope.allCases {
            let once = EffectiveScope.resolve(
                scope: scope, selectedDayKey: "2026-07-15", isCurrentYear: false)
            let twice = EffectiveScope.resolve(
                scope: once, selectedDayKey: "2026-07-15", isCurrentYear: false)
            #expect(once == twice, "scope \(scope): \(once) then \(twice)")
        }
    }
}
```

- [ ] **Step 2: Run and verify they fail**

Run the `xcodebuild test` command from Task 1 Step 2, with `-only-testing:ChqCalendarTests/EffectiveScopeTests`.

Expected: compile failure — `cannot find 'EffectiveScope' in scope`.

- [ ] **Step 3: Write the type**

Create `ios/ChqCalendarShared/Domain/EffectiveScope.swift`:

```swift
import Foundation

/// Which `DateScope` the pipeline **actually applies**, as opposed to the one
/// stored in `FilterSelection`.
///
/// Two rules make those differ, and before this type existed both were
/// duplicated across `EventFilter.apply`, `DateFilterLabel.text`, and
/// `FilterChipState.isScopeSelected` — three sites that had to agree, with
/// no compiler help if they drifted. `FilterChipState` is the one where
/// drift is a *silent* wrong answer: a chip renders selected or unselected
/// against a filter that is doing something else entirely (#192, #197).
///
/// 1. **A past or future season has no "now"**, so every scope relative to
///    it degrades to `.all`.
/// 2. **`.day` is exempt from that**, because it names an absolute calendar
///    day — just as meaningful in an archived season as in the live one —
///    but only while it actually carries a key. A `.day` with no key names
///    no date and filters nothing, which is precisely what `.all` means.
nonisolated enum EffectiveScope {
    /// - Parameter isCurrentYear: must be the same value the caller passes to
    ///   `EventFilter.apply`. Deliberately not defaulted: a default is what
    ///   lets a future call site forget it and silently reintroduce the bug
    ///   where a pill read "Now" over a list that was not date-filtered.
    ///
    /// Idempotent — resolving an already-resolved scope returns it unchanged
    /// — so a consumer that resolves twice cannot disagree with one that
    /// resolves once.
    static func resolve(
        scope: DateScope,
        selectedDayKey: String?,
        isCurrentYear: Bool
    ) -> DateScope {
        if scope == .day {
            return selectedDayKey == nil ? .all : .day
        }
        return isCurrentYear ? scope : .all
    }

    /// Convenience over a whole selection.
    static func resolve(_ selection: FilterSelection, isCurrentYear: Bool) -> DateScope {
        resolve(
            scope: selection.dateScope,
            selectedDayKey: selection.selectedDayKey,
            isCurrentYear: isCurrentYear)
    }
}
```

- [ ] **Step 4: Run and verify they pass**

Run with `-only-testing:ChqCalendarTests/EffectiveScopeTests`. Expected: PASS.

- [ ] **Step 5: Route `EventFilter` through it**

In `EventFilter.swift`, replace the `let scope: DateScope = (isCurrentYear || sel.dateScope == .day) ? sel.dateScope : .all` line (`:42`) and its preceding comment block with:

```swift
        // Which scope actually applies — the non-current-year downgrade and
        // the `.day` exemption both live in `EffectiveScope` now, so this
        // type, `DateFilterLabel` and `FilterChipState` cannot drift apart.
        let scope = EffectiveScope.resolve(sel, isCurrentYear: isCurrentYear)
```

The `case .day:` branch can now drop its `if let dayKey` guard's else-path reasoning, because `EffectiveScope` guarantees a non-nil key whenever it returns `.day`. Keep the optional binding (the type is still `String?`) but simplify the comment to say the key is guaranteed present:

```swift
        case .day:
            // `EffectiveScope` only returns `.day` when the key is non-nil,
            // so this binding cannot fail; it exists because the stored type
            // is still optional.
            if let dayKey = sel.selectedDayKey {
                result = result.filter { ChqTime.dayKey(for: $0.start) == dayKey }
            }
```

- [ ] **Step 6: Route `DateFilterLabel` through it**

In `DateFilterLabel.text`, replace the `if selection.dateScope == .day, let dayKey = ..., let date = ...` block and the `guard isCurrentYear else { return "All Year" }` inside the weeks guard with a single leading resolution:

```swift
        let scope = EffectiveScope.resolve(selection, isCurrentYear: isCurrentYear)

        // Resolved before the week logic: a selection carrying both a day and
        // weeks is filtered by both, and the day is never the wider of the
        // two — so naming it cannot overclaim, while naming the week can
        // (#197 item 5).
        if scope == .day,
           let dayKey = selection.selectedDayKey,
           let date = ChqTime.parse("\(dayKey) 00:00:00") {
            return ChqTime.pillDayLabel(for: date, includingYear: !isCurrentYear)
        }

        let weeks = selection.selectedWeeks.sorted()
        guard !weeks.isEmpty else {
            return scope == .all ? DateScope.all.label : scope.label
        }
```

Everything from `if weeks.count == seasonWeekCount` onward is unchanged.

- [ ] **Step 7: Route `FilterChipState` through it**

Replace the whole body of `isScopeSelected` with:

```swift
    static func isScopeSelected(
        _ scope: DateScope,
        selection: FilterSelection,
        currentWeek: Int?,
        isCurrentYear: Bool
    ) -> Bool {
        // The one place the pipeline's real scope is decided. Before this,
        // the same rules were restated here in a `guard isCurrentYear else`
        // block that had to stay in step with `EventFilter` by hand.
        let effective = EffectiveScope.resolve(selection, isCurrentYear: isCurrentYear)

        switch scope {
        case .thisWeek:
            if effective == .thisWeek { return true }
            // Selecting *only* the current week is the same range as
            // "This Week"; selecting it alongside others is not.
            guard let currentWeek else { return false }
            return selection.selectedWeeks == [currentWeek]

        case .all:
            // "All" means unfiltered dates, so a week selection un-selects it
            // even when the effective scope is `.all`.
            return effective == .all && selection.selectedWeeks.isEmpty

        case .day:
            // Never rendered as a chip — `.day` is derived, not pickable —
            // but answered honestly rather than left to the caller.
            return effective == .day

        case .next, .today, .season:
            return effective == scope
        }
    }
```

`isWeekSelected` is unchanged — but note it reads `selection.dateScope` directly, which is correct: the weeks stage of `EventFilter` runs outside the scope switch, so week highlighting is not subject to the downgrade.

- [ ] **Step 8: Run the characterization tests plus the three sites' own suites**

Run with `-only-testing:ChqCalendarTests/DateScopeExemptionTests -only-testing:ChqCalendarTests/EffectiveScopeTests -only-testing:ChqCalendarTests/FilterChipStateTests -only-testing:ChqCalendarTests/DateFilterLabelTests -only-testing:ChqCalendarTests/EventFilterTests`.

Expected: **all PASS, with Task 1's characterization tests unmodified.** That is the whole point of this task. If any characterization test fails, the collapse changed behavior — fix `EffectiveScope`, never the test.

- [ ] **Step 9: Prove the collapse is load-bearing**

Temporarily change `EffectiveScope.resolve` to drop the `.day` exemption:

```swift
        return isCurrentYear ? scope : .all
```

(i.e. delete the `if scope == .day` block). Re-run the same five suites.

Expected: **failures in `DateScopeExemptionTests`**, specifically `dayScopeWithKeyFiltersOnAPastSeason`, `labelNamesTheDayEvenOffYear`, and `activeDayUnselectsAllOnBothYearAxes`. Record which tests failed.

Restore the correct implementation and confirm green. If removing the exemption produces **no** failures, the characterization matrix is not covering the exemption and Task 1 must be extended before proceeding.

- [ ] **Step 10: Run the full suite and commit**

Run the full `xcodebuild test` with no `-only-testing` filter. Expected: all tests pass.

```bash
git add ios/ChqCalendarShared/Domain/EffectiveScope.swift \
        ios/ChqCalendarTests/EffectiveScopeTests.swift \
        ios/ChqCalendarShared/Domain/EventFilter.swift \
        ios/ChqCalendarShared/Domain/DateFilterLabel.swift \
        ios/ChqCalendarShared/Domain/FilterChipState.swift
git commit -m "refactor(ios): one owner for the scope downgrade and .day exemption

EventFilter, DateFilterLabel and FilterChipState each restated the same two
rules — a past season has no 'now' so relative scopes degrade to .all, and
.day is exempt because it names an absolute date. Three sites that had to
agree, with no compiler help if they drifted, and FilterChipState is the one
where drift is a silent wrong answer rather than a build error.

EffectiveScope.resolve is now the single owner. It also folds in the
keyless-.day case that all three were handling separately: a .day naming no
date filters nothing, which is exactly what .all means.

Behavior is unchanged — the characterization matrix from the previous commit
passes untouched. Proven load-bearing by deleting the exemption and
confirming three of those tests fail."
```

---

## Task 3: The `ViewWindow` type

**Files:**
- Create: `ios/ChqCalendarShared/Domain/ViewWindow.swift`
- Create: `ios/ChqCalendarTests/ViewWindowTests.swift`

**Interfaces:**
- Consumes: `EffectiveScope.resolve` from Task 2; `SeasonCalendar`, `ChqTime`, `DayWindow.bounds`, `EventFilter.adaptiveEndDate`.
- Produces, for Task 4:
  - `struct ViewWindow { let startDay: String; let endDay: String; let range: Range<Date> }`, with `start`/`endExclusive` accessors and `contains(_:)`
  - `ViewWindow.dayAfter(_ dayKey: String) -> Date?` — the next day's `startOfDay`, i.e. the exclusive upper bound of that day
  - `ViewWindow.lastDayCovered(_ endExclusive: Date) -> String`
  - `ViewWindow.navigableBounds(year: Int, events: [Event], starredDays: [String]) -> ClosedRange<String>`
  - `ViewWindow.make(selection:events:now:year:isCurrentYear:bounds:) -> ViewWindow?`

`nil` means "this scope matches nothing right now".

- [ ] **Step 1: Write the failing tests**

Create `ios/ChqCalendarTests/ViewWindowTests.swift`:

```swift
import Foundation
import Testing
@testable import ChqCalendar

struct ViewWindowTests {

    private static func at(_ s: String) throws -> Date {
        try #require(ChqTime.parse(s))
    }

    private func bounds() -> ClosedRange<String> {
        DayWindow.bounds(year: 2026, starredDays: [])
    }

    private func window(
        _ sel: FilterSelection,
        events: [Event] = [],
        now: Date,
        isCurrentYear: Bool = true
    ) -> ViewWindow? {
        ViewWindow.make(
            selection: sel, events: events, now: now,
            year: 2026, isCurrentYear: isCurrentYear, bounds: bounds())
    }

    // MARK: - day boundaries

    @Test func dayAfterIsTheNextDaysMidnight() throws {
        let bound = try #require(ViewWindow.dayAfter("2026-07-15"))
        #expect(bound == (try Self.at("2026-07-16 00:00:00")))
    }

    @Test func dayAfterHandlesADstDay() throws {
        // 2026-11-01 is 25 hours long in America/New_York. Adding 86_400
        // seconds would land at 23:00 on the 1st, not midnight on the 2nd.
        let bound = try #require(ViewWindow.dayAfter("2026-11-01"))
        #expect(bound == (try Self.at("2026-11-02 00:00:00")))
    }

    @Test func dayAfterRejectsAnUnparseableKey() {
        #expect(ViewWindow.dayAfter("not-a-day") == nil)
    }

    @Test func lastDayCoveredStepsBackOnAnExactDayBoundary() throws {
        // A window ending at midnight does NOT show that day.
        #expect(ViewWindow.lastDayCovered(try Self.at("2026-07-16 00:00:00")) == "2026-07-15")
    }

    @Test func lastDayCoveredKeepsTheDayOnAMidDayBoundary() throws {
        // A week ends at noon Saturday, and that Saturday morning has events,
        // so the Saturday counts as shown.
        #expect(ViewWindow.lastDayCovered(try Self.at("2026-07-18 12:00:00")) == "2026-07-18")
    }

    // MARK: - navigableBounds

    @Test func boundsCoverTheSeasonWhenEveryEventIsInside() throws {
        let inside = makeEvent(id: "in", start: try Self.at("2026-07-15 10:00:00"))
        let range = ViewWindow.navigableBounds(year: 2026, events: [inside], starredDays: [])
        #expect(range == DayWindow.bounds(year: 2026, starredDays: []))
    }

    @Test func boundsWidenToContainOutOfSeasonEvents() throws {
        let early = makeEvent(id: "early", start: try Self.at("2026-05-01 10:00:00"))
        let late = makeEvent(id: "late", start: try Self.at("2026-10-01 10:00:00"))
        let range = ViewWindow.navigableBounds(year: 2026, events: [early, late], starredDays: [])
        #expect(range.lowerBound == "2026-05-01")
        #expect(range.upperBound == "2026-10-01")
    }

    @Test func boundsAlsoWidenForStarredDaysOutsideTheSeason() {
        let range = ViewWindow.navigableBounds(
            year: 2026, events: [], starredDays: ["2026-04-01", "2026-12-25"])
        #expect(range.lowerBound == "2026-04-01")
        #expect(range.upperBound == "2026-12-25")
    }

    // MARK: - base windows, one per scope

    @Test func todaySpansExactlyTheCurrentDay() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        let w = try #require(window(FilterSelection(dateScope: .today), now: now))
        #expect(w.startDay == "2026-07-15")
        #expect(w.endDay == "2026-07-15")
        #expect(w.start == ChqTime.calendar.startOfDay(for: now))
        #expect(w.endExclusive == (try Self.at("2026-07-16 00:00:00")))
    }

    @Test func todayIncludesTheFinalSubSecondAndExcludesTheNextMidnight() throws {
        // Half-open means no epsilon and no precision assumption: anything
        // strictly before the next midnight is in, midnight itself is out.
        // ChqTime.endOfDay (23:59:59.000) would have dropped the first of
        // these, and an `end - 1ms` bound would have dropped it on iOS while
        // keeping it on the web, where Date is integer milliseconds.
        let now = try Self.at("2026-07-15 15:00:00")
        let w = try #require(window(FilterSelection(dateScope: .today), now: now))
        #expect(w.contains(try Self.at("2026-07-15 23:59:59").addingTimeInterval(0.9995)))
        #expect(!w.contains(try Self.at("2026-07-16 00:00:00")))
        #expect(w.contains(try Self.at("2026-07-15 00:00:00")))
    }

    @Test func adjacentDayWindowsTileWithoutGapOrOverlap() throws {
        // The property an inclusive-with-epsilon scheme cannot give you, and
        // the one scroll-stitching depends on.
        let day1 = try #require(window(
            FilterSelection(dateScope: .day, selectedDayKey: "2026-07-15"),
            now: try Self.at("2026-07-15 12:00:00")))
        let day2 = try #require(window(
            FilterSelection(dateScope: .day, selectedDayKey: "2026-07-16"),
            now: try Self.at("2026-07-15 12:00:00")))
        #expect(day1.endExclusive == day2.start)
    }

    @Test func nextStartsOneHourBeforeNow() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        let events = [makeEvent(id: "e", start: try Self.at("2026-07-16 10:00:00"))]
        let w = try #require(window(FilterSelection(dateScope: .next), events: events, now: now))
        #expect(w.start == now.addingTimeInterval(-3600))
        #expect(w.startDay == "2026-07-15")
    }

    @Test func nextUpperBoundAdmitsNoRepresentableEventBeyondTheOldOne() throws {
        // The one deliberate difference from the pre-refactor pipeline:
        // `.next` used `<= adaptiveEndDate`, which is ChqTime.endOfDay =
        // 23:59:59.000. The half-open bound is the next midnight, so it also
        // admits 23:59:59.5 — but event times are parsed from
        // "yyyy-MM-dd HH:mm:ss" and carry no sub-second component, so no
        // representable event can land in that gap. Asserted rather than
        // claimed in a comment.
        #expect(ChqTime.parse("2026-07-15 23:59:59.500") == nil)
        let onTheSecond = try #require(ChqTime.parse("2026-07-15 23:59:59"))
        #expect(onTheSecond.timeIntervalSince1970 == onTheSecond.timeIntervalSince1970.rounded())
    }

    @Test func nextNearMidnightPutsStartDayOnThePreviousDay() throws {
        let now = try Self.at("2026-07-15 00:30:00")
        let w = try #require(window(FilterSelection(dateScope: .next), now: now))
        #expect(w.startDay == "2026-07-14")
    }

    @Test func seasonConvertsTheExclusiveEndToInclusive() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let w = try #require(window(FilterSelection(dateScope: .season), now: now))
        #expect(w.start == weeks[0].start)
        #expect(weeks[8].end.timeIntervalSince(w.end) < 0.01)
        #expect(w.end < weeks[8].end)
    }

    @Test func thisWeekConvertsTheExclusiveNoonBoundary() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let current = try #require(weeks.first { $0.contains(now) })
        let w = try #require(window(FilterSelection(dateScope: .thisWeek), now: now))
        #expect(w.start == current.start)
        #expect(w.end < current.end)
        #expect(current.end.timeIntervalSince(w.end) < 0.01)
    }

    @Test func thisWeekSpansBothBoundarySaturdays() throws {
        // A week runs noon-Saturday to noon-Saturday, so both boundary
        // Saturdays carry events and the window covers eight day keys. This is
        // why the season cannot be paged into disjoint weeks.
        let now = try Self.at("2026-07-15 15:00:00")
        let w = try #require(window(FilterSelection(dateScope: .thisWeek), now: now))
        #expect(ChqTime.dayKeys(from: w.startDay, through: w.endDay).count == 8)
    }

    @Test func dayScopeSpansItsNamedDay() throws {
        let now = try Self.at("2027-01-01 12:00:00")
        let sel = FilterSelection(dateScope: .day, selectedDayKey: "2026-07-15")
        let w = try #require(window(sel, now: now, isCurrentYear: false))
        #expect(w.startDay == "2026-07-15")
        #expect(w.endDay == "2026-07-15")
    }

    @Test func allIsUnboundedInInstantsButBoundedInDays() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        let w = try #require(window(FilterSelection(dateScope: .all), now: now))
        #expect(w.start < (try Self.at("1900-01-01 00:00:00")))
        #expect(w.end > (try Self.at("2200-01-01 00:00:00")))
        #expect(w.startDay == bounds().lowerBound)
        #expect(w.endDay == bounds().upperBound)
    }

    @Test func aPastSeasonCollapsesRelativeScopesToAll() throws {
        let now = try Self.at("2027-01-01 12:00:00")
        let w = try #require(window(FilterSelection(dateScope: .today), now: now, isCurrentYear: false))
        #expect(w.start < (try Self.at("1900-01-01 00:00:00")))
    }

    // MARK: - expansion

    @Test func expansionGrowsTheEndAndUsesWholeDays() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        var sel = FilterSelection(dateScope: .today)
        sel.windowEndDayKey = "2026-07-17"
        let w = try #require(window(sel, now: now))
        #expect(w.endDay == "2026-07-17")
        #expect(w.endExclusive == (try Self.at("2026-07-18 00:00:00")))
        #expect(w.start == ChqTime.calendar.startOfDay(for: now))
    }

    @Test func expansionGrowsTheStart() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        var sel = FilterSelection(dateScope: .today)
        sel.windowStartDayKey = "2026-07-13"
        let w = try #require(window(sel, now: now))
        #expect(w.startDay == "2026-07-13")
        #expect(w.start == ChqTime.calendar.startOfDay(for: try Self.at("2026-07-13 00:00:00")))
    }

    @Test func expandingEarlierDropsTheIntraDayStartInstant() throws {
        // `.next` starts at now-1h. Once the user reaches back past that day
        // they want the whole earlier day, not a window still beginning at
        // 14:00 on a day they scrolled away from.
        let now = try Self.at("2026-07-15 15:00:00")
        var sel = FilterSelection(dateScope: .next)
        sel.windowStartDayKey = "2026-07-13"
        let w = try #require(window(sel, now: now))
        #expect(w.start == ChqTime.calendar.startOfDay(for: try Self.at("2026-07-13 00:00:00")))
    }

    @Test func expansionNeverNarrowsTheBaseWindow() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        var sel = FilterSelection(dateScope: .today)
        sel.windowEndDayKey = "2026-07-10"
        let w = try #require(window(sel, now: now))
        #expect(w.endDay == "2026-07-15")
    }

    @Test func expansionClampsToNavigableBounds() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        var sel = FilterSelection(dateScope: .today)
        sel.windowEndDayKey = "2030-01-01"
        let w = try #require(window(sel, now: now))
        #expect(w.endDay == bounds().upperBound)
    }
}
```

- [ ] **Step 2: Run and verify they fail**

Expected: compile failure — `cannot find 'ViewWindow' in scope`, and `windowStartDayKey` / `windowEndDayKey` are not members of `FilterSelection` yet. **Both are expected**; Task 4 adds the fields. To keep this task independently runnable, add the two fields to `FilterSelection` now as part of this task (Task 4 then only removes `extraDays` and updates the writers):

In `UserStateStore.swift`, add to `FilterSelection` beside `selectedDayKey`:

```swift
    /// How far the user has navigated beyond the current scope's own window,
    /// as `ChqTime.dayKey` strings. `nil` means "not expanded that way".
    ///
    /// **Session-only**, like `searchText`, `extraDays` and `selectedDayKey`:
    /// `UserStateStore.saveFilters` builds a separate `PersistedFilters`
    /// that does not carry them, so no persistence change is needed — and
    /// none may be added. Restoring a window pinned days ago would be worse
    /// than not restoring (#192).
    var windowStartDayKey: String?
    var windowEndDayKey: String?
```

Add both to the memberwise `init` with `= nil` defaults, in the same position. Do **not** add them to `isDefault`.

- [ ] **Step 3: Write the type**

Create `ios/ChqCalendarShared/Domain/ViewWindow.swift`:

```swift
import Foundation

/// The instants the event list is narrowed to, plus the calendar days that
/// range covers. The iOS counterpart of the web's `dayWindow.ts`.
///
/// **Half-open**: `start <= x < endExclusive`, carried as a `Range<Date>` so
/// the type system enforces it and `contains(_:)` comes for free. Never an
/// inclusive bound with a subtracted epsilon: `Date` wraps a `Double`, so
/// there is no last representable instant to subtract to, and an
/// `end - 0.001` bound silently drops `23:59:59.9995` — while the identical
/// expression is exact on the web, where `Date` is integer milliseconds. The
/// same written rule meaning two different things is exactly the drift this
/// shared model exists to prevent.
///
/// Half-open is also what the pipeline already used everywhere, so most
/// scopes need no conversion at all: `SeasonWeek.contains` is
/// `start <= x && x < end`, `.season` is `< last.end`, the `.thisWeek`
/// fallback is `< now + 7d`, and `dayKey` equality is exactly
/// `[startOfDay(d), startOfDay(d+1))`. Those bounds are carried through
/// verbatim below rather than re-derived.
///
/// `startDay`/`endDay` are the navigation-facing projection — what a day rail
/// or a step control moves through. They are derived from the range, never
/// the other way round, so they cannot disagree with what is filtered.
nonisolated struct ViewWindow: Equatable, Sendable {
    let startDay: String
    let endDay: String
    let range: Range<Date>

    var start: Date { range.lowerBound }
    var endExclusive: Date { range.upperBound }

    /// `start <= date < endExclusive`.
    func contains(_ date: Date) -> Bool { range.contains(date) }

    private static let minInstant = Date(timeIntervalSince1970: -62_135_596_800) // year 1
    private static let maxInstant = Date(timeIntervalSince1970: 32_503_680_000)  // year 3000

    /// The exclusive upper bound of `dayKey` — the next day's midnight.
    ///
    /// Goes through `Calendar`, not `+86_400`, because a DST day is 23 or 25
    /// hours. **Deliberately not `ChqTime.endOfDay`**, which returns
    /// `startOfDay + 1 day - 1 second` (`23:59:59.000`) and is an inclusive
    /// bound of the wrong precision for a window.
    static func dayAfter(_ dayKey: String) -> Date? {
        guard
            let start = ChqTime.parse("\(dayKey) 00:00:00"),
            let next = ChqTime.calendar.date(byAdding: .day, value: 1, to: start)
        else { return nil }
        return next
    }

    /// The last day a window actually shows, given its exclusive upper bound.
    ///
    /// One rule for two cases that look unrelated at the call site: a window
    /// ending at midnight does not show that day (`.today`, `.day`, `.next`),
    /// while one ending mid-day does (`.thisWeek` and `.season` end at noon
    /// Saturday, and that Saturday morning has events). Implemented once here
    /// rather than reasoned about at each construction site.
    static func lastDayCovered(_ endExclusive: Date) -> String {
        let cal = ChqTime.calendar
        let key = ChqTime.dayKey(for: endExclusive)
        guard cal.startOfDay(for: endExclusive) == endExclusive else { return key }
        return ChqTime.day(key, offsetBy: -1) ?? key
    }

    /// The outer limit of everything navigation can reach: the season, widened
    /// to contain every day that carries an event and every starred day.
    /// Reuses `DayWindow.bounds` for the season-and-starred half so its
    /// existing tests keep pinning that.
    static func navigableBounds(
        year: Int, events: [Event], starredDays: [String]
    ) -> ClosedRange<String> {
        let base = DayWindow.bounds(year: year, starredDays: starredDays)
        var lower = base.lowerBound
        var upper = base.upperBound
        for event in events {
            let key = ChqTime.dayKey(for: event.start)
            if key < lower { lower = key }
            if key > upper { upper = key }
        }
        return lower...upper
    }

    /// The window a scope defines, widened by however far the user has
    /// navigated. `nil` means the scope matches nothing right now.
    ///
    /// Expansion only ever grows the window — a `windowStartDayKey` or
    /// `windowEndDayKey` that would narrow it is ignored, so a stale value can
    /// never hide events. The added region uses whole days, while an untouched
    /// end keeps the base window's exact instant: that is what preserves
    /// `.next`'s one-hour grace and `.thisWeek`'s noon boundaries until the
    /// user actually navigates past them.
    ///
    /// `bounds` clamps the *expansion inputs*, before they are merged with
    /// `base` — never the merged result. The bounds limit how far navigation
    /// can reach; they say nothing about a scope the user hasn't navigated,
    /// and `base` can legitimately sit outside them (off-season `.today`,
    /// most of the year). Clamping the merged result instead of the inputs
    /// would invert the window (`startDay > endDay`) whenever that happens.
    static func make(
        selection: FilterSelection,
        events: [Event],
        now: Date,
        year: Int,
        isCurrentYear: Bool,
        bounds: ClosedRange<String>
    ) -> ViewWindow? {
        guard let base = base(
            selection: selection, events: events, now: now,
            year: year, isCurrentYear: isCurrentYear, bounds: bounds)
        else { return nil }

        var expandedStartDayKey = selection.windowStartDayKey
        if let expanded = expandedStartDayKey, expanded < bounds.lowerBound {
            expandedStartDayKey = bounds.lowerBound
        }
        var expandedEndDayKey = selection.windowEndDayKey
        if let expanded = expandedEndDayKey, expanded > bounds.upperBound {
            expandedEndDayKey = bounds.upperBound
        }

        var startDay = base.startDay
        var endDay = base.endDay
        if let expanded = expandedStartDayKey, expanded < startDay { startDay = expanded }
        if let expanded = expandedEndDayKey, expanded > endDay { endDay = expanded }

        let start: Date
        if startDay == base.startDay {
            start = base.start
        } else if let parsed = ChqTime.parse("\(startDay) 00:00:00") {
            start = ChqTime.calendar.startOfDay(for: parsed)
        } else {
            start = base.start
        }

        let endExclusive = endDay == base.endDay
            ? base.endExclusive
            : (dayAfter(endDay) ?? base.endExclusive)

        // No `guard start < endExclusive` here: unlike the clamp-after-merge
        // form this replaced, expansion only ever widens outward from a
        // `base` that is already a valid (non-empty) range, so `start` can
        // never cross `endExclusive`.
        return ViewWindow(startDay: startDay, endDay: endDay, range: start..<endExclusive)
    }

    private static func base(
        selection: FilterSelection,
        events: [Event],
        now: Date,
        year: Int,
        isCurrentYear: Bool,
        bounds: ClosedRange<String>
    ) -> ViewWindow? {
        let scope = EffectiveScope.resolve(selection, isCurrentYear: isCurrentYear)
        let weeks = SeasonCalendar.weeks(forYear: year)

        switch scope {
        case .all:
            // No instant bound. Deliberately not derived from `events`: a
            // window computed from the very list being filtered would be
            // circular and would behave differently for a caller passing a
            // subset.
            return ViewWindow(
                startDay: bounds.lowerBound, endDay: bounds.upperBound,
                range: minInstant..<maxInstant)

        case .season:
            // `first.start <= x && x < last.end`, carried through verbatim.
            guard let first = weeks.first, let last = weeks.last else { return nil }
            return windowed(first.start..<last.end)

        case .today:
            return day(ChqTime.dayKey(for: now))

        case .day:
            // `EffectiveScope` returns `.day` only with a non-nil key.
            guard let key = selection.selectedDayKey else { return nil }
            return day(key)

        case .next:
            let from = now.addingTimeInterval(-3600)
            // Sized against the FULL event set, not a search-narrowed one — an
            // active search must not change how wide the window is, only what
            // it is applied to.
            //
            // `adaptiveEndDate` returns an inclusive `ChqTime.endOfDay`
            // (23:59:59.000); the half-open equivalent is that day's exclusive
            // end. No representable event falls in the difference — event
            // times parse from "yyyy-MM-dd HH:mm:ss" and carry no sub-second
            // component — which `ViewWindowTests` asserts rather than assumes.
            let inclusiveEnd = EventFilter.adaptiveEndDate(events: events, from: from, minCount: 50)
            guard let end = dayAfter(ChqTime.dayKey(for: inclusiveEnd)) else { return nil }
            return windowed(from..<end)

        case .thisWeek:
            if let current = weeks.first(where: { $0.contains(now) }) {
                // Literally `SeasonWeek.contains`.
                return windowed(current.start..<current.end)
            }
            // Out of season: the pipeline's existing seven-day fallback.
            return windowed(now..<now.addingTimeInterval(7 * 24 * 3600))
        }
    }

    /// Wraps a half-open instant range with its day projection.
    private static func windowed(_ range: Range<Date>) -> ViewWindow {
        ViewWindow(
            startDay: ChqTime.dayKey(for: range.lowerBound),
            endDay: lastDayCovered(range.upperBound),
            range: range)
    }

    private static func day(_ key: String) -> ViewWindow? {
        guard
            let parsed = ChqTime.parse("\(key) 00:00:00"),
            let end = dayAfter(key)
        else { return nil }
        return ViewWindow(
            startDay: key, endDay: key,
            range: ChqTime.calendar.startOfDay(for: parsed)..<end)
    }
}
```

- [ ] **Step 4: Run and verify they pass**

Run with `-only-testing:ChqCalendarTests/ViewWindowTests`. Expected: PASS.

- [ ] **Step 5: Prove the half-open bound is load-bearing**

Two mutations, run separately, each restored before the next.

**(a) The wrong precision.** Change `dayAfter` to return `ChqTime.endOfDay(start)`. Re-run `ViewWindowTests`.
Expected: FAIL on `dayAfterIsTheNextDaysMidnight` and on `todayIncludesTheFinalSubSecondAndExcludesTheNextMidnight`.

**(b) The epsilon that looks equivalent.** Change `dayAfter` to return `next.addingTimeInterval(-0.001)` — the inclusive-minus-a-millisecond form this design rejected. Re-run.
Expected: FAIL on `todayIncludesTheFinalSubSecondAndExcludesTheNextMidnight` (`23:59:59.9995` falls outside) and on `adjacentDayWindowsTileWithoutGapOrOverlap` (the windows no longer abut).

Mutation (b) is the one that matters: it is the version a reviewer would wave through as equivalent, and it is exact on the web while being wrong on iOS, because `Date` is a `Double` here and integer milliseconds there. If (b) produces no failures, the tests are not pinning the property this design turns on.

Restore and confirm green.

- [ ] **Step 6: Commit**

```bash
git add ios/ChqCalendarShared/Domain/ViewWindow.swift \
        ios/ChqCalendarTests/ViewWindowTests.swift \
        ios/ChqCalendarShared/Data/UserStateStore.swift
git commit -m "feat(ios): add the ViewWindow type

The instant range plus day keys a scope resolves to — the counterpart of
the web's dayWindow module. Pure and not yet wired into EventFilter.

Half-open, carried as a Range<Date> so the type enforces it. Not inclusive
with a subtracted epsilon: Date wraps a Double here, so there is no last
representable instant to subtract to, and an end - 0.001 bound drops
23:59:59.9995 — while the identical expression is exact on the web, where
Date is integer milliseconds. The same written rule meaning two different
things per platform is the drift this shared model exists to prevent.

Half-open is also what the pipeline already used, so most scopes need no
conversion: .season and .thisWeek carry SeasonWeek's own bounds through
verbatim, and dayKey equality is exactly [startOfDay(d), startOfDay(d+1)).

endDay is derived by lastDayCovered, which steps back a day only when the
bound falls exactly on midnight — so .today does not claim tomorrow while
.thisWeek, ending at noon Saturday, still claims that Saturday.

Proven by two mutations: swapping in ChqTime.endOfDay, and swapping in the
minus-one-millisecond form that looks equivalent.

Adds windowStartDayKey/windowEndDayKey to FilterSelection. No persistence
change is needed: saveFilters builds a separate PersistedFilters that does
not carry them, which is the same reason searchText and extraDays are
already session-only."
```

---

## Task 4: Route `EventFilter` through the window and delete `extraDays`

**Files:**
- Modify: `ios/ChqCalendarShared/Domain/EventFilter.swift:29-85`
- Modify: `ios/ChqCalendarShared/Data/UserStateStore.swift` (remove `extraDays`)
- Modify: `ios/ChqCalendar/App/AppModel.swift:1032-1035, 1234-1236`
- Modify: `ios/ChqCalendar/Features/Calendar/EventListView.swift:180-184`

**Interfaces:**
- Consumes: `ViewWindow.make`, `ViewWindow.navigableBounds` from Task 3.
- Produces: `AppModel.expandWindowEnd()` replaces `AppModel.showNextDay()`.

- [ ] **Step 1: Write the failing test**

Append to `ios/ChqCalendarTests/ViewWindowTests.swift`:

```swift
struct EventFilterWindowTests {

    private static func at(_ s: String) throws -> Date {
        try #require(ChqTime.parse(s))
    }

    @Test func expandingTheWindowEndAddsThatDaysEvents() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        let today = makeEvent(id: "today", start: try Self.at("2026-07-15 18:00:00"))
        let tomorrow = makeEvent(id: "tomorrow", start: try Self.at("2026-07-16 18:00:00"))

        var sel = FilterSelection(dateScope: .today)
        let before = EventFilter.apply(
            sel, to: [today, tomorrow], favorites: [], now: now, year: 2026, isCurrentYear: true)
        #expect(before.map(\.id) == ["today"])

        sel.windowEndDayKey = "2026-07-16"
        let after = EventFilter.apply(
            sel, to: [today, tomorrow], favorites: [], now: now, year: 2026, isCurrentYear: true)
        #expect(after.map(\.id) == ["today", "tomorrow"])
    }

    @Test func expandingTheWindowStartAddsEarlierDays() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        let yesterday = makeEvent(id: "yesterday", start: try Self.at("2026-07-14 18:00:00"))
        let today = makeEvent(id: "today", start: try Self.at("2026-07-15 18:00:00"))

        var sel = FilterSelection(dateScope: .today)
        sel.windowStartDayKey = "2026-07-14"
        let result = EventFilter.apply(
            sel, to: [yesterday, today], favorites: [], now: now, year: 2026, isCurrentYear: true)
        #expect(result.map(\.id) == ["yesterday", "today"])
    }

    @Test func windowExpansionStillRespectsTheWeeksStage() throws {
        // The weeks stage is separate and ANDed. Phase 1 does not change that.
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let now = weeks[0].start.addingTimeInterval(3600)
        let inWeek1 = makeEvent(id: "w1", start: now.addingTimeInterval(600))
        let inWeek2 = makeEvent(id: "w2", start: weeks[1].start.addingTimeInterval(3600))

        var sel = FilterSelection(dateScope: .today, selectedWeeks: [1])
        sel.windowEndDayKey = ChqTime.dayKey(for: weeks[1].start.addingTimeInterval(3600))
        let result = EventFilter.apply(
            sel, to: [inWeek1, inWeek2], favorites: [], now: now, year: 2026, isCurrentYear: true)
        #expect(result.map(\.id) == ["w1"])
    }
}
```

- [ ] **Step 2: Run and verify it fails**

Run with `-only-testing:ChqCalendarTests/EventFilterWindowTests`.

Expected: FAIL on `expandingTheWindowEndAddsThatDaysEvents` and `expandingTheWindowStartAddsEarlierDays` — the fields exist but `EventFilter` ignores them.

- [ ] **Step 3: Replace the date `switch` with the window**

In `EventFilter.apply`, replace everything from `let weeks = SeasonCalendar.weeks(forYear: year)` through the end of the `switch scope { … }` block with:

```swift
        let weeks = SeasonCalendar.weeks(forYear: year)

        // The date stage. One half-open range check for every scope — the six
        // branches this replaced all reduce to this once the scope has been
        // turned into a window. A `nil` window means the scope matches
        // nothing, which only `.thisWeek` out of season can produce.
        let bounds = ViewWindow.navigableBounds(year: year, events: events, starredDays: [])
        guard let window = ViewWindow.make(
            selection: sel, events: events, now: now,
            year: year, isCurrentYear: isCurrentYear, bounds: bounds)
        else { return [] }
        result = result.filter { $0.start >= window.start && $0.start <= window.end }
```

`weeks` is still needed by the weeks stage below, so keep the binding. Everything from `if !sel.selectedWeeks.isEmpty` onward is unchanged.

- [ ] **Step 4: Delete `extraDays`**

1. In `UserStateStore.swift`, remove `var extraDays: Int = 0` from `FilterSelection` and its `init` parameter. Update the doc comment on the type: the session-only list becomes `searchText`, `selectedDayKey`, `windowStartDayKey`, `windowEndDayKey`.
2. In `AppModel.swift`, `clearScopeLocalDateState()` becomes:

```swift
    private func clearScopeLocalDateState() {
        filter.selectedDayKey = nil
        filter.windowStartDayKey = nil
        filter.windowEndDayKey = nil
    }
```

Update its doc comment: `extraDays` is gone, and the reason the window fields belong to the scope is the same one — a window widened under `.next` must not survive into `This Week` and back (#156).

3. Replace `showNextDay()` with:

```swift
    /// Widens the window by one calendar day from wherever it currently ends
    /// — the same operation whether that end came from the scope or from a
    /// previous widening.
    func expandWindowEnd() {
        let bounds = ViewWindow.navigableBounds(
            year: selectedYear, events: snapshot?.events ?? [], starredDays: [])
        guard
            let window = ViewWindow.make(
                selection: filter, events: snapshot?.events ?? [], now: now(),
                year: selectedYear, isCurrentYear: isCurrentYear, bounds: bounds),
            let next = ChqTime.day(window.endDay, offsetBy: 1),
            next <= bounds.upperBound
        else { return }
        filter.windowEndDayKey = next
    }
```

4. In `browseDay(_:)`, replace `filter.extraDays = 0` with the two window fields set to `nil`.

5. In `EventListView.swift`, change `model.showNextDay()` to `model.expandWindowEnd()`. **The button's label, placement, and condition are unchanged** — this is a call-site rename only, which is what keeps the screenshot opt-out honest.

- [ ] **Step 5: Run and verify they pass**

Run with `-only-testing:ChqCalendarTests/EventFilterWindowTests -only-testing:ChqCalendarTests/ViewWindowTests -only-testing:ChqCalendarTests/DateScopeExemptionTests`.

Expected: PASS, with the Task 1 characterization tests still unmodified.

- [ ] **Step 6: Run the FULL suite**

Run `xcodebuild test` with no `-only-testing` filter.

Expected: **every test passes.** `EventFilterTests`, `AppModelTests`, `FilterSelectionTests`, `UserStateStoreTests`, `DayPlanTests`, `MyDayModelTests` and `DayWindowTests` all exercise this area. Any test naming `extraDays` must be **translated** to the window fields, not deleted — find them first:

```bash
grep -rn "extraDays\|showNextDay" ios/ --include="*.swift"
```

Expected after the change: no matches outside your own translated tests.

- [ ] **Step 7: Commit**

```bash
git add ios/ChqCalendarShared/ ios/ChqCalendar/ ios/ChqCalendarTests/
git commit -m "refactor(ios): derive one date window instead of six branches

EventFilter's date stage was a six-branch switch over DateScope. All six
reduce to a single half-open range check once the scope is turned into a
ViewWindow.

extraDays is replaced by windowStartDayKey/windowEndDayKey. It was only ever
the window's end expressed as an offset meaningful under one scope, which is
why clearScopeLocalDateState existed to sweep it up on every scope change.
Day keys make the state impossible to misapply instead of merely tidied —
the #156 bug class closed by construction.

No user-visible behavior change: the Show next day button keeps its label,
placement and condition, and only its call site is renamed. The
characterization matrix passes untouched."
```

---

## Task 5: Verify parity with the web module

The two platforms now have parallel implementations of the same model. This task exists because they can drift silently — nothing compiles across the boundary.

**Files:**
- Create: `ios/ChqCalendarTests/WindowParityTests.swift`

**Interfaces:**
- Consumes: `ViewWindow` from Task 3.
- Produces: nothing.

- [ ] **Step 1: Write the parity tests**

Create `ios/ChqCalendarTests/WindowParityTests.swift`:

```swift
import Foundation
import Testing
@testable import ChqCalendar

/// Pins the facts iOS's `ViewWindow` shares with the web's `dayWindow.ts`.
/// Nothing compiles across that boundary, so the two can drift in silence —
/// these are the invariants a reader of either file is entitled to assume
/// hold on both. The web's mirror lives in
/// `frontend/src/__tests__/lib/utils/dayWindow.test.ts`.
struct WindowParityTests {

    @Test func dayKeysAreZeroPaddedAndSortChronologically() {
        let keys = ["2026-12-31", "2026-07-05", "2026-07-15"]
        #expect(keys.sorted() == ["2026-07-05", "2026-07-15", "2026-12-31"])
    }

    @Test func dayArithmeticCrossesMonthYearAndDstBoundaries() {
        #expect(ChqTime.day("2026-07-31", offsetBy: 1) == "2026-08-01")
        #expect(ChqTime.day("2026-08-01", offsetBy: -1) == "2026-07-31")
        #expect(ChqTime.day("2026-12-31", offsetBy: 1) == "2027-01-01")
        #expect(ChqTime.day("2026-01-01", offsetBy: -1) == "2025-12-31")
        // DST ends 2026-11-01, begins 2026-03-08 in America/New_York.
        #expect(ChqTime.day("2026-10-31", offsetBy: 1) == "2026-11-01")
        #expect(ChqTime.day("2026-11-01", offsetBy: 1) == "2026-11-02")
        #expect(ChqTime.day("2026-03-07", offsetBy: 1) == "2026-03-08")
        #expect(ChqTime.day("2026-03-08", offsetBy: 1) == "2026-03-09")
    }

    @Test func dayRangesAreInclusiveAndEmptyWhenInverted() {
        #expect(ChqTime.dayKeys(from: "2026-07-14", through: "2026-07-16")
            == ["2026-07-14", "2026-07-15", "2026-07-16"])
        #expect(ChqTime.dayKeys(from: "2026-07-14", through: "2026-07-14") == ["2026-07-14"])
        #expect(ChqTime.dayKeys(from: "2026-07-16", through: "2026-07-14") == [])
    }

    @Test func theSeasonIsNineWeeksOfNoonSaturdayBoundaries() {
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        #expect(weeks.count == 9)
        for i in 0..<(weeks.count - 1) {
            #expect(weeks[i].end == weeks[i + 1].start, "week \(i + 1) end must equal week \(i + 2) start")
        }
    }
}
```

- [ ] **Step 2: Run, then run the full suite**

Run with `-only-testing:ChqCalendarTests/WindowParityTests`, then the full suite with no filter.

Expected: PASS both times.

- [ ] **Step 3: Commit**

```bash
git add ios/ChqCalendarTests/WindowParityTests.swift
git commit -m "test(ios): pin the invariants shared with the web window module

Nothing compiles across the platform boundary, so the two ViewWindow
implementations can drift in silence. These pin what a reader of either
file is entitled to assume holds on both: zero-padded day keys that sort
chronologically, DST-safe day arithmetic, inclusive ranges that go empty
when inverted, and nine contiguous noon-Saturday weeks."
```

---

## Self-review

**Spec coverage.** `ViewWindow` derivation, `extraDays` deletion, session-only persistence, the `.day` exemption collapse, and DST-safe arithmetic all have tasks. Deliberately **out of scope for this phase**, per Global Constraints: the day rail and `⟳ Now` (phase 3), swipe (deferred), Siri routing and My Day unification (phase 4), and any scope-set change (phase 3 — iOS's scope set is already the target one, so iOS has nothing to change there).

**Type consistency.** `EffectiveScope.resolve` is defined in Task 2 with both overloads and called with those exact signatures in Tasks 2 and 3. `ViewWindow.make(selection:events:now:year:isCurrentYear:bounds:)` is defined in Task 3 and called with that signature in Tasks 3 and 4. `windowStartDayKey` / `windowEndDayKey` are added in Task 3 Step 2 and used in Tasks 3, 4.

**One deliberate sequencing choice.** The two `FilterSelection` fields are added in Task 3, not Task 4, so Task 3's tests compile and run on their own. Task 4 then only removes `extraDays` and updates the writers. Splitting it the other way would leave Task 3 unrunnable.

**Known divergence from Phase 1a, stated so a reader does not treat it as a bug.** The web's window covers the `dateFilter` stage only, because on the web `selectedWeeks` is a separate AND-ed stage. iOS is the same — `EventFilter` applies `selectedWeeks` outside the scope switch — so both platforms behave identically here, and both change in phase 3 when web adopts iOS's scope/weeks mutual exclusion.
