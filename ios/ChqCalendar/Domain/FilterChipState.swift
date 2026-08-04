import Foundation

/// Pure derivations for which date-range chips render as selected.
///
/// The iOS equivalents of the web's `isThisWeekActive` and
/// `isWeekHighlighted` (frontend/src/app/page.tsx). "This Week" and the
/// current week's own chip describe the *same* range, so choosing either
/// lights both — that equivalence is the whole reason these live here
/// rather than being read straight off `FilterSelection`.
nonisolated enum FilterChipState {
    /// - Parameter isCurrentYear: must be the same value the caller passes
    ///   to `EventFilter.apply` (and to `DateFilterLabel.text`). When it is
    ///   `false` the stored `dateScope` is **meaningless** — the pipeline
    ///   forces it to `.all` (`let scope: DateScope = isCurrentYear ?
    ///   sel.dateScope : .all`), because a past or future season has no
    ///   "now". Selection is therefore derived from that reality rather
    ///   than from what happens to be persisted.
    ///
    ///   Deliberately **not defaulted**, for the same reason
    ///   `DateFilterLabel.text` isn't: a default lets a future call site
    ///   omit it and silently go back to reporting a scope the pipeline is
    ///   ignoring.
    ///
    ///   This is the fix for the state where a persisted `.next` scope
    ///   viewed against a past season left `DateFilterSheet`'s sole
    ///   visible chip — "All", the only date control on offer — rendering
    ///   unselected over a list that was not date-filtered at all. Note
    ///   the fix belongs **here** and not at the call site: an earlier
    ///   revision hardcoded `isSelected: true` for that collapsed chip and
    ///   it had to be reverted, because a week selection surviving
    ///   `AppModel.select(year:)` then lit both the "All" chip and the
    ///   week grid at once. `FilterChipState` stays the single source of
    ///   truth; it was merely missing an input.
    static func isScopeSelected(
        _ scope: DateScope,
        selection: FilterSelection,
        currentWeek: Int?,
        isCurrentYear: Bool
    ) -> Bool {
        guard isCurrentYear else {
            switch scope {
            case .all:
                // The weeks stage of `EventFilter` runs regardless of
                // `isCurrentYear`, so a week selection is the one date
                // filter that *is* still in force on a past season — and
                // it un-selects "All" exactly as it does on the current
                // year. With no weeks, nothing is filtering dates, which
                // is precisely what "All" means.
                return selection.selectedWeeks.isEmpty
            case .next, .today, .thisWeek:
                // Unreachable through `DateFilterSheet`, whose
                // `visibleScopes` collapses to `[.all]` off the current
                // year — but answered rather than trusted to the caller.
                // The pipeline is ignoring these scopes, so no chip
                // claiming one may light up.
                return false
            }
        }

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
