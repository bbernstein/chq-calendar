import Foundation

/// Whether a day rail tap's pending scroll is still owed, or has gone stale.
///
/// `EventListView.landPendingScroll` waits for a tapped day to mount before
/// scrolling to it — `DayRailNavigation.shouldAbandonScroll` already ends
/// that wait once the window covers the target and it still has no section
/// (an ordinary empty day). What that check cannot see is a *scope* change:
/// `clearScopeLocalDateState()` (fired by `selectScope`/`setWeekSelection`/
/// `browseDay`) can move the window away from the target without ever
/// covering it, so `days.contains` stays false and `shouldAbandonScroll`
/// stays false too — the target survives, armed, until the window later
/// grows back across that day by some unrelated route (auto-expand, another
/// tap) and `landPendingScroll` fires, teleporting the reader to a day they
/// tapped under a scope they left minutes ago.
///
/// The fix is the same shape as phase 2's lesson: derive staleness from a
/// stamped key, don't try to synchronize it in an effect. `Key` captures
/// everything about the filter *except* the window-expansion fields
/// (`windowStartDayKey`/`windowEndDayKey`) — those are exactly what growing
/// toward the target is expected to change, so they must never make a
/// pending scroll stale. Everything else changing — scope, weeks, the named
/// day, search text, venues, categories, favorites-only, or the selected
/// year — means the reader has left the context the tap was made under.
nonisolated enum PendingDayScroll {
    /// Everything a pending target must still match to be honored. Two
    /// `FilterSelection`s that differ only in `windowStartDayKey`/
    /// `windowEndDayKey` produce the same `Key` — that's the whole point.
    struct Key: Equatable, Sendable {
        let searchText: String
        let dateScope: DateScope
        let selectedWeeks: Set<Int>
        let selectedDayKey: String?
        let selectedLocations: [String]
        let selectedCategories: [String]
        let showFavoritesOnly: Bool
        let year: Int
    }

    /// A day the reader tapped, stamped with the filter identity it was
    /// tapped under.
    struct Target: Equatable, Sendable {
        let day: String
        let key: Key
    }

    static func key(for selection: FilterSelection, year: Int) -> Key {
        Key(
            searchText: selection.searchText,
            dateScope: selection.dateScope,
            selectedWeeks: selection.selectedWeeks,
            selectedDayKey: selection.selectedDayKey,
            selectedLocations: selection.selectedLocations,
            selectedCategories: selection.selectedCategories,
            showFavoritesOnly: selection.showFavoritesOnly,
            year: year)
    }

    /// Whether `target` — armed under `target.key` — should be dropped
    /// without landing because the current filter identity no longer
    /// matches. A pure window expansion (the whole reason `target` is
    /// waiting in the first place) must never trip this, which is exactly
    /// what excluding the window fields from `Key` guarantees.
    static func isStale(_ target: Target, currentKey: Key) -> Bool {
        target.key != currentKey
    }
}
