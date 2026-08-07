import Foundation
import Testing
@testable import ChqCalendar

/// Pins `LandingState.determine`'s boundary cases against the exact dates
/// from issue #177: the `.next` scope's 90-day adaptive-window cap
/// (`EventFilter.adaptiveEndDate`) means the 2026 season (last event
/// 2026-09-10) goes empty in the default filter starting 2026-09-11, and the
/// app must describe that as `.postSeason` rather than showing nothing.
struct LandingStateTests {
    private let manifestYears = [2025, 2026, 2027]

    /// Pins the value used to build every `opening`/`daysUntil` expectation
    /// below, the same way `SeasonCalendarTests` pins `seasonStart(year:)`
    /// directly against a parsed date.
    @Test func seasonStart2027LandsSaturdayNoonNY() throws {
        let expected = try #require(ChqTime.parse("2027-06-26 12:00:00"))
        #expect(SeasonCalendar.seasonStart(year: 2027) == expected)
    }

    @Test func inSeasonWhenDefaultFilterStillHasManyUpcomingEvents() throws {
        let now = try #require(ChqTime.parse("2026-08-30 12:00:00"))
        let state = LandingState.determine(
            now: now, selectedYear: 2026, availableYears: manifestYears, upcomingDefaultCount: 14)
        #expect(state == .inSeason)
    }

    @Test func inSeasonWhenDefaultFilterHasExactlyOneUpcomingEvent() throws {
        let now = try #require(ChqTime.parse("2026-09-05 00:00:00"))
        let state = LandingState.determine(
            now: now, selectedYear: 2026, availableYears: manifestYears, upcomingDefaultCount: 1)
        #expect(state == .inSeason)
    }

    /// The exact day the adaptive window's 90-day cap first leaves the
    /// default filter with nothing: the 2026 feed's last event is
    /// 2026-09-10, so `upcomingDefaultCount` is 0 from 2026-09-11 on.
    @Test func postSeasonTheDayAfterTheLastEventsAdaptiveWindowExpires() throws {
        let now = try #require(ChqTime.parse("2026-09-11 00:00:00"))
        let opening = try #require(ChqTime.parse("2027-06-26 12:00:00"))
        let state = LandingState.determine(
            now: now, selectedYear: 2026, availableYears: manifestYears, upcomingDefaultCount: 0)
        #expect(state == .postSeason(endedSeasonYear: 2026, nextSeasonYear: 2027, opening: opening, daysUntil: 288))
    }

    /// `.postSeason` must keep holding months later, not flip to some other
    /// state just because a new calendar year has begun.
    @Test func postSeasonStillHoldsMonthsAfterTheSeasonEnded() throws {
        let now = try #require(ChqTime.parse("2027-01-15 00:00:00"))
        let opening = try #require(ChqTime.parse("2027-06-26 12:00:00"))
        let state = LandingState.determine(
            now: now, selectedYear: 2026, availableYears: manifestYears, upcomingDefaultCount: 0)
        #expect(state == .postSeason(endedSeasonYear: 2026, nextSeasonYear: 2027, opening: opening, daysUntil: 162))
    }

    /// Once the user (or `previewNextSeason()`) has moved `selectedYear`
    /// forward to the announced next season, and it's still before that
    /// season's own start, the state is `.preSeason` for *that* year — not
    /// `.postSeason` for the year that just ended.
    @Test func preSeasonWhenSelectedYearHasAdvancedToTheAnnouncedNextSeason() throws {
        let now = try #require(ChqTime.parse("2027-06-20 00:00:00"))
        let opening = try #require(ChqTime.parse("2027-06-26 12:00:00"))
        let state = LandingState.determine(
            now: now, selectedYear: 2027, availableYears: manifestYears, upcomingDefaultCount: 0)
        #expect(state == .preSeason(opening: opening, daysUntil: 6))
    }

    /// No later year in the manifest yet: `nextSeasonYear`/`opening`/
    /// `daysUntil` are all `nil` rather than guessing or crashing.
    @Test func postSeasonWithNoNextYearAnnouncedInManifest() throws {
        let now = try #require(ChqTime.parse("2026-09-11 00:00:00"))
        let state = LandingState.determine(
            now: now, selectedYear: 2026, availableYears: [2025, 2026], upcomingDefaultCount: 0)
        #expect(state == .postSeason(endedSeasonYear: 2026, nextSeasonYear: nil, opening: nil, daysUntil: nil))
    }

    /// `now` exactly at the season's start instant is in-season territory,
    /// not pre-season — `determine` only returns `.preSeason` for `now`
    /// strictly before `start`.
    @Test func exactlyAtSeasonStartIsNotPreSeason() throws {
        let start = try #require(ChqTime.parse("2026-06-27 12:00:00"))
        let state = LandingState.determine(
            now: start, selectedYear: 2026, availableYears: manifestYears, upcomingDefaultCount: 0)
        if case .preSeason = state {
            Issue.record("expected not-preSeason at the exact season start instant, got \(state)")
        }
    }

    // MARK: - isPostSeason

    @Test func isPostSeasonIsTrueOnlyForPostSeason() throws {
        let now = try #require(ChqTime.parse("2026-09-11 00:00:00"))
        let postSeason = LandingState.determine(
            now: now, selectedYear: 2026, availableYears: manifestYears, upcomingDefaultCount: 0)
        #expect(postSeason.isPostSeason)

        #expect(!LandingState.inSeason.isPostSeason)

        let preSeasonNow = try #require(ChqTime.parse("2026-05-01 00:00:00"))
        let preSeason = LandingState.determine(
            now: preSeasonNow, selectedYear: 2026, availableYears: manifestYears, upcomingDefaultCount: 0)
        #expect(!preSeason.isPostSeason)
    }
}
