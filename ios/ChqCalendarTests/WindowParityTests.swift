import Foundation
import Testing
@testable import ChqCalendar

/// Pins the facts iOS's `ViewWindow` shares with the web's `dayWindow.ts`.
/// Nothing compiles across that boundary, so the two can drift in silence —
/// these are the invariants a reader of either file is entitled to assume
/// hold on both. The web's mirror lives in
/// `frontend/src/__tests__/lib/utils/dayWindow.test.ts`; each test below
/// names the web test it mirrors.
struct WindowParityTests {

    private static func at(_ s: String) throws -> Date {
        try #require(ChqTime.parse(s))
    }

    private func bounds() -> ClosedRange<String> {
        DayWindow.bounds(year: 2026, starredDays: [])
    }

    /// Mirrors "formats a date as a zero-padded local day key" +
    /// "sorts lexicographically in chronological order". Round-trips
    /// through `ChqTime.dayKey(for:)` itself rather than hand-typed
    /// strings — every hand-typed key is already zero-padded by
    /// construction, so a hand-typed-only test (the bug this replaces)
    /// cannot fail no matter what the formatter does.
    @Test func dayKeysAreZeroPaddedAndSortChronologically() throws {
        let jan5 = try Self.at("2026-01-05 08:00:00")
        let jul15 = try Self.at("2026-07-15 08:00:00")
        let dec31 = try Self.at("2026-12-31 08:00:00")

        #expect(ChqTime.dayKey(for: jan5) == "2026-01-05")
        #expect(ChqTime.dayKey(for: jul15) == "2026-07-15")

        let keys = [ChqTime.dayKey(for: dec31), ChqTime.dayKey(for: jan5), ChqTime.dayKey(for: jul15)]
        #expect(keys.sorted() == ["2026-01-05", "2026-07-15", "2026-12-31"])
    }

    /// Mirrors "crosses a DST transition without drifting".
    @Test func dayArithmeticCrossesMonthYearAndDstBoundaries() {
        #expect(ChqTime.day("2026-07-31", offsetBy: 1) == "2026-08-01")
        #expect(ChqTime.day("2026-08-01", offsetBy: -1) == "2026-07-31")
        #expect(ChqTime.day("2026-12-31", offsetBy: 1) == "2027-01-01")
        #expect(ChqTime.day("2026-01-01", offsetBy: -1) == "2025-12-31")
        // DST ends 2026-11-01, begins 2026-03-08 in America/New_York.
        #expect(ChqTime.day("2026-10-31", offsetBy: 1) == "2026-11-01")
        #expect(ChqTime.day("2026-11-01", offsetBy: 1) == "2026-11-02")
        #expect(ChqTime.day("2026-03-07", offsetBy: 1) == "2026-03-08")
        #expect(ChqTime.day("2026-03-08", offsetBy: 1) == "2026-03-09")
    }

    /// Mirrors "produces inclusive contiguous ranges" and "returns an empty
    /// range when the bounds are inverted".
    @Test func dayRangesAreInclusiveAndEmptyWhenInverted() {
        #expect(ChqTime.dayKeys(from: "2026-07-14", through: "2026-07-16")
            == ["2026-07-14", "2026-07-15", "2026-07-16"])
        #expect(ChqTime.dayKeys(from: "2026-07-14", through: "2026-07-14") == ["2026-07-14"])
        #expect(ChqTime.dayKeys(from: "2026-07-16", through: "2026-07-14") == [])
    }

    /// Mirrors "spans both boundary Saturdays" (noon-to-noon), extended to
    /// actually assert noon — the original wording claimed it without a
    /// clock-component check anywhere in the test.
    @Test func theSeasonIsNineWeeksOfNoonSaturdayBoundaries() {
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        #expect(weeks.count == 9)
        let calendar = ChqTime.calendar
        for week in weeks {
            #expect(
                calendar.component(.hour, from: week.start) == 12,
                "week \(week.number) start must be noon")
            #expect(
                calendar.component(.hour, from: week.end) == 12,
                "week \(week.number) end must be noon")
        }
        for i in 0..<(weeks.count - 1) {
            #expect(weeks[i].end == weeks[i + 1].start, "week \(i + 1) end must equal week \(i + 2) start")
        }
    }

    /// Mirrors `windowContains`'s "does not contain an instant exactly at
    /// endExclusive" — the half-openness the whole shared model exists to
    /// enforce, exercised here through the real `ViewWindow.make`, not a
    /// synthetic window.
    @Test func endExclusiveBelongsToTheNextWindowNotThisOne() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        let w = try #require(ViewWindow.make(
            selection: FilterSelection(dateScope: .today), events: [], now: now,
            year: 2026, isCurrentYear: true, bounds: bounds()))
        #expect(w.contains(w.start))
        #expect(!w.contains(w.endExclusive))
    }

    /// Mirrors `lastDayCovered`'s "names the last day shown, stepping back
    /// only on an exact midnight": a window ending at midnight does not show
    /// that day (`.today`), one ending mid-day does (`.thisWeek`'s noon
    /// Saturday).
    @Test func lastDayCoveredOnMidnightAndNoonBounds() throws {
        #expect(ViewWindow.lastDayCovered(try Self.at("2026-07-16 00:00:00")) == "2026-07-15")
        #expect(ViewWindow.lastDayCovered(try Self.at("2026-07-18 12:00:00")) == "2026-07-18")
    }

    /// Mirrors "ignores an expansion that would narrow the base window".
    @Test func anExpansionNarrowerThanTheBaseWindowIsIgnored() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        var sel = FilterSelection(dateScope: .today)
        sel.windowEndDayKey = "2026-07-10"
        let w = try #require(ViewWindow.make(
            selection: sel, events: [], now: now,
            year: 2026, isCurrentYear: true, bounds: bounds()))
        #expect(w.endDay == "2026-07-15")
    }
}
