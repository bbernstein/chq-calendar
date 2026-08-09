import Foundation

/// Read-only data access for the App Intents / Siri Shortcuts surface
/// (#180). An App Intent can run out-of-process from any live `AppModel` —
/// Shortcuts can invoke one with the app not running at all — so, like the
/// widget extension (`WidgetDataSource`), this reads the same on-disk App
/// Group cache `EventRepository` already maintains instead of depending on
/// `EventRepository` itself (which owns fetching/writing and needs a live
/// `CalendarAPIClient`). No network access of its own — see
/// `SharedSnapshotLoader`'s doc comment for why that's the right trade-off
/// here too.
///
/// The pure selection/ranking logic is split out as `static` functions
/// (`selectUpcoming`/`selectToday`) so `IntentSelectionTests` can exercise
/// it directly with fixture events and a fixed `now`, without spinning up
/// the AppIntents runtime. `events`/`upcoming`/`today` below are just "load
/// the cache, then delegate."
///
/// A `nonisolated enum` of statics — not a class — for the same reason as
/// `WidgetDataSource` (see that type's doc comment): the project's
/// `SWIFT_DEFAULT_ACTOR_ISOLATION` is `MainActor`, and without an explicit
/// override every `async` member here would be implicitly MainActor-
/// isolated, meaning every intent run and `EventEntityQuery` lookup would do
/// its disk read + full-feed JSON decode (~1,600 events) synchronously on
/// the main thread while the app is in-process — exactly the cost
/// `EventRepository` and `WidgetDataSource` are both documented as
/// deliberately avoiding. A `nonisolated final class` was tried first to
/// keep the previous `IntentDataSource.shared.events(...)` call shape, but
/// the compiler rejects it: a `nonisolated` class's `static let shared`
/// instance must be `Sendable` to cross isolation domains safely, and this
/// type has no reason to be a reference type at all (no stored instance
/// state) — so, matching `WidgetDataSource` exactly, it's a stateless
/// `nonisolated enum` of statics instead of chasing that with
/// `@unchecked Sendable`.
nonisolated enum IntentDataSource {
    /// `AppModel.placeholderYear`/`WidgetDataSource.fallbackYear`'s twin:
    /// the year assumed when no years manifest has been cached yet (e.g.
    /// Shortcuts invoked before the app has ever launched).
    static let fallbackYear = 2026

    /// The current default year's cached events, tolerating a cold cache
    /// (empty result) the same way every `SharedSnapshotLoader` call does.
    /// `now` is accepted (rather than read internally via `Date()`) purely
    /// for call-site symmetry with `upcoming`/`today` — this method's own
    /// year lookup comes from the cached years manifest, not the clock.
    static func events(now: Date) async -> [Event] {
        let cache = DiskCache(directory: AppGroup.cacheDirectory())
        let manifest = SharedSnapshotLoader.loadYears(cache: cache)
        let year = manifest?.defaultYear ?? fallbackYear
        return SharedSnapshotLoader.loadEvents(year: year, cache: cache)
    }

    /// Up to `limit` non-cancelled events starting strictly after `now`,
    /// optionally narrowed to an exact (case-insensitive) `displayLocation`
    /// match, soonest first.
    static func upcoming(venue: String?, now: Date, limit: Int) async -> [Event] {
        selectUpcoming(events: await events(now: now), venue: venue, now: now, limit: limit)
    }

    /// Non-cancelled events whose NY calendar day matches `now`'s, soonest
    /// first.
    static func today(now: Date) async -> [Event] {
        selectToday(events: await events(now: now), now: now)
    }

    // MARK: - Pure selection (testable without the AppIntents runtime)

    /// `events` filtered to non-cancelled entries starting after `now`
    /// (strictly — an event starting exactly at `now` has already begun),
    /// optionally narrowed to `venue` (case-insensitive exact match against
    /// `displayLocation`; events with no `displayLocation` never match a
    /// non-`nil` venue), sorted soonest-first, capped at `limit`.
    static func selectUpcoming(events: [Event], venue: String?, now: Date, limit: Int) -> [Event] {
        let venueKey = venue?.lowercased()
        return events
            .filter { $0.status != .cancelled }
            .filter { $0.start > now }
            .filter { event in
                guard let venueKey else { return true }
                return event.displayLocation?.lowercased() == venueKey
            }
            .sorted { $0.start < $1.start }
            .prefix(limit)
            .map { $0 }
    }

    /// `events` filtered to non-cancelled entries whose NY calendar day
    /// (`ChqTime.dayKey`) matches `now`'s, sorted soonest-first. An event
    /// late at night NY time is still "today" as long as its `dayKey`
    /// matches; one that has rolled past midnight NY time belongs to
    /// tomorrow instead, regardless of the device's local time zone.
    static func selectToday(events: [Event], now: Date) -> [Event] {
        let todayKey = ChqTime.dayKey(for: now)
        return events
            .filter { $0.status != .cancelled }
            .filter { ChqTime.dayKey(for: $0.start) == todayKey }
            .sorted { $0.start < $1.start }
    }

    // MARK: - #193 composed selection engine (intent dialog content)

    /// The cached years manifest's default year, or `fallbackYear` when
    /// nothing is cached yet — the year every #193 intent resolves
    /// timeframes against.
    static func defaultYear() async -> Int {
        let cache = DiskCache(directory: AppGroup.cacheDirectory())
        return SharedSnapshotLoader.loadYears(cache: cache)?.defaultYear ?? fallbackYear
    }

    /// The #193 composed selection: non-cancelled events, scoped to
    /// `timeframe`'s window (or strictly-after-`now` when `nil`),
    /// narrowed by `kind` and/or exact case-insensitive `venue`, soonest
    /// first. Uncapped — dialogs need the true match count; callers cap
    /// what they *return* separately.
    static func selectMatching(events: [Event], kind: EventKind?, timeframe: IntentTimeframe?,
                               venue: String?, now: Date, year: Int) -> [Event] {
        let venueKey = venue?.lowercased()
        let window = timeframe?.interval(now: now, year: year)
        return events
            .filter { $0.status != .cancelled }
            .filter { event in
                if let window { return window.contains(event.start) }
                return event.start > now
            }
            .filter { event in kind?.matches(event) ?? true }
            .filter { event in
                guard let venueKey else { return true }
                return event.displayLocation?.lowercased() == venueKey
            }
            .sorted { $0.start < $1.start }
    }

    /// The event a single-answer dialog should lead with: the first
    /// flagship-venue event on the same NY day as the soonest match, or
    /// the soonest match itself — "what's the next lecture" answers the
    /// 10:45 Amp lecture, not a porch chat.
    static func featured(in results: [Event]) -> Event? {
        guard let first = results.first else { return nil }
        let day = ChqTime.dayKey(for: first.start)
        return results.first {
            ChqTime.dayKey(for: $0.start) == day && EventKind.isFlagshipVenue($0.displayLocation)
        } ?? first
    }

    /// The user's starred events inside `timeframe`'s window, soonest
    /// first — the My Schedule intent's selection.
    static func selectSchedule(events: [Event], favoriteIDs: Set<String>, timeframe: IntentTimeframe,
                               now: Date, year: Int) -> [Event] {
        let window = timeframe.interval(now: now, year: year)
        return events
            .filter { $0.status != .cancelled }
            .filter { favoriteIDs.contains($0.id) }
            .filter { window.contains($0.start) }
            .sorted { $0.start < $1.start }
    }
}
