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
    ///   forces it to `.all` (`let scope: DateScope = (isCurrentYear ||
    ///   sel.dateScope == .day) ? sel.dateScope : .all`), because a past or
    ///   future season has no "now" — **except `.day`**, which names an
    ///   absolute date and is exempt from that downgrade. Selection is
    ///   therefore derived from that reality rather than from what happens
    ///   to be persisted.
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
        // The one place the pipeline's real scope is decided. Before this,
        // the same rules were restated here in a `guard isCurrentYear else`
        // block that had to stay in step with `EventFilter` by hand.
        let effective = EffectiveScope.resolve(selection, isCurrentYear: isCurrentYear)

        switch scope {
        case .thisWeek:
            if effective == .thisWeek { return true }
            // Selecting *only* the current week is the same range as
            // "This Week"; selecting it alongside others is not. That
            // equivalence is itself a current-year concept — off-year there
            // is no "current week" for the browsed season to match against
            // — so it is additionally gated on `isCurrentYear`, matching the
            // unconditional `false` the old `guard isCurrentYear else` block
            // returned for `.thisWeek`.
            guard isCurrentYear, let currentWeek else { return false }
            return selection.selectedWeeks == [currentWeek]

        case .all:
            // "All" means unfiltered dates, so a week selection un-selects it
            // even when the effective scope is `.all`.
            return effective == .all && selection.selectedWeeks.isEmpty

        case .day:
            // Never rendered as a chip — `.day` is derived, not pickable —
            // but answered honestly rather than left to the caller.
            return effective == .day

        case .next, .today, .season:
            return effective == scope
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
