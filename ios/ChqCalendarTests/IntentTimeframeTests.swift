import Foundation
import Testing
@testable import ChqCalendar

/// Pins #193's timeframe vocabulary → NY-time interval resolution.
/// 2026 season: week 1 starts Sat 2026-06-27 12:00 NY; week 9 ends
/// Sat 2026-08-29 12:00 NY (per SeasonCalendarTests).
struct IntentTimeframeTests {
    private let year = 2026

    @Test func todayRunsFromNowToEndOfDay() throws {
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let interval = IntentTimeframe.today.interval(now: now, year: year)
        #expect(interval.start == now)
        #expect(interval.contains(try #require(ChqTime.parse("2026-07-15 23:00:00"))))
        #expect(!interval.contains(try #require(ChqTime.parse("2026-07-16 08:00:00"))))
    }

    @Test func tonightStartsAtFivePM() throws {
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let interval = IntentTimeframe.tonight.interval(now: now, year: year)
        #expect(interval.start == (try #require(ChqTime.parse("2026-07-15 17:00:00"))))
        #expect(interval.contains(try #require(ChqTime.parse("2026-07-15 20:15:00"))))
        #expect(!interval.contains(try #require(ChqTime.parse("2026-07-15 14:00:00"))))
    }

    @Test func tonightAfterFivePMStartsNow() throws {
        let now = try #require(ChqTime.parse("2026-07-15 19:00:00"))
        let interval = IntentTimeframe.tonight.interval(now: now, year: year)
        #expect(interval.start == now)
    }

    @Test func tomorrowCoversTheFullNextNYDay() throws {
        let now = try #require(ChqTime.parse("2026-07-15 22:00:00"))
        let interval = IntentTimeframe.tomorrow.interval(now: now, year: year)
        #expect(interval.contains(try #require(ChqTime.parse("2026-07-16 00:30:00"))))
        #expect(interval.contains(try #require(ChqTime.parse("2026-07-16 23:00:00"))))
        #expect(!interval.contains(now))
    }

    @Test func thisWeekEndsAtTheSeasonWeekBoundary() throws {
        // 2026-07-15 is inside week 3 (Jul 11 noon – Jul 18 noon).
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let interval = IntentTimeframe.thisWeek.interval(now: now, year: year)
        #expect(interval.start == now)
        #expect(interval.contains(try #require(ChqTime.parse("2026-07-17 20:00:00"))))
        #expect(!interval.contains(try #require(ChqTime.parse("2026-07-19 10:00:00"))))
    }

    @Test func nextWeekIsTheFollowingSeasonWeek() throws {
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let interval = IntentTimeframe.nextWeek.interval(now: now, year: year)
        // Week 4: Jul 18 noon – Jul 25 noon.
        #expect(interval.contains(try #require(ChqTime.parse("2026-07-20 10:00:00"))))
        #expect(!interval.contains(now))
    }

    @Test func nextWeekDuringWeekNineIsAnEmptyWindowAtSeasonEnd() throws {
        // 2026-08-26 is inside week 9 (Aug 22 noon – Aug 29 noon).
        let now = try #require(ChqTime.parse("2026-08-26 10:00:00"))
        let interval = IntentTimeframe.nextWeek.interval(now: now, year: 2026)
        let seasonEnd = SeasonCalendar.weeks(forYear: 2026)[8].end
        #expect(interval.start == seasonEnd)
        #expect(interval.end == seasonEnd)
        #expect(interval.duration == 0)
    }

    @Test func explicitWeekResolvesItsSeasonWeek() throws {
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let interval = IntentTimeframe.week7.interval(now: now, year: year)
        // Week 7: Aug 8 noon – Aug 15 noon.
        #expect(interval.contains(try #require(ChqTime.parse("2026-08-10 10:00:00"))))
        #expect(!interval.contains(now))
    }

    @Test func thisWeekOffSeasonFallsBackToSevenDays() throws {
        let now = try #require(ChqTime.parse("2026-10-01 10:00:00"))
        let interval = IntentTimeframe.thisWeek.interval(now: now, year: year)
        #expect(interval.start == now)
        #expect(interval.contains(try #require(ChqTime.parse("2026-10-05 10:00:00"))))
    }

    @Test func spokenLabelsReadNaturally() {
        #expect(IntentTimeframe.today.spokenLabel == "today")
        #expect(IntentTimeframe.thisWeek.spokenLabel == "this week")
        #expect(IntentTimeframe.week7.spokenLabel == "week 7")
    }

    @Test func seasonStatusDetectsPreInAndPost() throws {
        let before = try #require(ChqTime.parse("2026-05-01 10:00:00"))
        let during = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let after = try #require(ChqTime.parse("2026-09-15 10:00:00"))
        if case .preSeason(let start) = SeasonStatus.make(now: before, year: year) {
            #expect(start == SeasonCalendar.seasonStart(year: year))
        } else { Issue.record("expected preSeason") }
        #expect(SeasonStatus.make(now: during, year: year) == .inSeason)
        #expect(SeasonStatus.make(now: after, year: year) == .postSeason)
    }
}
