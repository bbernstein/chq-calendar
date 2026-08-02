import Testing
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
}
