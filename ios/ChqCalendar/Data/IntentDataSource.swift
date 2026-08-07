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
/// The pure selection/ranking logic is split out as `static nonisolated`
/// functions (`selectUpcoming`/`selectToday`) so `IntentSelectionTests` can
/// exercise it directly with fixture events and a fixed `now`, without
/// spinning up the AppIntents runtime. The instance methods below are just
/// "load the cache, then delegate."
final class IntentDataSource {
    static let shared = IntentDataSource()

    /// `AppModel.placeholderYear`/`WidgetDataSource.fallbackYear`'s twin:
    /// the year assumed when no years manifest has been cached yet (e.g.
    /// Shortcuts invoked before the app has ever launched).
    static let fallbackYear = 2026

    private init() {}

    /// The current default year's cached events, tolerating a cold cache
    /// (empty result) the same way every `SharedSnapshotLoader` call does.
    /// `now` is accepted (rather than read internally via `Date()`) purely
    /// for call-site symmetry with `upcoming`/`today` — this method's own
    /// year lookup comes from the cached years manifest, not the clock.
    func events(now: Date) async -> [Event] {
        let cache = DiskCache(directory: AppGroup.cacheDirectory())
        let manifest = SharedSnapshotLoader.loadYears(cache: cache)
        let year = manifest?.defaultYear ?? Self.fallbackYear
        return SharedSnapshotLoader.loadEvents(year: year, cache: cache)
    }

    /// Up to `limit` non-cancelled events starting strictly after `now`,
    /// optionally narrowed to an exact (case-insensitive) `displayLocation`
    /// match, soonest first.
    func upcoming(venue: String?, now: Date, limit: Int) async -> [Event] {
        Self.selectUpcoming(events: await events(now: now), venue: venue, now: now, limit: limit)
    }

    /// Non-cancelled events whose NY calendar day matches `now`'s, soonest
    /// first.
    func today(now: Date) async -> [Event] {
        Self.selectToday(events: await events(now: now), now: now)
    }

    // MARK: - Pure selection (testable without the AppIntents runtime)

    /// `events` filtered to non-cancelled entries starting after `now`
    /// (strictly — an event starting exactly at `now` has already begun),
    /// optionally narrowed to `venue` (case-insensitive exact match against
    /// `displayLocation`; events with no `displayLocation` never match a
    /// non-`nil` venue), sorted soonest-first, capped at `limit`.
    nonisolated static func selectUpcoming(events: [Event], venue: String?, now: Date, limit: Int) -> [Event] {
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
    nonisolated static func selectToday(events: [Event], now: Date) -> [Event] {
        let todayKey = ChqTime.dayKey(for: now)
        return events
            .filter { $0.status != .cancelled }
            .filter { ChqTime.dayKey(for: $0.start) == todayKey }
            .sorted { $0.start < $1.start }
    }
}
