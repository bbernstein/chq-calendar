import Foundation

/// The text shown on the calendar's date pill — a one-glance summary of
/// whatever date range is currently narrowing the list.
///
/// Depends on the selection and the season's week count and **nothing
/// else**. In particular it does not take the current week, even though
/// `FilterChipState` treats "only the current week is selected" as
/// equivalent to the `.thisWeek` scope. That equivalence is right for
/// deciding which week *segment* the strip highlights
/// (`FilterChipState.isWeekSelected`); it is wrong for a summary label,
/// where it would mean one selection renders as "This Week" in July and
/// "Week 6" in September. A pill that changes its wording without the user
/// touching anything is worse than a pill that is merely less clever.
///
/// `.all` renders as `DateScope.all.label` ("All Year") — deliberately not
/// "All", so it cannot be misread against "All Weeks": the first means no
/// date filter at all, the second means every week explicitly selected.
nonisolated enum DateFilterLabel {
    /// Above this many scattered weeks, the list stops being scannable and
    /// a count is more honest than an enumeration.
    private static let maxListedWeeks = 3

    /// - Parameter isCurrentYear: must be the same value the caller passes
    ///   to `EventFilter.apply`. The label has to know it because
    ///   `EventFilter` **ignores** a time-relative `dateScope` when it is
    ///   `false` (`let scope: DateScope = (isCurrentYear || sel.dateScope ==
    ///   .day) ? sel.dateScope : .all`) — a past or future season has no
    ///   "now" — **except `.day`**, which names an absolute date and is
    ///   exempt from that downgrade. Without this parameter a user whose
    ///   persisted scope is `.next`, viewing 2025, read "Now" on a list that
    ///   was not date-filtered at all.
    ///
    ///   Deliberately **not defaulted**: a default is exactly what would let
    ///   a future call site forget to pass it and silently reintroduce that
    ///   bug. Callers must state which season they are labelling.
    ///
    ///   Week selection is unaffected — `EventFilter` applies
    ///   `selectedWeeks` regardless of `isCurrentYear` (the weeks stage sits
    ///   outside the scope `switch`), so a week label is just as true on a
    ///   past season as on the current one and is left alone below.
    static func text(
        for selection: FilterSelection,
        seasonWeekCount: Int,
        isCurrentYear: Bool
    ) -> String {
        let weeks = selection.selectedWeeks.sorted()

        guard !weeks.isEmpty else {
            // `.day` is handled *before* the `isCurrentYear` shortcut below.
            // That shortcut is correct only because every other scope is
            // downgraded to `.all` for a non-current year, which makes
            // "All Year" a true statement about what the list is showing.
            // `.day` survives that downgrade (see `EventFilter.apply`), so
            // taking the shortcut would leave the pill claiming "All Year"
            // over a day-filtered list — the pill lying about the filter,
            // which is exactly the failure this type's doc comment warns
            // about for `.next` (#192).
            if selection.dateScope == .day,
               let dayKey = selection.selectedDayKey,
               let date = ChqTime.parse("\(dayKey) 00:00:00") {
                return ChqTime.pillDayLabel(for: date, includingYear: !isCurrentYear)
            }

            guard isCurrentYear else { return "All Year" }
            switch selection.dateScope {
            case .all: return DateScope.all.label            // "All Year"
            case .next, .today, .thisWeek, .season: return selection.dateScope.label
            // Reached when `selectedDayKey` is `nil` (in which case
            // `EventFilter` filters nothing, so "All Year" is true) or when
            // it's a non-nil string this parse can't read. The latter is
            // unreachable today — every key in practice comes from
            // `ChqTime.dayKey`, which this always parses back — but if it
            // ever weren't, `EventFilter.apply` does a raw string compare
            // rather than parsing, so a malformed key would filter every
            // event out while this still says "All Year" over the empty
            // result. Documented rather than guarded against, since nothing
            // constructs that key today.
            case .day: return DateScope.all.label
            }
        }

        if weeks.count == seasonWeekCount, weeks == Array(1...seasonWeekCount) {
            return "All Weeks"
        }

        if weeks.count == 1 {
            return "Week \(weeks[0])"
        }

        if isContiguous(weeks) {
            return "Weeks \(weeks[0])\u{2013}\(weeks[weeks.count - 1])"
        }

        if weeks.count <= maxListedWeeks {
            return "Weeks " + weeks.map(String.init).joined(separator: ", ")
        }

        return "\(weeks.count) Weeks"
    }

    /// `sorted` is assumed sorted ascending and free of duplicates, which a
    /// `Set<Int>.sorted()` always is.
    private static func isContiguous(_ sorted: [Int]) -> Bool {
        guard let first = sorted.first, let last = sorted.last else { return false }
        return last - first + 1 == sorted.count
    }
}
