import Foundation

/// Decides which of a facet's values become chips, and in what order:
/// **selected → recently used → count-descending.**
///
/// Ordering is the feature. The feed carries 64 venues, so no flat list
/// fits and no fixed subset is right for everyone. Selected-first
/// guarantees a selection is never scrolled out of sight. Recents next
/// surface the values *this* user keeps picking — Lenna Hall ranks 21st of
/// 64 by count, so count-ordering alone can never reach it. Count-order
/// fills the rest.
///
/// Lives in `Domain/` and takes closures rather than the model so it stays
/// a pure function: `FacetChipCloud` renders it, but every rule here is
/// testable without SwiftUI.
nonisolated enum FacetChipOrder {
    /// One chip. `name` is always the **snapshot's** casing, never a
    /// stored recent's, because `DisplayNames` is an exact-match lookup.
    struct Entry: Equatable, Identifiable {
        let name: String
        let isRecent: Bool
        var id: String { name }
    }

    /// - Parameters:
    ///   - all: every value available in the current snapshot, in display order.
    ///   - isSelected: whether a value is in the current filter.
    ///   - recent: remembered values, most-recent-first, in whatever casing
    ///     was stored. Entries absent from `all` are dropped — that is what
    ///     stops a name remembered from another year rendering as a live
    ///     chip that matches nothing (#157).
    ///   - count: events a value would leave, given the rest of the selection.
    ///   - recentLimit: how many recents may show. Storage keeps more; the
    ///     surplus absorbs entries dropped by the `all` check.
    ///   - visibleLimit: soft cap. Selected values and surviving recents
    ///     always render; only the count-ordered tail is truncated.
    static func build(
        all: [String],
        isSelected: (String) -> Bool,
        recent: [String],
        count: (String) -> Int,
        recentLimit: Int = 5,
        visibleLimit: Int = 12
    ) -> [Entry] {
        let selected = all.filter(isSelected)

        // Resolve each stored recent to the snapshot's casing. `recents` is
        // never run through `normalizePersistedFilterCasing`, so the stored
        // value can differ; an unresolved name would render with raw feed
        // casing instead of its `DisplayNames` shortcut.
        let canonical = Dictionary(
            all.map { ($0.lowercased(), $0) },
            uniquingKeysWith: { first, _ in first })

        var seen = Set(selected.map { $0.lowercased() })
        var recents: [String] = []
        for name in recent {
            guard recents.count < recentLimit else { break }
            let key = name.lowercased()
            guard let resolved = canonical[key], !seen.contains(key) else { continue }
            seen.insert(key)
            recents.append(resolved)
        }

        let remaining = max(0, visibleLimit - selected.count - recents.count)
        let tail = all
            .filter { !seen.contains($0.lowercased()) }
            .sorted { count($0) > count($1) }
            .prefix(remaining)

        return selected.map { Entry(name: $0, isRecent: false) }
            + recents.map { Entry(name: $0, isRecent: true) }
            + tail.map { Entry(name: $0, isRecent: false) }
    }
}
