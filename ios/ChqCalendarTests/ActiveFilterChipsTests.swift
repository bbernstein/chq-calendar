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

    // MARK: - what `FilterSheet` gates its active/reset section on

    @Test func theDefaultSelectionHasFiltersButProducesNoChips() {
        // The reason the reset row cannot be gated on `hasFilters`: a fresh
        // install's `.next` scope *is* a date filter, but date and week are
        // deliberately absent from the chip list (their own controls sit
        // directly above it). Gating on `hasFilters` renders a solitary
        // "Clear all" under two empty facet rows, permanently.
        let fresh = FilterSelection()
        #expect(fresh.hasFilters)
        #expect(fresh.hasNonDateFilters == false)
        #expect(ActiveFilterChips.build(selection: fresh).isEmpty)
    }

    @Test func hasNonDateFiltersIsExactlyWhetherAnyChipIsProduced() {
        // `FilterSheet` gates its active section and "Clear All" on there
        // being chips at all, which is exactly `hasNonDateFilters`; with no
        // chips the section and the button are orphans. The web writes the same guard as `hasFilters &&
        // chips.length > 0`. Pinned across every field either predicate
        // reads, so the two cannot drift apart.
        var selections: [FilterSelection] = [
            FilterSelection(),
            FilterSelection(dateScope: .all),
            FilterSelection(selectedWeeks: [6]),
            FilterSelection(searchText: "Burns"),
            FilterSelection(searchText: "   "),
            FilterSelection(selectedLocations: ["Amphitheater"]),
            FilterSelection(selectedCategories: ["CSO"]),
            FilterSelection(showFavoritesOnly: true),
        ]
        selections.append(
            FilterSelection(
                searchText: "Burns", dateScope: .all, selectedWeeks: [6],
                selectedLocations: ["Amphitheater"], selectedCategories: ["CSO"],
                showFavoritesOnly: true))

        for selection in selections {
            let hasChips = !ActiveFilterChips.build(selection: selection).isEmpty
            #expect(selection.hasNonDateFilters == hasChips)
        }
    }

    // MARK: - VoiceOver

    @Test func onlyTheSearchChipCarriesAKindPrefix() {
        // `"Burns"` read on its own says nothing about which of the four
        // filter kinds is about to be removed; every other chip's label is
        // already the name of the thing. Mirrors the web's `FilterChip`,
        // which prefixes exactly this one kind.
        var filter = FilterSelection()
        filter.searchText = "Burns"
        filter.selectedLocations = ["Amphitheater"]
        filter.showFavoritesOnly = true

        let labels = ActiveFilterChips.build(selection: filter).map(\.accessibilityLabel)
        #expect(labels == [
            "Remove filter Search: \"Burns\"",
            "Remove filter Amphitheater",
            "Remove filter Favorites",
        ])
    }
}
