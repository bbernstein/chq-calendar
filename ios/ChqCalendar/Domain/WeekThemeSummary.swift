import Foundation

/// One week's theme, formatted for display beside a day-header week badge.
///
/// The Chautauqua season is organised around a theme per week, and the app
/// has always fetched them (`EventRepository`'s weekly-themes sidecar) without
/// ever showing them. This is the display model that closes that gap.
///
/// `description` is deliberately absent. Every theme in the 2026 feed carries
/// an empty one, so rendering it — and testing both sides of the branch —
/// would be building for data that does not exist. The field stays decoded on
/// `WeeklyTheme`; see that type.
nonisolated struct WeekThemeSummary: Equatable, Sendable {
    let weekNumber: Int
    let title: String
    /// `nil` when either endpoint fails to parse. The title is the point, so
    /// a bad date costs the range and nothing else.
    let dateRange: String?

    var weekLabel: String { "Week \(weekNumber)" }

    /// The theme for `week`, or `nil` if there isn't one.
    ///
    /// `nil` is a normal, frequent answer, not an error: the 2025 sidecar
    /// 404s so `themes` is empty for that whole season, and a partial file
    /// leaves individual weeks uncovered. Callers use `nil` to decide whether
    /// the badge is interactive at all.
    ///
    /// Matched on `number`, never on array position — the feed's order is not
    /// guaranteed and it need not contain all nine weeks.
    static func make(forWeek week: Int, in themes: [WeeklyTheme]) -> WeekThemeSummary? {
        guard let theme = themes.first(where: { $0.number == week }) else { return nil }
        return WeekThemeSummary(
            weekNumber: theme.number,
            title: theme.title,
            dateRange: dateRange(from: theme.startDate, to: theme.endDate))
    }

    // MARK: Date range

    private static let monthAbbreviations = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]

    /// `"Aug 1–8"` within a month, `"Jun 27–Jul 4"` across one. En dash.
    ///
    /// Deliberately string parsing rather than `ChqTime.parse`, which expects
    /// a datetime: these are date-only `yyyy-MM-dd` values, and formatting a
    /// label needs no time zone and no clock. That keeps this function pure
    /// and its tests independent of the calendar.
    ///
    /// The web renders both months always (`Aug 1–Aug 8`); collapsing the
    /// same-month case reads better in a popover this narrow.
    private static func dateRange(from start: String, to end: String) -> String? {
        guard let (startMonth, startDay) = monthAndDay(start),
              let (endMonth, endDay) = monthAndDay(end)
        else { return nil }

        let startLabel = "\(monthAbbreviations[startMonth - 1]) \(startDay)"
        if startMonth == endMonth {
            return "\(startLabel)\u{2013}\(endDay)"
        }
        return "\(startLabel)\u{2013}\(monthAbbreviations[endMonth - 1]) \(endDay)"
    }

    /// Parses `"yyyy-MM-dd"`. Returns `nil` for anything else, including a
    /// well-shaped string with an impossible month — the array index below
    /// would trap on it.
    private static func monthAndDay(_ iso: String) -> (month: Int, day: Int)? {
        let parts = iso.split(separator: "-")
        guard parts.count == 3,
              let month = Int(parts[1]), (1...12).contains(month),
              let day = Int(parts[2]), (1...31).contains(day)
        else { return nil }
        return (month, day)
    }
}
