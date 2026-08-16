import Foundation
import Testing
@testable import ChqCalendar

/// Characterization tests for the `.day` / `isCurrentYear` exemption, which
/// today is duplicated across three types that must agree:
/// `EventFilter.apply`, `DateFilterLabel.text`, and
/// `FilterChipState.isScopeSelected`.
///
/// Written BEFORE the `EffectiveScope` refactor collapses them into one.
/// `FilterChipState` is the site where disagreement is a *silent* wrong
/// answer rather than a compile error, which is why the matrix below aims
/// to be exhaustive rather than illustrative.
///
/// It is not, in fact, exhaustive: the off-year `.thisWeek` scope combined
/// with `selectedWeeks == [currentWeek]` is a cell this matrix never
/// covers. That gap let a bug through the plan's own `FilterChipState`
/// code during this refactor; it was caught by
/// `FilterChipStateTests.swift`'s `timeRelativeChipsNeverLightOnANonCurrentYear`
/// (lines 126-129) instead, which is the guard actually covering that cell.
///
/// Do NOT edit these to make a later change pass. If one goes red, the
/// refactor is wrong.
struct DateScopeExemptionTests {

    private static let dayKey = "2026-07-15"

    private func selection(
        scope: DateScope, dayKey: String? = nil, weeks: Set<Int> = []
    ) -> FilterSelection {
        FilterSelection(dateScope: scope, selectedWeeks: weeks, selectedDayKey: dayKey)
    }

    // MARK: - EventFilter: which scope actually narrows the list

    @Test func dayScopeWithKeyFiltersOnAPastSeason() throws {
        // The exemption itself: `.day` names an absolute date, so it stays
        // in force even when `isCurrentYear` is false.
        let onDay = makeEvent(id: "on", start: try #require(ChqTime.parse("2026-07-15 10:00:00")))
        let offDay = makeEvent(id: "off", start: try #require(ChqTime.parse("2026-07-16 10:00:00")))
        let result = EventFilter.apply(
            selection(scope: .day, dayKey: Self.dayKey),
            to: [onDay, offDay],
            favorites: [],
            now: try #require(ChqTime.parse("2027-01-01 12:00:00")),
            year: 2026,
            isCurrentYear: false)
        #expect(result.map(\.id) == ["on"])
    }

    @Test func dayScopeWithoutKeyFiltersNothing() throws {
        let a = makeEvent(id: "a", start: try #require(ChqTime.parse("2026-07-15 10:00:00")))
        let b = makeEvent(id: "b", start: try #require(ChqTime.parse("2026-08-20 10:00:00")))
        let result = EventFilter.apply(
            selection(scope: .day, dayKey: nil),
            to: [a, b],
            favorites: [],
            now: try #require(ChqTime.parse("2026-07-15 12:00:00")),
            year: 2026,
            isCurrentYear: true)
        #expect(result.map(\.id) == ["a", "b"])
    }

    @Test func relativeScopesAreIgnoredOnAPastSeason() throws {
        // .next/.today/.thisWeek all downgrade to .all — a past season has
        // no "now".
        let far = makeEvent(id: "far", start: try #require(ChqTime.parse("2026-06-28 10:00:00")))
        let now = try #require(ChqTime.parse("2027-01-01 12:00:00"))
        for scope in [DateScope.next, .today, .thisWeek] {
            let result = EventFilter.apply(
                selection(scope: scope), to: [far], favorites: [],
                now: now, year: 2026, isCurrentYear: false)
            #expect(result.map(\.id) == ["far"], "scope \(scope) should not filter off-year")
        }
    }

    // Renamed from `seasonScopeStillFiltersOnAPastSeason`, which asserted
    // the opposite of what it said: the event OUTSIDE the season is what
    // survives the filter, because `.season` is downgraded (not exempt),
    // so nothing is being filtered on a past season at all. Rename only —
    // per this file's header, not a single assertion below has changed.
    @Test func seasonScopeIsDowngradedNotFilteredOnAPastSeason() throws {
        // .season is NOT relative to "now" either, but it is currently
        // downgraded anyway. Pinned so the refactor cannot quietly "fix" it.
        let outside = makeEvent(id: "outside", start: try #require(ChqTime.parse("2026-01-05 10:00:00")))
        let result = EventFilter.apply(
            selection(scope: .season), to: [outside], favorites: [],
            now: try #require(ChqTime.parse("2027-01-01 12:00:00")),
            year: 2026, isCurrentYear: false)
        #expect(result.map(\.id) == ["outside"], "season currently downgrades to all off-year")
    }

    @Test func weeksApplyRegardlessOfCurrentYear() throws {
        // The weeks stage sits OUTSIDE the scope switch, so it survives the
        // downgrade. Phase 1 must not change that.
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let inWeek1 = makeEvent(id: "w1", start: weeks[0].start.addingTimeInterval(3600))
        let inWeek5 = makeEvent(id: "w5", start: weeks[4].start.addingTimeInterval(3600))
        let result = EventFilter.apply(
            selection(scope: .next, weeks: [1]), to: [inWeek1, inWeek5], favorites: [],
            now: try #require(ChqTime.parse("2027-01-01 12:00:00")),
            year: 2026, isCurrentYear: false)
        #expect(result.map(\.id) == ["w1"])
    }

    // MARK: - DateFilterLabel

    @Test func labelNamesTheDayEvenOffYear() {
        let text = DateFilterLabel.text(
            for: selection(scope: .day, dayKey: Self.dayKey),
            seasonWeekCount: 9, isCurrentYear: false)
        #expect(text.contains("Jul") || text.contains("15"), "got \(text)")
    }

    @Test func labelSaysAllYearForAKeylessDay() {
        let text = DateFilterLabel.text(
            for: selection(scope: .day, dayKey: nil),
            seasonWeekCount: 9, isCurrentYear: true)
        #expect(text == "All Year")
    }

    @Test func labelSaysAllYearForRelativeScopesOffYear() {
        for scope in [DateScope.next, .today, .thisWeek, .season] {
            let text = DateFilterLabel.text(
                for: selection(scope: scope), seasonWeekCount: 9, isCurrentYear: false)
            #expect(text == "All Year", "scope \(scope) gave \(text)")
        }
    }

    @Test func labelPrefersTheDayOverAWeekSelection() {
        let text = DateFilterLabel.text(
            for: selection(scope: .day, dayKey: Self.dayKey, weeks: [3]),
            seasonWeekCount: 9, isCurrentYear: true)
        #expect(!text.contains("Week"), "got \(text)")
    }

    // MARK: - FilterChipState (silent-failure site)

    @Test func activeDayUnselectsAllOnBothYearAxes() {
        for isCurrentYear in [true, false] {
            let sel = selection(scope: .day, dayKey: Self.dayKey)
            #expect(
                FilterChipState.isScopeSelected(
                    .all, selection: sel, currentWeek: 3, isCurrentYear: isCurrentYear) == false,
                "All should be unselected with an active day, isCurrentYear=\(isCurrentYear)")
            #expect(
                FilterChipState.isScopeSelected(
                    .day, selection: sel, currentWeek: 3, isCurrentYear: isCurrentYear) == true)
        }
    }

    @Test func keylessDayReadsAsAllOnBothYearAxes() {
        for isCurrentYear in [true, false] {
            let sel = selection(scope: .day, dayKey: nil)
            #expect(
                FilterChipState.isScopeSelected(
                    .all, selection: sel, currentWeek: 3, isCurrentYear: isCurrentYear) == true,
                "isCurrentYear=\(isCurrentYear)")
            #expect(
                FilterChipState.isScopeSelected(
                    .day, selection: sel, currentWeek: 3, isCurrentYear: isCurrentYear) == false)
        }
    }

    @Test func offYearRelativeScopesNeverReadSelected() {
        for scope in [DateScope.next, .today, .thisWeek, .season] {
            #expect(
                FilterChipState.isScopeSelected(
                    scope, selection: selection(scope: scope),
                    currentWeek: 3, isCurrentYear: false) == false,
                "scope \(scope)")
        }
    }

    @Test func offYearAllIsSelectedOnlyWithoutWeeksOrDay() {
        #expect(FilterChipState.isScopeSelected(
            .all, selection: selection(scope: .next), currentWeek: 3, isCurrentYear: false) == true)
        #expect(FilterChipState.isScopeSelected(
            .all, selection: selection(scope: .next, weeks: [2]),
            currentWeek: 3, isCurrentYear: false) == false)
    }

    @Test func onlyCurrentWeekSelectedEqualsThisWeek() {
        #expect(FilterChipState.isScopeSelected(
            .thisWeek, selection: selection(scope: .all, weeks: [3]),
            currentWeek: 3, isCurrentYear: true) == true)
        #expect(FilterChipState.isScopeSelected(
            .thisWeek, selection: selection(scope: .all, weeks: [3, 4]),
            currentWeek: 3, isCurrentYear: true) == false)
    }
}
