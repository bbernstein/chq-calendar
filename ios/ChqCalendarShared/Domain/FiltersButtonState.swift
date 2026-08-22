import Foundation

/// The Filters toolbar button's two outputs, derived from one expression.
///
/// They lived apart and disagreed (#256 review fix). The icon filled on
/// `count > 0 || !selection.isDefault`; the accessibility label branched on
/// `count == 0` alone. A reader with only Weeks 1, 3 and 5 selected has
/// `count == 0` and `isDefault == false`, so they saw a **filled** icon and
/// heard **"Filters, none active."** — the wrong answer on the one surface
/// that cannot see the icon, and precisely the week/scope-only narrowing the
/// second half of the fill condition was added to signal.
///
/// Pure, and here rather than in `EventListView`, so `isActive` and
/// `accessibilityLabel` can be asserted to agree for every combination
/// instead of being kept in step by hand.
nonisolated enum FiltersButtonState {
    /// Whether anything the reader chose is narrowing the list — the filled
    /// icon, and the same question the label answers.
    ///
    /// The two halves are both needed. `ActiveFilterCount.value(for:)`
    /// deliberately excludes date scope and week selection (its own doc
    /// explains why: they used to be summarised by the date pill next to
    /// this button, and counting them twice would double-report one
    /// decision). That pill is gone, and nothing else on screen says the
    /// list is narrowed by scope or weeks.
    ///
    /// Deliberately `isDefault`, not `hasDateFilters`:
    /// `FilterSelection.hasDateFilters` is true on a fresh install, because
    /// the default `dateScope` is `.next` and it tests `dateScope != .all` —
    /// it would light the icon for every reader before they touched
    /// anything, and an indicator that is always on communicates nothing.
    static func isActive(count: Int, selection: FilterSelection) -> Bool {
        count > 0 || !selection.isDefault
    }

    /// What VoiceOver reads for the button.
    ///
    /// - `dateLabel` is `DateFilterLabel.text(for:seasonWeekCount:isCurrentYear:)`
    ///   — the same sentence the Filters sheet's WHEN section shows. Design
    ///   A5 folded it into this button's label for the case the count cannot
    ///   describe: a selection narrowed *only* by scope or weeks, where
    ///   "active" alone leaves a screen-reader user with nothing to act on
    ///   and no way to find out what is hiding their events.
    static func accessibilityLabel(
        count: Int, selection: FilterSelection, dateLabel: String
    ) -> String {
        let state: String
        if count > 0 {
            state = "\(count) active"
        } else if !selection.isDefault {
            // The count is zero and something is still narrowing the list,
            // so the date range is the whole of what is active — naming it
            // is both the honest answer and the actionable one.
            state = "\(dateLabel) only"
        } else {
            state = "none active"
        }
        return "Filters, \(state). Double tap to change."
    }
}
