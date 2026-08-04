import Testing
@testable import ChqCalendar

struct DateFilterLabelTests {
    private let nine = 9

    @Test func scopeOnlyLabels() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .next),
            seasonWeekCount: nine, isCurrentYear: true) == "Now")
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .today),
            seasonWeekCount: nine, isCurrentYear: true) == "Today")
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .thisWeek),
            seasonWeekCount: nine, isCurrentYear: true) == "This Week")
    }

    @Test func allScopeReadsAllDatesNotAll() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all),
            seasonWeekCount: nine, isCurrentYear: true) == "All Dates")
    }

    @Test func singleWeekIsSingular() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [6]),
            seasonWeekCount: nine, isCurrentYear: true) == "Week 6")
    }

    @Test func contiguousRunUsesEnDash() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [4, 5, 6]),
            seasonWeekCount: nine, isCurrentYear: true) == "Weeks 4\u{2013}6")
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [2, 3]),
            seasonWeekCount: nine, isCurrentYear: true) == "Weeks 2\u{2013}3")
    }

    @Test func scatteredUpToThreeAreListed() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [3, 6, 8]),
            seasonWeekCount: nine, isCurrentYear: true) == "Weeks 3, 6, 8")
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [1, 9]),
            seasonWeekCount: nine, isCurrentYear: true) == "Weeks 1, 9")
    }

    @Test func scatteredFourOrMoreCollapseToACount() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [1, 3, 5, 7]),
            seasonWeekCount: nine, isCurrentYear: true) == "4 Weeks")
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [1, 2, 3, 5, 9]),
            seasonWeekCount: nine, isCurrentYear: true) == "5 Weeks")
    }

    @Test func everyWeekReadsAllWeeks() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: Set(1...9)),
            seasonWeekCount: nine, isCurrentYear: true) == "All Weeks")
    }

    @Test func fullContiguousRunShorterThanTheSeasonIsStillARange() {
        // 1...8 of 9 is contiguous but not "all" — must not read "All Weeks".
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: Set(1...8)),
            seasonWeekCount: nine, isCurrentYear: true) == "Weeks 1\u{2013}8")
    }

    @Test func weeksWinOverScope() {
        // Both set is not reachable through AppModel today, but the label
        // must still be deterministic if it ever becomes reachable.
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .thisWeek, selectedWeeks: [2]),
            seasonWeekCount: nine, isCurrentYear: true) == "Week 2")
    }

    @Test func labelIsIndependentOfTheCurrentDate() {
        // Deliberate: no `currentWeek` parameter exists, so the same
        // selection can never render two different ways.
        let selection = FilterSelection(dateScope: .all, selectedWeeks: [6])
        #expect(DateFilterLabel.text(
            for: selection, seasonWeekCount: nine, isCurrentYear: true) == "Week 6")
        #expect(DateFilterLabel.text(
            for: selection, seasonWeekCount: 9, isCurrentYear: true) == "Week 6")
    }

    // MARK: - Non-current year

    /// `EventFilter.apply` forces every time-relative scope to `.all` when
    /// `isCurrentYear` is false, so the pill must say so. Before this, a
    /// persisted `.next` scope viewed against 2025 rendered "Now" over a
    /// list that was not date-filtered at all.
    @Test func timeRelativeScopesCollapseToAllDatesOnANonCurrentYear() {
        for scope in [DateScope.next, .today, .thisWeek] {
            #expect(DateFilterLabel.text(
                for: FilterSelection(dateScope: scope),
                seasonWeekCount: nine, isCurrentYear: false) == "All Dates",
                "\(scope) must not claim a time-relative range on a past season")
        }
    }

    @Test func allScopeStillReadsAllDatesOnANonCurrentYear() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all),
            seasonWeekCount: nine, isCurrentYear: false) == "All Dates")
    }

    /// `EventFilter` applies `selectedWeeks` regardless of `isCurrentYear`
    /// — the weeks stage sits outside the scope `switch` — so week labels
    /// stay literally true on a past season and must not be collapsed.
    @Test func weekLabelsSurviveOnANonCurrentYear() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [6]),
            seasonWeekCount: nine, isCurrentYear: false) == "Week 6")
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [4, 5, 6]),
            seasonWeekCount: nine, isCurrentYear: false) == "Weeks 4\u{2013}6")
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [3, 6, 8]),
            seasonWeekCount: nine, isCurrentYear: false) == "Weeks 3, 6, 8")
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: [1, 3, 5, 7]),
            seasonWeekCount: nine, isCurrentYear: false) == "4 Weeks")
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all, selectedWeeks: Set(1...9)),
            seasonWeekCount: nine, isCurrentYear: false) == "All Weeks")
    }

    /// A stranded time-relative scope alongside a week selection: the weeks
    /// are what `EventFilter` actually applies, so the week label is still
    /// the honest one even though the scope is being ignored.
    @Test func weeksStillWinOverAnIgnoredScopeOnANonCurrentYear() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .thisWeek, selectedWeeks: [2]),
            seasonWeekCount: nine, isCurrentYear: false) == "Week 2")
    }
}
