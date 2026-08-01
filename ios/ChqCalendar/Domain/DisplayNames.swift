import Foundation

/// Maps full location/category names from the feed to the short forms used
/// in the UI (chips, filter pills, etc). Names with no shortcut pass
/// through unchanged.
nonisolated enum DisplayNames {
    private static let locationShortcuts: [String: String] = [
        "Elizabeth S. Lenna Hall": "Lenna Hall",
        "Smith Wilkes Hall": "Smith Wilkes",
    ]

    private static let categoryShortcuts: [String: String] = [
        "Chautauqua Symphony Orchestra/Classical Concerts": "CSO",
        "Chautauqua Institution Program": "CHQ Program",
        "Chautauqua Literary and Scientific Circle (CLSC)": "CLSC",
        "Climate Change Initiative Program": "Climate Change Program",
    ]

    static func location(_ full: String) -> String {
        locationShortcuts[full] ?? full
    }

    static func category(_ full: String) -> String {
        categoryShortcuts[full] ?? full
    }

    /// Distinct category names across `events`, excluding any that start
    /// with `"Week "` (those are season-week markers, not real filterable
    /// categories), sorted by their display (shortcut) name.
    static func visibleCategories(from events: [Event]) -> [String] {
        var seen: Set<String> = []
        var names: [String] = []
        for event in events {
            for name in event.categoryNames where !name.hasPrefix("Week ") {
                if seen.insert(name).inserted {
                    names.append(name)
                }
            }
        }
        return names.sorted { category($0) < category($1) }
    }

    /// Distinct `displayLocation` values across `events`, sorted by their
    /// display (shortcut) name.
    static func visibleLocations(from events: [Event]) -> [String] {
        var seen: Set<String> = []
        var names: [String] = []
        for event in events {
            guard let location = event.displayLocation else { continue }
            if seen.insert(location).inserted {
                names.append(location)
            }
        }
        return names.sorted { location($0) < location($1) }
    }
}
