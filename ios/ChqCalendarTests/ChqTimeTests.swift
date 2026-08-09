import Foundation
import Testing
@testable import ChqCalendar

/// Pins the day-key arithmetic and chip/pill label formatters added for the
/// My Day date model (#192). The DST cases matter even though a Chautauqua
/// season never spans a transition: these are general-purpose helpers, and
/// arithmetic done by adding 86_400 seconds instead of a calendar day would
/// pass every in-season test and silently break anywhere else.
struct ChqTimeTests {
    // MARK: - day(_:offsetBy:)

    @Test func dayOffsetMovesForwardAndBackward() {
        #expect(ChqTime.day("2026-08-09", offsetBy: 1) == "2026-08-10")
        #expect(ChqTime.day("2026-08-09", offsetBy: -1) == "2026-08-08")
        #expect(ChqTime.day("2026-08-09", offsetBy: 0) == "2026-08-09")
    }

    @Test func dayOffsetCrossesMonthAndYearBoundaries() {
        #expect(ChqTime.day("2026-07-31", offsetBy: 1) == "2026-08-01")
        #expect(ChqTime.day("2026-01-01", offsetBy: -1) == "2025-12-31")
    }

    @Test func dayOffsetIsCorrectAcrossTheSpringForwardTransition() {
        // 2026-03-08 is the second Sunday of March: clocks jump 2am -> 3am,
        // so that NY day is only 23 hours long.
        #expect(ChqTime.day("2026-03-07", offsetBy: 1) == "2026-03-08")
        #expect(ChqTime.day("2026-03-08", offsetBy: 1) == "2026-03-09")
        #expect(ChqTime.day("2026-03-07", offsetBy: 2) == "2026-03-09")
    }

    @Test func dayOffsetIsCorrectAcrossTheFallBackTransition() {
        // 2026-11-01 is the first Sunday of November: that NY day is 25
        // hours long.
        #expect(ChqTime.day("2026-11-01", offsetBy: 1) == "2026-11-02")
        #expect(ChqTime.day("2026-10-31", offsetBy: 2) == "2026-11-02")
    }

    @Test func dayOffsetIsNilForAnUnparseableKey() {
        #expect(ChqTime.day("not-a-day", offsetBy: 1) == nil)
    }

    // MARK: - dayKeys(from:through:)

    @Test func dayKeysIsInclusiveOfBothEnds() {
        #expect(ChqTime.dayKeys(from: "2026-08-09", through: "2026-08-12")
            == ["2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12"])
    }

    @Test func dayKeysReturnsASingleDayWhenEndsMatch() {
        #expect(ChqTime.dayKeys(from: "2026-08-09", through: "2026-08-09") == ["2026-08-09"])
    }

    @Test func dayKeysIsEmptyWhenTheRangeIsInverted() {
        #expect(ChqTime.dayKeys(from: "2026-08-12", through: "2026-08-09").isEmpty)
    }

    @Test func dayKeysIsEmptyForAnUnparseableKey() {
        #expect(ChqTime.dayKeys(from: "nope", through: "2026-08-09").isEmpty)
        #expect(ChqTime.dayKeys(from: "2026-08-09", through: "nope").isEmpty)
    }

    @Test func dayKeysSpansTheFallBackTransitionWithoutRepeatingADay() {
        #expect(ChqTime.dayKeys(from: "2026-10-31", through: "2026-11-02")
            == ["2026-10-31", "2026-11-01", "2026-11-02"])
    }

    @Test func dayKeysCoversTheWhole2026Season() {
        // Season 2026 runs Sat Jun 27 through Sat Aug 29 inclusive.
        #expect(ChqTime.dayKeys(from: "2026-06-27", through: "2026-08-29").count == 64)
    }

    // MARK: - Labels

    @Test func weekdayAndMonthDayLabels() throws {
        let date = try #require(ChqTime.parse("2026-08-09 10:00:00"))
        #expect(ChqTime.weekdayLabel(for: date) == "Sun")
        #expect(ChqTime.monthDayLabel(for: date) == "Aug 9")
    }

    @Test func dayTitleAddsTheYearOnlyWhenAsked() throws {
        let date = try #require(ChqTime.parse("2025-08-23 10:00:00"))
        #expect(ChqTime.dayTitle(for: date, includingYear: false) == "Saturday, August 23")
        #expect(ChqTime.dayTitle(for: date, includingYear: true) == "Saturday, August 23, 2025")
    }

    @Test func dayTitleWithoutYearMatchesTheExistingOverload() throws {
        let date = try #require(ChqTime.parse("2026-08-09 10:00:00"))
        #expect(ChqTime.dayTitle(for: date, includingYear: false) == ChqTime.dayTitle(for: date))
    }

    @Test func pillDayLabelAddsTheYearOnlyWhenAsked() throws {
        let date = try #require(ChqTime.parse("2025-08-23 10:00:00"))
        #expect(ChqTime.pillDayLabel(for: date, includingYear: false) == "Sat, Aug 23")
        #expect(ChqTime.pillDayLabel(for: date, includingYear: true) == "Sat, Aug 23, 2025")
    }
}
