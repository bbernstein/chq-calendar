import Foundation

/// How many filters the filter pill's badge reports.
///
/// Date scope and week selection are excluded: they are summarised by the
/// date pill sitting next to it, and counting them in both places would
/// double-report one decision.
///
/// Everything else is included, favorites-only especially. That inclusion
/// is why favorites moved off the bar and into the filter sheet — a single
/// number is only worth showing if it accounts for every filter that can
/// narrow the list, and a favorites toggle living outside the count would
/// make the badge quietly wrong.
///
/// The search term counts once however many words it has, and is trimmed
/// first so a whitespace-only term — which matches everything and produces
/// no chip — does not register. Both rules match
/// `FilterSelection.hasNonDateFilters`, and a test pins the two together.
nonisolated enum ActiveFilterCount {
    static func value(for selection: FilterSelection) -> Int {
        var count = selection.selectedLocations.count + selection.selectedCategories.count
        if !selection.searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            count += 1
        }
        if selection.showFavoritesOnly {
            count += 1
        }
        return count
    }
}
