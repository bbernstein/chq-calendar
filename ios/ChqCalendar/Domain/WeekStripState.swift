import Foundation

/// Where a season week sits relative to "now".
nonisolated enum WeekTimeState: Equatable, Sendable {
    case past
    case current
    case upcoming
}

/// Pure inputs for how a week strip styles and scrolls its nine chips.
///
/// `now` is optional throughout: callers pass `nil` when the viewed year
/// isn't the current one. A past or future season has no "now" to be
/// relative to, so every week renders neutrally and the strip stays at
/// week 1 rather than guessing.
///
/// **Currently referenced by nothing but its own tests.** Its only caller
/// was `WeekStripView`, deleted when the four-row filter bar was replaced by
/// the floating bar; `DateFilterSheet` renders weeks without past/current
/// styling today. Kept deliberately rather than deleted alongside the view:
/// the season-relative week logic is the non-obvious part and is worth
/// having on hand if that styling returns. Delete it in its own change, not
/// as a side effect of one about chrome.
nonisolated enum WeekStripState {
    /// Convenience for callers that only need one week's state. Builds the
    /// season once and delegates.
    ///
    /// A caller rendering all nine chips per pass should NOT use this: it
    /// would rebuild the nine-week array nine times. Hoist
    /// `SeasonCalendar.weeks(forYear:)` and call
    /// `timeState(week:now:weeks:)` instead.
    static func timeState(week n: Int, now: Date?, year: Int) -> WeekTimeState {
        timeState(week: n, now: now, weeks: SeasonCalendar.weeks(forYear: year))
    }

    /// `timeState` against an already-built season, so a caller styling every
    /// chip pays for `SeasonCalendar.weeks(forYear:)` once rather than once
    /// per chip.
    static func timeState(week n: Int, now: Date?, weeks: [SeasonWeek]) -> WeekTimeState {
        guard let now, let week = weeks.first(where: { $0.number == n }) else {
            return .upcoming
        }
        if week.contains(now) { return .current }
        return week.end <= now ? .past : .upcoming
    }

    /// The week to scroll to the leading edge on first appearance, so the
    /// current week and everything after it are visible without swiping.
    /// `nil` means "leave it at week 1" — correct both before the season
    /// starts and for a non-current year.
    static func initialScrollTarget(now: Date?, year: Int) -> Int? {
        guard let now else { return nil }
        let weeks = SeasonCalendar.weeks(forYear: year)
        if let current = weeks.first(where: { $0.contains(now) }) {
            return current.number
        }
        guard let last = weeks.last else { return nil }
        // After the season: anchor on the final week. Before it: week 1 is
        // already the leading chip, so there is nothing to scroll to.
        return last.end <= now ? last.number : nil
    }
}
