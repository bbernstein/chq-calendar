import Foundation
import Testing
@testable import ChqCalendar

/// Pins #193's theme-week vocabulary → season week number resolution.
struct ThemeWeekTests {
    private let year = 2026

    @Test func thisWeekResolvesTheCurrentSeasonWeek() throws {
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00")) // week 3
        #expect(ThemeWeek.thisWeek.weekNumber(now: now, year: year) == 3)
    }

    @Test func nextWeekResolvesTheFollowingWeekAndCapsAtNine() throws {
        let midSeason = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        #expect(ThemeWeek.nextWeek.weekNumber(now: midSeason, year: year) == 4)
        let weekNine = try #require(ChqTime.parse("2026-08-26 10:00:00"))
        #expect(ThemeWeek.nextWeek.weekNumber(now: weekNine, year: year) == nil)
    }

    @Test func relativeWeeksAreNilOffSeason() throws {
        let october = try #require(ChqTime.parse("2026-10-01 10:00:00"))
        #expect(ThemeWeek.thisWeek.weekNumber(now: october, year: year) == nil)
        #expect(ThemeWeek.nextWeek.weekNumber(now: october, year: year) == nil)
    }

    @Test func explicitWeeksAlwaysResolve() throws {
        let october = try #require(ChqTime.parse("2026-10-01 10:00:00"))
        #expect(ThemeWeek.week7.weekNumber(now: october, year: year) == 7)
    }
}
