import Foundation

/// The instants the event list is narrowed to, plus the calendar days that
/// range covers. The iOS counterpart of the web's `dayWindow.ts`.
///
/// **Half-open**: `start <= x < endExclusive`, carried as a `Range<Date>` so
/// the type system enforces it and `contains(_:)` comes for free. Never an
/// inclusive bound with a subtracted epsilon: `Date` wraps a `Double`, so
/// there is no last representable instant to subtract to, and an
/// `end - 0.001` bound silently drops `23:59:59.9995` — while the identical
/// expression is exact on the web, where `Date` is integer milliseconds. The
/// same written rule meaning two different things is exactly the drift this
/// shared model exists to prevent.
///
/// Half-open is also what the pipeline already used everywhere, so most
/// scopes need no conversion at all: `SeasonWeek.contains` is
/// `start <= x && x < end`, `.season` is `< last.end`, the `.thisWeek`
/// fallback is `< now + 7d`, and `dayKey` equality is exactly
/// `[startOfDay(d), startOfDay(d+1))`. Those bounds are carried through
/// verbatim below rather than re-derived.
///
/// `startDay`/`endDay` are the navigation-facing projection — what a day rail
/// or a step control moves through. They are derived from the range, never
/// the other way round, so they cannot disagree with what is filtered.
nonisolated struct ViewWindow: Equatable, Sendable {
    let startDay: String
    let endDay: String
    let range: Range<Date>

    var start: Date { range.lowerBound }
    var endExclusive: Date { range.upperBound }

    /// `start <= date < endExclusive`.
    func contains(_ date: Date) -> Bool { range.contains(date) }

    /// `.all`'s instant bounds. `Date.distantPast`/`distantFuture` rather
    /// than an arbitrary "year 1"/"year 3000" pair — genuinely the full
    /// `Date` domain, matching the web's `.all`, which bounds no instant at
    /// all.
    private static let minInstant = Date.distantPast
    private static let maxInstant = Date.distantFuture

    /// The exclusive upper bound of `dayKey` — the next day's midnight.
    ///
    /// Goes through `Calendar`, not `+86_400`, because a DST day is 23 or 25
    /// hours. **Deliberately not `ChqTime.endOfDay`**, which returns
    /// `startOfDay + 1 day - 1 second` (`23:59:59.000`) and is an inclusive
    /// bound of the wrong precision for a window.
    static func dayAfter(_ dayKey: String) -> Date? {
        guard
            let start = ChqTime.parse("\(dayKey) 00:00:00"),
            let next = ChqTime.calendar.date(byAdding: .day, value: 1, to: start)
        else { return nil }
        return next
    }

    /// The last day a window actually shows, given its exclusive upper bound.
    ///
    /// One rule for two cases that look unrelated at the call site: a window
    /// ending at midnight does not show that day (`.today`, `.day`, `.next`),
    /// while one ending mid-day does (`.thisWeek` and `.season` end at noon
    /// Saturday, and that Saturday morning has events). Implemented once here
    /// rather than reasoned about at each construction site.
    static func lastDayCovered(_ endExclusive: Date) -> String {
        let cal = ChqTime.calendar
        let key = ChqTime.dayKey(for: endExclusive)
        guard cal.startOfDay(for: endExclusive) == endExclusive else { return key }
        return ChqTime.day(key, offsetBy: -1) ?? key
    }

    /// The outer limit of everything navigation can reach: the season, widened
    /// to contain every day that carries an event and every starred day.
    /// Reuses `DayWindow.bounds` for the season-and-starred half so its
    /// existing tests keep pinning that.
    static func navigableBounds(
        year: Int, events: [Event], starredDays: [String]
    ) -> ClosedRange<String> {
        let base = DayWindow.bounds(year: year, starredDays: starredDays)
        var lower = base.lowerBound
        var upper = base.upperBound
        for event in events {
            let key = ChqTime.dayKey(for: event.start)
            if key < lower { lower = key }
            if key > upper { upper = key }
        }
        return lower...upper
    }

    /// The window a scope defines, widened by however far the user has
    /// navigated. `nil` means the scope matches nothing right now.
    ///
    /// Expansion only ever grows the window — a `windowStartDayKey` or
    /// `windowEndDayKey` that would narrow it is ignored, so a stale value can
    /// never hide events. The added region uses whole days, while an untouched
    /// end keeps the base window's exact instant: that is what preserves
    /// `.next`'s one-hour grace and `.thisWeek`'s noon boundaries until the
    /// user actually navigates past them.
    ///
    /// `bounds` clamps the *expansion inputs*, before they are merged with
    /// `base` — never the merged result. The bounds limit how far navigation
    /// can reach; they say nothing about a scope the user hasn't navigated,
    /// and `base` can legitimately sit outside them (off-season `.today`,
    /// most of the year). Clamping the merged result instead of the inputs
    /// would invert the window (`startDay > endDay`) whenever that happens.
    ///
    /// - Parameter bounds: does double duty. Besides clamping the expansion
    ///   inputs above, `base`'s `.all` case also returns it verbatim as
    ///   `startDay`/`endDay` — so a caller that passes a season-only range
    ///   (`DayWindow.bounds`, skipping the per-event `navigableBounds` scan)
    ///   gets a season-only day-key pair back for `.all`, not one widened to
    ///   cover every event. `EventFilter` is one such caller on its common
    ///   path, and can be precisely because it reads `contains(_:)` only and
    ///   never touches `startDay`/`endDay`.
    static func make(
        selection: FilterSelection,
        events: [Event],
        now: Date,
        year: Int,
        isCurrentYear: Bool,
        bounds: ClosedRange<String>
    ) -> ViewWindow? {
        guard let base = base(
            selection: selection, events: events, now: now,
            year: year, isCurrentYear: isCurrentYear, bounds: bounds)
        else { return nil }

        var expandedStartDayKey = selection.windowStartDayKey
        if let expanded = expandedStartDayKey, expanded < bounds.lowerBound {
            expandedStartDayKey = bounds.lowerBound
        }
        var expandedEndDayKey = selection.windowEndDayKey
        if let expanded = expandedEndDayKey, expanded > bounds.upperBound {
            expandedEndDayKey = bounds.upperBound
        }

        // Each side is applied atomically: `startDay`/`endDay` only ever
        // change together with the `Date` they describe. If an expansion key
        // survives the clamp above but fails `ChqTime.parse` below (it
        // shouldn't — `browseDay` only ever writes a canonical `dayKey` — but
        // these fields are plain `String?`, unvalidated by the type system),
        // the expansion is dropped entirely rather than applied to one of
        // `startDay`/`range` and not the other. Anything else would let
        // `startDay`/`endDay` name a day the actual filtered range
        // disagrees with — exactly what this type's doc promises can't
        // happen.
        var startDay = base.startDay
        var start = base.start
        if let expanded = expandedStartDayKey, expanded < startDay,
           let parsed = ChqTime.parse("\(expanded) 00:00:00") {
            startDay = expanded
            start = ChqTime.calendar.startOfDay(for: parsed)
        }

        var endDay = base.endDay
        var endExclusive = base.endExclusive
        if let expanded = expandedEndDayKey, expanded > endDay,
           let after = dayAfter(expanded) {
            endDay = expanded
            endExclusive = after
        }

        // No `guard start < endExclusive` here: unlike the clamp-after-merge
        // form this replaced, expansion only ever widens outward from a
        // `base` that is already a valid (non-empty) range, so `start` can
        // never cross `endExclusive`.
        return ViewWindow(startDay: startDay, endDay: endDay, range: start..<endExclusive)
    }

    private static func base(
        selection: FilterSelection,
        events: [Event],
        now: Date,
        year: Int,
        isCurrentYear: Bool,
        bounds: ClosedRange<String>
    ) -> ViewWindow? {
        let scope = EffectiveScope.resolve(selection, isCurrentYear: isCurrentYear)

        switch scope {
        case .all:
            return allWindow(bounds: bounds)

        case .season:
            // `first.start <= x && x < last.end`, carried through verbatim.
            // `weeks` is built here rather than once for the whole switch —
            // it's only `.season` and `.thisWeek` that read it, and the
            // other four scopes shouldn't pay for a 9-struct build they
            // never use.
            let weeks = SeasonCalendar.weeks(forYear: year)
            guard let first = weeks.first, let last = weeks.last else { return nil }
            return windowed(first.start..<last.end)

        case .today:
            return day(ChqTime.dayKey(for: now))

        case .day:
            return dayWindow(forDayScope: selection.selectedDayKey, bounds: bounds)

        case .next:
            let from = now.addingTimeInterval(-3600)
            // Sized against the FULL event set, not a search-narrowed one — an
            // active search must not change how wide the window is, only what
            // it is applied to.
            //
            // `adaptiveEndDate` returns an inclusive `ChqTime.endOfDay`
            // (23:59:59.000); the half-open equivalent is that day's exclusive
            // end. No representable event falls in the difference — event
            // times parse from "yyyy-MM-dd HH:mm:ss" and carry no sub-second
            // component — which `ViewWindowTests` asserts rather than assumes.
            let inclusiveEnd = EventFilter.adaptiveEndDate(events: events, from: from, minCount: 50)
            guard let end = dayAfter(ChqTime.dayKey(for: inclusiveEnd)) else { return nil }
            return windowed(from..<end)

        case .thisWeek:
            let weeks = SeasonCalendar.weeks(forYear: year)
            if let current = weeks.first(where: { $0.contains(now) }) {
                // Literally `SeasonWeek.contains`.
                return windowed(current.start..<current.end)
            }
            // Out of season: the pipeline's existing seven-day rolling
            // window from `now`. Deliberately `86_400`-second arithmetic —
            // the one place in this file that ignores the "never `86_400`,
            // always `Calendar`" rule — because this is verbatim parity with
            // the pre-refactor pipeline, and unlike every other boundary
            // here it is a `now`-relative INSTANT, not a day-key computation:
            // there is no day key on either side for `ChqTime.day(_:offsetBy:)`
            // to compute DST-safely. Do not "fix" this to `Calendar` day
            // arithmetic — that would change what gets shown across a DST
            // boundary, which is exactly the drift this exception avoids.
            //
            // This is also the one place iOS and the web's shared model
            // genuinely disagree: the web's `this-week` returns `null` out
            // of season (the list shows nothing), while iOS returns this
            // rolling week. Both preserve their own platform's pre-refactor
            // behavior, so neither changes here — reconciling the two is
            // Phase 3's job.
            return windowed(now..<now.addingTimeInterval(7 * 24 * 3600))
        }
    }

    /// The `.all` scope's window: no instant bound, `bounds` reported
    /// verbatim as the day projection. Deliberately not derived from
    /// `events`: a window computed from the very list being filtered would
    /// be circular and would behave differently for a caller passing a
    /// subset. Shared by the real `.all` case above and `.day`'s
    /// fail-open fallback, which is what `.all` degrades to for a `.day`
    /// naming no date.
    private static func allWindow(bounds: ClosedRange<String>) -> ViewWindow {
        ViewWindow(
            startDay: bounds.lowerBound, endDay: bounds.upperBound,
            range: minInstant..<maxInstant)
    }

    /// `.day`'s window: the named day, or — if `key` is `nil` — the
    /// unbounded `.all` window rather than `nil`.
    ///
    /// `EffectiveScope` guarantees `.day` is only resolved with a non-nil
    /// key, so the nil branch is unreachable through `ViewWindow.make`
    /// today (and would still be unreachable calling `base` directly, since
    /// `base` re-derives the same scope from the same guarantee). It exists
    /// so that if that guarantee were ever weakened, the failure mode is
    /// OPEN — show everything, what `EffectiveScope` itself would have
    /// produced for a keyless `.day` — rather than CLOSED, which is what a
    /// bare `nil` here would give `EventFilter` (zero events), flipping the
    /// pre-refactor behavior (a keyless day scope showed everything) to its
    /// opposite. Internal, not private, so a test can pin it directly
    /// without first needing to defeat `EffectiveScope`'s guarantee.
    static func dayWindow(forDayScope key: String?, bounds: ClosedRange<String>) -> ViewWindow? {
        guard let key else { return allWindow(bounds: bounds) }
        return day(key)
    }

    /// Wraps a half-open instant range with its day projection.
    private static func windowed(_ range: Range<Date>) -> ViewWindow {
        ViewWindow(
            startDay: ChqTime.dayKey(for: range.lowerBound),
            endDay: lastDayCovered(range.upperBound),
            range: range)
    }

    private static func day(_ key: String) -> ViewWindow? {
        guard
            let parsed = ChqTime.parse("\(key) 00:00:00"),
            let end = dayAfter(key)
        else { return nil }
        return ViewWindow(
            startDay: key, endDay: key,
            range: ChqTime.calendar.startOfDay(for: parsed)..<end)
    }
}
