import Testing
import Foundation
@testable import ChqCalendar

struct FacetCountsTests {
    /// A fixed instant inside the 2026 season. `isCurrentYear: false` is
    /// passed everywhere below, which forces `EventFilter` to treat any
    /// time-relative scope as `.all` — so these tests exercise the facet
    /// logic without depending on the wall clock.
    private func date(_ string: String) throws -> Date {
        try #require(ChqTime.parse(string))
    }

    private func sample() throws -> [Event] {
        [
            makeEvent(id: "1", start: try date("2026-07-01 10:00:00"),
                      title: "Opening Recital", location: "Amphitheater", categories: ["Music"]),
            makeEvent(id: "2", start: try date("2026-07-02 10:00:00"),
                      title: "Event 2", location: "Amphitheater", categories: ["Lectures"]),
            makeEvent(id: "3", start: try date("2026-07-03 10:00:00"),
                      title: "Event 3", location: "Norton Hall", categories: ["Music"]),
            makeEvent(id: "4", start: try date("2026-08-10 10:00:00"),
                      title: "Event 4", location: "Norton Hall", categories: ["Opera"]),
            makeEvent(id: "5", start: try date("2026-08-11 10:00:00"),
                      title: "Event 5", location: "Bratton Theater", categories: ["Theater"]),
        ]
    }

    private func counts(
        _ selection: FilterSelection,
        favorites: Set<String> = []
    ) throws -> FacetCounts {
        FacetCounts.build(
            events: try sample(),
            selection: selection,
            favorites: favorites,
            now: try date("2026-07-01 09:00:00"),
            year: 2026,
            isCurrentYear: false)
    }

    @Test func unfilteredCountsEveryEvent() throws {
        let c = try counts(FilterSelection(dateScope: .all))
        #expect(c.locations["amphitheater"] == 2)
        #expect(c.locations["norton hall"] == 2)
        #expect(c.locations["bratton theater"] == 1)
        #expect(c.categories["music"] == 2)
    }

    @Test func anotherFacetNarrowsTheCounts() throws {
        // This is #152's repro shape: a category selection must move the
        // venue numbers.
        let c = try counts(FilterSelection(dateScope: .all, selectedCategories: ["Music"]))
        #expect(c.locations["amphitheater"] == 1)
        #expect(c.locations["norton hall"] == 1)
        #expect(c.locations["bratton theater"] == nil || c.locations["bratton theater"] == 0)
    }

    @Test func aFacetDoesNotNarrowItself() throws {
        // With Amphitheater selected, other venues must still report the
        // counts they would add — otherwise a second venue could never be
        // picked, because every alternative would read 0.
        let c = try counts(FilterSelection(dateScope: .all, selectedLocations: ["Amphitheater"]))
        #expect(c.locations["amphitheater"] == 2)
        #expect(c.locations["norton hall"] == 2)
        #expect(c.locations["bratton theater"] == 1)
    }

    @Test func aFacetStillNarrowsTheOtherFacet() throws {
        // The venue selection is excluded from venue counts but not from
        // category counts.
        let c = try counts(FilterSelection(dateScope: .all, selectedLocations: ["Amphitheater"]))
        #expect(c.categories["music"] == 1)
        #expect(c.categories["lectures"] == 1)
        #expect(c.categories["opera"] == nil || c.categories["opera"] == 0)
    }

    @Test func searchNarrowsBothFacets() throws {
        // "Recital" appears only in Event 1's title ("Opening Recital"); the
        // other sample titles are plain "Event N" and share no word with it,
        // so this term narrows to exactly one event under `EventFilter`'s
        // per-word OR scoring.
        let c = try counts(FilterSelection(searchText: "Recital", dateScope: .all))
        #expect(c.locations["amphitheater"] == 1)
        #expect(c.locations["norton hall"] == nil || c.locations["norton hall"] == 0)
    }

    @Test func favoritesOnlyNarrowsBothFacets() throws {
        let c = try counts(
            FilterSelection(dateScope: .all, showFavoritesOnly: true),
            favorites: ["1"])
        #expect(c.locations["amphitheater"] == 1)
        #expect(c.categories["music"] == 1)
        #expect(c.locations["norton hall"] == nil || c.locations["norton hall"] == 0)
    }

    @Test func keysAreLowercasedOnBothFacets() throws {
        let c = try counts(FilterSelection(dateScope: .all))
        #expect(c.locations["Amphitheater"] == nil)
        #expect(c.locations["amphitheater"] != nil)
    }

    @Test func emptyEventsProduceEmptyCounts() throws {
        let c = FacetCounts.build(
            events: [],
            selection: FilterSelection(dateScope: .all),
            favorites: [],
            now: try date("2026-07-01 09:00:00"),
            year: 2026,
            isCurrentYear: false)
        #expect(c == .empty)
    }
}
