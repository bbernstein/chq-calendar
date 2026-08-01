import Foundation

/// The filter pipeline that turns raw events + the user's `FilterSelection`
/// into the events actually shown. Mirrors the web app's pipeline order:
/// search → dateScope → weeks → locations → categories → favorites. Each
/// stage narrows the set produced by the previous one.
nonisolated enum EventFilter {
    /// Runs the full pipeline. `now`/`year`/`isCurrentYear` govern the
    /// date-relative stages: `now` is the reference instant, `year` selects
    /// the season used for week math, and `isCurrentYear == false` forces
    /// any time-relative `dateScope` (`.next`/`.today`/`.thisWeek`) to
    /// behave as `.all` — a past/future season has no "now".
    ///
    /// `SeasonCalendar.weeks(forYear:)` is computed exactly once here and
    /// reused for both the `.thisWeek` scope and the weeks filter — it
    /// rebuilds all 9 `SeasonWeek` structs on every call, so recomputing it
    /// per event (or per stage) would be wasteful.
    static func apply(
        _ sel: FilterSelection,
        to events: [Event],
        favorites: Set<String>,
        now: Date,
        year: Int,
        isCurrentYear: Bool
    ) -> [Event] {
        var result = events

        let term = sel.searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !term.isEmpty {
            result = result.filter { searchScore(event: $0, term: term) > 0 }
        }

        let weeks = SeasonCalendar.weeks(forYear: year)
        let scope: DateScope = isCurrentYear ? sel.dateScope : .all

        switch scope {
        case .all:
            break

        case .today:
            let nowKey = ChqTime.dayKey(for: now)
            result = result.filter { ChqTime.dayKey(for: $0.start) == nowKey }

        case .next:
            let from = now.addingTimeInterval(-3600)
            let adaptiveEnd = adaptiveEndDate(events: result, from: from, minCount: 50)
            let end: Date
            if sel.extraDays != 0, let advanced = ChqTime.calendar.date(byAdding: .day, value: sel.extraDays, to: adaptiveEnd) {
                end = ChqTime.endOfDay(advanced)
            } else {
                end = adaptiveEnd
            }
            result = result.filter { $0.start >= from && $0.start <= end }

        case .thisWeek:
            if let currentWeek = weeks.first(where: { $0.contains(now) }) {
                result = result.filter { currentWeek.contains($0.start) }
            } else {
                let weekLater = now.addingTimeInterval(7 * 24 * 3600)
                result = result.filter { $0.start >= now && $0.start < weekLater }
            }
        }

        if !sel.selectedWeeks.isEmpty {
            let selected = weeks.filter { sel.selectedWeeks.contains($0.number) }
            result = result.filter { event in selected.contains { $0.contains(event.start) } }
        }

        if !sel.selectedLocations.isEmpty {
            result = result.filter { event in
                guard let location = event.displayLocation?.lowercased() else { return false }
                return sel.selectedLocations.contains(location)
            }
        }

        if !sel.selectedCategories.isEmpty {
            result = result.filter { !sel.selectedCategories.isDisjoint(with: $0.filterTokens) }
        }

        if sel.showFavoritesOnly {
            result = result.filter { favorites.contains($0.id) }
        }

        return result
    }

    /// Relevance score for `event` against `term` (already free-form, not
    /// necessarily lowercased or trimmed). Higher is more relevant; `0`
    /// means "no match" — callers keep only events with `score > 0`.
    ///
    /// Two passes:
    /// 1. Whole-term substring match: title +100, location +90, each
    ///    matching `filterToken` +85 (summed, so multiple token hits
    ///    stack), details +50, presenter +25.
    /// 2. Per-word bonus, for each word of the term longer than 2
    ///    characters: title +10, location +9, *any* matching token +7
    ///    (flat, not summed per token), details +5, presenter +3.
    static func searchScore(event: Event, term: String) -> Int {
        let trimmed = term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return 0 }
        let lowerTerm = trimmed.lowercased()

        let title = event.title.lowercased()
        let location = event.displayLocation?.lowercased()
        let details = event.details?.lowercased()
        let presenter = event.presenter?.lowercased()
        let tokens = event.filterTokens

        var score = 0

        if title.contains(lowerTerm) { score += 100 }
        if let location, location.contains(lowerTerm) { score += 90 }
        for token in tokens where token.contains(lowerTerm) { score += 85 }
        if let details, details.contains(lowerTerm) { score += 50 }
        if let presenter, presenter.contains(lowerTerm) { score += 25 }

        let words = lowerTerm
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { $0.count > 2 }

        for word in words {
            if title.contains(word) { score += 10 }
            if let location, location.contains(word) { score += 9 }
            if tokens.contains(where: { $0.contains(word) }) { score += 7 }
            if let details, details.contains(word) { score += 5 }
            if let presenter, presenter.contains(word) { score += 3 }
        }

        return score
    }

    /// The end of the `.next` scope's adaptive window: walks successive NY
    /// end-of-days starting from `from`'s day, accumulating `events` whose
    /// `start` falls in `[from, candidateEnd]`, and returns the first
    /// `candidateEnd` at which the cumulative count reaches `minCount`.
    /// Capped at `from + 90 days` (that day's end-of-day) — if `minCount`
    /// is never reached, the cap is returned regardless.
    static func adaptiveEndDate(events: [Event], from: Date, minCount: Int) -> Date {
        let calendar = ChqTime.calendar
        let maxOffset = 90
        let capDate = ChqTime.endOfDay(calendar.date(byAdding: .day, value: maxOffset, to: from) ?? from)

        // Only events on/after `from` can ever count; sorting once lets the
        // day-by-day walk below advance a single cursor instead of
        // re-scanning the whole list for every candidate end-of-day.
        let relevant = events
            .filter { $0.start >= from }
            .sorted { $0.start < $1.start }

        var index = 0
        var dayOffset = 0
        while true {
            guard let candidateDay = calendar.date(byAdding: .day, value: dayOffset, to: from) else {
                return capDate
            }
            let candidateEnd = ChqTime.endOfDay(candidateDay)
            if candidateEnd >= capDate {
                return capDate
            }

            while index < relevant.count && relevant[index].start <= candidateEnd {
                index += 1
            }

            if index >= minCount {
                return candidateEnd
            }
            dayOffset += 1
        }
    }
}
