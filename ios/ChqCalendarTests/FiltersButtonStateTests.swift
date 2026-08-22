import Foundation
import Testing
@testable import ChqCalendar

/// The Filters toolbar button's icon and its spoken name (#256 review fix).
///
/// The defect these exist to prevent: the icon filled on
/// `count > 0 || !selection.isDefault` while the label branched on
/// `count == 0` alone, so a reader with only Weeks 1, 3 and 5 selected saw a
/// **filled** icon and heard **"Filters, none active."** — wrong on the one
/// surface that cannot see the icon.
struct FiltersButtonStateTests {
    private func selection(
        weeks: Set<Int> = [], scope: DateScope = .next, search: String = "",
        favorites: Bool = false
    ) -> FilterSelection {
        var value = FilterSelection()
        value.selectedWeeks = weeks
        value.dateScope = scope
        value.searchText = search
        value.showFavoritesOnly = favorites
        return value
    }

    private func label(_ selection: FilterSelection, dateLabel: String = "Weeks 1, 3, 5") -> String {
        FiltersButtonState.accessibilityLabel(
            count: ActiveFilterCount.value(for: selection),
            selection: selection,
            dateLabel: dateLabel)
    }

    private func isActive(_ selection: FilterSelection) -> Bool {
        FiltersButtonState.isActive(
            count: ActiveFilterCount.value(for: selection), selection: selection)
    }

    @Test func anUntouchedSelectionIsNeitherFilledNorAnnouncedAsActive() {
        let value = selection()
        #expect(isActive(value) == false)
        #expect(label(value) == "Filters, none active. Double tap to change.")
    }

    @Test func aWeekOnlyNarrowingIsAnnouncedAsActive() {
        // The regression itself. `ActiveFilterCount` excludes weeks, so this
        // selection counts zero — and used to be announced as "none active"
        // beside a filled icon.
        let value = selection(weeks: [1, 3, 5])
        #expect(isActive(value))
        #expect(label(value).contains("none active") == false)
    }

    @Test func aWeekOnlyNarrowingNamesTheDateRangeItIsNarrowedBy() {
        // Design A5: `DateFilterLabel` becomes part of this button's
        // accessibility label. "Active" on its own leaves a screen-reader
        // user with nothing to act on.
        let value = selection(weeks: [1, 3, 5])
        #expect(label(value) == "Filters, Weeks 1, 3, 5 only. Double tap to change.")
    }

    @Test func aScopeOnlyNarrowingIsAnnouncedTheSameWay() {
        let value = selection(scope: .today)
        #expect(isActive(value))
        #expect(label(value, dateLabel: "Today")
            == "Filters, Today only. Double tap to change.")
    }

    @Test func countedFiltersStillReportTheirCount() {
        let value = selection(search: "meditation", favorites: true)
        #expect(isActive(value))
        #expect(label(value) == "Filters, 2 active. Double tap to change.")
    }

    /// The property the split caused: whatever the selection, the icon's
    /// fill and the label's claim must be the same claim.
    @Test(arguments: [
        FilterSelection(),
    ] + [
        ([1], DateScope.next, "", false),
        ([], .today, "", false),
        ([], .season, "", false),
        ([], .all, "", false),
        ([], .next, "burns", false),
        ([], .next, "", true),
        ([2, 3], .all, "burns", true),
    ].map { weeks, scope, search, favorites -> FilterSelection in
        var value = FilterSelection()
        value.selectedWeeks = Set(weeks)
        value.dateScope = scope
        value.searchText = search
        value.showFavoritesOnly = favorites
        return value
    })
    func theIconAndTheLabelNeverDisagree(value: FilterSelection) {
        let saysNothingActive = label(value).contains("none active")
        #expect(isActive(value) == !saysNothingActive)
    }
}
