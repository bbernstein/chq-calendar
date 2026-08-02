import Foundation
import Testing
@testable import ChqCalendar

struct FacetCountsTests {
    @Test func countsLocationsAndCategoriesLowercased() throws {
        let start = try #require(ChqTime.parse("2026-07-01 10:00:00"))
        let events = [
            makeEvent(id: "a", start: start, location: "Amphitheater", categories: ["CSO"]),
            makeEvent(id: "b", start: start, location: "Amphitheater", categories: ["CSO"]),
            makeEvent(id: "c", start: start, location: "Norton Hall", categories: ["CLSC"]),
        ]

        let counts = FacetCounts.build(from: events)

        #expect(counts.locations["amphitheater"] == 2)
        #expect(counts.locations["norton hall"] == 1)
        #expect(counts.categories["cso"] == 2)
        #expect(counts.categories["clsc"] == 1)
    }

    @Test func eventsWithoutALocationAreSkipped() throws {
        let start = try #require(ChqTime.parse("2026-07-01 10:00:00"))
        let counts = FacetCounts.build(from: [makeEvent(id: "a", start: start)])
        #expect(counts.locations.isEmpty)
    }

    @Test func emptyIsAllZeroes() {
        #expect(FacetCounts.empty.locations.isEmpty)
        #expect(FacetCounts.empty.categories.isEmpty)
    }
}
