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
