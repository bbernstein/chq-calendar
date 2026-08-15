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

        let scope = EffectiveScope.resolve(selection, isCurrentYear: isCurrentYear)

        // Resolved before the week logic: a selection carrying both a day and
        // weeks is filtered by both, and the day is never the wider of the
        // two — so naming it cannot overclaim, while naming the week can
        // (#197 item 5).
        if scope == .day,
           let dayKey = selection.selectedDayKey,
           let date = ChqTime.parse("\(dayKey) 00:00:00") {
            return ChqTime.pillDayLabel(for: date, includingYear: !isCurrentYear)
        }

        guard !weeks.isEmpty else {
            return scope == .all ? DateScope.all.label : scope.label
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
