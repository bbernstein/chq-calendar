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
}
