import Testing
@testable import ChqCalendar

struct ActiveFilterCountTests {
    @Test func defaultSelectionCountsZero() {
        #expect(ActiveFilterCount.value(for: FilterSelection()) == 0)
    }

    @Test func dateScopeAndWeeksNeverCount() {
        // Both have their own pill; counting them would double-report.
        #expect(ActiveFilterCount.value(
            for: FilterSelection(dateScope: .today)) == 0)
        #expect(ActiveFilterCount.value(
            for: FilterSelection(dateScope: .all, selectedWeeks: [1, 2, 3])) == 0)
    }

    @Test func eachVenueAndCategoryCountsOnce() {
        #expect(ActiveFilterCount.value(for: FilterSelection(
            selectedLocations: ["Amphitheater", "Norton Hall"])) == 2)
        #expect(ActiveFilterCount.value(for: FilterSelection(
            selectedCategories: ["Music"])) == 1)
    }

    @Test func favoritesOnlyCountsOne() {
        #expect(ActiveFilterCount.value(
            for: FilterSelection(showFavoritesOnly: true)) == 1)
    }

    @Test func searchTermCountsOnceRegardlessOfWordCount() {
        #expect(ActiveFilterCount.value(
            for: FilterSelection(searchText: "burns")) == 1)
        #expect(ActiveFilterCount.value(
            for: FilterSelection(searchText: "ken burns lecture")) == 1)
    }

    @Test func whitespaceOnlySearchDoesNotCount() {
        // Matches FilterSelection.hasNonDateFilters, which trims.
        #expect(ActiveFilterCount.value(for: FilterSelection(searchText: "   ")) == 0)
        #expect(ActiveFilterCount.value(for: FilterSelection(searchText: "\n\t")) == 0)
    }

    @Test func contributorsSum() {
        let selection = FilterSelection(
            searchText: "burns",
            dateScope: .all,
            selectedWeeks: [4, 5],
            selectedLocations: ["Amphitheater", "Norton Hall"],
            selectedCategories: ["Music"],
            showFavoritesOnly: true)
        // 1 search + 2 venues + 1 category + 1 favorites; weeks excluded.
        #expect(ActiveFilterCount.value(for: selection) == 5)
    }

    @Test func agreesWithHasNonDateFilters() {
        // The badge is visible exactly when the reset affordance would be.
        let cases = [
            FilterSelection(),
            FilterSelection(searchText: "x"),
            FilterSelection(searchText: "  "),
            FilterSelection(dateScope: .all, selectedWeeks: [2]),
            FilterSelection(selectedLocations: ["Amphitheater"]),
            FilterSelection(showFavoritesOnly: true),
        ]
        for selection in cases {
            #expect((ActiveFilterCount.value(for: selection) > 0) == selection.hasNonDateFilters)
        }
    }
}
