import Foundation
import Testing
@testable import ChqCalendar

@MainActor
struct AppModelTests {
    /// A fresh, isolated `UserDefaults` suite per test so runs never collide.
    private func makeDefaults() -> UserDefaults {
        UserDefaults(suiteName: UUID().uuidString)!
    }

    // MARK: - start()

    @Test func startWithWarmCacheIsReadyBeforeAnyNetworkCompletes() async throws {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        let api = MockAPI()
        // The years manifest has no cached entry, so `start()` must reach
        // out to the network for it — but that call is scripted to hang
        // forever. If `phase`/`dayGroups` only became correct *after* that
        // call resolved, this test would time out instead of passing.
        await api.setNeverResolves(for: .years)
        let repo = EventRepository(api: api, cache: cache)
        // Pinned before every fixture event's start, so the default `.next`
        // date scope doesn't filter all of them out.
        let fixedNow = try #require(ChqTime.parse("2026-06-15 00:00:00"))
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: { fixedNow }
        )

        Task { await model.start() }
        try await Task.sleep(for: .milliseconds(150))

        #expect(model.phase == .ready)
        #expect(!model.dayGroups.isEmpty)
    }

    @Test func startWithColdCacheAndFailingAPIGoesOffline() async {
        let api = MockAPI()
        await api.setFailure(MockAPIError.unscripted("events-down"), for: .events(year: 2026))
        let repo = EventRepository(api: api, cache: MockCache())
        let model = AppModel(repository: repo, store: UserStateStore(defaults: makeDefaults(), now: { Date() }))

        await model.start()

        #expect(model.phase == .offline)
        #expect(model.snapshot == nil)
        #expect(model.dayGroups.isEmpty)
    }

    // MARK: - toggleFavorite

    @Test func toggleFavoritePersistsAcrossStoreInstances() {
        let defaults = makeDefaults()
        let store = UserStateStore(defaults: defaults, now: { Date() })
        let model = AppModel(repository: EventRepository(api: MockAPI(), cache: MockCache()), store: store)

        model.toggleFavorite("evt-1")
        #expect(model.favorites.contains("evt-1"))

        let freshStore = UserStateStore(defaults: defaults, now: { Date() })
        #expect(freshStore.loadFavorites().contains("evt-1"))

        model.toggleFavorite("evt-1")
        #expect(!model.favorites.contains("evt-1"))
        #expect(!UserStateStore(defaults: defaults, now: { Date() }).loadFavorites().contains("evt-1"))
    }

    // MARK: - select(year:)

    @Test func selectYearSwapsSnapshot() async {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        cache.write("events-2025", data: fixtureData("events-sample"), etag: "e2", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        let model = AppModel(repository: repo, store: UserStateStore(defaults: makeDefaults(), now: { Date() }))

        await model.start()
        #expect(model.snapshot?.year == 2026)

        await model.select(year: 2025)

        #expect(model.selectedYear == 2025)
        #expect(model.snapshot?.year == 2025)
    }

    // MARK: - setScope / toggleWeek / clearFilters

    @Test func setScopeMutatesAndPersistsFilter() {
        let defaults = makeDefaults()
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: defaults, now: { Date() })
        )

        model.setScope(.thisWeek)

        #expect(model.filter.dateScope == .thisWeek)
        #expect(UserStateStore(defaults: defaults, now: { Date() }).loadFilters()?.dateScope == .thisWeek)
    }

    @Test func toggleWeekMutatesAndPersistsFilter() {
        let defaults = makeDefaults()
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: defaults, now: { Date() })
        )

        model.toggleWeek(3)
        #expect(model.filter.selectedWeeks == [3])
        #expect(UserStateStore(defaults: defaults, now: { Date() }).loadFilters()?.selectedWeeks == [3])

        model.toggleWeek(3)
        #expect(model.filter.selectedWeeks.isEmpty)
        #expect(UserStateStore(defaults: defaults, now: { Date() }).loadFilters()?.selectedWeeks.isEmpty == true)
    }

    @Test func clearFiltersResetsFacetsButKeepsSearchTextAndExtraDays() {
        let defaults = makeDefaults()
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: defaults, now: { Date() })
        )

        model.filter.searchText = "opera"
        model.filter.extraDays = 2
        model.toggleWeek(4)
        model.setScope(.all)
        model.toggleFavorite("evt-1")
        model.filter.showFavoritesOnly = true

        model.clearFilters()

        #expect(model.filter.isDefault)
        #expect(model.filter.searchText == "opera")
        #expect(model.filter.extraDays == 2)
        #expect(UserStateStore(defaults: defaults, now: { Date() }).loadFilters()?.isDefault == true)
    }

    // MARK: - showNextDay

    @Test func showNextDayIncrementsExtraDays() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )

        #expect(model.filter.extraDays == 0)
        model.showNextDay()
        #expect(model.filter.extraDays == 1)
        model.showNextDay()
        #expect(model.filter.extraDays == 2)
    }
}
