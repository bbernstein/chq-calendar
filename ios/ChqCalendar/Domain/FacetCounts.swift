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
/// 165" with a week filter already active yields far fewer than 165, and
/// the number does not change as other filters come and go.
///
/// This is the trade faceted search usually makes — recomputing every count
/// against the current selection costs a full pass per facet value on every
/// filter change — but note it is *not* inherited from the web app. The
/// web's `LocationFilter.tsx` / `CategoryFilter.tsx` show no per-chip counts
/// at all, so there is no upstream behaviour being matched here; these
/// counts are an iOS addition and this is an iOS decision. An earlier
/// version of this comment claimed web parity, which was incorrect.
///
/// Whether the counts should instead reflect the other active filters is
/// tracked as issue #152, deferred deliberately: it is a behaviour change
/// with a real cost, not a wording fix.
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
