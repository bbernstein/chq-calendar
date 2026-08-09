import Foundation
import Testing
@testable import ChqCalendar

/// Pins the #193 composed selection engine: kind × timeframe × venue
/// filtering, flagship-venue featuring, and starred-schedule selection.
struct IntentMatchingTests {
    private let year = 2026
    private var now: Date { ChqTime.parse("2026-07-15 09:00:00")! }

    private var fixtures: [Event] {
        [
            makeEvent(id: "porch", start: ChqTime.parse("2026-07-15 10:00:00")!,
                      title: "Porch Chat", location: "Smith Wilkes Hall",
                      tags: ["chautauqua-lecture-series"]),
            makeEvent(id: "amp-lecture", start: ChqTime.parse("2026-07-15 10:45:00")!,
                      title: "Morning Lecture", location: "Amphitheater",
                      tags: ["chautauqua-lecture-series"], presenter: "Jane Goodall"),
            makeEvent(id: "movie", start: ChqTime.parse("2026-07-15 18:00:00")!,
                      title: "A Film", location: "Chautauqua Cinema"),
            makeEvent(id: "cso", start: ChqTime.parse("2026-07-16 20:15:00")!,
                      title: "CSO Concert", location: "Amphitheater",
                      tags: ["chautauqua-symphony-orchestra-classical-concerts"]),
            makeEvent(id: "cancelled", start: ChqTime.parse("2026-07-15 11:00:00")!,
                      tags: ["chautauqua-lecture-series"], status: .cancelled),
            makeEvent(id: "past", start: ChqTime.parse("2026-07-14 10:00:00")!,
                      tags: ["chautauqua-lecture-series"]),
        ]
    }

    @Test func kindFilterSelectsOnlyThatKindUpcoming() {
        let r = IntentDataSource.selectMatching(events: fixtures, kind: .lectures, timeframe: nil,
                                                venue: nil, now: now, year: year)
        #expect(r.map(\.id) == ["porch", "amp-lecture"])
    }

    @Test func timeframeFilterScopesToWindow() {
        let r = IntentDataSource.selectMatching(events: fixtures, kind: nil, timeframe: .today,
                                                venue: nil, now: now, year: year)
        #expect(r.map(\.id) == ["porch", "amp-lecture", "movie"])
    }

    @Test func tonightExcludesTheAfternoon() {
        let r = IntentDataSource.selectMatching(events: fixtures, kind: nil, timeframe: .tonight,
                                                venue: nil, now: now, year: year)
        #expect(r.map(\.id) == ["movie"])
    }

    @Test func venueFilterIsCaseInsensitive() {
        let r = IntentDataSource.selectMatching(events: fixtures, kind: nil, timeframe: nil,
                                                venue: "amphitheater", now: now, year: year)
        #expect(r.map(\.id) == ["amp-lecture", "cso"])
    }

    @Test func kindAndTimeframeCompose() {
        let r = IntentDataSource.selectMatching(events: fixtures, kind: .symphonyConcerts,
                                                timeframe: .tomorrow, venue: nil, now: now, year: year)
        #expect(r.map(\.id) == ["cso"])
    }

    @Test func cancelledAndPastAreAlwaysExcluded() {
        let ids = IntentDataSource.selectMatching(events: fixtures, kind: .lectures, timeframe: nil,
                                                  venue: nil, now: now, year: year).map(\.id)
        #expect(!ids.contains("cancelled"))
        #expect(!ids.contains("past"))
    }

    @Test func featuredPrefersFlagshipVenueOnTheSameDay() {
        let r = IntentDataSource.selectMatching(events: fixtures, kind: .lectures, timeframe: nil,
                                                venue: nil, now: now, year: year)
        // "porch" starts first, but the Amp lecture the same NY day leads.
        #expect(IntentDataSource.featured(in: r)?.id == "amp-lecture")
    }

    @Test func featuredFallsBackToFirstWhenNoFlagshipThatDay() {
        let r = [fixtures[0]] // porch only
        #expect(IntentDataSource.featured(in: r)?.id == "porch")
        #expect(IntentDataSource.featured(in: []) == nil)
    }

    @Test func scheduleSelectsOnlyStarredInWindow() {
        let r = IntentDataSource.selectSchedule(events: fixtures, favoriteIDs: ["porch", "cso"],
                                                timeframe: .today, now: now, year: year)
        #expect(r.map(\.id) == ["porch"])
    }

    // MARK: - IntentDataSource.entityWindow

    private func windowFixtures(count: Int) -> [Event] {
        (0..<count).map { i in
            makeEvent(id: "e\(i)", start: ChqTime.parse("2026-07-15 09:00:00")!.addingTimeInterval(Double(i) * 600))
        }
    }

    @Test func entityWindowKeepsPrefixWhenFeaturedInsideIt() {
        let events = windowFixtures(count: 6)
        let window = IntentDataSource.entityWindow(results: events, featured: events[2], limit: 5)
        #expect(window.map(\.id) == ["e0", "e1", "e2", "e3", "e4"])
    }

    @Test func entityWindowSwapsInFeaturedFromBeyondTheLimit() {
        let events = windowFixtures(count: 8)
        let window = IntentDataSource.entityWindow(results: events, featured: events[6], limit: 5)
        #expect(window.map(\.id) == ["e0", "e1", "e2", "e3", "e6"])
        #expect(window.count == 5)
    }

    @Test func entityWindowHandlesShortAndEmptyResults() {
        let events = windowFixtures(count: 2)
        let short = IntentDataSource.entityWindow(results: events, featured: events[1], limit: 5)
        #expect(short.map(\.id) == ["e0", "e1"])
        #expect(IntentDataSource.entityWindow(results: [], featured: events[0], limit: 5).isEmpty)
    }
}
