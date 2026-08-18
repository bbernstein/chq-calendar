import Foundation

/// Whether the day rail's forward auto-expand trigger should fire.
///
/// Pulled out of `EventListView.autoExpandIfAtTheEnd` so the property it
/// protects — exactly one expansion per newly-reached last day, never a
/// cascade — is unit-testable without a view host. `EventListView` stays the
/// thin wrapper: it consults `shouldFire`, then performs the two side
/// effects (`autoExpandedThrough = day`, `model.expandWindowEnd()`).
nonisolated enum DayRailAutoExpand {
    /// - Parameters:
    ///   - day: the day key of the section whose row just appeared.
    ///   - event: the id of the event whose row just appeared.
    ///   - lastDay: the day key of the last section currently rendered, or
    ///     `nil` if there are no days at all.
    ///   - lastEventInDay: the id of the last event in `day`'s own section,
    ///     or `nil` if that day (unexpectedly) has none.
    ///   - alreadyExpandedThrough: the day key the trigger last fired for,
    ///     or `nil` if it has never fired.
    ///
    /// Fires only for the final row of the final day, and only once per
    /// distinct `day` — see `EventListView.autoExpandIfAtTheEnd` for the
    /// cascade this guards against, and for why the caller sets
    /// `alreadyExpandedThrough` *before* calling `expandWindowEnd()`.
    static func shouldFire(
        day: String,
        event: String,
        lastDay: String?,
        lastEventInDay: String?,
        alreadyExpandedThrough: String?
    ) -> Bool {
        day == lastDay && event == lastEventInDay && alreadyExpandedThrough != day
    }
}
