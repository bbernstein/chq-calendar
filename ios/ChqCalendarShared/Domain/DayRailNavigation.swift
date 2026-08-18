import Foundation

/// What the day rail's controls do, expressed once and without a view.
///
/// The Swift half of `frontend/src/app/dayRailNavigation.ts` — same rules,
/// same refusals, same reasons. Where the two platforms must agree, the
/// tests name it; a divergence here is a cross-platform behaviour bug.
///
/// There is deliberately **no** "go to day" action on the model. Tapping a
/// chip decomposes exactly into the window expansion that already exists
/// plus a scroll, and a third action would be a synonym for the two.
nonisolated enum DayRailNavigation {
    /// What a tap resolves to: at most one edge to grow, and the day to
    /// scroll to once it has.
    struct Plan: Equatable, Sendable {
        let expandStart: String?
        let expandEnd: String?
        let scrollTo: String
    }

    /// *Take me to that day.* If it is already inside the window this is a
    /// scroll and nothing more; if it lies past an edge, that edge grows to
    /// include it and then we scroll. The window only ever grows — the scope
    /// button is what shrinks it back — so "widen or move" never arises.
    ///
    /// Returns `nil` for a target outside `bounds`: `ViewWindow.make` would
    /// clamp such a value anyway, but clamping moves the window to an edge
    /// and then scrolls to a day that is not there. Refusing is honest.
    ///
    /// Returns `nil` for a `nil` window too. Expansion cannot rescue a scope
    /// that matches nothing — `ViewWindow.make` returns `nil` out of `base`
    /// before it ever reads the expansion inputs, so a plan that grew both
    /// edges would widen nothing, mount nothing, and leave a pending scroll
    /// waiting on a day that can never appear.
    static func plan(
        target: String, window: ViewWindow?, bounds: ClosedRange<String>
    ) -> Plan? {
        guard bounds.contains(target), let window else { return nil }
        return Plan(
            expandStart: target < window.startDay ? target : nil,
            expandEnd: target > window.endDay ? target : nil,
            scrollTo: target)
    }

    /// Whether a pending scroll target should be given up rather than waited
    /// for.
    ///
    /// A pending target that is never cleared survives every later commit and
    /// hijacks one of them, scrolling the reader to a day they tapped under a
    /// different scope minutes ago. Two cases end the wait: there is no
    /// window to land in, or the window already covers the target and the day
    /// still has no section — an ordinary empty day, not a commit in flight.
    static func shouldAbandonScroll(target: String, window: ViewWindow?) -> Bool {
        guard let window else { return true }
        return target >= window.startDay && target <= window.endDay
    }

    /// The nearest day with events on either side of `anchor`.
    ///
    /// `eventDays` is every day that has an event under the current
    /// **non-date** filters, sorted — so a step always lands somewhere that
    /// will actually render. A raw ±1 calendar day cannot: with Favourites
    /// on, or any search or venue filter that leaves gaps, the adjacent day
    /// usually has no matches, so no section mounts, the pending scroll gives
    /// up, and the anchor never moves.
    static func stepTargets(
        anchor: String?, eventDays: [String]
    ) -> (previous: String?, next: String?) {
        guard let anchor else { return (nil, nil) }
        var previous: String?
        var next: String?
        // Sorted, so the last key below the anchor wins (the walk keeps
        // overwriting `previous`) and the first key above it wins (guarded by
        // the nil check).
        for key in eventDays {
            if key < anchor { previous = key }
            else if key > anchor, next == nil { next = key }
        }
        return (previous, next)
    }

    /// The nearest event day beyond each edge of `window` — what
    /// "show earlier" / auto-expand-forward reach for. Same walk as
    /// `stepTargets`, applied to a window's two edges rather than one day.
    static func edgeTargets(
        eventDays: [String], window: ViewWindow?
    ) -> (earlier: String?, later: String?) {
        guard let window else { return (nil, nil) }
        var earlier: String?
        var later: String?
        for key in eventDays {
            if key < window.startDay { earlier = key }
            else if key > window.endDay, later == nil { later = key }
        }
        return (earlier, later)
    }

    /// Every day carrying at least one of `events`, sorted, each once.
    static func eventDays(_ events: [Event]) -> [String] {
        Set(events.map { ChqTime.dayKey(for: $0.start) }).sorted()
    }

    /// Today's key, but only where navigation can actually reach it.
    ///
    /// `plan` refuses a target outside the navigable bounds, and off-season
    /// today is outside them for roughly ten months of the year — so an
    /// unclamped today renders a "Now" control that is visible, enabled, and
    /// does nothing when pressed. Returning `nil` removes the control
    /// instead, which is the treatment an archived year already gets.
    static func reachableTodayKey(
        _ today: String?, bounds: ClosedRange<String>
    ) -> String? {
        guard let today, bounds.contains(today) else { return nil }
        return today
    }
}
