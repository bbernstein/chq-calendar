import Foundation
import Testing
@testable import ChqCalendar

/// Pins the `AppModel`-level accessors that sit between `DayPlan` (whose own
/// domain logic is covered exhaustively in `DayPlanTests`) and `MyDayView`
/// (#181): `myDayAvailableDays`, `dayPlan(for:)`, and `myDayDefaultDay`. All
/// three are thin wrappers over `DayPlan`'s static functions plus model
/// state (`snapshot`, `favorites`, `selectedYear`, `now()`) — these tests
/// exist to pin that wiring, not to re-prove `DayPlan`'s own math.
@MainActor
struct MyDayModelTests {
    private func makeDefaults() -> UserDefaults {
        UserDefaults(suiteName: UUID().uuidString)!
    }

    /// Same shape as `AppModelTests.makeSnapshotModel`: a model holding a
    /// synthetic snapshot and a pinned clock, with no repository/network
    /// activity involved.
    private func makeSnapshotModel(events: [Event], now: Date, favorites: Set<String> = []) -> AppModel {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: { now }
        )
        model.snapshot = CalendarSnapshot(
            year: 2026, events: events, articleLinks: [:], programLinks: [:],
            themes: [], fetchedAt: now)
        model.favorites = favorites
        return model
    }

    // MARK: - myDayAvailableDays

    @Test func myDayAvailableDaysSpansTwoSeededDaysAndExcludesNonFavorites() throws {
        let now = try #require(ChqTime.parse("2026-07-01 08:00:00"))
        let dayOne = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let dayTwo = try #require(ChqTime.parse("2026-07-20 14:00:00"))
        let unfavorited = try #require(ChqTime.parse("2026-07-16 10:00:00"))
        let model = makeSnapshotModel(
            events: [
                makeEvent(id: "a", start: dayOne),
                makeEvent(id: "b", start: dayTwo),
                makeEvent(id: "c", start: unfavorited),
            ],
            now: now,
            favorites: ["a", "b"])

        #expect(model.myDayAvailableDays == ["2026-07-15", "2026-07-20"])
    }

    @Test func myDayAvailableDaysIsEmptyWithoutASnapshot() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )
        #expect(model.snapshot == nil)
        #expect(model.myDayAvailableDays.isEmpty)
    }

    // MARK: - dayPlan(for:)

    @Test func dayPlanFlagsASeededOverlapBetweenFavoritedEvents() throws {
        let now = try #require(ChqTime.parse("2026-07-15 08:00:00"))
        let start = try #require(ChqTime.parse("2026-07-15 10:00:00"))
        let overlappingStart = try #require(ChqTime.parse("2026-07-15 10:30:00"))
        let end = try #require(ChqTime.parse("2026-07-15 11:00:00"))
        let model = makeSnapshotModel(
            events: [
                makeEvent(id: "a", start: start, end: end),
                makeEvent(id: "b", start: overlappingStart, end: try #require(ChqTime.parse("2026-07-15 11:30:00"))),
            ],
            now: now,
            favorites: ["a", "b"])

        let plan = model.dayPlan(for: "2026-07-15")

        #expect(plan.items.map(\.event.id) == ["a", "b"])
        #expect(plan.items[1].transitionFromPrevious == .overlap(minutes: 30))
        #expect(plan.conflictCount == 1)
    }

    @Test func dayPlanIsEmptyForADayWithNoFavoritedEvents() throws {
        let now = try #require(ChqTime.parse("2026-07-15 08:00:00"))
        let model = makeSnapshotModel(
            events: [makeEvent(id: "a", start: try #require(ChqTime.parse("2026-07-15 10:00:00")))],
            now: now,
            favorites: [])

        let plan = model.dayPlan(for: "2026-07-15")

        #expect(plan.items.isEmpty)
        #expect(plan.conflictCount == 0)
    }

    // MARK: - myDayDefaultDay

    @Test func myDayDefaultDayHonorsInjectedNowWhenTodayIsAvailable() throws {
        let today = try #require(ChqTime.parse("2026-07-20 09:00:00"))
        let model = makeSnapshotModel(
            events: [
                makeEvent(id: "a", start: try #require(ChqTime.parse("2026-07-15 10:00:00"))),
                makeEvent(id: "b", start: try #require(ChqTime.parse("2026-07-20 10:00:00"))),
            ],
            now: today,
            favorites: ["a", "b"])

        #expect(model.myDayDefaultDay == "2026-07-20")
    }

    @Test func myDayDefaultDayFallsBackToNextFutureDayWhenTodayIsUnavailable() throws {
        // Injected "now" falls between the two favorited days, so neither
        // is "today" — the default should pick the earliest day still in
        // the future relative to the injected clock, matching
        // `DayPlan.defaultDayKey`'s own contract.
        let between = try #require(ChqTime.parse("2026-07-17 09:00:00"))
        let model = makeSnapshotModel(
            events: [
                makeEvent(id: "a", start: try #require(ChqTime.parse("2026-07-15 10:00:00"))),
                makeEvent(id: "b", start: try #require(ChqTime.parse("2026-07-20 10:00:00"))),
            ],
            now: between,
            favorites: ["a", "b"])

        #expect(model.myDayDefaultDay == "2026-07-20")
    }

    @Test func myDayDefaultDayIsNilWithNoFavoritedDays() throws {
        let now = try #require(ChqTime.parse("2026-07-15 08:00:00"))
        let model = makeSnapshotModel(events: [], now: now, favorites: [])

        #expect(model.myDayDefaultDay == nil)
    }
}
