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

    // MARK: - timeState(week:now:weeks:) — the pre-built-season overload

    /// The overload `WeekStripView` actually calls must agree with the
    /// convenience one for every week, or the strip would style differently
    /// than the rest of the app reasons about it.
    @Test func prebuiltSeasonOverloadAgreesWithTheYearOverload() throws {
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        for instant in ["2026-06-01 09:00:00", "2026-08-01 12:00:00",
                        "2026-08-03 12:00:00", "2026-09-15 09:00:00"] {
            let now = try #require(ChqTime.parse(instant))
            for week in 1...9 {
                #expect(
                    WeekStripState.timeState(week: week, now: now, weeks: weeks)
                        == WeekStripState.timeState(week: week, now: now, year: 2026),
                    "week \(week) at \(instant)")
            }
        }
    }

    @Test func prebuiltSeasonOverloadTreatsNilNowAsUpcoming() {
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        for week in 1...9 {
            #expect(WeekStripState.timeState(week: week, now: nil, weeks: weeks) == .upcoming)
        }
    }

    /// A week number with no entry in the supplied season is `.upcoming`
    /// rather than a crash — the view only ever passes 1...9, but the
    /// signature does not enforce it.
    @Test func prebuiltSeasonOverloadHandlesAWeekOutsideTheSeason() throws {
        let now = try #require(ChqTime.parse("2026-08-03 12:00:00"))
        #expect(WeekStripState.timeState(week: 99, now: now, weeks: SeasonCalendar.weeks(forYear: 2026)) == .upcoming)
        #expect(WeekStripState.timeState(week: 0, now: now, weeks: []) == .upcoming)
    }
}
