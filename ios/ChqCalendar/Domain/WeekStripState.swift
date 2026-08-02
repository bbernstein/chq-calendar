import Foundation

/// Where a season week sits relative to "now".
nonisolated enum WeekTimeState: Equatable, Sendable {
    case past
    case current
    case upcoming
}

/// Pure inputs for how `WeekStripView` styles and scrolls its nine chips.
///
/// `now` is optional throughout: callers pass `nil` when the viewed year
/// isn't the current one. A past or future season has no "now" to be
/// relative to, so every week renders neutrally and the strip stays at
/// week 1 rather than guessing.
nonisolated enum WeekStripState {
    static func timeState(week n: Int, now: Date?, year: Int) -> WeekTimeState {
        guard let now,
              let week = SeasonCalendar.weeks(forYear: year).first(where: { $0.number == n })
        else {
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
