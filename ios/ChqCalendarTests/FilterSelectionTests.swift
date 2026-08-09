import Testing
import Foundation
@testable import ChqCalendar

struct FilterSelectionTests {
    @Test func defaultSelectionHasADateFilterButNoNonDateFilter() {
        // The default scope is `.next` ("Now"), which is a date filter.
        let filter = FilterSelection()
        #expect(filter.hasDateFilters)
        #expect(!filter.hasNonDateFilters)
        #expect(filter.hasFilters)
    }

    @Test func scopeAllWithNoWeeksHasNoDateFilter() {
        let filter = FilterSelection(dateScope: .all)
        #expect(!filter.hasDateFilters)
        #expect(!filter.hasFilters)
    }

    @Test func weeksCountAsADateFilter() {
        let filter = FilterSelection(dateScope: .all, selectedWeeks: [3])
        #expect(filter.hasDateFilters)
    }

    // MARK: - .day and isDayFilterActive

    @Test func dayScopeWithAKeyIsActiveAndCountsAsADateFilter() {
        let filter = FilterSelection(dateScope: .day, selectedDayKey: "2026-08-09")
        #expect(filter.isDayFilterActive)
        #expect(filter.hasDateFilters)
    }

    @Test func dayScopeWithNoKeyIsNotActiveAndHasNoDateFilter() {
        // The Important fix from Task 8 review: `.day` with no key names no
        // date, so `EventFilter` filters nothing — `hasDateFilters` must
        // agree, or the "N of M events" banner would show over an unfiltered
        // list (#192).
        let filter = FilterSelection(dateScope: .day, selectedDayKey: nil)
        #expect(!filter.isDayFilterActive)
        #expect(!filter.hasDateFilters)
    }

    @Test func dayScopeWithNoKeyButWeeksSelectedStillCountsAsADateFilter() {
        // A keyless `.day` isn't itself filtering, but a week selection
        // alongside it still is.
        let filter = FilterSelection(dateScope: .day, selectedWeeks: [3], selectedDayKey: nil)
        #expect(!filter.isDayFilterActive)
        #expect(filter.hasDateFilters)
    }

    @Test func nonDayScopeIsNeverDayFilterActive() {
        #expect(!FilterSelection(dateScope: .all).isDayFilterActive)
        #expect(!FilterSelection(dateScope: .next).isDayFilterActive)
    }

    @Test func whitespaceOnlySearchIsNotAFilter() {
        var filter = FilterSelection(dateScope: .all)
        filter.searchText = "   "
        #expect(!filter.hasNonDateFilters)
    }

    @Test func eachNonDateFacetCounts() {
        var search = FilterSelection(dateScope: .all)
        search.searchText = "Burns"
        #expect(search.hasNonDateFilters)

        var location = FilterSelection(dateScope: .all)
        location.selectedLocations = ["Amphitheater"]
        #expect(location.hasNonDateFilters)

        var category = FilterSelection(dateScope: .all)
        category.selectedCategories = ["CSO"]
        #expect(category.hasNonDateFilters)

        var favorites = FilterSelection(dateScope: .all)
        favorites.showFavoritesOnly = true
        #expect(favorites.hasNonDateFilters)
    }

    // MARK: - DateScope

    @Test func seasonScopeRawValueAndLabel() {
        #expect(DateScope.season.rawValue == "season")
        #expect(DateScope.season.label == "All Season")
    }

    @Test func allScopeLabelIsAllYear() {
        #expect(DateScope.all.label == "All Year")
    }

    @Test func legacyRawValuesStillDecode() throws {
        // Persisted selections predating this change must keep decoding.
        for (raw, expected): (String, DateScope) in
            [("next", .next), ("today", .today), ("this-week", .thisWeek), ("all", .all), ("season", .season)] {
            let decoded = try JSONDecoder().decode(DateScope.self, from: Data("\"\(raw)\"".utf8))
            #expect(decoded == expected)
        }
    }
}
