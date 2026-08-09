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

    /// The slice of `bounds` the strip shows right now.
    ///
    /// When `today` is inside `bounds`, the default slice runs
    /// `today - defaultDaysBefore ... today + defaultDaysAfter`, clamped to
    /// `bounds`; `showsEarlier` and `showsLater` extend each end
    /// independently out to the bound, so opening the past never drags the
    /// whole future along.
    ///
    /// The `canExpand` flags are computed from the *default* slice, not the
    /// current one, so a control stays on screen after its end is expanded
    /// and can toggle back. They go `false` only when the default slice
    /// already reached that bound — a control near a season edge disappears
    /// on its own rather than expanding into nothing.
    ///
    /// When `today` is outside `bounds` — off-season, or any past season —
    /// a window measured from "today" is meaningless, so the whole of
    /// `bounds` is shown, both flags are `false`, and `showsEarlier` /
    /// `showsLater` are ignored.
    ///
    /// - Parameter selectedDay: the day currently selected in the strip, if
    ///   any. A day can be selected only while its end is expanded — e.g.
    ///   tapping a chip revealed by `showsEarlier` — and collapsing that end
    ///   afterwards must not orphan the selection: no chip would carry
    ///   `.id(selectedDay)`, so the view's re-anchoring `scrollTo` would
    ///   silently do nothing and the strip would render with no chip
    ///   highlighted at all, even while the plan below is still showing that
    ///   day. When `selectedDay` falls inside `bounds`, the slice is widened
    ///   to include it so the invariant "the visible window always contains
    ///   the selection" holds regardless of expansion state — and holds as a
    ///   property of this type, pinned by a unit test, rather than being
    ///   reproduced (or missed) at each view call site. A `selectedDay`
    ///   outside `bounds` entirely is not this function's problem — that's
    ///   `reconcileSelection`'s job — so it's ignored here.
    static func make(
        bounds: ClosedRange<String>,
        today: String,
        showsEarlier: Bool,
        showsLater: Bool,
        selectedDay: String? = nil
    ) -> DayWindow {
        guard bounds.contains(today) else {
            return DayWindow(
                days: ChqTime.dayKeys(from: bounds.lowerBound, through: bounds.upperBound),
                canExpandEarlier: false,
                canExpandLater: false,
                hiddenEarlierCount: 0,
                hiddenLaterCount: 0)
        }

        let defaultLower = ChqTime.day(today, offsetBy: -defaultDaysBefore) ?? bounds.lowerBound
        let defaultUpper = ChqTime.day(today, offsetBy: defaultDaysAfter) ?? bounds.upperBound
        let clampedLower = Swift.max(defaultLower, bounds.lowerBound)
        let clampedUpper = Swift.min(defaultUpper, bounds.upperBound)

        var lower = showsEarlier ? bounds.lowerBound : clampedLower
        var upper = showsLater ? bounds.upperBound : clampedUpper

        if let selectedDay, bounds.contains(selectedDay) {
            lower = Swift.min(lower, selectedDay)
            upper = Swift.max(upper, selectedDay)
        }

        // `dayKeys` is inclusive of both ends, so the number of days
        // strictly outside the clamp is the inclusive span minus the shared
        // boundary day. Measured against the final `lower`/`upper` (which
        // may have been widened above to keep the selection visible), not
        // against the clamp, so the counts stay truthful about what is
        // actually hidden right now.
        let hiddenEarlier = showsEarlier
            ? 0
            : Swift.max(0, ChqTime.dayKeys(from: bounds.lowerBound, through: lower).count - 1)
        let hiddenLater = showsLater
            ? 0
            : Swift.max(0, ChqTime.dayKeys(from: upper, through: bounds.upperBound).count - 1)

        return DayWindow(
            days: ChqTime.dayKeys(from: lower, through: upper),
            canExpandEarlier: clampedLower > bounds.lowerBound,
            canExpandLater: clampedUpper < bounds.upperBound,
            hiddenEarlierCount: hiddenEarlier,
            hiddenLaterCount: hiddenLater)
    }

    /// Which day the planner opens to.
    ///
    /// - Nothing starred at all → `nil`. The view shows its all-season
    ///   empty state, so there is no day to select.
    /// - `today` inside `bounds` → **`today`, even when today has nothing
    ///   starred.** This is the fix for #192: the previous behavior skipped
    ///   an empty today forward to the next day that did have favorites,
    ///   which relocates a visitor who asked "what am I doing today" and
    ///   answers a different question. Now that every day in the window is
    ///   selectable, an empty today can simply show as empty.
    /// - Otherwise → `DayPlan.defaultDayKey`, which already returns the
    ///   earliest future starred day when `today` precedes them all (the
    ///   pre-season case) and the latest starred day when `today` follows
    ///   them all (post-season, and any past season). Reused rather than
    ///   reimplemented, so its existing tests keep pinning it.
    static func defaultSelection(
        bounds: ClosedRange<String>,
        today: String,
        starredDays: [String]
    ) -> String? {
        guard !starredDays.isEmpty else { return nil }
        if bounds.contains(today) { return today }
        guard let todayDate = ChqTime.parse("\(today) 00:00:00") else {
            return starredDays.min()
        }
        // `defaultDayKey` is non-nil whenever `available` is non-empty,
        // which the guard above has already established; the coalesce keeps
        // this a total function rather than relying on that from a distance.
        return DayPlan.defaultDayKey(available: starredDays, now: todayDate) ?? starredDays.min()
    }
}
