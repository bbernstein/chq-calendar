import Testing
@testable import ChqCalendar

struct FilterChipStateTests {
    @Test func thisWeekSelectedWhenScopeIsThisWeek() {
        let sel = FilterSelection(dateScope: .thisWeek)
        #expect(FilterChipState.isScopeSelected(
            .thisWeek, selection: sel, currentWeek: 6, isCurrentYear: true))
        #expect(FilterChipState.isWeekSelected(6, selection: sel, currentWeek: 6))
        #expect(!FilterChipState.isWeekSelected(5, selection: sel, currentWeek: 6))
    }

    @Test func thisWeekSelectedWhenOnlyCurrentWeekIsSelected() {
        let sel = FilterSelection(dateScope: .all, selectedWeeks: [6])
        #expect(FilterChipState.isScopeSelected(
            .thisWeek, selection: sel, currentWeek: 6, isCurrentYear: true))
    }

    @Test func thisWeekNotSelectedWhenCurrentWeekIsOneOfSeveral() {
        let sel = FilterSelection(dateScope: .all, selectedWeeks: [6, 7])
        #expect(!FilterChipState.isScopeSelected(
            .thisWeek, selection: sel, currentWeek: 6, isCurrentYear: true))
        #expect(FilterChipState.isWeekSelected(6, selection: sel, currentWeek: 6))
        #expect(FilterChipState.isWeekSelected(7, selection: sel, currentWeek: 6))
    }

    @Test func allSelectedOnlyWhenNoWeeksAreSelected() {
        #expect(FilterChipState.isScopeSelected(
            .all, selection: FilterSelection(dateScope: .all),
            currentWeek: 6, isCurrentYear: true))
        #expect(!FilterChipState.isScopeSelected(
            .all, selection: FilterSelection(dateScope: .all, selectedWeeks: [3]),
            currentWeek: 6, isCurrentYear: true))
    }

    @Test func nowAndTodayTrackScopeDirectly() {
        let sel = FilterSelection(dateScope: .next)
        #expect(FilterChipState.isScopeSelected(
            .next, selection: sel, currentWeek: 6, isCurrentYear: true))
        #expect(!FilterChipState.isScopeSelected(
            .today, selection: sel, currentWeek: 6, isCurrentYear: true))
    }

    @Test func seasonChipFollowsTheScope() {
        #expect(FilterChipState.isScopeSelected(
            .season, selection: FilterSelection(dateScope: .season),
            currentWeek: 6, isCurrentYear: true))
        #expect(!FilterChipState.isScopeSelected(
            .season, selection: FilterSelection(dateScope: .all),
            currentWeek: 6, isCurrentYear: true))
    }

    @Test func seasonChipNeverLightsOffTheCurrentYear() {
        #expect(!FilterChipState.isScopeSelected(
            .season, selection: FilterSelection(dateScope: .season),
            currentWeek: nil, isCurrentYear: false))
    }

    @Test func outOfSeasonNilCurrentWeekNeverCrossLightsChips() {
        #expect(!FilterChipState.isScopeSelected(
            .thisWeek, selection: FilterSelection(dateScope: .all, selectedWeeks: [6]),
            currentWeek: nil, isCurrentYear: true))
        #expect(!FilterChipState.isWeekSelected(
            6, selection: FilterSelection(dateScope: .thisWeek), currentWeek: nil))
    }

    // MARK: - Non-current year

    /// The bug: on a past season `DateFilterSheet.visibleScopes` collapses
    /// to the lone `.all` chip, but a persisted `.next` scope made
    /// `dateScope == .all` false — so the sheet's only date control rendered
    /// unchecked over a list `EventFilter` had left entirely unfiltered
    /// (it forces the scope to `.all` when `isCurrentYear` is false).
    @Test func allIsSelectedOnANonCurrentYearWhateverScopeIsPersisted() {
        for scope in [DateScope.next, .today, .thisWeek, .all] {
            #expect(FilterChipState.isScopeSelected(
                .all, selection: FilterSelection(dateScope: scope),
                currentWeek: nil, isCurrentYear: false),
                "a persisted \(scope) is ignored by the pipeline on a past season, so All is what's active")
        }
    }

    /// The half a prior ruling required: the weeks stage of `EventFilter`
    /// runs regardless of `isCurrentYear`, so weeks really are filtering a
    /// past season — and "All" must go dark, exactly as it does on the
    /// current year, rather than lighting up alongside the week chips.
    @Test func allIsNotSelectedOnANonCurrentYearWhenWeeksAreSelected() {
        let sel = FilterSelection(dateScope: .next, selectedWeeks: [4, 5])
        #expect(!FilterChipState.isScopeSelected(
            .all, selection: sel, currentWeek: nil, isCurrentYear: false))
        // ...and the week chips themselves stay lit, so the two agree.
        #expect(FilterChipState.isWeekSelected(4, selection: sel, currentWeek: nil))
        #expect(FilterChipState.isWeekSelected(5, selection: sel, currentWeek: nil))
        #expect(!FilterChipState.isWeekSelected(6, selection: sel, currentWeek: nil))
    }

    /// A single selected week is the same rule — pinned separately because
    /// it is the one a user actually reaches by tapping one week chip.
    @Test func allIsNotSelectedOnANonCurrentYearWithOneWeekSelected() {
        #expect(!FilterChipState.isScopeSelected(
            .all, selection: FilterSelection(dateScope: .all, selectedWeeks: [3]),
            currentWeek: nil, isCurrentYear: false))
    }

    /// Not reachable through `DateFilterSheet` (its `visibleScopes` is
    /// `[.all]` off the current year), but answered rather than left to the
    /// caller: the pipeline is ignoring these scopes, so no chip claiming
    /// one may light up — not even when the stored scope matches it.
    @Test func timeRelativeChipsNeverLightOnANonCurrentYear() {
        for scope in [DateScope.next, .today, .thisWeek] {
            #expect(!FilterChipState.isScopeSelected(
                scope, selection: FilterSelection(dateScope: scope),
                currentWeek: nil, isCurrentYear: false),
                "\(scope) must not claim to be active on a season with no now")
        }
        // Nor via the "only the current week is selected" equivalence, in
        // the hypothetical where a currentWeek is somehow supplied.
        #expect(!FilterChipState.isScopeSelected(
            .thisWeek, selection: FilterSelection(dateScope: .all, selectedWeeks: [6]),
            currentWeek: 6, isCurrentYear: false))
    }

    /// The pill and the chip must now tell the same story: both derive from
    /// `isCurrentYear`, so "All Year" on the pill and a selected "All" chip
    /// always appear together.
    @Test func chipAgreesWithTheDatePillOnANonCurrentYear() {
        let sel = FilterSelection(dateScope: .next)
        #expect(DateFilterLabel.text(for: sel, seasonWeekCount: 9, isCurrentYear: false) == "All Year")
        #expect(FilterChipState.isScopeSelected(
            .all, selection: sel, currentWeek: nil, isCurrentYear: false))

        let withWeeks = FilterSelection(dateScope: .next, selectedWeeks: [4, 5])
        #expect(DateFilterLabel.text(
            for: withWeeks, seasonWeekCount: 9, isCurrentYear: false) == "Weeks 4\u{2013}5")
        #expect(!FilterChipState.isScopeSelected(
            .all, selection: withWeeks, currentWeek: nil, isCurrentYear: false))
    }
}
