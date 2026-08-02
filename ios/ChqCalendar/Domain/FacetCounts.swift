import Foundation

/// How many events in the unfiltered snapshot each venue and category
/// matches, for the counts shown beside names in the expanded facet panels.
///
/// Keys are lowercased on both sides: locations key on lowercased
/// `displayLocation`, categories on `filterTokens` (already lowercased) —
/// exactly what `EventFilter` compares against, so a name that has a count
/// here is always a name `EventFilter` can match, and vice versa.
///
/// The counts themselves are of the *unfiltered* snapshot, so they are a
/// measure of the season rather than a prediction: tapping "Amphitheater
/// 165" with a week filter already active yields far fewer than 165. That
/// matches the web, and is the same trade every faceted search makes —
/// recomputing every count against the current selection on every keystroke
/// costs a full pass per facet value.
nonisolated struct FacetCounts: Equatable, Sendable {
    let locations: [String: Int]
    let categories: [String: Int]

    static let empty = FacetCounts(locations: [:], categories: [:])

    /// One pass over `events` for both facets.
    static func build(from events: [Event]) -> FacetCounts {
        var locations: [String: Int] = [:]
        var categories: [String: Int] = [:]
        for event in events {
            for token in event.filterTokens {
                categories[token, default: 0] += 1
            }
            if let location = event.displayLocation?.lowercased() {
                locations[location, default: 0] += 1
            }
        }
        return FacetCounts(locations: locations, categories: categories)
    }
}
