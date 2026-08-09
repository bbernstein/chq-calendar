import Foundation

/// The week slot for #193's theme queries ("what's the theme week 7") —
/// separate from `IntentTimeframe` because only weeks make sense here
/// ("what's the theme tonight" is not a question).
nonisolated enum ThemeWeek: String, CaseIterable, Sendable {
    case thisWeek, nextWeek
    case week1, week2, week3, week4, week5, week6, week7, week8, week9

    var spokenLabel: String {
        switch self {
        case .thisWeek: return "this week"
        case .nextWeek: return "next week"
        case .week1: return "week 1"
        case .week2: return "week 2"
        case .week3: return "week 3"
        case .week4: return "week 4"
        case .week5: return "week 5"
        case .week6: return "week 6"
        case .week7: return "week 7"
        case .week8: return "week 8"
        case .week9: return "week 9"
        }
    }

    /// The season week this resolves to at `now`, or `nil` when there
    /// isn't one (relative cases out of season; "next week" during week 9).
    func weekNumber(now: Date, year: Int) -> Int? {
        switch self {
        case .thisWeek:
            return SeasonCalendar.currentWeekNumber(at: now, year: year)
        case .nextWeek:
            guard let n = SeasonCalendar.currentWeekNumber(at: now, year: year), n < 9 else { return nil }
            return n + 1
        case .week1: return 1
        case .week2: return 2
        case .week3: return 3
        case .week4: return 4
        case .week5: return 5
        case .week6: return 6
        case .week7: return 7
        case .week8: return 8
        case .week9: return 9
        }
    }
}
