import Testing
@testable import ChqCalendar

struct FilterChipStateTests {
    @Test func thisWeekSelectedWhenScopeIsThisWeek() {
        let sel = FilterSelection(dateScope: .thisWeek)
        #expect(FilterChipState.isScopeSelected(.thisWeek, selection: sel, currentWeek: 6))
        #expect(FilterChipState.isWeekSelected(6, selection: sel, currentWeek: 6))
        #expect(!FilterChipState.isWeekSelected(5, selection: sel, currentWeek: 6))
    }

    @Test func thisWeekSelectedWhenOnlyCurrentWeekIsSelected() {
        let sel = FilterSelection(dateScope: .all, selectedWeeks: [6])
        #expect(FilterChipState.isScopeSelected(.thisWeek, selection: sel, currentWeek: 6))
    }

    @Test func thisWeekNotSelectedWhenCurrentWeekIsOneOfSeveral() {
        let sel = FilterSelection(dateScope: .all, selectedWeeks: [6, 7])
        #expect(!FilterChipState.isScopeSelected(.thisWeek, selection: sel, currentWeek: 6))
        #expect(FilterChipState.isWeekSelected(6, selection: sel, currentWeek: 6))
        #expect(FilterChipState.isWeekSelected(7, selection: sel, currentWeek: 6))
    }

    @Test func allSelectedOnlyWhenNoWeeksAreSelected() {
        #expect(FilterChipState.isScopeSelected(
            .all, selection: FilterSelection(dateScope: .all), currentWeek: 6))
        #expect(!FilterChipState.isScopeSelected(
            .all, selection: FilterSelection(dateScope: .all, selectedWeeks: [3]), currentWeek: 6))
    }

    @Test func nowAndTodayTrackScopeDirectly() {
        let sel = FilterSelection(dateScope: .next)
        #expect(FilterChipState.isScopeSelected(.next, selection: sel, currentWeek: 6))
        #expect(!FilterChipState.isScopeSelected(.today, selection: sel, currentWeek: 6))
    }

    @Test func outOfSeasonNilCurrentWeekNeverCrossLightsChips() {
        #expect(!FilterChipState.isScopeSelected(
            .thisWeek, selection: FilterSelection(dateScope: .all, selectedWeeks: [6]), currentWeek: nil))
        #expect(!FilterChipState.isWeekSelected(
            6, selection: FilterSelection(dateScope: .thisWeek), currentWeek: nil))
    }
}
