import Foundation

/// Builds the static sequence of "slices" a home-screen widget rolls
/// through. WidgetKit has no way to run app code on a per-minute timer, but
/// it *will* re-render a `WidgetKit.Timeline` entry the instant `now`
/// crosses that entry's own timestamp — so encoding "show event E until E
/// starts, then roll to the next one" as an array of `(date, state)` pairs
/// lets the widget update itself exactly on schedule with no polling.
///
/// Pure domain logic: no `Date()`, no I/O. Callers (the widget's
/// `TimelineProvider`, added in a later task) supply `now` and everything
/// else needed to compute a deterministic result.
nonisolated enum WidgetTimelineBuilder {
    /// A minimal, `Sendable` projection of `Event` for widget rendering —
    /// just the fields a home-screen widget needs, so the widget extension
    /// never has to carry `Event`'s full decode machinery just to show a
    /// title.
    struct EventSummary: Equatable, Sendable {
        let id: String
        let title: String
        let venue: String?
        let start: Date
    }

    /// What a given `Slice` should render.
    enum State: Equatable, Sendable {
        /// Up to 4 upcoming events, soonest first.
        case events([EventSummary])

        /// No events are upcoming (given the current config), but a future
        /// season's opening date is known.
        case countdown(opening: Date, daysUntil: Int)

        /// No events are upcoming and no future season is known yet.
        case empty
    }

    /// One entry in the timeline: `state` is what to render from `date`
    /// onward, until the next `Slice`'s `date` is reached (or forever, for
    /// the last one).
    struct Slice: Equatable, Sendable {
        let date: Date
        let state: State
    }

    /// The widget's user-configurable narrowing — a single venue/category
    /// rather than `FilterSelection`'s multi-select, since widget
    /// configuration UI is one picker per facet.
    struct Config: Equatable, Sendable {
        var venue: String? = nil
        var category: String? = nil
        var favoritesOnly = false
    }

    /// Builds the timeline for `events` under `config`, as of `now`.
    ///
    /// Rules:
    /// - A candidate is an event that starts strictly after `now`, is not
    ///   `.cancelled`, and matches `config` (`venue` against
    ///   `displayLocation` exactly; `category` against
    ///   `filterTokens.contains(category.lowercased())`; `favoritesOnly`
    ///   against membership in `favorites`).
    /// - With no candidates, the result is a single slice at `now`: a
    ///   `.countdown` to the nearest future season opening derived from
    ///   `availableYears` (plus `year`, in case it isn't itself already in
    ///   `availableYears`) via `SeasonCalendar.seasonStart`, or `.empty`
    ///   when no such season is known yet.
    /// - Otherwise, the first slice is at `now`, showing the soonest ≤4
    ///   candidates. Then one more slice is added at each *distinct*
    ///   candidate start time (ascending; simultaneous starts collapse into
    ///   one slice), each showing the ≤4 candidates still upcoming as of
    ///   that instant — so the widget rolls over exactly when an event
    ///   begins. A candidate whose own start never gets a slice (because
    ///   `maxSlices` was reached first) still appears in every earlier
    ///   slice's list it qualifies for.
    /// - The total slice count (including the initial one) is capped at
    ///   `maxSlices`.
    static func timeline(
        events: [Event],
        favorites: Set<String>,
        config: Config,
        availableYears: [Int],
        year: Int,
        now: Date,
        maxSlices: Int = 24
    ) -> [Slice] {
        let candidates = events
            .filter { $0.start > now && $0.status != .cancelled && matches($0, config: config, favorites: favorites) }
            .sorted { lhs, rhs in
                lhs.start != rhs.start ? lhs.start < rhs.start : lhs.id < rhs.id
            }

        guard !candidates.isEmpty else {
            return [Slice(date: now, state: seasonState(availableYears: availableYears, year: year, now: now))]
        }

        var slices = [Slice(date: now, state: .events(upcoming(in: candidates, after: now)))]

        let distinctStarts = Set(candidates.map(\.start)).sorted()
        for start in distinctStarts {
            guard slices.count < maxSlices else { break }
            slices.append(Slice(date: start, state: .events(upcoming(in: candidates, after: start))))
        }

        return slices
    }

    /// Whether `event` matches every facet `config` narrows on. A `nil`
    /// facet (or `favoritesOnly == false`) imposes no constraint.
    private static func matches(_ event: Event, config: Config, favorites: Set<String>) -> Bool {
        if let venue = config.venue, event.displayLocation != venue {
            return false
        }
        if let category = config.category, !event.filterTokens.contains(category.lowercased()) {
            return false
        }
        if config.favoritesOnly, !favorites.contains(event.id) {
            return false
        }
        return true
    }

    /// The soonest ≤4 of `candidates` (already sorted ascending by start)
    /// that haven't started as of `date`.
    private static func upcoming(in candidates: [Event], after date: Date) -> [EventSummary] {
        candidates
            .filter { $0.start > date }
            .prefix(4)
            .map { EventSummary(id: $0.id, title: $0.title, venue: $0.displayLocation, start: $0.start) }
    }

    /// The state to show when there are zero candidates: a countdown to the
    /// nearest season opening strictly after `now` among `availableYears`
    /// (and `year`, so a caller that passes a `year` not yet reflected in
    /// `availableYears` still gets a countdown to it), or `.empty` when none
    /// exists.
    private static func seasonState(availableYears: [Int], year: Int, now: Date) -> State {
        let years = Set(availableYears).union([year])
        let opening = years
            .map(SeasonCalendar.seasonStart)
            .filter { $0 > now }
            .min()

        guard let opening else {
            return .empty
        }
        return .countdown(opening: opening, daysUntil: daysBetween(now, opening))
    }

    /// Whole NY-calendar days between the day containing `from` and the day
    /// containing `to` — the same rule `LandingState` uses for its own
    /// `daysUntil`, so the widget's countdown and the app's never disagree.
    private static func daysBetween(_ from: Date, _ to: Date) -> Int {
        let calendar = ChqTime.calendar
        let fromDay = calendar.startOfDay(for: from)
        let toDay = calendar.startOfDay(for: to)
        return calendar.dateComponents([.day], from: fromDay, to: toDay).day ?? 0
    }
}
