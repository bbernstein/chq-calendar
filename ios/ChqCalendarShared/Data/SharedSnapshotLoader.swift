import Foundation

/// Reads calendar data the app has already cached to disk, with **no
/// network access of its own** — the widget extension (and anything else
/// that only wants a fast, offline read) uses this instead of
/// `EventRepository`, which owns fetching/writing and lives in the app
/// target.
///
/// Every method tolerates a missing or corrupt cache entry by returning an
/// empty/`nil` result rather than throwing: a widget has no user-facing way
/// to surface a decode error, so "nothing to show yet" is the only
/// sensible fallback.
nonisolated enum SharedSnapshotLoader {
    /// Decodes the events cached under `"events-<year>"` (the same
    /// `EventEnvelope`/`Event` wire format `EventRepository` decodes — see
    /// `EventRepository.decodeEvents`), or `[]` on any failure: a missing
    /// cache key, or a payload that fails to decode.
    static func loadEvents(year: Int, cache: DataCaching) -> [Event] {
        guard let entry = cache.read("events-\(year)"),
              let envelope = try? JSONDecoder().decode(EventEnvelope.self, from: entry.data)
        else {
            return []
        }
        return envelope.data
    }

    /// Decodes the years manifest cached under `"years"`, or `nil` on any
    /// failure (missing key or corrupt payload). Used to find the app's
    /// default year without ever touching the network.
    static func loadYears(cache: DataCaching) -> YearsManifest? {
        guard let entry = cache.read("years") else {
            return nil
        }
        return try? JSONDecoder().decode(YearsManifest.self, from: entry.data)
    }

    /// The persisted favorite event IDs, respecting the same 30-day expiry
    /// as the app (`UserStateStore.loadFavorites`) — delegated to rather
    /// than reimplemented, so the widget and the app can never disagree
    /// about whether a saved favorites set has expired.
    static func loadFavorites(defaults: UserDefaults, now: Date) -> Set<String> {
        UserStateStore(defaults: defaults, now: { now }).loadFavorites()
    }
}
