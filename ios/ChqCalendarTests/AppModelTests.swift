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

    // MARK: - refresh(force:) year affinity + reentrancy

    /// A refresh started for year A (by `start()`) that's still in flight
    /// when the user switches to year B must not clobber B's snapshot when
    /// A's result finally arrives.
    @Test func refreshDiscardsStaleYearResultAfterYearSwitchedDuringInFlightRefresh() async {
        let cache = MockCache()
        // Genuinely stale by real wall-clock time (`EventRepository.refresh`
        // checks freshness via its own `Date()`), so `start()` actually
        // kicks off a background refresh for year 2026.
        let staleFetchedAt = Date(timeIntervalSince1970: 1_000_000)
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: staleFetchedAt)
        cache.write("events-2025", data: fixtureData("events-sample"), etag: "e2", fetchedAt: Date())
        cache.write("years", data: fixtureData("years"), etag: "y1", fetchedAt: Date())

        let api = MockAPI()
        await api.setSuccess(data: fixtureData("events-sample"), etag: "e1-refreshed", for: .events(year: 2026))
        await api.setSuspended(for: .events(year: 2026))
        let repo = EventRepository(api: api, cache: cache)
        let model = AppModel(repository: repo, store: UserStateStore(defaults: makeDefaults(), now: { Date() }))

        let startTask = Task { await model.start() }
        // Give start() time to load the stale 2026 cache, read the (cached,
        // network-free) manifest, and reach the gated fetch inside its
        // background refresh.
        try? await Task.sleep(for: .milliseconds(150))
        #expect(model.isRefreshing)
        #expect(model.snapshot?.year == 2026)

        // User switches years while the year-2026 refresh is still in flight.
        await model.select(year: 2025)
        #expect(model.snapshot?.year == 2025)

        // Now let the stale year-2026 fetch complete. It must be discarded
        // rather than clobbering the year-2025 snapshot now being viewed.
        await api.resume(for: .events(year: 2026))
        await startTask.value

        #expect(model.snapshot?.year == 2025)
        #expect(!model.isRefreshing)
    }

    /// A second `refresh` call made while one is already in flight must be
    /// a no-op — not a second overlapping network round trip.
    @Test func refreshGuardsAgainstConcurrentReentrancy() async {
        let cache = MockCache()
        let api = MockAPI()
        await api.setSuccess(data: fixtureData("events-sample"), etag: "e1", for: .events(year: 2026))
        await api.setSuspended(for: .events(year: 2026))
        // ttl: 0 so the cached-freshness short-circuit never applies —
        // every `refresh(force:)` call genuinely reaches the network.
        let repo = EventRepository(api: api, cache: cache, ttl: 0)
        let model = AppModel(repository: repo, store: UserStateStore(defaults: makeDefaults(), now: { Date() }))

        let firstRefresh = Task { await model.refresh(force: false) }
        try? await Task.sleep(for: .milliseconds(80))
        #expect(model.isRefreshing)

        // While the first refresh is still parked mid-fetch, a second
        // concurrent call must return immediately without its own fetch.
        await model.refresh(force: false)

        await api.resume(for: .events(year: 2026))
        await firstRefresh.value

        let eventCalls = await api.calls.filter {
            if case .events = $0.resource { return true }
            return false
        }
        #expect(eventCalls.count == 1)
        #expect(model.snapshot?.events.count == 5)
    }

    /// The discriminating case for per-year dedupe scoping: switching to a
    /// year with NO cache at all, while another year's non-forced refresh
    /// is still in flight, must not be starved by that other year's
    /// in-flight refresh — it needs to issue (and complete) its own fetch.
    /// A global `isRefreshing`-only guard would incorrectly no-op this.
    @Test func selectingCacheLessYearStartsOwnRefreshDespiteAnotherYearsInFlightRefresh() async {
        let cache = MockCache()
        // Year 2026 has a genuinely-stale (by real wall-clock) cache, so
        // start() kicks off a background refresh for it. Year 2025 has NO
        // cache entry at all.
        let staleFetchedAt = Date(timeIntervalSince1970: 1_000_000)
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: staleFetchedAt)
        cache.write("years", data: fixtureData("years"), etag: "y1", fetchedAt: Date())

        let api = MockAPI()
        await api.setSuccess(data: fixtureData("events-sample"), etag: "e1-refreshed", for: .events(year: 2026))
        await api.setSuspended(for: .events(year: 2026))
        await api.setSuccess(data: fixtureData("events-sample"), etag: "e3", for: .events(year: 2025))
        await api.setSuspended(for: .events(year: 2025))

        let repo = EventRepository(api: api, cache: cache)
        let model = AppModel(repository: repo, store: UserStateStore(defaults: makeDefaults(), now: { Date() }))

        let startTask = Task { await model.start() }
        try? await Task.sleep(for: .milliseconds(150))
        #expect(model.isRefreshing)
        #expect(model.snapshot?.year == 2026)

        // Switch to year 2025 (no cache) while 2026's refresh is still
        // parked mid-fetch.
        let selectTask = Task { await model.select(year: 2025) }
        try? await Task.sleep(for: .milliseconds(150))

        // 2025 has no cache, so it's showing nothing yet — but its own
        // fetch must have actually been issued, not swallowed.
        #expect(model.snapshot == nil)
        #expect(model.phase == .launching)
        let year2025Calls = await api.calls.filter {
            if case .events(let year) = $0.resource, year == 2025 { return true }
            return false
        }
        #expect(year2025Calls.count == 1)

        // Resolve 2025's fetch: its own refresh completes and populates it.
        await api.resume(for: .events(year: 2025))
        await selectTask.value
        #expect(model.snapshot?.year == 2025)

        // Finally resolve 2026's late fetch: must be discarded, not
        // clobbering the year-2025 snapshot now being viewed.
        await api.resume(for: .events(year: 2026))
        await startTask.value
        #expect(model.snapshot?.year == 2025)
    }

    /// Pull-to-refresh (`force: true`) must proceed even while a non-forced
    /// refresh for the same year is already in flight — the dedupe only
    /// applies between non-forced calls.
    @Test func forcedRefreshBypassesDedupeWhileSameYearNonForcedRefreshInFlight() async {
        let cache = MockCache()
        let api = MockAPI()
        await api.setSuccess(data: fixtureData("events-sample"), etag: "e1", for: .events(year: 2026))
        await api.setSuspended(for: .events(year: 2026))
        let repo = EventRepository(api: api, cache: cache, ttl: 0)
        let model = AppModel(repository: repo, store: UserStateStore(defaults: makeDefaults(), now: { Date() }))

        let firstRefresh = Task { await model.refresh(force: false) }
        try? await Task.sleep(for: .milliseconds(80))
        #expect(model.isRefreshing)

        // A forced refresh for the same year, while the first non-forced
        // one is still in flight, must issue its own fetch rather than
        // being deduped away.
        let secondRefresh = Task { await model.refresh(force: true) }
        try? await Task.sleep(for: .milliseconds(80))

        await api.resume(for: .events(year: 2026))
        await firstRefresh.value
        await secondRefresh.value

        let eventCalls = await api.calls.filter {
            if case .events = $0.resource { return true }
            return false
        }
        #expect(eventCalls.count == 2)
        #expect(!model.isRefreshing)
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

    // MARK: - foregrounded()
    //
    // Each of these pins the cache as genuinely stale by *real* wall-clock
    // time (`EventRepository.refresh` freshness-checks via its own
    // `Date()`), while giving the model an injected clock that treats it as
    // fresh (`needsRefresh` returns false). That decouples the two possible
    // triggers: if `foregrounded()` incorrectly decided to refresh anyway,
    // it would produce a real, observable network call against the
    // genuinely-stale cache — so an empty `eventCalls` here is real proof
    // no refresh happened, not just a side effect of a fresh-cache
    // short-circuit.

    @Test func foregroundedDoesNotRefreshOnFirstRunWithNilVersionAndModelFreshCache() async {
        let cache = MockCache()
        let staleFetchedAt = Date(timeIntervalSince1970: 1_000_000)
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: staleFetchedAt)
        let api = MockAPI() // `.version` unscripted -> remoteVersion() resolves to nil.
        let repo = EventRepository(api: api, cache: cache)
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: { staleFetchedAt.addingTimeInterval(10) }
        )

        await model.foregrounded()

        let eventCalls = await api.calls.filter {
            if case .events = $0.resource { return true }
            return false
        }
        #expect(eventCalls.isEmpty)
    }

    @Test func foregroundedRefreshesWhenRemoteVersionChanges() async throws {
        let cache = MockCache()
        let staleFetchedAt = Date(timeIntervalSince1970: 1_000_000)
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: staleFetchedAt)
        let api = MockAPI()
        let v1 = try #require("{\"version\":\"v1\"}".data(using: .utf8))
        await api.setSuccess(data: v1, etag: nil, for: .version)
        let repo = EventRepository(api: api, cache: cache)
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: { staleFetchedAt.addingTimeInterval(10) }
        )

        // First call only records v1 as the baseline — nothing to compare
        // against yet, so no refresh.
        await model.foregrounded()
        var eventCalls = await api.calls.filter {
            if case .events = $0.resource { return true }
            return false
        }
        #expect(eventCalls.isEmpty)

        // Second call sees a different deployed version. The model still
        // believes the cache is fresh (its injected clock hasn't moved),
        // so this alone must be what triggers the refresh.
        let v2 = try #require("{\"version\":\"v2\"}".data(using: .utf8))
        await api.setSuccess(data: v2, etag: nil, for: .version)
        await api.setSuccess(data: fixtureData("events-sample"), etag: "e2", for: .events(year: 2026))

        await model.foregrounded()

        eventCalls = await api.calls.filter {
            if case .events = $0.resource { return true }
            return false
        }
        #expect(eventCalls.count == 1)
    }

    @Test func foregroundedDoesNotRefreshWhenModelFreshCacheAndVersionUnchanged() async throws {
        let cache = MockCache()
        let staleFetchedAt = Date(timeIntervalSince1970: 1_000_000)
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: staleFetchedAt)
        let api = MockAPI()
        let v1 = try #require("{\"version\":\"v1\"}".data(using: .utf8))
        await api.setSuccess(data: v1, etag: nil, for: .version)
        let repo = EventRepository(api: api, cache: cache)
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: { staleFetchedAt.addingTimeInterval(10) }
        )

        await model.foregrounded()
        await model.foregrounded()

        let eventCalls = await api.calls.filter {
            if case .events = $0.resource { return true }
            return false
        }
        #expect(eventCalls.isEmpty)
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
