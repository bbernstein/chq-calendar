import Foundation
import Testing
@testable import ChqCalendar

/// Pins `WidgetTimelineBuilder`'s slice-progression rules and
/// `SharedSnapshotLoader`'s cache decoding, both introduced for the home-
/// screen widget (#179). All dates are constructed via `ChqTime.parse` (no
/// `Date()` in the logic under test), matching the rest of the domain
/// layer's testing style.
struct WidgetTimelineBuilderTests {
    private func makeDefaults() -> UserDefaults {
        UserDefaults(suiteName: UUID().uuidString)!
    }

    // MARK: - Slice progression

    /// Five events an hour apart. The first slice (at `now`) shows the
    /// soonest 4 (capped); each subsequent slice lands exactly at an
    /// event's start and drops it (and anything earlier) from the shown
    /// list, rolling the remaining events forward.
    @Test func sliceProgressionDropsStartedEventsAtEachBoundary() throws {
        let now = try #require(ChqTime.parse("2026-07-01 08:00:00"))
        let starts = try (9...13).map { try #require(ChqTime.parse("2026-07-01 \($0):00:00")) }
        let events = zip(starts.indices, starts).map { index, start in
            makeEvent(id: "e\(index + 1)", start: start, title: "E\(index + 1)")
        }

        let slices = WidgetTimelineBuilder.timeline(
            events: events, favorites: [], config: .init(),
            availableYears: [2026], year: 2026, now: now
        )

        #expect(slices.count == 6)

        #expect(slices[0].date == now)
        #expect(ids(of: slices[0]) == ["e1", "e2", "e3", "e4"])

        #expect(slices[1].date == starts[0])
        #expect(ids(of: slices[1]) == ["e2", "e3", "e4", "e5"])

        #expect(slices[2].date == starts[1])
        #expect(ids(of: slices[2]) == ["e3", "e4", "e5"])

        #expect(slices[3].date == starts[2])
        #expect(ids(of: slices[3]) == ["e4", "e5"])

        #expect(slices[4].date == starts[3])
        #expect(ids(of: slices[4]) == ["e5"])

        #expect(slices[5].date == starts[4])
        #expect(ids(of: slices[5]) == [])

        // Slices must be strictly increasing in date.
        let dates = slices.map(\.date)
        #expect(dates == dates.sorted())
        #expect(Set(dates).count == dates.count)
    }

    /// Two events sharing an identical start collapse into a single slice
    /// at that instant, and both are dropped together (not one-at-a-time).
    @Test func identicalStartEventsProduceOneSlice() throws {
        let now = try #require(ChqTime.parse("2026-07-01 08:00:00"))
        let sharedStart = try #require(ChqTime.parse("2026-07-01 09:00:00"))
        let events = [
            makeEvent(id: "a", start: sharedStart, title: "A"),
            makeEvent(id: "b", start: sharedStart, title: "B")
        ]

        let slices = WidgetTimelineBuilder.timeline(
            events: events, favorites: [], config: .init(),
            availableYears: [2026], year: 2026, now: now
        )

        #expect(slices.count == 2)
        #expect(slices[0].date == now)
        #expect(ids(of: slices[0]) == ["a", "b"])
        #expect(slices[1].date == sharedStart)
        #expect(ids(of: slices[1]) == [])
    }

    /// `maxSlices` caps the *total* number of slices (including the initial
    /// one at `now`) — later candidates never get their own slice, but they
    /// still appear in earlier slices' event lists (capped away is a slice
    /// concern, not a candidacy concern).
    @Test func maxSlicesCapsTotalSliceCount() throws {
        let now = try #require(ChqTime.parse("2026-07-01 08:00:00"))
        let starts = try (9...18).map { try #require(ChqTime.parse("2026-07-01 \($0):00:00")) }
        let events = zip(starts.indices, starts).map { index, start in
            makeEvent(id: "e\(index + 1)", start: start, title: "E\(index + 1)")
        }

        let slices = WidgetTimelineBuilder.timeline(
            events: events, favorites: [], config: .init(),
            availableYears: [2026], year: 2026, now: now, maxSlices: 3
        )

        #expect(slices.count == 3)
        // Even with only 3 slices total, the first slice's event list still
        // reflects the soonest 4 candidates out of all 10 — capping slices
        // never truncates a slice's own event list.
        #expect(ids(of: slices[0]) == ["e1", "e2", "e3", "e4"])
    }

    // MARK: - Config filtering

    @Test func venueConfigFiltersCandidates() throws {
        let now = try #require(ChqTime.parse("2026-07-01 08:00:00"))
        let t1 = try #require(ChqTime.parse("2026-07-01 09:00:00"))
        let t2 = try #require(ChqTime.parse("2026-07-01 10:00:00"))
        let t3 = try #require(ChqTime.parse("2026-07-01 11:00:00"))
        let events = [
            makeEvent(id: "amp-1", start: t1, location: "Amphitheater"),
            makeEvent(id: "hall-1", start: t2, location: "Hall of Philosophy"),
            makeEvent(id: "amp-2", start: t3, location: "Amphitheater")
        ]

        let slices = WidgetTimelineBuilder.timeline(
            events: events, favorites: [],
            config: .init(venue: "Amphitheater"),
            availableYears: [2026], year: 2026, now: now
        )

        #expect(slices.count == 3)
        #expect(ids(of: slices[0]) == ["amp-1", "amp-2"])
    }

    @Test func categoryConfigFiltersCandidatesViaFilterTokens() throws {
        let now = try #require(ChqTime.parse("2026-07-01 08:00:00"))
        let t1 = try #require(ChqTime.parse("2026-07-01 09:00:00"))
        let t2 = try #require(ChqTime.parse("2026-07-01 10:00:00"))
        let events = [
            makeEvent(id: "opera-1", start: t1, categories: ["Opera"]),
            makeEvent(id: "lecture-1", start: t2, categories: ["Lecture"])
        ]

        let slices = WidgetTimelineBuilder.timeline(
            events: events, favorites: [],
            // Deliberately mixed-case: matching goes through
            // `filterTokens.contains(category.lowercased())`.
            config: .init(category: "OPERA"),
            availableYears: [2026], year: 2026, now: now
        )

        #expect(ids(of: slices[0]) == ["opera-1"])
    }

    // MARK: - Zero candidates

    /// `favoritesOnly` with no favorites at all leaves zero candidates even
    /// though events exist; with a later season announced, the single slice
    /// is a countdown to it. Pins the same opening/daysUntil pair as
    /// `LandingStateTests.postSeasonTheDayAfterTheLastEventsAdaptiveWindowExpires`
    /// so the widget and the app never disagree about the countdown.
    @Test func favoritesOnlyWithEmptyFavoritesYieldsCountdownOnPostSeasonFixture() throws {
        let envelope = try JSONDecoder().decode(EventEnvelope.self, from: fixtureData("events-sample"))
        let now = try #require(ChqTime.parse("2026-09-11 00:00:00"))
        let opening = try #require(ChqTime.parse("2027-06-26 12:00:00"))

        let slices = WidgetTimelineBuilder.timeline(
            events: envelope.data, favorites: [],
            config: .init(favoritesOnly: true),
            availableYears: [2025, 2026, 2027], year: 2026, now: now
        )

        #expect(slices.count == 1)
        #expect(slices[0].date == now)
        #expect(slices[0].state == .countdown(opening: opening, daysUntil: 288))
    }

    /// Zero candidates and no future season anywhere in `availableYears` (or
    /// `year`) falls back to `.empty` rather than fabricating a countdown.
    @Test func emptyWhenNoFutureSeasonInAvailableYears() throws {
        let now = try #require(ChqTime.parse("2026-09-11 00:00:00"))

        let slices = WidgetTimelineBuilder.timeline(
            events: [], favorites: [], config: .init(),
            availableYears: [2026], year: 2026, now: now
        )

        #expect(slices == [WidgetTimelineBuilder.Slice(date: now, state: .empty)])
    }

    /// A cancelled event is never a candidate, even if nothing else filters
    /// it out.
    @Test func cancelledEventsAreExcluded() throws {
        let now = try #require(ChqTime.parse("2026-07-01 08:00:00"))
        let start = try #require(ChqTime.parse("2026-07-01 09:00:00"))
        let events = [makeEvent(id: "cancelled-1", start: start, status: .cancelled)]

        let slices = WidgetTimelineBuilder.timeline(
            events: events, favorites: [], config: .init(),
            availableYears: [], year: 2026, now: now
        )

        #expect(slices.count == 1)
        #expect(slices[0].state == .empty)
    }

    // MARK: - SharedSnapshotLoader.loadEvents

    @Test func loadEventsRoundTripsFixtureThroughMockCache() {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: nil, fetchedAt: Date())

        let events = SharedSnapshotLoader.loadEvents(year: 2026, cache: cache)

        #expect(events.count == 5)
        #expect(Set(events.map(\.id)) == ["101037", "200001", "200002", "200003", "200004"])
    }

    @Test func loadEventsReturnsEmptyOnCacheMiss() {
        let cache = MockCache()
        #expect(SharedSnapshotLoader.loadEvents(year: 2026, cache: cache) == [])
    }

    @Test func loadEventsReturnsEmptyOnCorruptData() {
        let cache = MockCache()
        cache.write("events-2026", data: Data("not json".utf8), etag: nil, fetchedAt: Date())

        #expect(SharedSnapshotLoader.loadEvents(year: 2026, cache: cache) == [])
    }

    // MARK: - SharedSnapshotLoader.loadYears

    @Test func loadYearsRoundTripsFixtureThroughMockCache() throws {
        let cache = MockCache()
        cache.write("years", data: fixtureData("years"), etag: nil, fetchedAt: Date())

        let manifest = try #require(SharedSnapshotLoader.loadYears(cache: cache))

        #expect(manifest.years == [2025, 2026, 2027])
        #expect(manifest.defaultYear == 2026)
    }

    @Test func loadYearsReturnsNilOnCacheMiss() {
        let cache = MockCache()
        #expect(SharedSnapshotLoader.loadYears(cache: cache) == nil)
    }

    @Test func loadYearsReturnsNilOnCorruptData() {
        let cache = MockCache()
        cache.write("years", data: Data("not json".utf8), etag: nil, fetchedAt: Date())

        #expect(SharedSnapshotLoader.loadYears(cache: cache) == nil)
    }

    // MARK: - SharedSnapshotLoader.loadFavorites

    @Test func loadFavoritesDelegatesToUserStateStore() {
        let defaults = makeDefaults()
        let now = Date()
        UserStateStore(defaults: defaults, now: { now }).saveFavorites(["fav-1", "fav-2"])

        #expect(SharedSnapshotLoader.loadFavorites(defaults: defaults, now: now) == ["fav-1", "fav-2"])
    }

    @Test func loadFavoritesRespectsThirtyDayExpiry() {
        let defaults = makeDefaults()
        let saveTime = Date(timeIntervalSince1970: 1_700_000_000)
        UserStateStore(defaults: defaults, now: { saveTime }).saveFavorites(["fav-9"])

        let later = saveTime.addingTimeInterval(31 * 24 * 3600)
        #expect(SharedSnapshotLoader.loadFavorites(defaults: defaults, now: later) == [])
    }

    // MARK: - Helpers

    private func ids(of slice: WidgetTimelineBuilder.Slice) -> [String] {
        guard case .events(let summaries) = slice.state else {
            Issue.record("expected .events state, got \(slice.state)")
            return []
        }
        return summaries.map(\.id)
    }
}
