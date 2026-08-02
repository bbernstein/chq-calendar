import Foundation

/// Pure derivations for which date-range chips render as selected.
///
/// The iOS equivalents of the web's `isThisWeekActive` and
/// `isWeekHighlighted` (frontend/src/app/page.tsx). "This Week" and the
/// current week's own chip describe the *same* range, so choosing either
/// lights both — that equivalence is the whole reason these live here
/// rather than being read straight off `FilterSelection`.
nonisolated enum FilterChipState {
    static func isScopeSelected(
        _ scope: DateScope,
        selection: FilterSelection,
        currentWeek: Int?
    ) -> Bool {
        switch scope {
        case .thisWeek:
            if selection.dateScope == .thisWeek { return true }
            // Selecting *only* the current week is the same range as
            // "This Week"; selecting it alongside others is not.
            guard let currentWeek else { return false }
            return selection.selectedWeeks == [currentWeek]
        case .all:
            // "All" means unfiltered dates, so a week selection un-selects it
            // even though `dateScope` is still `.all`.
            return selection.dateScope == .all && selection.selectedWeeks.isEmpty
        case .next, .today:
            return selection.dateScope == scope
        }
    }

    static func isWeekSelected(
        _ n: Int,
        selection: FilterSelection,
        currentWeek: Int?
    ) -> Bool {
        if selection.selectedWeeks.contains(n) { return true }
        return selection.dateScope == .thisWeek && currentWeek == n
    }
}
