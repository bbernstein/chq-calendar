import Foundation
import Testing
@testable import ChqCalendar

/// `navMatching` is what the day rail is drawn from: every day the *non-date*
/// filters admit, anywhere navigation can reach. Getting its independence
/// from the date scope wrong is silent — the rail still renders, it just
/// reports the filter it exists to escape.
@MainActor
struct NavMatchingTests {
    private func makeDefaults() -> UserDefaults { UserDefaults(suiteName: UUID().uuidString)! }

    /// Events on three separate days, one of which is well outside a `.next`
    /// window, so "independent of the scope" is actually exercised.
    private func makeModel(defaults: UserDefaults) throws -> AppModel {
        let now = try #require(ChqTime.parse("2026-07-15 12:00:00"))
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: defaults, now: { Date() }),
            now: { now })
        let events: [Event] = [
            makeEvent(id: "a1", start: try #require(ChqTime.parse("2026-07-15 13:00:00")),
                      title: "Opera Talk", location: "Amphitheater"),
            makeEvent(id: "a2", start: try #require(ChqTime.parse("2026-07-15 19:00:00")),
                      title: "Evening Lecture", location: "Amphitheater"),
            makeEvent(id: "b1", start: try #require(ChqTime.parse("2026-07-20 09:00:00")),
                      title: "Morning Walk", location: "Norton Hall"),
            makeEvent(id: "c1", start: try #require(ChqTime.parse("2026-08-20 09:00:00")),
                      title: "Closing Concert", location: "Amphitheater"),
        ]
        model.snapshot = CalendarSnapshot(
            year: 2026, events: events, articleLinks: [:], programLinks: [:],
            themes: [], fetchedAt: now)
        return model
    }

    @Test func countsEveryDayWithEventsRegardlessOfTheDateScope() throws {
        let model = try makeModel(defaults: makeDefaults())
        model.selectScope(.today)

        let nav = try #require(model.navMatching)
        #expect(nav.eventDays == ["2026-07-15", "2026-07-20", "2026-08-20"])
        #expect(nav.countsByDay["2026-07-15"] == 2)
        #expect(nav.countsByDay["2026-08-20"] == 1)
    }

    /// The non-date filters DO constrain it: search, venue, category, weeks
    /// and favourites all say where navigation is allowed to go. Only the
    /// scope is ignored, because escaping the scope's own edge is the point.
    @Test func theNonDateFiltersStillNarrowIt() throws {
        let model = try makeModel(defaults: makeDefaults())
        model.toggleLocation("Norton Hall")

        let nav = try #require(model.navMatching)
        #expect(nav.eventDays == ["2026-07-20"])
    }

    @Test func windowExpansionDoesNotChangeIt() throws {
        let model = try makeModel(defaults: makeDefaults())
        let before = try #require(model.navMatching)

        model.goToDay("2026-08-20")

        #expect(model.navMatching == before)
    }

    /// Two derivations of the same fact must not drift: the cached array and
    /// the pure rule that Task 4 tests in isolation.
    @Test func theCachedDayListAgreesWithThePureRule() throws {
        let model = try makeModel(defaults: makeDefaults())
        let snapshot = try #require(model.snapshot)
        let nav = try #require(model.navMatching)

        #expect(nav.eventDays == DayRailNavigation.eventDays(snapshot.events))
    }

    @Test func boundsCoverEveryEventDayIncludingOnesOutsideTheSeason() throws {
        let model = try makeModel(defaults: makeDefaults())
        let nav = try #require(model.navMatching)

        #expect(nav.bounds.contains("2026-07-15"))
        #expect(nav.bounds.contains("2026-08-20"))
    }

    @Test func thereIsNoNavMatchingBeforeASnapshotLoads() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }))

        #expect(model.navMatching == nil)
    }
}
