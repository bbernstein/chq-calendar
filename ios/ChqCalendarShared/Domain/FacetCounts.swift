import Foundation

/// How many events each venue and category would contribute, **given every
/// other filter currently active**.
///
/// Keys are lowercased on both sides: locations key on lowercased
/// `displayLocation`, categories on `filterTokens` (already lowercased) —
/// exactly what `EventFilter` compares against, so a name with a count here
/// is always a name `EventFilter` can match, and vice versa.
///
/// Each facet is counted against the selection **with its own dimension
/// removed**. This is the standard faceted-search rule and it is load-
/// bearing: counting venues with the venue selection applied would make
/// every unselected venue read 0 the moment one was picked, so the numbers
/// would prevent the multi-select they exist to inform.
///
/// Earlier versions counted the unfiltered snapshot once and never
/// recomputed, which is why Week 6 + Amphitheater could show a category
/// count of 1302 — the season-wide total (issue #152). Recomputing is two
/// `EventFilter.apply` passes per rebuild, so `AppModel` rebuilds only when
/// the selection, favorites, or loaded snapshot actually changes, never per
/// render.
nonisolated struct FacetCounts: Equatable, Sendable {
    let locations: [String: Int]
    let categories: [String: Int]

    static let empty = FacetCounts(locations: [:], categories: [:])

    static func build(
        events: [Event],
        selection: FilterSelection,
        favorites: Set<String>,
        now: Date,
        year: Int,
        isCurrentYear: Bool
    ) -> FacetCounts {
        func filtered(_ sel: FilterSelection) -> [Event] {
            EventFilter.apply(
                sel,
                to: events,
                favorites: favorites,
                now: now,
                year: year,
                isCurrentYear: isCurrentYear)
        }

        var withoutLocations = selection
        withoutLocations.selectedLocations = []
        var locations: [String: Int] = [:]
        for event in filtered(withoutLocations) {
            if let location = event.displayLocation?.lowercased() {
                locations[location, default: 0] += 1
            }
        }

        var withoutCategories = selection
        withoutCategories.selectedCategories = []
        var categories: [String: Int] = [:]
        for event in filtered(withoutCategories) {
            for token in event.filterTokens {
                categories[token, default: 0] += 1
            }
        }

        return FacetCounts(locations: locations, categories: categories)
    }
}
