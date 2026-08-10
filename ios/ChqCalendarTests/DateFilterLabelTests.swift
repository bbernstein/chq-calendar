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

    @Test func allScopeReadsAllYear() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all),
            seasonWeekCount: nine, isCurrentYear: true) == "All Year")
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
    @Test func timeRelativeScopesCollapseToAllYearOnANonCurrentYear() {
        for scope in [DateScope.next, .today, .thisWeek] {
            #expect(DateFilterLabel.text(
                for: FilterSelection(dateScope: scope),
                seasonWeekCount: nine, isCurrentYear: false) == "All Year",
                "\(scope) must not claim a time-relative range on a past season")
        }
    }

    @Test func allScopeStillReadsAllYearOnANonCurrentYear() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .all),
            seasonWeekCount: nine, isCurrentYear: false) == "All Year")
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

    /// #197 item 5. `.day` is unlike the other scopes here: `EventFilter`
    /// applies it *and* the weeks stage, so a selection carrying both is
    /// day-filtered as well as week-filtered. Naming the week would describe
    /// the wider of the two ranges and overclaim what the list contains —
    /// and if the day falls outside the selected week the list is empty,
    /// which "Week 3" describes especially badly. The day is never wider
    /// than the week filter, so it is the label that cannot lie.
    ///
    /// `AppModel` no longer produces this pairing (`browseDay` clears weeks;
    /// `selectScope`/`setWeekSelection` clear the day), but this function is
    /// pure and shared, and the previous structure made the wrong answer the
    /// fall-through for any future caller that reintroduced the pairing.
    @Test func dayScopeWinsOverAWeekSelection() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .day, selectedWeeks: [6], selectedDayKey: "2026-08-09"),
            seasonWeekCount: nine, isCurrentYear: true) == "Sun, Aug 9")
    }

    /// The disjoint case, where the week label would be at its most
    /// misleading: 2026-08-09 is in week 6, not week 3.
    @Test func dayScopeWinsOverAWeekSelectionThatExcludesIt() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .day, selectedWeeks: [3], selectedDayKey: "2026-08-09"),
            seasonWeekCount: nine, isCurrentYear: true) == "Sun, Aug 9")
    }

    /// A `.day` scope with no key filters nothing (see `EventFilter.apply`),
    /// so the weeks are the only real filter left and must still be named.
    @Test func aKeylessDayScopeStillDefersToTheWeekLabel() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .day, selectedWeeks: [6]),
            seasonWeekCount: nine, isCurrentYear: true) == "Week 6")
    }

    @Test func seasonScopeReadsAllSeason() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .season),
            seasonWeekCount: nine, isCurrentYear: true) == "All Season")
    }

    @Test func offYearAlwaysReadsAllYearForEveryRelativeScope() {
        // Off the current year the pipeline ignores every *relative* scope,
        // so the pill must say so regardless of what is persisted.
        //
        // `.day` is excluded deliberately: it names an absolute date and is
        // exempt from that downgrade, so off-year it renders the date rather
        // than "All Year" — see `dayScopeCarriesTheYearForANonCurrentSeason`.
        // Left in the loop it would pass only by accident, because these
        // selections carry no `selectedDayKey`.
        for scope in DateScope.allCases where scope != .day {
            #expect(DateFilterLabel.text(
                for: FilterSelection(dateScope: scope),
                seasonWeekCount: nine, isCurrentYear: false) == "All Year")
        }
    }

    @Test func dayScopeRendersTheDateNotTheWord() {
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .day, selectedDayKey: "2026-08-09"),
            seasonWeekCount: nine, isCurrentYear: true) == "Sun, Aug 9")
    }

    @Test func dayScopeCarriesTheYearForANonCurrentSeason() {
        // The pill must not say "All Year" here. `.day` survives
        // EventFilter's non-current-year downgrade, so the list really is
        // filtered to one day and a pill claiming otherwise would be lying.
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .day, selectedDayKey: "2025-08-23"),
            seasonWeekCount: nine, isCurrentYear: false) == "Sat, Aug 23, 2025")
    }

    @Test func dayScopeWithoutADayKeyReadsAllYear() {
        // Nothing is actually being filtered, so "All Year" is true.
        #expect(DateFilterLabel.text(
            for: FilterSelection(dateScope: .day, selectedDayKey: nil),
            seasonWeekCount: nine, isCurrentYear: true) == "All Year")
    }

    // A former `weekSelectionStillWinsOverADayScope` pinned the opposite
    // answer for this same input ("Week 6"), on the descriptive grounds that
    // "the weeks branch runs first". #197 item 5 identified that ordering as
    // the bug rather than the contract; the flipped expectation now lives in
    // `dayScopeWinsOverAWeekSelection` above, alongside the disjoint-week
    // case that shows why the week label is the one that can lie.
}
