import Foundation
import Testing
@testable import ChqCalendar

struct EventGroupingTests {
    // MARK: - EventGrouping.byDay

    @Test func byDaySortsGroupsAscendingAndEventsAscendingWithinDay() throws {
        let events = [
            makeEvent(id: "b", start: try #require(ChqTime.parse("2026-07-05 14:00:00"))),
            makeEvent(id: "a", start: try #require(ChqTime.parse("2026-07-05 09:00:00"))),
            makeEvent(id: "c", start: try #require(ChqTime.parse("2026-07-01 10:00:00"))),
        ]

        let groups = EventGrouping.byDay(events, year: 2026)

        #expect(groups.map(\.dayKey) == ["2026-07-01", "2026-07-05"])
        #expect(groups[0].events.map(\.id) == ["c"])
        #expect(groups[1].events.map(\.id) == ["a", "b"])
        #expect(groups[0].title == "Wednesday, July 1")
        #expect(groups[0].id == "2026-07-01")
    }

    @Test func byDayWeekNumbersSpanBothWeeksOnJuly4Boundary() throws {
        let event = makeEvent(id: "e1", start: try #require(ChqTime.parse("2026-07-04 08:00:00")))

        let groups = EventGrouping.byDay([event], year: 2026)

        #expect(groups.first?.weekNumbers == [1, 2])
    }

    @Test func byDayWeekNumbersSingleWeekMidweek() throws {
        let event = makeEvent(id: "e1", start: try #require(ChqTime.parse("2026-07-08 12:00:00")))

        let groups = EventGrouping.byDay([event], year: 2026)

        #expect(groups.first?.weekNumbers == [2])
    }

    @Test func byDayReturnsEmptyForNoEvents() {
        #expect(EventGrouping.byDay([], year: 2026).isEmpty)
    }

    // MARK: - DisplayNames.location / .category

    @Test func locationShortcutsMapKnownVenuesAndPassThroughOthers() {
        #expect(DisplayNames.location("Elizabeth S. Lenna Hall") == "Lenna Hall")
        #expect(DisplayNames.location("Smith Wilkes Hall") == "Smith Wilkes")
        #expect(DisplayNames.location("Hall of Philosophy") == "Hall of Philosophy")
    }

    @Test func categoryShortcutsMapKnownCategoriesAndPassThroughOthers() {
        #expect(DisplayNames.category("Chautauqua Symphony Orchestra/Classical Concerts") == "CSO")
        #expect(DisplayNames.category("Chautauqua Institution Program") == "CHQ Program")
        #expect(DisplayNames.category("Chautauqua Literary and Scientific Circle (CLSC)") == "CLSC")
        #expect(DisplayNames.category("Climate Change Initiative Program") == "Climate Change Program")
        #expect(DisplayNames.category("Recreation") == "Recreation")
    }

    // MARK: - DisplayNames.visibleCategories / .visibleLocations

    @Test func visibleCategoriesExcludesWeekPrefixedNamesAndDedupes() {
        let events = [
            makeEvent(id: "1", start: Date(), categories: ["Week One", "Recreation"]),
            makeEvent(id: "2", start: Date(), categories: ["Chautauqua Institution Program", "Recreation"]),
        ]

        let visible = DisplayNames.visibleCategories(from: events)

        #expect(visible == ["Chautauqua Institution Program", "Recreation"])
        #expect(!visible.contains("Week One"))
    }

    @Test func visibleLocationsSortedByDisplayNameNotRawName() {
        // Raw-name order would be ["Elizabeth S. Lenna Hall", "Hall of
        // Philosophy"] (E < H). Sorting by *display* name reverses that,
        // since "Lenna Hall" (L) sorts after "Hall of Philosophy" (H) —
        // this is the discriminating case that proves the sort key is the
        // shortcut name, not the raw name.
        let events = [
            makeEvent(id: "1", start: Date(), location: "Elizabeth S. Lenna Hall"),
            makeEvent(id: "2", start: Date(), location: "Hall of Philosophy"),
        ]

        let visible = DisplayNames.visibleLocations(from: events)

        #expect(visible == ["Hall of Philosophy", "Elizabeth S. Lenna Hall"])
    }

    @Test func visibleLocationsDedupesAndSkipsNilLocations() {
        let events = [
            makeEvent(id: "1", start: Date(), location: "Smith Wilkes Hall"),
            makeEvent(id: "2", start: Date(), location: "Smith Wilkes Hall"),
            makeEvent(id: "3", start: Date(), location: nil),
        ]

        let visible = DisplayNames.visibleLocations(from: events)

        #expect(visible == ["Smith Wilkes Hall"])
    }
}
