import Foundation

/// Computes the option lists `WidgetConfigIntent`'s `DynamicOptionsProvider`s
/// offer for the venue/category pickers. Pure domain logic — no I/O, no
/// `WidgetKit` dependency — so it lives here (not in the widget target,
/// which has no test target) and stays unit-testable the same way
/// `WidgetTimelineBuilder` does. `WidgetDataSource` is the thin cache-read
/// wrapper that supplies `events:` from the App Group cache.
nonisolated enum WidgetConfigOptions {
    /// Distinct `displayLocation` values from `events`, most-frequent first
    /// (ties broken alphabetically), capped at `limit`. Events with a `nil`
    /// `displayLocation` are skipped.
    static func venueOptions(events: [Event], limit: Int = 30) -> [String] {
        rankedByFrequency(events.compactMap(\.displayLocation), limit: limit)
    }

    /// Distinct category names (excluding `"Week "` markers, matching
    /// `DisplayNames.visibleCategories`'s own filter) from `events`,
    /// most-frequent first, capped at `limit`.
    static func categoryOptions(events: [Event], limit: Int = 30) -> [String] {
        let names = events.flatMap { event in
            event.categoryNames.filter { !$0.hasPrefix("Week ") }
        }
        return rankedByFrequency(names, limit: limit)
    }

    /// Distinct values of `values`, most-frequent first, ties broken
    /// alphabetically for a stable order, capped at `limit`.
    private static func rankedByFrequency(_ values: [String], limit: Int) -> [String] {
        var counts: [String: Int] = [:]
        for value in values {
            counts[value, default: 0] += 1
        }
        return counts.keys
            .sorted { lhs, rhs in
                let (lc, rc) = (counts[lhs] ?? 0, counts[rhs] ?? 0)
                return lc != rc ? lc > rc : lhs < rhs
            }
            .prefix(limit)
            .map { $0 }
    }
}
