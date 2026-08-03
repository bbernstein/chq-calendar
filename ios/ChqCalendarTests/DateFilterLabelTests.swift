import Testing
@testable import ChqCalendar

struct DateFilterLabelTests {
    private let nine = 9

    @Test func scopeOnlyLabels() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .next), seasonWeekCount: nine) == "Now")
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .today), seasonWeekCount: nine) == "Today")
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .thisWeek), seasonWeekCount: nine) == "This Week")
    }

    @Test func allScopeReadsAllDatesNotAll() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all), seasonWeekCount: nine) == "All Dates")
    }

    @Test func singleWeekIsSingular() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [6]),
            seasonWeekCount: nine) == "Week 6")
    }

    @Test func contiguousRunUsesEnDash() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [4, 5, 6]),
            seasonWeekCount: nine) == "Weeks 4\u{2013}6")
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [2, 3]),
            seasonWeekCount: nine) == "Weeks 2\u{2013}3")
    }

    @Test func scatteredUpToThreeAreListed() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [3, 6, 8]),
            seasonWeekCount: nine) == "Weeks 3, 6, 8")
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [1, 9]),
            seasonWeekCount: nine) == "Weeks 1, 9")
    }

    @Test func scatteredFourOrMoreCollapseToACount() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [1, 3, 5, 7]),
            seasonWeekCount: nine) == "4 Weeks")
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [1, 2, 3, 5, 9]),
            seasonWeekCount: nine) == "5 Weeks")
    }

    @Test func everyWeekReadsAllWeeks() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: Set(1...9)),
            seasonWeekCount: nine) == "All Weeks")
    }

    @Test func fullContiguousRunShorterThanTheSeasonIsStillARange() {
        // 1...8 of 9 is contiguous but not "all" — must not read "All Weeks".
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: Set(1...8)),
            seasonWeekCount: nine) == "Weeks 1\u{2013}8")
    }

    @Test func weeksWinOverScope() {
        // Both set is not reachable through AppModel today, but the label
        // must still be deterministic if it ever becomes reachable.
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .thisWeek, selectedWeeks: [2]),
            seasonWeekCount: nine) == "Week 2")
    }

    @Test func labelIsIndependentOfTheCurrentDate() {
        // Deliberate: no `currentWeek` parameter exists, so the same
        // selection can never render two different ways.
        let selection = FilterSelection(dateScope: .all, selectedWeeks: [6])
        #expect(DateFilterLabel.text(for: selection, seasonWeekCount: nine) == "Week 6")
        #expect(DateFilterLabel.text(for: selection, seasonWeekCount: 9) == "Week 6")
    }
}
