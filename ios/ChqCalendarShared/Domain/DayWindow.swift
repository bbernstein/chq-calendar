import Foundation

/// Which calendar days the My Day strip can show, and which subset of them
/// it is showing right now (#192).
///
/// Pure domain logic in the shape of `DayPlan`: no `Date()`, no I/O —
/// `today` is always supplied by the caller. Day keys are `ChqTime.dayKey`
/// strings (`"yyyy-MM-dd"`), whose lexicographic order is chronological,
/// which is what makes `ClosedRange<String>` a correct range type here.
///
/// The strip is driven by the *calendar*, not by the favorites set: every
/// day in the window is shown and tappable, including days with nothing
/// starred. A strip built only from starred days re-flows whenever the user
/// stars or unstars anything, so chip positions are unpredictable; a
/// calendar-driven one is stable and makes gaps in the plan visible.
nonisolated struct DayWindow: Equatable, Sendable {
    /// Visible day keys, ascending and contiguous.
    let days: [String]
    /// Whether an "earlier" control belongs on the leading edge. Stays
    /// `true` once that end is expanded, so the control can toggle back —
    /// it reports "this end *has* something to expand", not "something is
    /// hidden right now". For the latter, see `hiddenEarlierCount`.
    let canExpandEarlier: Bool
    /// As `canExpandEarlier`, for the trailing edge.
    let canExpandLater: Bool
    /// How many days are hidden before `days.first` right now — `0` once
    /// that end is expanded. Drives the control's VoiceOver label ("Show 42
    /// earlier days"); the visible chip stays narrow.
    let hiddenEarlierCount: Int
    /// As `hiddenEarlierCount`, for the trailing edge.
    let hiddenLaterCount: Int

    /// How many days before and after `today` the default (unexpanded)
    /// window covers. The near past is worth keeping — "what did I go to
    /// yesterday" — and two weeks forward covers the planning horizon.
    static let defaultDaysBefore = 7
    static let defaultDaysAfter = 14

    /// The outer limit of everything the strip can ever show: `year`'s
    /// season, widened to contain any starred day outside it.
    ///
    /// The season component runs from the opening Saturday through the day
    /// of `weeks.last.end`. That `end` is an *exclusive* noon-Saturday
    /// boundary, but that Saturday morning still holds week-9 events, so its
    /// day key belongs in the range. For 2026 this is
    /// `"2026-06-27"..."2026-08-29"` — 64 days.
    ///
    /// The widening is not cosmetic: without it a starred pre- or
    /// post-season event would be permanently unreachable from the strip.
    /// `starredDays` need not be sorted.
    static func bounds(year: Int, starredDays: [String]) -> ClosedRange<String> {
        // `SeasonCalendar.weeks` always returns exactly 9 weeks.
        let weeks = SeasonCalendar.weeks(forYear: year)
        var lower = ChqTime.dayKey(for: weeks[0].start)
        var upper = ChqTime.dayKey(for: weeks[weeks.count - 1].end)

        if let earliestStarred = starredDays.min() {
            lower = Swift.min(lower, earliestStarred)
        }
        if let latestStarred = starredDays.max() {
            upper = Swift.max(upper, latestStarred)
        }
        return lower...upper
    }
}
