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
    /// behave as `.all` — a past/future season has no "now". `.day` is
    /// excluded from that downgrade: it names an absolute date rather than a
    /// window relative to "now", so it is just as meaningful off the current
    /// year.
    ///
    /// `SeasonCalendar.weeks(forYear:)` is computed once here, for the weeks
    /// filter below — it rebuilds all 9 `SeasonWeek` structs, so
    /// recomputing it per event would be wasteful. `ViewWindow.base` builds
    /// its own separate copy, but only for the two scopes that actually
    /// read it (`.season`, `.thisWeek`), not on every call — and it isn't
    /// shared with the copy here, since threading a `[SeasonWeek]` across
    /// that boundary would trade one cheap 9-struct build for coupling the
    /// two call sites together. `bounds` below is `DayWindow.bounds`'s
    /// cheaper season-only range on the common path, not
    /// `navigableBounds`'s O(n) per-event scan — see the comment at its
    /// call site for why that scan is skippable here.
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

        // The date stage. One half-open range check for every scope — the six
        // branches this replaced all reduce to this once the scope has been
        // turned into a window. A `nil` window means the scope resolves to no
        // window at all — reachable via a `.day` scope whose key doesn't parse
        // at all. For a key that *does* parse but isn't canonical (e.g.
        // `"2026-8-9"`), the old string comparison matched nothing — it
        // compared events against a string no `dayKey` ever emits — while
        // `ChqTime.parse`'s variable-width digits now produce a real window,
        // so the two are NOT observably identical for that input. That input
        // is unreachable in practice: `browseDay` normalizes every key
        // through `ChqTime.dayKey(for: parsed)` before storing it, and
        // `selectedDayKey` is never persisted, so no non-canonical key can
        // reach here. `.thisWeek` out of season does NOT hit any of this:
        // `ViewWindow.base` gives it a seven-day fallback and never returns
        // `nil` for it.
        //
        // `navigableBounds` is an O(n) scan over every event (via
        // `ChqTime.dayKey(for:)`) to build the season-and-starred-and-event
        // widened bounds. `EventFilter` reads only `window.contains(_:)`
        // below, never `startDay`/`endDay`, so those bounds matter only to
        // clamp `ViewWindow.make`'s expansion inputs — and those inputs are
        // `nil` on almost every call, since expansion only happens once the
        // user has actually navigated. When neither is set, the cheaper
        // season-only `DayWindow.bounds` is enough: it can't disagree with
        // `navigableBounds` about anything this function reads, only about
        // the `.all` scope's (here-unused) day-key projection — see
        // `ViewWindow.make`'s doc for that.
        let hasExpansion = sel.windowStartDayKey != nil || sel.windowEndDayKey != nil
        let bounds = hasExpansion
            ? ViewWindow.navigableBounds(year: year, events: events, starredDays: [])
            : DayWindow.bounds(year: year, starredDays: [])
        guard let window = ViewWindow.make(
            selection: sel, events: events, now: now,
            year: year, isCurrentYear: isCurrentYear, bounds: bounds)
        else { return [] }
        result = result.filter { window.contains($0.start) }

        if !sel.selectedWeeks.isEmpty {
            let selected = weeks.filter { sel.selectedWeeks.contains($0.number) }
            result = result.filter { event in selected.contains { $0.contains(event.start) } }
        }

        // Lowercased once per call rather than per event — mirrors the web's
        // `selectedLocationsLowerSet` / `selectedTagsLowerSet` memos. The
        // selection itself stores original casing so it can be rendered as
        // chip labels; only the comparison is case-folded.
        if !sel.selectedLocations.isEmpty {
            let selected = Set(sel.selectedLocations.map { $0.lowercased() })
            result = result.filter { event in
                guard let location = event.displayLocation?.lowercased() else { return false }
                return selected.contains(location)
            }
        }

        if !sel.selectedCategories.isEmpty {
            let selected = Set(sel.selectedCategories.map { $0.lowercased() })
            result = result.filter { !selected.isDisjoint(with: $0.filterTokens) }
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
    /// There is no whole-phrase stage: the term is lowercased and split on
    /// spaces, and each word is scored independently, then summed. For
    /// *every* word: title +100, location +90, each matching `filterToken`
    /// +85 (summed, so multiple token hits stack), details +50, presenter
    /// +25. Additionally, for words longer than 2 characters: title +10,
    /// location +9, *any* matching token +7 (flat, not summed per token),
    /// details +5, presenter +3. So a single word that's long enough gets
    /// both tiers; a query is just the sum of its words' scores.
    static func searchScore(event: Event, term: String) -> Int {
        let trimmed = term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return 0 }
        let lowerTerm = trimmed.lowercased()

        let title = event.title.lowercased()
        let location = event.displayLocation?.lowercased()
        let details = event.details?.lowercased()
        let presenter = event.presenter?.lowercased()
        let tokens = event.filterTokens

        let words = lowerTerm
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }

        var score = 0

        for word in words {
            if title.contains(word) { score += 100 }
            if let location, location.contains(word) { score += 90 }
            for token in tokens where token.contains(word) { score += 85 }
            if let details, details.contains(word) { score += 50 }
            if let presenter, presenter.contains(word) { score += 25 }

            guard word.count > 2 else { continue }

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
