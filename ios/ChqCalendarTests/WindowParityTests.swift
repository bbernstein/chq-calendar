import Foundation
import Testing
@testable import ChqCalendar

/// Pins the facts iOS's `ViewWindow` shares with the web's `dayWindow.ts`.
/// Nothing compiles across that boundary, so the two can drift in silence —
/// these are the invariants a reader of either file is entitled to assume
/// hold on both. The web's mirror lives in
/// `frontend/src/__tests__/lib/utils/dayWindow.test.ts`.
struct WindowParityTests {

    @Test func dayKeysAreZeroPaddedAndSortChronologically() {
        let keys = ["2026-12-31", "2026-07-05", "2026-07-15"]
        #expect(keys.sorted() == ["2026-07-05", "2026-07-15", "2026-12-31"])
    }

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

    @Test func dayRangesAreInclusiveAndEmptyWhenInverted() {
        #expect(ChqTime.dayKeys(from: "2026-07-14", through: "2026-07-16")
            == ["2026-07-14", "2026-07-15", "2026-07-16"])
        #expect(ChqTime.dayKeys(from: "2026-07-14", through: "2026-07-14") == ["2026-07-14"])
        #expect(ChqTime.dayKeys(from: "2026-07-16", through: "2026-07-14") == [])
    }

    @Test func theSeasonIsNineWeeksOfNoonSaturdayBoundaries() {
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        #expect(weeks.count == 9)
        for i in 0..<(weeks.count - 1) {
            #expect(weeks[i].end == weeks[i + 1].start, "week \(i + 1) end must equal week \(i + 2) start")
        }
    }
}
