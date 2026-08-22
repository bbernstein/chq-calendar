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

    /// The positive branch for `.today` — its siblings `.next` and `.season`
    /// are pinned above and below, but nothing previously asserted that
    /// selecting `.today` itself reads the `.today` chip as selected.
    @Test func todayChipTracksScopeDirectlyWhenSelected() {
        #expect(FilterChipState.isScopeSelected(
            .today, selection: FilterSelection(dateScope: .today),
            currentWeek: 3, isCurrentYear: true))
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

    /// The bug: on a past season `FilterSheet.visibleScopes` collapses
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

    /// Not reachable through `FilterSheet` (its `visibleScopes` is
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

    // MARK: - .day scope

    @Test func dayScopeUnselectsTheAllChipOnAPastSeason() {
        // The subtle one. On a past season every *relative* scope is ignored
        // by the pipeline, which is why "All" lights up whenever no weeks
        // are selected. `.day` is exempt from that downgrade, so dates
        // really are being filtered — and "All" must not claim otherwise.
        #expect(!FilterChipState.isScopeSelected(
            .all,
            selection: FilterSelection(dateScope: .day, selectedDayKey: "2025-08-23"),
            currentWeek: nil,
            isCurrentYear: false))
    }

    @Test func allChipStaysSelectedOnAPastSeasonWithoutADayOrWeekFilter() {
        // Guards the fix above against over-reach: a persisted relative
        // scope still leaves "All" selected, since the pipeline ignores it.
        #expect(FilterChipState.isScopeSelected(
            .all,
            selection: FilterSelection(dateScope: .next),
            currentWeek: nil,
            isCurrentYear: false))
    }

    @Test func dayScopeUnselectsTheAllChipOnTheCurrentSeason() {
        #expect(!FilterChipState.isScopeSelected(
            .all,
            selection: FilterSelection(dateScope: .day, selectedDayKey: "2026-08-09"),
            currentWeek: 7,
            isCurrentYear: true))
    }

    // MARK: - .day scope with no key (Task 8 review, Important finding)

    @Test func dayScopeWithNoKeyLeavesTheAllChipLitOnTheCurrentSeason() {
        // `.day` with no key filters nothing (`EventFilter.apply`), so "All"
        // must stay lit even though `dateScope` isn't literally `.all`.
        #expect(FilterChipState.isScopeSelected(
            .all,
            selection: FilterSelection(dateScope: .day, selectedDayKey: nil),
            currentWeek: 7,
            isCurrentYear: true))
    }

    @Test func dayScopeWithNoKeyLeavesTheAllChipLitOnAPastSeason() {
        #expect(FilterChipState.isScopeSelected(
            .all,
            selection: FilterSelection(dateScope: .day, selectedDayKey: nil),
            currentWeek: nil,
            isCurrentYear: false))
    }

    @Test func dayScopeWithNoKeyButWeeksSelectedStillUnselectsTheAllChip() {
        // The weeks stage runs independently of the `.day` key, so a week
        // selection alongside a keyless `.day` still un-selects "All".
        #expect(!FilterChipState.isScopeSelected(
            .all,
            selection: FilterSelection(dateScope: .day, selectedWeeks: [3], selectedDayKey: nil),
            currentWeek: 7,
            isCurrentYear: true))
    }

    // MARK: - The `.day` chip itself (never rendered, answered per convention)

    @Test func dayChipTracksTheScopeDirectlyOnTheCurrentSeason() {
        #expect(FilterChipState.isScopeSelected(
            .day,
            selection: FilterSelection(dateScope: .day, selectedDayKey: "2026-08-09"),
            currentWeek: 7,
            isCurrentYear: true))
        #expect(!FilterChipState.isScopeSelected(
            .day,
            selection: FilterSelection(dateScope: .all),
            currentWeek: 7,
            isCurrentYear: true))
    }

    @Test func dayChipTracksTheScopeDirectlyOnAPastSeason() {
        #expect(FilterChipState.isScopeSelected(
            .day,
            selection: FilterSelection(dateScope: .day, selectedDayKey: "2025-08-23"),
            currentWeek: nil,
            isCurrentYear: false))
        #expect(!FilterChipState.isScopeSelected(
            .day,
            selection: FilterSelection(dateScope: .next),
            currentWeek: nil,
            isCurrentYear: false))
    }

    // MARK: - The `.day` chip agrees with `.all` on a keyless `.day` scope

    /// A keyless `.day` scope filters nothing, so the two chips must not
    /// contradict each other: "All" reports selected (asserted above by
    /// `dayScopeWithNoKeyLeavesTheAllChipLitOnTheCurrentSeason`) and `.day`
    /// must therefore report *not* selected, pinned here alongside it.
    @Test func dayChipAgreesWithAllChipWhenDayScopeHasNoKeyOnTheCurrentSeason() {
        let sel = FilterSelection(dateScope: .day, selectedDayKey: nil)
        #expect(!FilterChipState.isScopeSelected(
            .day, selection: sel, currentWeek: 7, isCurrentYear: true))
        #expect(FilterChipState.isScopeSelected(
            .all, selection: sel, currentWeek: 7, isCurrentYear: true))
    }

    /// Same agreement, off the current year, where `.day` is exempt from the
    /// relative-scope downgrade but a keyless key still filters nothing.
    @Test func dayChipAgreesWithAllChipWhenDayScopeHasNoKeyOnAPastSeason() {
        let sel = FilterSelection(dateScope: .day, selectedDayKey: nil)
        #expect(!FilterChipState.isScopeSelected(
            .day, selection: sel, currentWeek: nil, isCurrentYear: false))
        #expect(FilterChipState.isScopeSelected(
            .all, selection: sel, currentWeek: nil, isCurrentYear: false))
    }
}
