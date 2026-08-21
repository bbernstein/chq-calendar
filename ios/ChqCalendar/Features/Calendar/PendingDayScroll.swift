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

    /// Whether a `scrollTo` that has *just been issued* for `day` may be
    /// treated as done, or has to be issued again.
    ///
    /// Issuing a scroll is not the same as landing one. `ScrollViewProxy`
    /// resolves an id against the scroll view's already-resolved content, and
    /// the caller's `days` is whatever array its enclosing render captured —
    /// on a cold launch consuming a `chqcal://day/…` link, neither is
    /// reliably the current truth at the instant the link is consumed. Rather
    /// than reason about which, `EventListView.resolvePendingScroll` confirms
    /// the outcome: `visibleDays` — the set it already maintains from section
    /// header `onAppear`/`onDisappear` — containing the target is direct
    /// evidence the day is on screen. Until it does, the scroll is still owed
    /// and gets re-issued against the next render's `days`.
    ///
    /// `retryDeadline` bounds that. A target that can never become visible —
    /// an empty day with no section, or a list that unmounts — stops being
    /// re-issued rather than retrying forever, which is the hazard the
    /// staleness check above exists to prevent in the first place. `nil` (no
    /// deadline stamped) means "do not retry", the behavior before this
    /// existed.
    ///
    /// `EventListView.resolvePendingScroll` — the only caller — takes its
    /// deadline from `retryDeadline(existing:now:window:)` below, whose
    /// return type is non-optional, so in practice this function never sees
    /// `nil` while a target is genuinely still being retried. The `nil`
    /// branch is a conservative fallback for a caller that has not stamped
    /// yet, not a state the live path visits.
    static func hasLanded(
        day: String, visibleDays: Set<String>, retryDeadline: Date?, now: Date
    ) -> Bool {
        if visibleDays.contains(day) { return true }
        guard let retryDeadline else { return true }
        return now >= retryDeadline
    }

    /// The retry deadline governing an attempt happening at `now`: whatever
    /// was already stamped for this target, or a fresh `window` if this is
    /// its first attempt.
    ///
    /// **Non-optional by return type, on purpose.** `hasLanded` above reads a
    /// `nil` deadline as "done, do not retry", so a target arriving at its
    /// first attempt with nothing stamped would be abandoned before a single
    /// `scrollTo` could land. Routing every attempt through here makes "an
    /// attempt always has a deadline" a property of the type rather than of
    /// the caller remembering to stamp in the right order.
    ///
    /// **`existing` wins, on purpose.** The window is measured from the first
    /// attempt and then stops moving. Re-stamping on every attempt would push
    /// the deadline out by one interval each time and the target would retry
    /// forever — the unbounded wait the deadline exists to prevent.
    static func retryDeadline(existing: Date?, now: Date, window: TimeInterval) -> Date {
        existing ?? now.addingTimeInterval(window)
    }
}
