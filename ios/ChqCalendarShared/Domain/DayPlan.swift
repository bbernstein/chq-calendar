import Foundation

/// One starred day's events, annotated with the walking-time gap (or
/// overlap) between each consecutive pair — the core of the My Day planner
/// (#181). Pure domain logic: no `Date()`, no I/O; `build` and
/// `availableDayKeys` take fully-formed inputs, and `defaultDayKey` takes
/// `now` explicitly so callers control time.
nonisolated struct DayPlan: Equatable, Sendable {
    /// How one item in the day relates to the item immediately before it.
    enum Transition: Equatable, Sendable {
        /// The gap between the previous event's effective end and this
        /// event's start is at least the walking time between their
        /// venues — or one/both venues can't be resolved by `VenueAtlas`,
        /// so there's no walking time to compare against at all.
        /// `walkMinutes` is `nil` in the unresolved case, populated
        /// whenever the walk itself is known (including `0` for two
        /// events at the same venue).
        case fine(walkMinutes: Int?)
        /// Both venues resolved, and `0 <= gapMinutes < walkMinutes`:
        /// there's a gap, but not enough of one to comfortably make the
        /// walk.
        case tight(walkMinutes: Int, gapMinutes: Int)
        /// The next event starts before the previous one's effective end.
        /// `minutes` is how much of the previous event bleeds into the
        /// next, rounded up to a whole minute (never `0`, since this case
        /// only fires when the overlap is strictly positive).
        case overlap(minutes: Int)
    }

    /// One favorited event on the day, with its relationship to the
    /// previous item — `nil` for the first item, since there's nothing to
    /// transition from.
    struct Item: Equatable, Sendable {
        let event: Event
        let transitionFromPrevious: Transition?
    }

    let dayKey: String
    let items: [Item]
    var firstStart: Date?
    var lastEnd: Date?
    var conflictCount: Int
    var tightCount: Int

    /// Assumed duration, in minutes, for an event whose feed `end` equals
    /// its `start` (the feed's convention for "no end time given").
    static let assumedDurationMinutes = 60

    /// Builds the plan for `dayKey`: every favorited event whose `start`
    /// falls on `dayKey` (per `ChqTime.dayKey`, so this follows the same
    /// NY-calendar-day bucketing as `EventGrouping.byDay`), ordered by
    /// `start` (ties broken by `id` for a deterministic order).
    ///
    /// Cancelled events are included, not filtered out: a cancellation
    /// still occupied the visitor's plan up until it was pulled, so it
    /// stays on the timeline and still participates in conflict/gap math.
    /// The UI is responsible for showing the existing status badge so the
    /// user knows why an item is flagged.
    ///
    /// An event's effective end is `end` when it's after `start`, else
    /// `start + assumedDurationMinutes` (the feed's "no end time" case).
    static func build(dayKey: String, favorites: Set<String>, events: [Event]) -> DayPlan {
        let dayEvents = events
            .filter { favorites.contains($0.id) && ChqTime.dayKey(for: $0.start) == dayKey }
            .sorted { lhs, rhs in
                lhs.start != rhs.start ? lhs.start < rhs.start : lhs.id < rhs.id
            }

        var items: [Item] = []
        items.reserveCapacity(dayEvents.count)
        var previous: Event?
        var conflictCount = 0
        var tightCount = 0

        for event in dayEvents {
            let transition = previous.map { previousEvent in
                transitionBetween(previous: previousEvent, next: event)
            }
            switch transition {
            case .overlap: conflictCount += 1
            case .tight: tightCount += 1
            case .fine, nil: break
            }
            items.append(Item(event: event, transitionFromPrevious: transition))
            previous = event
        }

        // The latest effective end across *all* items, not just the
        // chronologically last-starting one — an early, long headliner can
        // outlast every event that starts after it.
        let lastEnd = dayEvents.map(effectiveEnd).max()

        return DayPlan(
            dayKey: dayKey,
            items: items,
            firstStart: dayEvents.first?.start,
            lastEnd: lastEnd,
            conflictCount: conflictCount,
            tightCount: tightCount
        )
    }

    /// Sorted, deduped `ChqTime.dayKey`s that have at least one favorited
    /// event (any `status`, including `.cancelled` — a day the user
    /// starred something on stays pickable even if that event was later
    /// cancelled) in `events`.
    ///
    /// `year` isn't used internally: `events` is already year-scoped by the
    /// caller before it reaches this function, the same convention
    /// `EventGrouping.byDay` relies on for its own `year` parameter — there
    /// is nothing left for a year filter to narrow here. Kept in the
    /// signature to match the planned interface and stay consistent with
    /// other day-scoped domain entry points.
    static func availableDayKeys(favorites: Set<String>, events: [Event], year: Int) -> [String] {
        let keys = events
            .filter { favorites.contains($0.id) }
            .map { ChqTime.dayKey(for: $0.start) }
        return Set(keys).sorted()
    }

    /// Picks which day the planner should open to: today's key if it's in
    /// `available`; otherwise the earliest available key that's still in
    /// the future; otherwise the latest available key (so opening the
    /// planner after the season ends still shows the last starred day
    /// instead of nothing); `nil` when `available` is empty. `available`
    /// need not already be sorted.
    static func defaultDayKey(available: [String], now: Date) -> String? {
        guard !available.isEmpty else { return nil }
        let today = ChqTime.dayKey(for: now)
        if available.contains(today) { return today }

        let sorted = available.sorted()
        if let nextFuture = sorted.first(where: { $0 > today }) {
            return nextFuture
        }
        return sorted.last
    }

    // MARK: - Transition math

    private static func effectiveEnd(_ event: Event) -> Date {
        event.end > event.start
            ? event.end
            : event.start.addingTimeInterval(TimeInterval(assumedDurationMinutes * 60))
    }

    private static func transitionBetween(previous: Event, next: Event) -> Transition {
        let previousEnd = effectiveEnd(previous)
        let gapSeconds = next.start.timeIntervalSince(previousEnd)

        if gapSeconds < 0 {
            let overlapMinutes = max(1, Int((-gapSeconds / 60).rounded(.up)))
            return .overlap(minutes: overlapMinutes)
        }

        let gapMinutes = Int((gapSeconds / 60).rounded(.down))

        guard
            let fromLocation = previous.displayLocation.flatMap(VenueAtlas.location(for:)),
            let toLocation = next.displayLocation.flatMap(VenueAtlas.location(for:))
        else {
            return .fine(walkMinutes: nil)
        }

        let walkMinutes = VenueAtlas.walkingMinutes(from: fromLocation, to: toLocation)
        if gapMinutes < walkMinutes {
            return .tight(walkMinutes: walkMinutes, gapMinutes: gapMinutes)
        }
        return .fine(walkMinutes: walkMinutes)
    }
}
