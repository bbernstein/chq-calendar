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

    // MARK: - targetDayKey

    /// The day a spoken timeframe should *land on* is the first day of the
    /// window it means — not the whole window. "This week" opens on today, not
    /// on Saturday: the reader asked what is happening, and the rail is right
    /// there for the rest of the week.
    @Test func targetDayKeyIsTheFirstDayOfTheInterval() throws {
        let now = try #require(ChqTime.parse("2026-07-27 09:00:00"))

        #expect(IntentTimeframe.today.targetDayKey(now: now, year: 2026) == "2026-07-27")
        #expect(IntentTimeframe.tonight.targetDayKey(now: now, year: 2026) == "2026-07-27")
        #expect(IntentTimeframe.tomorrow.targetDayKey(now: now, year: 2026) == "2026-07-28")
        #expect(IntentTimeframe.thisWeek.targetDayKey(now: now, year: 2026) == "2026-07-27")
    }

    /// `tonight` is 5pm-anchored, so asking at 9pm must still mean today —
    /// `interval` clamps its start to `now`, and the day key of either is the
    /// same day. Pinned because a naive "5pm tomorrow" rewrite would pass the
    /// morning case above and break this one.
    @Test func targetDayKeyForTonightAskedLateIsStillToday() throws {
        let now = try #require(ChqTime.parse("2026-07-27 21:30:00"))

        #expect(IntentTimeframe.tonight.targetDayKey(now: now, year: 2026) == "2026-07-27")
    }

    @Test func targetDayKeyForAnExplicitWeekIsThatWeeksFirstDay() throws {
        let now = try #require(ChqTime.parse("2026-07-27 09:00:00"))
        let week3 = SeasonCalendar.weeks(forYear: 2026)[2]

        #expect(IntentTimeframe.week3.targetDayKey(now: now, year: 2026)
                == ChqTime.dayKey(for: week3.start))
    }

    /// Week 9's "next week" is past the season: `interval` returns a
    /// zero-length window at the season's end. A day key still comes out —
    /// and it lands exactly on `weeks[8].end`'s day, which is the season's
    /// last day and therefore inside `ViewWindow.navigableBounds`, so
    /// `OpenDayIntent` navigates there rather than refusing (pinned in
    /// `OpenDayTargetTests.weekNineNextWeekNavigatesToTheSeasonsLastDay`).
    /// Landing on the last day is more useful than a refusal for a day that
    /// genuinely is reachable. Pinned here so a later "return nil when
    /// empty" refactor has to argue with a test rather than silently change
    /// what key comes out.
    @Test func targetDayKeyForNextWeekInWeekNineStillProducesAKey() throws {
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let inWeekNine = weeks[8].start.addingTimeInterval(3600)

        let key = IntentTimeframe.nextWeek.targetDayKey(now: inWeekNine, year: 2026)

        #expect(key == ChqTime.dayKey(for: weeks[8].end))
    }
}
