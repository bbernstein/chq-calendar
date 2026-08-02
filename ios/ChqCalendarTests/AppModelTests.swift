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
        await waitUntil("model reaches .ready phase") { model.phase == .ready }

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
        // Wait for start() to load the stale 2026 cache, read the (cached,
        // network-free) manifest, and reach the gated fetch inside its
        // background refresh.
        await waitUntil("start() reaches in-flight refresh for year 2026") {
            model.isRefreshing && model.snapshot?.year == 2026
        }
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
        await waitUntil("first refresh becomes in-flight") { model.isRefreshing }
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
        await waitUntil("start() reaches in-flight refresh for year 2026") {
            model.isRefreshing && model.snapshot?.year == 2026
        }
        #expect(model.isRefreshing)
        #expect(model.snapshot?.year == 2026)

        // Switch to year 2025 (no cache) while 2026's refresh is still
        // parked mid-fetch.
        let selectTask = Task { await model.select(year: 2025) }
        await waitUntil("year-2025 fetch is issued") {
            let calls = await api.calls.filter {
                if case .events(let year) = $0.resource, year == 2025 { return true }
                return false
            }
            return calls.count == 1
        }

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
        await waitUntil("first refresh becomes in-flight") { model.isRefreshing }
        #expect(model.isRefreshing)

        // A forced refresh for the same year, while the first non-forced
        // one is still in flight, must issue its own fetch rather than
        // being deduped away.
        let secondRefresh = Task { await model.refresh(force: true) }
        await waitUntil("forced refresh issues its own fetch") {
            let calls = await api.calls.filter {
                if case .events = $0.resource { return true }
                return false
            }
            return calls.count == 2
        }

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

    // MARK: - selectScope / selectWeek / clearAll / clearNonDateFilters

    /// Week 6 of the 2026 season is 08-01 12:00 → 08-08 12:00, so this
    /// instant puts `model.currentWeek == 6`.
    private func makeInSeasonModel(defaults: UserDefaults) throws -> AppModel {
        let now = try #require(ChqTime.parse("2026-08-03 12:00:00"))
        return AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: defaults, now: { Date() }),
            now: { now }
        )
    }

    @Test func selectScopeClearsWeeksAndPersists() throws {
        let defaults = makeDefaults()
        let model = try makeInSeasonModel(defaults: defaults)
        model.selectWeek(3)
        #expect(model.filter.selectedWeeks == [3])

        model.selectScope(.today)

        #expect(model.filter.dateScope == .today)
        #expect(model.filter.selectedWeeks.isEmpty)
        let reloaded = UserStateStore(defaults: defaults, now: { Date() }).loadFilters()
        #expect(reloaded?.dateScope == .today)
        #expect(reloaded?.selectedWeeks.isEmpty == true)
    }

    @Test func reselectingTheActiveScopeIsANoOp() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        model.selectScope(.today)
        model.selectScope(.today)
        #expect(model.filter.dateScope == .today)
    }

    @Test func selectingCurrentWeekBecomesThisWeekScope() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        #expect(model.currentWeek == 6)

        model.selectWeek(6)

        #expect(model.filter.dateScope == .thisWeek)
        #expect(model.filter.selectedWeeks.isEmpty)
        #expect(FilterChipState.isScopeSelected(
            .thisWeek, selection: model.filter, currentWeek: model.currentWeek))
        #expect(FilterChipState.isWeekSelected(
            6, selection: model.filter, currentWeek: model.currentWeek))
    }

    @Test func selectingAnotherWeekWhileNowIsActiveReplacesTheScope() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        #expect(model.filter.dateScope == .next)

        model.selectWeek(3)

        #expect(model.filter.dateScope == .all)
        #expect(model.filter.selectedWeeks == [3])
    }

    @Test func weeksAccumulateOnceScopeIsAll() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        model.selectWeek(3)
        model.selectWeek(4)
        #expect(model.filter.selectedWeeks == [3, 4])

        model.selectWeek(3)
        #expect(model.filter.selectedWeeks == [4])
    }

    @Test func deselectingTheLastWeekLeavesScopeAll() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        model.selectWeek(3)
        model.selectWeek(3)
        #expect(model.filter.selectedWeeks.isEmpty)
        #expect(model.filter.dateScope == .all)
    }

    @Test func selectingCurrentWeekAgainStaysThisWeek() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        model.selectWeek(6)
        model.selectWeek(6)
        #expect(model.filter.dateScope == .thisWeek)
        #expect(model.filter.selectedWeeks.isEmpty)
    }

    @Test func toggleLocationStoresOriginalCasingAndPersists() {
        let defaults = makeDefaults()
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: defaults, now: { Date() })
        )

        model.toggleLocation("Hall Of Philosophy")
        #expect(model.filter.selectedLocations == ["Hall Of Philosophy"])
        #expect(UserStateStore(defaults: defaults, now: { Date() })
            .loadFilters()?.selectedLocations == ["Hall Of Philosophy"])

        // Removal is case-insensitive, matching the web's toggleInList.
        model.toggleLocation("hall of philosophy")
        #expect(model.filter.selectedLocations.isEmpty)
        #expect(UserStateStore(defaults: defaults, now: { Date() })
            .loadFilters()?.selectedLocations.isEmpty == true)
    }

    @Test func toggleCategoryStoresOriginalCasingAndPersists() {
        let defaults = makeDefaults()
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: defaults, now: { Date() })
        )

        model.toggleCategory("CSO")
        #expect(model.filter.selectedCategories == ["CSO"])
        #expect(UserStateStore(defaults: defaults, now: { Date() })
            .loadFilters()?.selectedCategories == ["CSO"])

        model.toggleCategory("cso")
        #expect(model.filter.selectedCategories.isEmpty)
    }

    @Test func selectionsKeepInsertionOrder() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )

        model.toggleLocation("Norton Hall")
        model.toggleLocation("Amphitheater")
        #expect(model.filter.selectedLocations == ["Norton Hall", "Amphitheater"])
    }

    @Test func toggleFavoritesOnlyMutatesAndPersistsFilter() {
        let defaults = makeDefaults()
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: defaults, now: { Date() })
        )

        model.toggleFavoritesOnly()
        #expect(model.filter.showFavoritesOnly)
        #expect(UserStateStore(defaults: defaults, now: { Date() }).loadFilters()?.showFavoritesOnly == true)

        model.toggleFavoritesOnly()
        #expect(!model.filter.showFavoritesOnly)
        #expect(UserStateStore(defaults: defaults, now: { Date() }).loadFilters()?.showFavoritesOnly == false)
    }

    @Test func clearAllClearsEverythingIncludingTheSearchTerm() {
        let defaults = makeDefaults()
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: defaults, now: { Date() })
        )

        model.filter.searchText = "opera"
        model.filter.extraDays = 2
        model.selectWeek(4)
        model.toggleLocation("Amphitheater")
        model.filter.showFavoritesOnly = true

        model.clearAll()

        #expect(model.filter.searchText.isEmpty)
        #expect(model.filter.extraDays == 0)
        #expect(model.filter.dateScope == .all)
        #expect(model.filter.selectedWeeks.isEmpty)
        #expect(model.filter.selectedLocations.isEmpty)
        #expect(!model.filter.showFavoritesOnly)
        #expect(!model.filter.hasFilters)
        #expect(UserStateStore(defaults: defaults, now: { Date() })
            .loadFilters()?.hasFilters == false)
    }

    @Test func clearNonDateFiltersKeepsScopeAndWeeks() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )

        model.selectWeek(4)
        model.filter.searchText = "opera"
        model.toggleLocation("Amphitheater")
        model.toggleCategory("CSO")
        model.filter.showFavoritesOnly = true

        model.clearNonDateFilters()

        #expect(model.filter.selectedWeeks == [4])
        #expect(model.filter.dateScope == .all)
        #expect(model.filter.searchText.isEmpty)
        #expect(model.filter.selectedLocations.isEmpty)
        #expect(model.filter.selectedCategories.isEmpty)
        #expect(!model.filter.showFavoritesOnly)
    }

    @Test func removingAChipClearsJustThatFilter() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )

        model.filter.searchText = "Burns"
        model.toggleLocation("Amphitheater")
        model.toggleCategory("CSO")

        let chips = ActiveFilterChips.build(selection: model.filter)
        for chip in chips { model.remove(chip) }

        #expect(model.filter.searchText.isEmpty)
        #expect(model.filter.selectedLocations.isEmpty)
        #expect(model.filter.selectedCategories.isEmpty)
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

    // MARK: - Recents

    @Test func selectingAFilterPushesItOntoRecents() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )

        model.toggleLocation("Amphitheater")
        model.toggleCategory("CSO")

        #expect(model.recents.locations == ["Amphitheater"])
        #expect(model.recents.categories == ["CSO"])
    }

    @Test func deselectingDoesNotReorderRecents() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )

        model.toggleLocation("Amphitheater")
        model.toggleLocation("Norton Hall")
        #expect(model.recents.locations == ["Norton Hall", "Amphitheater"])

        model.toggleLocation("Amphitheater")   // deselect
        #expect(model.recents.locations == ["Norton Hall", "Amphitheater"])
    }

    @Test func recentsPersistAcrossModelInstances() {
        let defaults = makeDefaults()
        let store = UserStateStore(defaults: defaults, now: { Date() })
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()), store: store)
        model.toggleLocation("Amphitheater")

        let reborn = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: defaults, now: { Date() })
        )
        #expect(reborn.recents.locations == ["Amphitheater"])
    }

    @Test func facetHelpersReadThroughToTheSelection() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )

        model.toggle("Amphitheater", in: .venues)
        #expect(model.isSelected("amphitheater", in: .venues))
        #expect(!model.isSelected("Amphitheater", in: .categories))
        #expect(model.recentNames(.venues) == ["Amphitheater"])
    }

    // MARK: - facetCounts

    /// `facetCounts` is maintained by `snapshot`'s `didSet`, and a `didSet`
    /// never fires for a value `init` assigns — so this pins that the two
    /// paths which actually populate `snapshot` both keep the counts in
    /// step: a cold launch reading a cached snapshot, and a year switch to
    /// a year with no cache (which must clear the counts rather than leave
    /// the previous year's behind).
    @Test func facetCountsTrackTheSnapshotAcrossLaunchAndYearSwitch() async throws {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        let api = MockAPI()
        await api.setNeverResolves(for: .years)
        let model = AppModel(
            repository: EventRepository(api: api, cache: cache),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )

        #expect(model.facetCounts == .empty)

        Task { await model.start() }
        await waitUntil("model reaches .ready phase") { model.phase == .ready }
        #expect(model.facetCounts.locations["sports club, waterfront"] == 1)

        // `count(for:in:)` is what the panel actually renders, and it has to
        // lowercase: the name comes from `visibleLocations` in the feed's
        // display casing, while the key is lowercased `displayLocation`.
        // Drop that `.lowercased()` and every count in the panel silently
        // reads 0, so assert through the accessor rather than the dictionary.
        let venue = try #require(model.visibleLocations
            .first { $0.lowercased() == "sports club, waterfront" })
        #expect(venue != venue.lowercased(), "fixture venue must be display-cased")
        #expect(model.count(for: venue, in: .venues) == 1)
        #expect(model.count(for: "No Such Venue", in: .venues) == 0)

        let category = try #require(model.visibleCategories.first)
        #expect(model.count(for: category, in: .categories)
            == model.facetCounts.categories[category.lowercased()])

        // `selectedCount` drives the "(1)" in the row label.
        #expect(model.selectedCount(.venues) == 0)
        model.toggleLocation(venue)
        #expect(model.selectedCount(.venues) == 1)
        #expect(model.selectedCount(.categories) == 0)

        // 2025 has no cached snapshot and no scripted network response.
        await model.select(year: 2025)
        #expect(model.snapshot == nil)
        #expect(model.facetCounts == .empty)
    }

    // MARK: - legacy filter casing normalization

    /// Prior to this branch, `selectedLocations`/`selectedCategories` were
    /// persisted lowercased
    /// (`UserStateStoreTests.legacyLowercasedPayloadStillDecodes` pins that
    /// decoding such a payload still succeeds). Filtering has always been
    /// correct regardless of casing, but `ActiveFilterChips.build` does an
    /// exact-match lookup against the feed's own casing — so without this
    /// fix, a user upgrading with a persisted lowercase selection would see
    /// a raw lowercase chip (and lose the "CHQ Program" shortcut) until they
    /// toggled the filter or hit "Clear all". This pins that the very first
    /// snapshot after launch corrects it instead of waiting for the next
    /// interaction.
    @Test func snapshotArrivingCorrectsLegacyLowercasedFilterCasing() async throws {
        let defaults = makeDefaults()
        let legacy = """
        {"dateScope":"next","selectedWeeks":[],\
        "selectedLocations":["sports club, waterfront"],\
        "selectedCategories":["chautauqua institution program"],\
        "showFavoritesOnly":false,"lastSaved":"2026-08-01T12:00:00Z"}
        """
        defaults.set(Data(legacy.utf8), forKey: "chq-filters")

        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        let api = MockAPI()
        await api.setNeverResolves(for: .years)
        let model = AppModel(
            repository: EventRepository(api: api, cache: cache),
            store: UserStateStore(defaults: defaults, now: { Date() })
        )

        // Loaded exactly as persisted, lowercased, before any snapshot exists.
        #expect(model.filter.selectedLocations == ["sports club, waterfront"])
        #expect(model.filter.selectedCategories == ["chautauqua institution program"])

        Task { await model.start() }
        await waitUntil("model reaches .ready phase") { model.phase == .ready }

        #expect(model.filter.selectedLocations == ["Sports Club, Waterfront"])
        #expect(model.filter.selectedCategories == ["Chautauqua Institution Program"])

        // Corrected casing is written back, not just held in memory — a
        // second launch before the next snapshot arrives must not regress.
        let reloaded = UserStateStore(defaults: defaults, now: { Date() }).loadFilters()
        #expect(reloaded?.selectedLocations == ["Sports Club, Waterfront"])
        #expect(reloaded?.selectedCategories == ["Chautauqua Institution Program"])
    }

    /// A selection with no case-insensitive match in the current snapshot —
    /// e.g. a venue retired from this year's feed — must pass through
    /// untouched rather than being dropped, corrupted, or endlessly
    /// re-persisted.
    @Test func nonMatchingSelectionIsLeftUntouchedBySnapshotArrival() async throws {
        let defaults = makeDefaults()
        var filter = FilterSelection()
        filter.selectedLocations = ["Retired Venue"]
        UserStateStore(defaults: defaults, now: { Date() }).saveFilters(filter)

        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        let api = MockAPI()
        await api.setNeverResolves(for: .years)
        let model = AppModel(
            repository: EventRepository(api: api, cache: cache),
            store: UserStateStore(defaults: defaults, now: { Date() })
        )

        Task { await model.start() }
        await waitUntil("model reaches .ready phase") { model.phase == .ready }

        #expect(model.filter.selectedLocations == ["Retired Venue"])
    }
}
