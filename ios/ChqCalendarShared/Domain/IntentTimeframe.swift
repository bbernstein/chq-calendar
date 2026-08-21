import Foundation

/// The timeframe vocabulary behind the Siri surface (#193), resolved to
/// concrete NY-time `DateInterval`s against the season calendar.
/// `nonisolated` — see `IntentDataSource.swift`'s doc comment.
nonisolated enum IntentTimeframe: String, CaseIterable, Sendable {
    case today, tonight, tomorrow, thisWeek, nextWeek
    case week1, week2, week3, week4, week5, week6, week7, week8, week9

    /// The explicit season week number, or `nil` for the relative cases.
    var explicitWeek: Int? {
        switch self {
        case .week1: return 1
        case .week2: return 2
        case .week3: return 3
        case .week4: return 4
        case .week5: return 5
        case .week6: return 6
        case .week7: return 7
        case .week8: return 8
        case .week9: return 9
        default: return nil
        }
    }

    /// How the timeframe is spoken back in a dialog ("No movies *tonight*.").
    var spokenLabel: String {
        switch self {
        case .today: return "today"
        case .tonight: return "tonight"
        case .tomorrow: return "tomorrow"
        case .thisWeek: return "this week"
        case .nextWeek: return "next week"
        default: return "week \(explicitWeek!)"
        }
    }

    /// The NY-time window this timeframe means at `now`. Relative week
    /// cases use the season's Saturday-noon week boundaries when `now` is
    /// in season, and a plain 7-day window otherwise (so off-season
    /// queries still resolve and the empty result produces an off-season
    /// dialog rather than a crash).
    func interval(now: Date, year: Int) -> DateInterval {
        let cal = ChqTime.calendar
        switch self {
        case .today:
            return DateInterval(start: now, end: max(now, ChqTime.endOfDay(now)))
        case .tonight:
            var c = cal.dateComponents([.year, .month, .day], from: now)
            c.hour = 17
            let five = cal.date(from: c) ?? now
            let start = max(now, five)
            return DateInterval(start: start, end: max(start, ChqTime.endOfDay(now)))
        case .tomorrow:
            let t = cal.date(byAdding: .day, value: 1, to: now) ?? now
            return DateInterval(start: cal.startOfDay(for: t), end: ChqTime.endOfDay(t))
        case .thisWeek:
            if let n = SeasonCalendar.currentWeekNumber(at: now, year: year) {
                return DateInterval(start: now, end: max(now, SeasonCalendar.weeks(forYear: year)[n - 1].end))
            }
            return DateInterval(start: now, end: cal.date(byAdding: .day, value: 7, to: now) ?? now)
        case .nextWeek:
            let weeks = SeasonCalendar.weeks(forYear: year)
            if let n = SeasonCalendar.currentWeekNumber(at: now, year: year) {
                if n < 9 {
                    let w = weeks[n] // weeks[n] is week n+1 (0-indexed array)
                    return DateInterval(start: w.start, end: w.end)
                }
                // Week 9: "next week" is past the season — zero-length
                // window yields no matches and an off-season dialog.
                return DateInterval(start: weeks[8].end, end: weeks[8].end)
            }
            let start = cal.date(byAdding: .day, value: 7, to: now) ?? now
            return DateInterval(start: start, end: cal.date(byAdding: .day, value: 14, to: now) ?? start)
        default:
            let w = SeasonCalendar.weeks(forYear: year)[explicitWeek! - 1]
            return DateInterval(start: w.start, end: w.end)
        }
    }

    /// The single NY day this timeframe should open the Events tab on — the
    /// first day of `interval`, in `ChqTime.dayKey` form.
    ///
    /// A timeframe names a *window*; navigation needs a *day*. Taking the
    /// window's first day is what makes "what's happening this week" and
    /// "show me this week" agree about where the reader lands, and the day
    /// rail carries them onward from there.
    ///
    /// Always returns a canonical key, including for the degenerate windows
    /// `interval` produces off-season and for week 9's "next week" — whether
    /// that day is *reachable* is `ViewWindow.navigableBounds`' question, and
    /// `OpenDayIntent` asks it.
    func targetDayKey(now: Date, year: Int) -> String {
        ChqTime.dayKey(for: interval(now: now, year: year).start)
    }
}

/// Where `now` falls relative to `year`'s season — drives the off-season
/// dialog shapes ("The 2026 season has ended…").
nonisolated enum SeasonStatus: Equatable, Sendable {
    case preSeason(start: Date)
    case inSeason
    case postSeason

    static func make(now: Date, year: Int) -> SeasonStatus {
        let weeks = SeasonCalendar.weeks(forYear: year)
        guard let first = weeks.first, let last = weeks.last else { return .inSeason }
        if now < first.start { return .preSeason(start: first.start) }
        if now >= last.end { return .postSeason }
        return .inSeason
    }
}
