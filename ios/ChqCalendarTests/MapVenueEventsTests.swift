import Foundation
import Testing
@testable import ChqCalendar

/// Pins `MapVenueEvents.upcomingEvents` — the grounds map's marker-selection
/// sheet content (#182): venue resolution via `VenueAtlas` (not raw string
/// equality), cancelled-event exclusion, ascending sort, and the `limit`
/// cap.
struct MapVenueEventsTests {
    private static let day = "2026-07-15"

    private func time(_ s: String) throws -> Date {
        try #require(ChqTime.parse("\(Self.day) \(s)"))
    }

    private func venue(_ name: String) throws -> VenueLocation {
        try #require(VenueAtlas.location(for: name))
    }

    @Test func groupsRoomLevelFeedNamesUnderTheirBuilding() throws {
        // "Hultquist 101" and "Hultquist Porch" both resolve to the
        // "Hultquist Center" building (VenueAtlas), so both must count as
        // events "at" that venue even though neither's raw displayLocation
        // matches the venue's canonical name.
        let hultquist = try venue("Hultquist 101")
        let now = try time("09:00:00")
        let events = [
            makeEvent(id: "a", start: try time("10:00:00"), location: "Hultquist 101"),
            makeEvent(id: "b", start: try time("11:00:00"), location: "Hultquist Porch"),
            makeEvent(id: "c", start: try time("12:00:00"), location: "Amphitheater"),
        ]

        let upcoming = MapVenueEvents.upcomingEvents(at: hultquist, events: events, now: now, limit: 3)

        #expect(upcoming.map(\.id) == ["a", "b"])
    }

    @Test func excludesCancelledEvents() throws {
        let amphitheater = try venue("Amphitheater")
        let now = try time("09:00:00")
        let events = [
            makeEvent(id: "a", start: try time("10:00:00"), location: "Amphitheater", status: .cancelled),
            makeEvent(id: "b", start: try time("11:00:00"), location: "Amphitheater"),
        ]

        let upcoming = MapVenueEvents.upcomingEvents(at: amphitheater, events: events, now: now, limit: 3)

        #expect(upcoming.map(\.id) == ["b"])
    }

    @Test func excludesEventsThatAlreadyStarted() throws {
        let amphitheater = try venue("Amphitheater")
        let now = try time("10:30:00")
        let events = [
            makeEvent(id: "past", start: try time("10:00:00"), location: "Amphitheater"),
            makeEvent(id: "future", start: try time("11:00:00"), location: "Amphitheater"),
        ]

        let upcoming = MapVenueEvents.upcomingEvents(at: amphitheater, events: events, now: now, limit: 3)

        #expect(upcoming.map(\.id) == ["future"])
    }

    @Test func sortsAscendingByStart() throws {
        let amphitheater = try venue("Amphitheater")
        let now = try time("09:00:00")
        let events = [
            makeEvent(id: "later", start: try time("14:00:00"), location: "Amphitheater"),
            makeEvent(id: "earlier", start: try time("10:00:00"), location: "Amphitheater"),
        ]

        let upcoming = MapVenueEvents.upcomingEvents(at: amphitheater, events: events, now: now, limit: 3)

        #expect(upcoming.map(\.id) == ["earlier", "later"])
    }

    @Test func breaksSimultaneousStartTiesByID() throws {
        let amphitheater = try venue("Amphitheater")
        let now = try time("09:00:00")
        let start = try time("10:00:00")
        let events = [
            makeEvent(id: "z", start: start, location: "Amphitheater"),
            makeEvent(id: "a", start: start, location: "Amphitheater"),
        ]

        let upcoming = MapVenueEvents.upcomingEvents(at: amphitheater, events: events, now: now, limit: 3)

        #expect(upcoming.map(\.id) == ["a", "z"])
    }

    @Test func respectsTheLimit() throws {
        let amphitheater = try venue("Amphitheater")
        let now = try time("09:00:00")
        let events = try (0..<5).map { offset in
            makeEvent(id: "\(offset)", start: try time("1\(offset):00:00"), location: "Amphitheater")
        }

        let upcoming = MapVenueEvents.upcomingEvents(at: amphitheater, events: events, now: now, limit: 3)

        #expect(upcoming.count == 3)
        #expect(upcoming.map(\.id) == ["0", "1", "2"])
    }

    @Test func excludesEventsAtOtherVenues() throws {
        let amphitheater = try venue("Amphitheater")
        let now = try time("09:00:00")
        let events = [
            makeEvent(id: "here", start: try time("10:00:00"), location: "Amphitheater"),
            makeEvent(id: "elsewhere", start: try time("10:00:00"), location: "Hall of Philosophy"),
            makeEvent(id: "unresolvable", start: try time("10:00:00"), location: "Zoom"),
            makeEvent(id: "noLocation", start: try time("10:00:00"), location: nil),
        ]

        let upcoming = MapVenueEvents.upcomingEvents(at: amphitheater, events: events, now: now, limit: 3)

        #expect(upcoming.map(\.id) == ["here"])
    }
}
