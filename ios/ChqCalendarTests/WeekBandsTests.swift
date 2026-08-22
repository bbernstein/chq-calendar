import Foundation
import Testing
@testable import ChqCalendar

/// 2026 season: week 1 is Sat Jun 27 12:00 -> Sat Jul 4 12:00, so Jun 27
/// opens week 1 and Jul 4 is the week 1 / week 2 boundary.
struct WeekBandsTests {
    private func segments(_ keys: [String]) -> [WeekBandSegment] {
        WeekBands.segments(dayKeys: keys, year: 2026)
    }

    @Test func aBoundarySaturdayBelongsToBothItsWeeks() {
        let result = segments(["2026-07-04"])
        #expect(result.count == 1)
        #expect(result[0].weekNumbers == [1, 2])
    }

    @Test func aMidweekDayBelongsToOneWeek() {
        let result = segments(["2026-06-30"])
        #expect(result[0].weekNumbers == [1])
    }

    @Test func theOpeningSaturdayBelongsOnlyToWeekOne() {
        // No previous week to share with.
        let result = segments(["2026-06-27"])
        #expect(result[0].weekNumbers == [1])
    }

    @Test func anOutOfSeasonDayHasNoWeek() {
        let result = segments(["2026-01-15"])
        #expect(result[0].weekNumbers.isEmpty)
        #expect(result[0].navigationTarget == nil)
        #expect(result[0].labelledWeek == nil)
    }

    @Test func aSharedSaturdayIsNotATapTarget() {
        // Ambiguous by construction: it opens one week and closes another,
        // so a tap on it cannot mean one week. The six non-shared days
        // carry the week's navigation instead.
        let result = segments(["2026-07-04"])
        #expect(result[0].navigationTarget == nil)
    }

    @Test func aNonSharedDayNavigatesToItsOwnWeek() {
        let result = segments(["2026-06-30"])
        #expect(result[0].navigationTarget == 1)
    }

    @Test func theOpeningSaturdayOfWeekOneIsATapTarget() {
        // Week 1's opening Saturday is shared with nothing, so unlike every
        // other Saturday it is unambiguous.
        let result = segments(["2026-06-27"])
        #expect(result[0].navigationTarget == 1)
    }

    @Test func exactlyOneDayPerWeekCarriesTheLabel() {
        let keys = ChqTime.dayKeys(from: "2026-06-27", through: "2026-07-11")
        let result = segments(keys)
        let labelledForWeekOne = result.filter { $0.labelledWeek == 1 }
        let labelledForWeekTwo = result.filter { $0.labelledWeek == 2 }
        #expect(labelledForWeekOne.count == 1)
        #expect(labelledForWeekTwo.count == 1)
    }

    @Test func theLabelNeverLandsOnASharedSaturday() {
        let keys = ChqTime.dayKeys(from: "2026-06-27", through: "2026-08-29")
        for segment in segments(keys) where segment.labelledWeek != nil {
            #expect(segment.weekNumbers.count == 1)
        }
    }

    @Test func theLabelFollowsTheVisibleRunWhenAWeekIsClipped() {
        // The rail spans navigableBounds, which can start mid-week. The
        // label must land inside what is actually rendered, not at a fixed
        // offset from a week start that may not be on screen at all.
        let keys = ChqTime.dayKeys(from: "2026-07-01", through: "2026-07-03")
        let result = segments(keys)
        let labelled = result.filter { $0.labelledWeek == 1 }
        #expect(labelled.count == 1)
        #expect(keys.contains(labelled[0].dayKey))
        // A fixed "first index" placement would also pass the assertions
        // above (index 0 is inside the visible run) without actually
        // proving the label follows the visible run. With a 3-day run,
        // pin it away from both ends so a naive "always index 0" (or
        // "always last") implementation is caught.
        #expect(labelled[0].dayKey != keys.first)
        #expect(labelled[0].dayKey != keys.last)
    }

    @Test func rampRunsZeroToOneAcrossTheSeason() {
        let first = segments(["2026-06-29"])[0]   // week 1
        #expect(first.rampSteps == [0.0])

        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let lastWeek = weeks[weeks.count - 1]
        let midLastWeek = lastWeek.start.addingTimeInterval(2 * 24 * 60 * 60)
        let last = segments([ChqTime.dayKey(for: midLastWeek)])[0]
        #expect(last.rampSteps == [1.0])
    }

    @Test func aSharedSaturdayCarriesBothRampSteps() {
        let result = segments(["2026-07-04"])
        #expect(result[0].rampSteps.count == 2)
        #expect(result[0].rampSteps[0] < result[0].rampSteps[1])
    }

    @Test func openingDayKeyIsTheSaturdayThatStartsTheWeek() {
        #expect(WeekBands.openingDayKey(ofWeek: 1, year: 2026) == "2026-06-27")
        #expect(WeekBands.openingDayKey(ofWeek: 2, year: 2026) == "2026-07-04")
    }

    @Test func openingDayKeyRefusesAWeekOutsideTheSeason() {
        #expect(WeekBands.openingDayKey(ofWeek: 0, year: 2026) == nil)
        #expect(WeekBands.openingDayKey(ofWeek: 10, year: 2026) == nil)
    }
}
