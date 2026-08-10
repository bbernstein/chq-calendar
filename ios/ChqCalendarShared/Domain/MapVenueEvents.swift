import Foundation

/// Pure event-matching for the grounds map's venue-selection sheet (#182):
/// which of the currently-loaded events happen at a given `VenueLocation`,
/// and which of those are still upcoming.
///
/// Matches through `VenueAtlas.location(for:)` rather than comparing
/// `Event.displayLocation` to `venue.name` directly, so a room-level feed
/// name (e.g. "Hultquist 101") correctly groups under its building
/// ("Hultquist Center") the same way `DayPlan`'s walking-time math already
/// does.
nonisolated enum MapVenueEvents {
    /// Upcoming (non-cancelled, `start` strictly after `now`) events at
    /// `venue`, sorted by `start` ascending (ties broken by `id` for a
    /// deterministic order), capped at `limit`.
    static func upcomingEvents(at venue: VenueLocation, events: [Event], now: Date, limit: Int) -> [Event] {
        events
            .filter { event in
                event.status != .cancelled
                    && event.start > now
                    && VenueAtlas.location(for: event.displayLocation ?? "")?.id == venue.id
            }
            .sorted { lhs, rhs in
                lhs.start != rhs.start ? lhs.start < rhs.start : lhs.id < rhs.id
            }
            .prefix(limit)
            .map { $0 }
    }
}
