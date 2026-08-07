import Foundation
import Testing
@testable import ChqCalendar

/// Pins `SpotlightIndexer`'s pure surfaces (#180, task 13) — `itemsToIndex`'s
/// season-window-union-favorites selection, and the `identifier(for:)` /
/// `eventID(fromActivityIdentifier:)` round trip used by
/// `CalendarView.onContinueUserActivity` — all exercisable without the
/// CoreSpotlight runtime. All dates are constructed via `ChqTime.parse` or
/// read straight off `SeasonCalendar.weeks(forYear:)` (no `Date()` in the
/// logic under test), matching the rest of the domain layer's testing
/// style. 2026's season boundaries are pinned by `SeasonCalendarTests`:
/// week 1 starts 2026-06-27 12:00:00, week 9 ends 2026-08-29 12:00:00.
struct SpotlightIndexerTests {
    // MARK: - itemsToIndex

    @Test func inSeasonEventIsKept() throws {
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let inSeason = try #require(ChqTime.parse("2026-07-15 14:00:00"))
        let events = [makeEvent(id: "a", start: inSeason)]

        let result = SpotlightIndexer.itemsToIndex(events: events, favorites: [], year: 2026, now: now)

        #expect(result.map(\.id) == ["a"])
    }

    @Test func offSeasonNonFavoriteIsDropped() throws {
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let offSeason = try #require(ChqTime.parse("2026-09-15 14:00:00"))
        let events = [makeEvent(id: "a", start: offSeason)]

        let result = SpotlightIndexer.itemsToIndex(events: events, favorites: [], year: 2026, now: now)

        #expect(result.isEmpty)
    }

    @Test func offSeasonFavoriteIsKept() throws {
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let offSeason = try #require(ChqTime.parse("2026-09-15 14:00:00"))
        let events = [makeEvent(id: "a", start: offSeason)]

        let result = SpotlightIndexer.itemsToIndex(events: events, favorites: ["a"], year: 2026, now: now)

        #expect(result.map(\.id) == ["a"])
    }

    @Test func cancelledEventIsDroppedEvenWhenFavorited() throws {
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let inSeason = try #require(ChqTime.parse("2026-07-15 14:00:00"))
        let events = [makeEvent(id: "a", start: inSeason, status: .cancelled)]

        let result = SpotlightIndexer.itemsToIndex(events: events, favorites: ["a"], year: 2026, now: now)

        #expect(result.isEmpty)
    }

    @Test func eventExactlyAtSeasonStartIsIncluded() throws {
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let seasonStart = try #require(weeks.first?.start)
        let events = [makeEvent(id: "a", start: seasonStart)]

        let result = SpotlightIndexer.itemsToIndex(events: events, favorites: [], year: 2026, now: now)

        #expect(result.map(\.id) == ["a"])
    }

    @Test func eventExactlyAtSeasonEndIsExcluded() throws {
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let seasonEnd = try #require(weeks.last?.end)
        let events = [makeEvent(id: "a", start: seasonEnd)]

        let result = SpotlightIndexer.itemsToIndex(events: events, favorites: [], year: 2026, now: now)

        #expect(result.isEmpty)
    }

    @Test func mixedSelectionUnionsInSeasonAndFavoritesWithoutDuplicates() throws {
        let now = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let inSeason = try #require(ChqTime.parse("2026-07-15 14:00:00"))
        let offSeason = try #require(ChqTime.parse("2026-09-15 14:00:00"))
        let events = [
            makeEvent(id: "in-season-favorite", start: inSeason),
            makeEvent(id: "off-season-favorite", start: offSeason),
            makeEvent(id: "off-season-not-favorite", start: offSeason)
        ]

        let result = SpotlightIndexer.itemsToIndex(
            events: events,
            favorites: ["in-season-favorite", "off-season-favorite"],
            year: 2026,
            now: now
        )

        #expect(Set(result.map(\.id)) == ["in-season-favorite", "off-season-favorite"])
    }

    // MARK: - identifier(for:)

    @Test func identifierPrefixesTheEventID() {
        #expect(SpotlightIndexer.identifier(for: "abc123") == "event-abc123")
    }

    // MARK: - eventID(fromActivityIdentifier:)

    @Test func eventIDStripsThePrefix() {
        #expect(SpotlightIndexer.eventID(fromActivityIdentifier: "event-abc123") == "abc123")
    }

    @Test func eventIDIsNilWithoutTheExpectedPrefix() {
        #expect(SpotlightIndexer.eventID(fromActivityIdentifier: "abc123") == nil)
        #expect(SpotlightIndexer.eventID(fromActivityIdentifier: "other-prefix-abc123") == nil)
    }

    @Test func eventIDIsNilWhenIDIsEmptyAfterStrippingPrefix() {
        #expect(SpotlightIndexer.eventID(fromActivityIdentifier: "event-") == nil)
    }

    @Test func identifierAndEventIDRoundTrip() {
        let identifier = SpotlightIndexer.identifier(for: "xyz-789")
        #expect(SpotlightIndexer.eventID(fromActivityIdentifier: identifier) == "xyz-789")
    }
}
