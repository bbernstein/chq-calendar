import Foundation

/// The seam between `AppModel` and `SpotlightIndexer`, mirroring
/// `WidgetReloading`'s role for `WidgetCenter`: the app target can perform
/// real `CSSearchableIndex` writes here without forcing `AppModel`'s
/// existing unit tests to trigger them as a side effect of every
/// successful-refresh/toggle-favorite test (review fix, task 13 — prior to
/// this seam, `AppModelTests` performed a real on-device Spotlight
/// delete-and-re-add on every green `refresh()` run).
///
/// `@MainActor`, matching `AppModel`/`WidgetReloading`/`NotificationScheduling`:
/// every call site is already on the main actor.
///
/// No `now:` parameter — unlike `SpotlightIndexer.reindex` before this fix,
/// this protocol never carried one: the season window `itemsToIndex`
/// selects against is year-derived, not clock-derived, so there was never a
/// clock reading for a mock to need to inject. See `SpotlightIndexer`'s doc
/// comment for the underlying dead-parameter cleanup this reflects.
@MainActor
protocol SpotlightIndexing {
    /// Wipes this app's previous Spotlight contents and re-adds whatever
    /// `SpotlightIndexer.itemsToIndex` currently selects from `events` and
    /// `favorites` for `year`. See `SpotlightIndexer.reindex` for the full
    /// contract (batching, error handling, availability guard) the live
    /// conformance below delegates to.
    func reindex(events: [Event], favorites: Set<String>, year: Int) async
}

/// The live conformance, backed by the real `SpotlightIndexer`/
/// `CSSearchableIndex`. Only `ChqCalendarApp` constructs this — every
/// existing `AppModel` call site (and every test) keeps passing `nil` for
/// `spotlightIndexer`, which makes `AppModel`'s reindex triggers no-ops.
struct LiveSpotlightIndexing: SpotlightIndexing {
    func reindex(events: [Event], favorites: Set<String>, year: Int) async {
        await SpotlightIndexer.reindex(events: events, favorites: favorites, year: year)
    }
}
