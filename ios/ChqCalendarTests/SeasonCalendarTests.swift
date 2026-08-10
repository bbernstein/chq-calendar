import Foundation
import Testing
@testable import ChqCalendar

struct SeasonCalendarTests {
    // MARK: - seasonStart / weeks(forYear:)

    @Test func week1Starts2026SaturdayBeforeFourthSundayOfJune() throws {
        let expected = try #require(ChqTime.parse("2026-06-27 12:00:00"))
        #expect(SeasonCalendar.seasonStart(year: 2026) == expected)

        let weeks = SeasonCalendar.weeks(forYear: 2026)
        #expect(weeks.first?.start == expected)
    }

    @Test func week1EndEqualsWeek2Start2026() throws {
        let expected = try #require(ChqTime.parse("2026-07-04 12:00:00"))
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        #expect(weeks.count == 9)
        #expect(weeks[0].end == expected)
        #expect(weeks[1].start == expected)
    }

    @Test func week9Ends2026() throws {
        let expected = try #require(ChqTime.parse("2026-08-29 12:00:00"))
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        #expect(weeks.last?.number == 9)
        #expect(weeks.last?.end == expected)
    }

    @Test func week1Starts2025SaturdayBeforeFourthSundayOfJune() throws {
        let expected = try #require(ChqTime.parse("2025-06-21 12:00:00"))
        #expect(SeasonCalendar.seasonStart(year: 2025) == expected)
    }

    // MARK: - currentWeekNumber(at:year:)

    @Test func currentWeekNumberNilBeforeSeasonStart() throws {
        let date = try #require(ChqTime.parse("2026-06-01 00:00:00"))
        #expect(SeasonCalendar.currentWeekNumber(at: date, year: 2026) == nil)
    }

    @Test func currentWeekNumberOneAtSeasonStart() throws {
        let date = try #require(ChqTime.parse("2026-06-27 12:00:00"))
        #expect(SeasonCalendar.currentWeekNumber(at: date, year: 2026) == 1)
    }

    @Test func currentWeekNumberOneJustBeforeWeek2Boundary() throws {
        let date = try #require(ChqTime.parse("2026-07-04 11:59:00"))
        #expect(SeasonCalendar.currentWeekNumber(at: date, year: 2026) == 1)
    }

    @Test func currentWeekNumberTwoAtWeek2Boundary() throws {
        let date = try #require(ChqTime.parse("2026-07-04 12:00:00"))
        #expect(SeasonCalendar.currentWeekNumber(at: date, year: 2026) == 2)
    }

    @Test func currentWeekNumberNilAtSeasonEnd() throws {
        let date = try #require(ChqTime.parse("2026-08-29 12:00:00"))
        #expect(SeasonCalendar.currentWeekNumber(at: date, year: 2026) == nil)
    }

    // MARK: - weekNumbers(spanningDayOf:year:)

    @Test func weekNumbersSpanningBoundarySaturdayReturnsBothWeeks() throws {
        let date = try #require(ChqTime.parse("2026-07-04 08:00:00"))
        #expect(SeasonCalendar.weekNumbers(spanningDayOf: date, year: 2026) == [1, 2])
    }

    @Test func weekNumbersSpanningMidweekDayReturnsSingleWeek() throws {
        let date = try #require(ChqTime.parse("2026-07-08 12:00:00"))
        #expect(SeasonCalendar.weekNumbers(spanningDayOf: date, year: 2026) == [2])
    }
}
