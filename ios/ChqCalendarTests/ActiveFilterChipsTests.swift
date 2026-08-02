import Testing
@testable import ChqCalendar

struct ActiveFilterChipsTests {
    @Test func emptySelectionYieldsNoChips() {
        #expect(ActiveFilterChips.build(selection: FilterSelection()).isEmpty)
    }

    @Test func whitespaceOnlySearchYieldsNoChip() {
        var filter = FilterSelection()
        filter.searchText = "   "
        #expect(ActiveFilterChips.build(selection: filter).isEmpty)
    }

    @Test func orderIsSearchThenLocationsThenCategoriesThenFavorites() {
        var filter = FilterSelection()
        filter.searchText = "Burns"
        filter.selectedLocations = ["Amphitheater", "Norton Hall"]
        filter.selectedCategories = ["CSO"]
        filter.showFavoritesOnly = true

        let chips = ActiveFilterChips.build(selection: filter)

        #expect(chips.map(\.kind) == [
            .search,
            .location("Amphitheater"),
            .location("Norton Hall"),
            .category("CSO"),
            .favorites,
        ])
    }

    @Test func searchChipQuotesTheTrimmedTerm() {
        var filter = FilterSelection()
        filter.searchText = "  Burns  "
        #expect(ActiveFilterChips.build(selection: filter).first?.label == "\"Burns\"")
    }

    @Test func displayNameShortcutIsApplied() {
        var filter = FilterSelection()
        filter.selectedLocations = ["Elizabeth S. Lenna Hall"]
        filter.selectedCategories = ["Chautauqua Symphony Orchestra/Classical Concerts"]

        let chips = ActiveFilterChips.build(selection: filter)

        #expect(chips.map(\.label) == ["Lenna Hall", "CSO"])
    }

    @Test func namesWithoutAShortcutPassThroughUnchanged() {
        var filter = FilterSelection()
        filter.selectedLocations = ["Amphitheater"]
        #expect(ActiveFilterChips.build(selection: filter).first?.label == "Amphitheater")
    }

    @Test func chipIdsAreUnique() {
        var filter = FilterSelection()
        filter.searchText = "Burns"
        filter.selectedLocations = ["Amphitheater"]
        filter.selectedCategories = ["Amphitheater"]   // same string, different facet
        filter.showFavoritesOnly = true

        let ids = ActiveFilterChips.build(selection: filter).map(\.id)
        #expect(Set(ids).count == ids.count)
    }
}
