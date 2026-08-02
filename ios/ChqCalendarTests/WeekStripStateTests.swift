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
