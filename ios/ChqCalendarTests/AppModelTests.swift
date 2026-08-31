import Foundation
import UserNotifications
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

    // MARK: - resolvePendingEventDeepLinkIfPossible()
    //
    // The fix this section pins: `phase` alone is not a reliable "the
    // snapshot changed" signal, because a warm launch's stale cached
    // snapshot sets `phase = .ready` immediately and a background
    // `refresh()` can later replace `snapshot` without `phase` changing
    // again. So an unknown `.event` id must not be cleared while a refresh
    // is still in flight — only once one has actually settled.

    @Test func eventDeepLinkResolvesImmediatelyWhenSnapshotAlreadyHasIt() {
        let now = Date()
        let model = makeSnapshotModel(events: [makeEvent(id: "a", start: now)], now: now)
        model.pendingDeepLink = .event(id: "a")

        let resolved = model.resolvePendingEventDeepLinkIfPossible()

        #expect(resolved?.id == "a")
        #expect(model.pendingDeepLink == nil)
    }

    @Test func eventDeepLinkStaysPendingWithoutASnapshotYet() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )
        model.pendingDeepLink = .event(id: "a")

        #expect(model.resolvePendingEventDeepLinkIfPossible() == nil)
        #expect(model.pendingDeepLink == .event(id: "a"))
    }

    @Test func eventDeepLinkIsClearedImmediatelyWhenUnknownAndNoRefreshInFlight() {
        let now = Date()
        let model = makeSnapshotModel(events: [makeEvent(id: "a", start: now)], now: now)
        // `makeSnapshotModel` assigns `snapshot` directly rather than going
        // through `start()`/`refresh()`, so `phase` needs setting by hand to
        // match what those flows always pair a non-nil snapshot with.
        model.phase = .ready
        model.pendingDeepLink = .event(id: "does-not-exist")

        #expect(model.resolvePendingEventDeepLinkIfPossible() == nil)
        #expect(model.pendingDeepLink == nil)
    }

    @Test func nonEventDeepLinksAreNeverResolvedOrClearedHere() {
        let now = Date()
        let model = makeSnapshotModel(events: [makeEvent(id: "a", start: now)], now: now)

        model.pendingDeepLink = .myDay
        #expect(model.resolvePendingEventDeepLinkIfPossible() == nil)
        #expect(model.pendingDeepLink == .myDay)

        model.pendingDeepLink = .map(venue: "Amphitheater")
        #expect(model.resolvePendingEventDeepLinkIfPossible() == nil)
        #expect(model.pendingDeepLink == .map(venue: "Amphitheater"))
    }

    /// The race from the review: a warm launch loads a stale cached
    /// snapshot (missing the deep-linked event) straight into `phase =
    /// .ready`, then `start()`'s background refresh is still in flight when
    /// the link is asked to resolve. It must stay pending rather than being
    /// declared unknown — and once the refresh lands with the event, the
    /// very next resolution attempt must find it.
    @Test func eventDeepLinkStaysPendingDuringInFlightRefreshThenResolvesOnceRefreshLandsWithTheEvent() async throws {
        let cache = MockCache()
        // Genuinely stale by real wall-clock time (`EventRepository.refresh`
        // checks freshness via its own `Date()`), so `start()` actually
        // kicks off a background refresh for year 2026.
        let staleFetchedAt = Date(timeIntervalSince1970: 1_000_000)
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: staleFetchedAt)
        cache.write("years", data: fixtureData("years"), etag: "y1", fetchedAt: Date())

        let refreshedPayload = try #require("""
        {"data": [{"id": "999999", "title": "Newly Published Event", "startDate": "2026-08-10 10:00:00"}]}
        """.data(using: .utf8))
        let api = MockAPI()
        await api.setSuccess(data: refreshedPayload, etag: "e1-refreshed", for: .events(year: 2026))
        await api.setSuspended(for: .events(year: 2026))
        let repo = EventRepository(api: api, cache: cache)
        let model = AppModel(repository: repo, store: UserStateStore(defaults: makeDefaults(), now: { Date() }))

        let startTask = Task { await model.start() }
        await waitUntil("start() reaches in-flight refresh for year 2026") {
            model.isRefreshing && model.snapshot != nil
        }
        #expect(model.isRefreshing)

        model.pendingDeepLink = .event(id: "999999")

        // The stale snapshot (still `events-sample`, no "999999") doesn't
        // have the event, but a refresh is in flight — must stay pending,
        // not be declared unknown.
        #expect(model.resolvePendingEventDeepLinkIfPossible() == nil)
        #expect(model.pendingDeepLink == .event(id: "999999"))

        // Let the in-flight refresh land with data that has the event.
        await api.resume(for: .events(year: 2026))
        await startTask.value
        #expect(!model.isRefreshing)

        let resolved = model.resolvePendingEventDeepLinkIfPossible()
        #expect(resolved?.id == "999999")
        #expect(model.pendingDeepLink == nil)
    }

    /// The other half of the same race: if the id genuinely never shows up,
    /// the link must still eventually be cleared — just not until the
    /// in-flight refresh has actually settled.
    @Test func eventDeepLinkIsClearedOnlyAfterRefreshSettlesConfirmingTheEventIsUnknown() async throws {
        let cache = MockCache()
        let staleFetchedAt = Date(timeIntervalSince1970: 1_000_000)
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: staleFetchedAt)
        cache.write("years", data: fixtureData("years"), etag: "y1", fetchedAt: Date())

        let api = MockAPI()
        // The refreshed payload still doesn't contain the deep-linked id.
        await api.setSuccess(data: fixtureData("events-sample"), etag: "e1-refreshed", for: .events(year: 2026))
        await api.setSuspended(for: .events(year: 2026))
        let repo = EventRepository(api: api, cache: cache)
        let model = AppModel(repository: repo, store: UserStateStore(defaults: makeDefaults(), now: { Date() }))

        let startTask = Task { await model.start() }
        await waitUntil("start() reaches in-flight refresh for year 2026") {
            model.isRefreshing && model.snapshot != nil
        }
        #expect(model.isRefreshing)

        model.pendingDeepLink = .event(id: "does-not-exist")

        // Refresh still in flight: even though the *current* snapshot lacks
        // the id, it must not be given up on yet.
        #expect(model.resolvePendingEventDeepLinkIfPossible() == nil)
        #expect(model.pendingDeepLink == .event(id: "does-not-exist"))

        await api.resume(for: .events(year: 2026))
        await startTask.value
        #expect(!model.isRefreshing)

        // The refresh has settled and still doesn't know the id — now it's
        // safe to give up on it.
        #expect(model.resolvePendingEventDeepLinkIfPossible() == nil)
        #expect(model.pendingDeepLink == nil)
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

    // MARK: - Reminder scheduling

    /// The fixture event "101037" starts 2026-07-27 12:45:00 NY time — well
    /// after `reminderFixedNow` below, so its default 30-minutes-before
    /// reminder always has a future trigger date.
    ///
    /// `nonisolated`: passed directly as a `@Sendable () -> Date` to both
    /// `AppModel.init` and `ReminderCenter.init`, which must be callable
    /// without hopping back to the main actor.
    private nonisolated func reminderFixedNow() -> Date {
        // swiftlint:disable:next force_unwrapping
        ChqTime.parse("2026-07-15 00:00:00")!
    }

    @Test func starringWithDefaultPresetSchedulesViaReminderCenter() async throws {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        let scheduler = MockScheduler()
        let reminderCenter = ReminderCenter(scheduler: scheduler, now: reminderFixedNow)
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: reminderFixedNow,
            reminderCenter: reminderCenter
        )

        await model.start()
        #expect(model.phase == .ready)

        model.toggleFavorite("101037")

        await waitUntil("reminder scheduled for the starred event") {
            scheduler.addCalls.contains { $0.identifier == "event-101037" }
        }
        let call = try #require(scheduler.addCalls.first { $0.identifier == "event-101037" })
        #expect(call.userInfo == ["eventID": "101037"])
    }

    @Test func unstarringCancelsTheReminderOnNextSync() async {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        let scheduler = MockScheduler()
        let reminderCenter = ReminderCenter(scheduler: scheduler, now: reminderFixedNow)
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: reminderFixedNow,
            reminderCenter: reminderCenter
        )

        await model.start()
        model.toggleFavorite("101037")
        await waitUntil("reminder scheduled for the starred event") {
            scheduler.pendingIdentifiers.contains("event-101037")
        }

        model.toggleFavorite("101037")
        await waitUntil("reminder cancelled after unstarring") {
            !scheduler.pendingIdentifiers.contains("event-101037")
        }
    }

    @Test func successfulRefreshTriggersReminderSync() async {
        let cache = MockCache()
        let api = MockAPI()
        await api.setSuccess(data: fixtureData("events-sample"), etag: "e1", for: .events(year: 2026))
        let repo = EventRepository(api: api, cache: cache)
        let scheduler = MockScheduler()
        let reminderCenter = ReminderCenter(scheduler: scheduler, now: reminderFixedNow)
        let store = UserStateStore(defaults: makeDefaults(), now: { Date() })
        // Saved before `AppModel.init` so the model's `favorites` picks it
        // up at construction, without needing a second model instance.
        store.saveFavorites(["101037"])
        let model = AppModel(repository: repo, store: store, now: reminderFixedNow, reminderCenter: reminderCenter)

        await model.refresh(force: true)

        await waitUntil("refresh's successful snapshot triggers a reminder sync") {
            scheduler.addCalls.contains { $0.identifier == "event-101037" }
        }
    }

    @Test func deniedAuthorizationMeansStarringSchedulesNothing() async {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        let scheduler = MockScheduler()
        scheduler.status = .denied
        let reminderCenter = ReminderCenter(scheduler: scheduler, now: reminderFixedNow)
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: reminderFixedNow,
            reminderCenter: reminderCenter
        )

        await model.start()
        model.toggleFavorite("101037")

        // Give the fire-and-forget sync a chance to run; there's nothing to
        // poll *for* here since this proves an absence.
        try? await Task.sleep(for: .milliseconds(200))
        #expect(scheduler.calls.isEmpty)
    }

    @Test func setReminderOverridePersistsAndSyncs() async {
        let defaults = makeDefaults()
        let store = UserStateStore(defaults: defaults, now: { Date() })
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        let scheduler = MockScheduler()
        let reminderCenter = ReminderCenter(scheduler: scheduler, now: reminderFixedNow)
        let model = AppModel(repository: repo, store: store, now: reminderFixedNow, reminderCenter: reminderCenter)

        await model.start()
        model.toggleFavorite("101037")
        await waitUntil("initial reminder scheduled") {
            scheduler.pendingIdentifiers.contains("event-101037")
        }

        model.setReminderOverride(ReminderPreset.none, for: "101037")

        let reloadedSettings = UserStateStore(defaults: defaults, now: { Date() }).loadReminderSettings()
        #expect(reloadedSettings.preset(for: "101037") == ReminderPreset.none)
        await waitUntil("override turning reminders off removes the pending reminder") {
            !scheduler.pendingIdentifiers.contains("event-101037")
        }
    }

    @Test func setDefaultReminderPresetPersistsAndSyncs() async {
        let defaults = makeDefaults()
        let store = UserStateStore(defaults: defaults, now: { Date() })
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        let scheduler = MockScheduler()
        let reminderCenter = ReminderCenter(scheduler: scheduler, now: reminderFixedNow)
        let model = AppModel(repository: repo, store: store, now: reminderFixedNow, reminderCenter: reminderCenter)

        await model.start()
        model.toggleFavorite("101037")
        await waitUntil("initial reminder scheduled with default preset") {
            scheduler.pendingIdentifiers.contains("event-101037")
        }

        model.setDefaultReminderPreset(ReminderPreset.none)

        let reloadedSettings = UserStateStore(defaults: defaults, now: { Date() }).loadReminderSettings()
        #expect(reloadedSettings.defaultPreset == ReminderPreset.none)
        await waitUntil("default preset turned off removes the pending reminder") {
            !scheduler.pendingIdentifiers.contains("event-101037")
        }
    }

    @Test func reminderCenterDefaultsToNilAndAppModelStillWorksWithoutIt() async {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        let store = UserStateStore(defaults: makeDefaults(), now: { Date() })
        let model = AppModel(repository: repo, store: store, now: reminderFixedNow)

        #expect(model.reminderCenter == nil)
        await model.start()
        model.toggleFavorite("101037")
        // No crash / no assertion failure from a nil reminderCenter is the
        // whole point of this test.
        #expect(model.favorites.contains("101037"))
    }

    /// Browsing an archive year (via the always-available year picker) must
    /// not cancel a reminder for a favorited event that belongs to a
    /// *different* cached year. `events-sample-alt-casing` is used for 2025
    /// specifically because it contains none of `events-sample`'s event
    /// IDs — with the bug (a plan scoped to `snapshot?.events`, i.e.
    /// whichever year is currently selected), switching to 2025 would find
    /// no favorited events in that year's list, `sync` would `removeAll`,
    /// and the still-pending, still-in-the-future 2026 reminder for
    /// "101037" would be silently cancelled.
    @Test func selectingAnArchiveYearDoesNotCancelAReminderForAFavoriteInAnotherYear() async {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        cache.write("events-2025", data: fixtureData("events-sample-alt-casing"), etag: "e2", fetchedAt: Date())
        // Populates `model.years` with both 2025 and 2026 (plus 2027, which
        // has no cached snapshot and is simply skipped), so this actually
        // exercises the union-across-`years` code path rather than
        // incidentally passing because `years` only ever contained 2026.
        cache.write("years", data: fixtureData("years"), etag: "y1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        let scheduler = MockScheduler()
        let reminderCenter = ReminderCenter(scheduler: scheduler, now: reminderFixedNow)
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: reminderFixedNow,
            reminderCenter: reminderCenter
        )

        await model.start()
        model.toggleFavorite("101037")
        await waitUntil("reminder scheduled for the 2026 favorite") {
            scheduler.pendingIdentifiers.contains("event-101037")
        }

        await model.select(year: 2025)

        #expect(model.selectedYear == 2025)
        #expect(scheduler.pendingIdentifiers.contains("event-101037"))
    }

    // MARK: - One-time reminder-authorization ask on first star (#178)

    @Test func firstStarWithDefaultPresetRequestsAuthorizationExactlyOnceAcrossThreeStars() async {
        let scheduler = MockScheduler()
        scheduler.status = .notDetermined
        let reminderCenter = ReminderCenter(scheduler: scheduler, now: reminderFixedNow)
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: reminderFixedNow,
            reminderCenter: reminderCenter
        )

        // Three back-to-back stars of three different events — all
        // synchronous, no `await` between them, which is exactly the
        // scenario `requestReminderAuthorizationIfNeeded`'s synchronous
        // flag (not a re-read of async authorization status) is designed to
        // survive without a race. See that method's doc comment.
        model.toggleFavorite("evt-a")
        model.toggleFavorite("evt-b")
        model.toggleFavorite("evt-c")

        await waitUntil("the one-time authorization request lands") {
            scheduler.requestAuthorizationCallCount >= 1
        }
        // Bounded settle window for the negative half of the assertion — a
        // second or third stray request would also show up within it.
        try? await Task.sleep(for: .milliseconds(200))
        #expect(scheduler.requestAuthorizationCallCount == 1)
    }

    @Test func noAuthorizationRequestAcrossThreeStarsWhenDefaultPresetIsOff() async {
        let scheduler = MockScheduler()
        scheduler.status = .notDetermined
        let reminderCenter = ReminderCenter(scheduler: scheduler, now: reminderFixedNow)
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: reminderFixedNow,
            reminderCenter: reminderCenter
        )
        model.setDefaultReminderPreset(ReminderPreset.none)

        model.toggleFavorite("evt-a")
        model.toggleFavorite("evt-b")
        model.toggleFavorite("evt-c")

        try? await Task.sleep(for: .milliseconds(200))
        #expect(scheduler.requestAuthorizationCallCount == 0)
    }

    @Test func noAuthorizationRequestAcrossThreeStarsWhenAlreadyDenied() async {
        let scheduler = MockScheduler()
        scheduler.status = .denied
        let reminderCenter = ReminderCenter(scheduler: scheduler, now: reminderFixedNow)
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: reminderFixedNow,
            reminderCenter: reminderCenter
        )

        model.toggleFavorite("evt-a")
        model.toggleFavorite("evt-b")
        model.toggleFavorite("evt-c")

        try? await Task.sleep(for: .milliseconds(200))
        #expect(scheduler.requestAuthorizationCallCount == 0)
    }

    /// Task 17 review fix: `-uitest-seed-favorites`/`-uitest-star-selected-event`
    /// call `toggleFavorite` directly on a freshly-erased simulator (the
    /// screenshot script's starting state), which is `.notDetermined` and
    /// would otherwise spawn a real system permission dialog — see
    /// `AppModel.uitestSuppressReminderAuthorizationPrompt()`'s doc comment.
    /// Pins that calling the suppression hook first makes three back-to-back
    /// stars request authorization zero times, the same shape as
    /// `noAuthorizationRequestAcrossThreeStarsWhenDefaultPresetIsOff` above
    /// but via the DEBUG escape hatch rather than the preset.
    @Test func uitestSuppressionPreventsAnyAuthorizationRequestAcrossThreeStars() async {
        let scheduler = MockScheduler()
        scheduler.status = .notDetermined
        let reminderCenter = ReminderCenter(scheduler: scheduler, now: reminderFixedNow)
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: reminderFixedNow,
            reminderCenter: reminderCenter
        )

        model.uitestSuppressReminderAuthorizationPrompt()

        model.toggleFavorite("evt-a")
        model.toggleFavorite("evt-b")
        model.toggleFavorite("evt-c")

        try? await Task.sleep(for: .milliseconds(200))
        #expect(scheduler.requestAuthorizationCallCount == 0)
        #expect(model.favorites.isSuperset(of: ["evt-a", "evt-b", "evt-c"]))
    }

    /// #178 review fix: the in-flow "Don't Allow" case. Starring an event
    /// fires `requestReminderAuthorizationIfNeeded()`'s fire-and-forget
    /// `Task`, which the reviewer found never reported its result back
    /// anywhere the detail row could read — so a denial from *this* system
    /// dialog (as opposed to one already decided before the row appeared)
    /// left `model.reminderAuthorizationStatus` stale. This pins that the
    /// star flow now routes through `AppModel.ensureReminderAuthorization()`,
    /// which publishes the resolved status once the request settles.
    @Test func starringAnEventPublishesADenialOnTheModelOnceTheAuthorizationFlowSettles() async {
        let scheduler = MockScheduler()
        scheduler.status = .notDetermined
        scheduler.requestAuthorizationResult = false
        let reminderCenter = ReminderCenter(scheduler: scheduler, now: reminderFixedNow)
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: reminderFixedNow,
            reminderCenter: reminderCenter
        )

        #expect(model.reminderAuthorizationStatus == nil)

        model.toggleFavorite("evt-a")

        await waitUntil("the star flow's denial is published on the model") {
            model.reminderAuthorizationStatus == .denied
        }
        #expect(model.reminderAuthorizationStatus == .denied)
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

    // MARK: - landingState / browseArchiveSeason / previewNextSeason (#177)
    //
    // `events-sample.json` is entirely July 2026, so a fixed `now` in
    // September 2026 puts it past the `.next` scope's 90-day adaptive-window
    // cap (`EventFilter.adaptiveEndDate`) with nothing left in it — the
    // exact off-season emptiness #177 is about.

    @Test func landingStateIsPostSeasonOnceTheFixtureFeedsAdaptiveWindowCapExpires() async throws {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        cache.write("years", data: fixtureData("years"), etag: "y1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        let now = try #require(ChqTime.parse("2026-09-11 00:00:00"))
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: { now }
        )

        await model.start()

        #expect(model.years == [2025, 2026, 2027])
        #expect(model.selectedYear == 2026)
        #expect(model.isCurrentYear)

        let expected = LandingState.determine(
            now: now, selectedYear: 2026, availableYears: [2025, 2026, 2027], yearHasUpcomingEvents: false, yearHasEvents: true)
        #expect(model.landingState == expected)
        #expect(model.landingState == .postSeason(
            endedSeasonYear: 2026, nextSeasonYear: 2027,
            opening: SeasonCalendar.seasonStart(year: 2027), daysUntil: 288))
    }

    @Test func landingStateIsInSeasonWhileTheDefaultFilterStillHasFixtureEvents() async throws {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        cache.write("years", data: fixtureData("years"), etag: "y1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        // Pinned before every fixture event's start (same instant used by
        // `startWithWarmCacheIsReadyBeforeAnyNetworkCompletes`).
        let now = try #require(ChqTime.parse("2026-06-15 00:00:00"))
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: { now }
        )

        await model.start()

        #expect(model.landingState == .inSeason)
    }

    /// Without a `snapshot` yet, `landingState` must make no off-season
    /// claim at all — an offline first launch has no event data to say
    /// anything about the calendar from, and `phase` already owns what the
    /// screen shows. Originally #177; both instants below are run because
    /// only one of them can still fail.
    ///
    /// **2026-05-01 is the case that pins the guard.** Mid-July, `determine`
    /// would reach rule 3 (`!yearHasEvents` → `.inSeason`) against a nil
    /// snapshot's empty event set and return the right answer for the wrong
    /// reason — measured: deleting `guard let snapshot` leaves the mid-July
    /// assertion green. Before the season start the two genuinely disagree:
    /// the guard says `.inSeason`, while falling through says `.preSeason`
    /// (rule 2 outranks rule 3). So the May instant is what makes this test
    /// able to fail, and the July one is kept only because it is the
    /// scenario #177 was actually about.
    ///
    /// Note this is a deliberate iOS-only behaviour with no web counterpart,
    /// and it is a real divergence — verified, not assumed. `useEventData`
    /// sets `loading = false` with `events: []` on a failed fetch
    /// (`useEventData.ts`'s `catch` + `finally`), so `page.tsx:683-690`
    /// evaluates `showLanding` anyway and a failed May fetch resolves
    /// through rule 2 to `pre-season` — a countdown. iOS has `phase`
    /// (`.offline`/`.failed`) to own that screen instead, and web has no
    /// equivalent. The divergence is therefore in the *caller*, not in
    /// `determine`, which is why it does not break the rule-for-rule parity
    /// this change restores.
    @Test(arguments: ["2026-07-15 00:00:00", "2026-05-01 00:00:00"])
    func landingStateIsInSeasonWithoutASnapshot(_ nowString: String) async throws {
        let api = MockAPI()
        await api.setFailure(MockAPIError.unscripted("events-down"), for: .events(year: 2026))
        let repo = EventRepository(api: api, cache: MockCache())
        let now = try #require(ChqTime.parse(nowString))
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: { now }
        )

        // Before start(): no snapshot at all yet.
        #expect(model.snapshot == nil)
        #expect(model.landingState == .inSeason)

        // A failed fetch also leaves snapshot nil (offline first launch) —
        // same expectation holds once settled.
        await model.start()
        #expect(model.phase == .offline)
        #expect(model.snapshot == nil)
        #expect(model.landingState == .inSeason)
    }

    /// #288 — the divergence the fix closes. From 2026-10-01 the server
    /// flips `defaultYear` to 2027 (`eventsCalendarDataSyncService.ts`'s
    /// `getMonth() >= 9`), so 2027 becomes the *current* year while its
    /// published feed holds five events roughly 265 days out — far beyond
    /// `.next`'s 90-day adaptive cap (`EventFilter.adaptiveEndDate`).
    ///
    /// The old probe counted the `.next` window and got 0, so `determine`
    /// fell through to `.preSeason` and `OffSeasonLandingView` covered a
    /// feed that has events in it with "Almost showtime" — and, in
    /// `.preSeason`, no buttons at all (`LandingState.archiveYear` returned
    /// `nil` there at the time, and the preview button is
    /// `.postSeason`-only). Web, asking its
    /// year's whole event set, said `in-season` for the identical manifest,
    /// feed and clock. Six months of that, until 2027-06-27 finally entered
    /// the 90-day window around 2027-03-28.
    ///
    /// The fixtures are the real ones: `events-2027-sparse.json` is
    /// production's `all-events-2027.json` verbatim, and
    /// `years-2027-default.json` is the manifest the server generates from
    /// October 1.
    @Test func landingStateIsInSeasonWhenTheCurrentYearsOnlyEventsAreBeyondTheAdaptiveWindowCap() async throws {
        let cache = MockCache()
        cache.write("events-2027", data: fixtureData("events-2027-sparse"), etag: "e1", fetchedAt: Date())
        cache.write("years", data: fixtureData("years-2027-default"), etag: "y1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        let now = try #require(ChqTime.parse("2026-10-05 00:00:00"))
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: { now }
        )

        await model.start()

        #expect(model.selectedYear == 2027)
        #expect(model.isCurrentYear, "the whole point: 2027 is now the DEFAULT year, so .next is not degraded to .all")
        // The premise, asserted rather than assumed: `.next` genuinely has
        // nothing in it here. The fix is in what the landing probe asks, not
        // in the scope's window — the 90-day cap stays a scope window (#285
        // owns whether it should).
        #expect(model.dayGroups.isEmpty)

        #expect(model.landingState == .inSeason)

        // And the screen that produces has a way forward, which `.preSeason`
        // did not: `.inSeason` with an empty window sends `EventListView` to
        // `noMatchesView`, whose "Show All Events" button is `clearAll()`,
        // and that reaches all five announced days. (Whether "No matching
        // events" is the right *wording* for a season 265 days out is #285's
        // question — the scope semantics — not this one.)
        model.clearAll()

        #expect(model.dayGroups.count == 5)
    }

    /// The one-hour grace `landingState` applies is `.next`'s own opening
    /// grace (`ViewWindow.swift`'s `now.addingTimeInterval(-3600)`), and it
    /// is what keeps the app from saying "See you next season" over an event
    /// that is still happening. `events-sample.json`'s latest start is
    /// 2026-07-27 12:45, so half an hour past it is still in-season.
    @Test func landingStateStaysInSeasonWithinTheGraceHourAfterTheLastEventBegins() async throws {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        cache.write("years", data: fixtureData("years"), etag: "y1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        let now = try #require(ChqTime.parse("2026-07-27 13:15:00"))
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: { now }
        )

        await model.start()

        #expect(model.landingState == .inSeason)
    }

    /// The other side of the same boundary: 75 minutes past that last start,
    /// the grace has run out and the year genuinely has nothing ahead.
    /// Without this, `landingStateStaysInSeasonWithinTheGraceHourAfterTheLastEventBegins`
    /// would also pass with no grace at all in the code, since 2026-07-27
    /// is still inside the season calendar either way.
    @Test func landingStateIsPostSeasonOnceTheGraceHourAfterTheLastEventHasRunOut() async throws {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        cache.write("years", data: fixtureData("years"), etag: "y1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        let now = try #require(ChqTime.parse("2026-07-27 14:00:00"))
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: { now }
        )

        await model.start()

        #expect(model.landingState.isPostSeason)
    }

    /// Task 5 (#177): pins the exact state `OffSeasonLandingView` renders
    /// against — default filter, off-season, `dayGroups` empty — and that
    /// its "Browse the ended season" action (`browseArchiveSeason()`) is
    /// what recovers a non-empty list from there.
    @Test func browseArchiveSeasonShowsTheEndedSeasonWhenTheDefaultFilterHasGoneEmpty() async throws {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        cache.write("years", data: fixtureData("years"), etag: "y1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        let now = try #require(ChqTime.parse("2026-10-01 00:00:00"))
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: { now }
        )

        await model.start()
        #expect(model.filter.isDefault)
        #expect(model.dayGroups.isEmpty, "the default .next filter has nothing left post-season")
        #expect(model.landingState.isPostSeason)

        model.browseArchiveSeason()

        #expect(model.filter.dateScope == .season)
        #expect(!model.dayGroups.isEmpty)
    }

    @Test func previewNextSeasonSelectsTheAnnouncedYearAndSwitchesFilterToAll() async throws {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        cache.write("events-2027", data: fixtureData("events-sample"), etag: "e2", fetchedAt: Date())
        cache.write("years", data: fixtureData("years"), etag: "y1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        let now = try #require(ChqTime.parse("2026-09-11 00:00:00"))
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: { now }
        )

        await model.start()
        guard case .postSeason(_, 2027, _, _) = model.landingState else {
            Issue.record("expected postSeason with nextSeasonYear 2027, got \(model.landingState)")
            return
        }

        await model.previewNextSeason()

        #expect(model.selectedYear == 2027)
        #expect(model.snapshot?.year == 2027)
        #expect(model.filter.dateScope == .all)
    }

    /// `select(year:)` never throws — a network failure just leaves
    /// `snapshot == nil` / `phase == .offline` (see its doc comment) — so
    /// this pins that `previewNextSeason()` still finishes setting the
    /// filter afterward instead of stranding it mid-transition.
    @Test func previewNextSeasonSetsFilterEvenWhenTheNetworkFetchForNextYearFails() async throws {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        cache.write("years", data: fixtureData("years"), etag: "y1", fetchedAt: Date())
        // No cache entry at all for 2027, and its network fetch fails.
        let api = MockAPI()
        await api.setFailure(MockAPIError.unscripted("events-2027-down"), for: .events(year: 2027))
        let repo = EventRepository(api: api, cache: cache)
        let now = try #require(ChqTime.parse("2026-09-11 00:00:00"))
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: { now }
        )

        await model.start()

        await model.previewNextSeason()

        #expect(model.selectedYear == 2027)
        #expect(model.snapshot == nil)
        #expect(model.phase == .offline)
        #expect(model.filter.dateScope == .all)
    }

    @Test func previewNextSeasonIsANoOpWhileInSeason() async throws {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        cache.write("years", data: fixtureData("years"), etag: "y1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        let now = try #require(ChqTime.parse("2026-06-15 00:00:00"))
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: { now }
        )

        await model.start()
        #expect(model.landingState == .inSeason)
        let filterBefore = model.filter

        await model.previewNextSeason()

        #expect(model.selectedYear == 2026)
        #expect(model.filter == filterBefore)
    }

    /// Forces the "no next year announced yet" branch of `.postSeason`
    /// without needing a second years-manifest fixture.
    @Test func previewNextSeasonIsANoOpWhenNoNextYearIsAnnounced() async throws {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        cache.write("years", data: fixtureData("years"), etag: "y1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        let now = try #require(ChqTime.parse("2026-09-11 00:00:00"))
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: { now }
        )

        await model.start()
        model.years = [2025, 2026]
        guard case .postSeason(_, nil, nil, nil) = model.landingState else {
            Issue.record("expected postSeason with no next year, got \(model.landingState)")
            return
        }
        let filterBefore = model.filter

        await model.previewNextSeason()

        #expect(model.selectedYear == 2026)
        #expect(model.filter == filterBefore)
    }

    // MARK: - selectScope / setWeekSelection / clearAll / clearNonDateFilters

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

    /// Same fixture as `makeInSeasonModel`, plus a snapshot of 50 events
    /// packed into the hour before `now` — enough to satisfy the `.next`
    /// scope's `adaptiveEndDate` `minCount` on day 0 itself, so its base
    /// window settles at `2026-08-03` rather than the empty-snapshot
    /// fallback (the 90-day cap, which sits past the season's `bounds` and
    /// would make `expandWindowEnd()` a no-op — see `expandWindowEnd`'s test
    /// coverage below for that edge case in isolation).
    ///
    /// Plus one event each on `2026-08-06` and `2026-08-09`, with `08-04`,
    /// `08-05`, `08-07` and `08-08` deliberately empty. `expandWindowEnd()`
    /// steps to the next day that HAS events, so a fixture with no later
    /// event days at all could not tell a working implementation from a
    /// no-op one.
    private func makeInSeasonModelWithSeedEvents(defaults: UserDefaults) throws -> AppModel {
        let model = try makeInSeasonModel(defaults: defaults)
        let now = try #require(ChqTime.parse("2026-08-03 12:00:00"))
        let from = now.addingTimeInterval(-3600)
        var events: [Event] = try (0..<50).map { i in
            makeEvent(
                id: "seed\(i)",
                start: try #require(ChqTime.calendar.date(byAdding: .minute, value: i, to: from)))
        }
        events.append(makeEvent(
            id: "later-06", start: try #require(ChqTime.parse("2026-08-06 10:00:00"))))
        events.append(makeEvent(
            id: "later-09", start: try #require(ChqTime.parse("2026-08-09 10:00:00"))))
        model.snapshot = CalendarSnapshot(
            year: 2026, events: events, articleLinks: [:], programLinks: [:],
            themes: [], fetchedAt: now)
        return model
    }

    @Test func selectScopeClearsWeeksAndPersists() throws {
        let defaults = makeDefaults()
        let model = try makeInSeasonModel(defaults: defaults)
        model.setWeekSelection([3])
        #expect(model.filter.selectedWeeks == [3])

        model.selectScope(.today)

        #expect(model.filter.dateScope == .today)
        #expect(model.filter.selectedWeeks.isEmpty)
        let reloaded = UserStateStore(defaults: defaults, now: { Date() }).loadFilters()
        #expect(reloaded?.dateScope == .today)
        #expect(reloaded?.selectedWeeks.isEmpty == true)
    }

    /// #156: `windowEndDayKey` is how far the user has widened the `.next`
    /// window ("Show next day"), so it must not survive a move to another
    /// scope and silently re-widen the window when the user comes back to
    /// Now.
    /// Both window-expansion fields belong to the scope being left, not
    /// just `windowEndDayKey`. `expandWindowEnd` grows only the end edge, so
    /// the start edge is seeded directly here — the point is to pin that
    /// `clearScopeLocalDateState()` clears both, not only the one this path
    /// writes.
    @Test func selectScopeResetsWindowExpansion() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        #expect(model.filter.dateScope == .next)
        model.expandWindowEnd()
        model.expandWindowEnd()
        // Two steps of expandWindowEnd()'s "next day with events" rule
        // against the fixture's 08-06/08-09 event days — not a hardcoded
        // calendar step. What this test is actually pinning is unaffected
        // by which day that lands on: only that selectScope(.thisWeek)
        // clears it below.
        #expect(model.filter.windowEndDayKey == "2026-08-09")
        model.filter.windowStartDayKey = "2026-08-01"

        model.selectScope(.thisWeek)

        #expect(model.filter.windowEndDayKey == nil)
        #expect(model.filter.windowStartDayKey == nil)
    }

    /// The failure #156 actually describes: Now → This Week → Now leaves the
    /// window wider than a fresh `.next` selection, with nothing on screen
    /// explaining why. The intermediate assertion pins that the first
    /// `expandWindowEnd()` actually did something before the scope change
    /// throws it away — without it, a no-op `expandWindowEnd()` would let
    /// this test go green while pinning nothing.
    @Test func returningToNowAfterAScopeChangeStartsFromAFreshWindow() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.expandWindowEnd()
        // The next day with events in the fixture, per expandWindowEnd's
        // step rule — not a hardcoded calendar step. The point below is
        // that this is thrown away by the scope round-trip, regardless of
        // which day it landed on.
        #expect(model.filter.windowEndDayKey == "2026-08-06")
        model.selectScope(.thisWeek)

        model.selectScope(.next)

        #expect(model.filter.windowEndDayKey == nil)
    }

    /// #197 item 3: `selectedDayKey` is only meaningful under `.day`. Leaving
    /// it set after a scope change is inert today only because nothing else
    /// reads it — this makes the invariant hold by construction. Also pins
    /// that `browseDay` itself clears both window-expansion fields (per its
    /// doc comment), not just `selectedDayKey` via the later `selectScope`.
    @Test func selectScopeClearsTheBrowsedDay() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        model.filter.windowStartDayKey = "2026-08-01"
        model.filter.windowEndDayKey = "2026-08-05"

        model.browseDay("2026-08-09")

        #expect(model.filter.selectedDayKey == "2026-08-09")
        #expect(model.filter.windowStartDayKey == nil)
        #expect(model.filter.windowEndDayKey == nil)

        model.selectScope(.today)

        #expect(model.filter.selectedDayKey == nil)
    }

    /// `setWeekSelection` is the other route out of `.day` — it forces
    /// `.all` — so it owes the same cleanup as `selectScope`.
    @Test func setWeekSelectionClearsTheBrowsedDay() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        model.browseDay("2026-08-09")

        model.setWeekSelection([3])

        #expect(model.filter.dateScope == .all)
        #expect(model.filter.selectedDayKey == nil)
    }

    @Test func setWeekSelectionResetsWindowExpansion() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.expandWindowEnd()
        // The next day with events in the fixture, per expandWindowEnd's
        // step rule — not a hardcoded calendar step. What matters below is
        // that setWeekSelection clears it, not which day it was.
        #expect(model.filter.windowEndDayKey == "2026-08-06")

        model.setWeekSelection([3])

        #expect(model.filter.windowEndDayKey == nil)
    }

    /// #234: the early return was the one path into `selectScope` that
    /// skipped `clearScopeLocalDateState()`, so "Show next day" ×2 → Now
    /// left the window two days wider than a fresh `.next` selection —
    /// re-tapping the scope you are already on means "reset it".
    ///
    /// Note this does *not* make the scope chip agree with the rail's
    /// `⟳ Now`: `nowLeavesAnyAccumulatedExpansionInPlace` below pins the
    /// opposite for that control, deliberately (#258 deleted
    /// `AppModel.resetToNow()` to make `⟳ Now` pure navigation). They share
    /// a name, not a job — the chip resets its scope, the rail control
    /// travels without touching the filter.
    ///
    /// `expandWindowEnd` grows only the end edge, so the start edge is
    /// seeded directly here — the point is to verify the reset on *both*
    /// window fields, not just the one this particular path writes.
    /// `reTappingTheActiveScopeClearsAWindowGrownByTheDayRail` below covers
    /// the same reset with both edges driven through `goToDay` instead.
    @Test func reTappingTheActiveScopeClearsItsWidenedWindow() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        #expect(model.filter.dateScope == .next)
        model.expandWindowEnd()
        // The next day with events in the fixture, per expandWindowEnd's step
        // rule — not a hardcoded calendar step. The point is that the re-tap
        // throws it away, regardless of which day it landed on.
        #expect(model.filter.windowEndDayKey == "2026-08-06")
        model.filter.windowStartDayKey = "2026-08-01"

        model.selectScope(.next)

        #expect(model.filter.dateScope == .next)
        #expect(model.filter.windowStartDayKey == nil)
        #expect(model.filter.windowEndDayKey == nil)
    }

    /// The same reset, driven by the writer that actually produces most of
    /// this state in the field. `expandWindowEnd` (the test above) is the
    /// "Show next day" button; since #258 the day rail is the busier source
    /// — every chip tap goes `EventListView.selectDay` → `AppModel.goToDay`,
    /// which writes `windowStartDayKey`/`windowEndDayKey` directly. So the
    /// realistic path into #234 is: navigate the rail, open Filters, re-tap
    /// the chip you are already on.
    ///
    /// Both edges are grown here, each by a `goToDay` in its own direction,
    /// and each is asserted before the re-tap — a `goToDay` that silently
    /// refused its target would otherwise let this pass while pinning
    /// nothing.
    @Test func reTappingTheActiveScopeClearsAWindowGrownByTheDayRail() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        #expect(model.filter.dateScope == .next)

        // Before the fixture's "now" (2026-08-03 12:00), so the start edge
        // has to grow to reach it — 08-03 itself is already inside a fresh
        // `.next` window and `goToDay` would correctly write nothing.
        #expect(model.goToDay("2026-08-01"))
        #expect(model.filter.windowStartDayKey == "2026-08-01")
        #expect(model.goToDay("2026-08-09"))
        #expect(model.filter.windowEndDayKey == "2026-08-09")

        model.selectScope(.next)

        #expect(model.filter.dateScope == .next)
        #expect(model.filter.windowStartDayKey == nil)
        #expect(model.filter.windowEndDayKey == nil)
    }

    /// Re-tapping `.day` clears `selectedDayKey`, leaving `.day` with no day.
    /// That is deliberate, not an oversight, on two counts.
    ///
    /// First it is a *total* state, not a broken one: the #192 exemption trio
    /// all route through `EffectiveScope.resolve`, which downgrades `.day`
    /// with a `nil` key to `.all` (`ViewWindow` does the same via
    /// `dayWindow(forDayScope:)`), so the list, the date label and the chip
    /// state agree on "All Year" — a reset, which is what a re-tap now means.
    ///
    /// Second it is unreachable from the UI anyway. `selectScope`'s only
    /// caller is `FilterSheet`'s chip row, whose `visibleScopes` is
    /// `[.next, .today, .season, .all]` on the current year and `[.all]`
    /// otherwise; `.day` is never offered (see `DateScope.day`: "Derived, not
    /// pickable"), and neither is `.thisWeek`, which the week strip owns.
    /// `.day` arrives only from `browseDay`, which sets the scope and the day
    /// in one assignment and is therefore never a re-tap.
    @Test func reTappingDayScopeClearsItsBrowsedDayAndFallsBackToAll() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        model.browseDay("2026-08-09")
        #expect(model.filter.dateScope == .day)

        model.selectScope(.day)

        #expect(model.filter.selectedDayKey == nil)
        #expect(EffectiveScope.resolve(model.filter, isCurrentYear: true) == .all)
    }

    /// The guard's *original* purpose survives: when there is genuinely
    /// nothing to clear, `filter` is never written, so its `didSet` never
    /// fires and no save happens. Asserting only `dateScope == .today` would
    /// have passed just as well with the guard deleted outright — the erased
    /// payload below is what makes this able to fail.
    @Test func reselectingTheActiveScopeIsANoOp() throws {
        let defaults = makeDefaults()
        let model = try makeInSeasonModel(defaults: defaults)
        model.selectScope(.today)
        #expect(defaults.data(forKey: "chq-filters") != nil)
        // Erase what that first, real selection persisted: anything present
        // afterwards can only have been written by the re-tap.
        defaults.removeObject(forKey: "chq-filters")

        model.selectScope(.today)

        #expect(model.filter.dateScope == .today)
        #expect(defaults.data(forKey: "chq-filters") == nil)
    }

    @Test func selectingTheCurrentWeekIsAnOrdinaryWeekSelection() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        #expect(model.currentWeek == 6)

        model.setWeekSelection([6])

        #expect(model.filter.dateScope == .all)
        #expect(model.filter.selectedWeeks == [6])
        #expect(FilterChipState.isWeekSelected(
            6, selection: model.filter, currentWeek: model.currentWeek))
    }

    @Test func selectingAnotherWeekWhileNowIsActiveReplacesTheScope() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        #expect(model.filter.dateScope == .next)

        model.setWeekSelection([3])

        #expect(model.filter.dateScope == .all)
        #expect(model.filter.selectedWeeks == [3])
    }

    @Test func setWeekSelectionReplacesWholesale() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        model.setWeekSelection([3, 4])
        #expect(model.filter.selectedWeeks == [3, 4])

        model.setWeekSelection([6])
        #expect(model.filter.selectedWeeks == [6])
    }

    @Test func deselectingTheLastWeekLeavesScopeAll() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        model.setWeekSelection([3])
        model.setWeekSelection([])
        #expect(model.filter.selectedWeeks.isEmpty)
        #expect(model.filter.dateScope == .all)
    }

    @Test func clearingWeeksFromAPersistedThisWeekScopeReturnsToAllYear() throws {
        // Migration path: a user whose stored scope predates the strip
        // arrives with `.thisWeek` and no stored weeks. The strip shows the
        // current week highlighted; tapping it commits an empty selection —
        // which must actually clear the filter, not leave `.thisWeek`
        // silently re-highlighting the same week (a dead tap).
        let defaults = makeDefaults()
        let model = try makeInSeasonModel(defaults: defaults)
        model.selectScope(.thisWeek)

        model.setWeekSelection([])

        #expect(model.filter.dateScope == .all)
        #expect(model.filter.selectedWeeks.isEmpty)
    }

    @Test func setWeekSelectionPersists() throws {
        let defaults = makeDefaults()
        let model = try makeInSeasonModel(defaults: defaults)
        model.setWeekSelection([3, 4, 5])

        let reloaded = UserStateStore(defaults: defaults, now: { Date() }).loadFilters()
        #expect(reloaded?.selectedWeeks == [3, 4, 5])
        #expect(reloaded?.dateScope == .all)
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
        model.filter.windowEndDayKey = "2026-07-13"
        model.setWeekSelection([4])
        model.toggleLocation("Amphitheater")
        model.filter.showFavoritesOnly = true

        model.clearAll()

        #expect(model.filter.searchText.isEmpty)
        #expect(model.filter.windowEndDayKey == nil)
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

        model.setWeekSelection([4])
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

    // MARK: - scope-local resets stale pending targets (#254 scope addition)

    /// Entrance (2), live on `main`: `browseDay` of the day already browsed
    /// clears only the window-expansion fields, leaving every filter field
    /// of `PendingDayScroll.Key` unchanged — so before the reset epoch was
    /// part of the key, a target armed before the re-browse could never go
    /// stale and its pinned highlight survived pointing outside the freshly
    /// reset window.
    @Test func reBrowsingTheSameDayStalesATargetArmedUnderIt() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.browseDay("2026-08-03")
        let armed = PendingDayScroll.Target(
            day: "2026-08-06",
            key: PendingDayScroll.key(
                for: model.filter, year: model.selectedYear, scopeResets: model.scopeResetCount))

        // Growth toward the target must not stale it while we wait.
        model.filter.windowEndDayKey = "2026-08-06"
        #expect(!PendingDayScroll.isStale(armed, currentKey: PendingDayScroll.key(
            for: model.filter, year: model.selectedYear, scopeResets: model.scopeResetCount)))

        model.browseDay("2026-08-03")

        #expect(model.filter.windowEndDayKey == nil)
        #expect(PendingDayScroll.isStale(armed, currentKey: PendingDayScroll.key(
            for: model.filter, year: model.selectedYear, scopeResets: model.scopeResetCount)))
    }

    /// Entrance (1)'s state transition — a reset that clears ONLY the window
    /// fields while every `Key` filter field stays identical. Written against
    /// `clearScopeLocalDateState()`'s public route that exists on this base
    /// (`setWeekSelection([])` under an unchanged `.all`/no-weeks selection)
    /// rather than against #266's `selectScope` re-tap guard, which merges
    /// before this branch and calls the same reset — the epoch bump inside
    /// the reset covers it identically. Two selections differing only in
    /// window fields produce equal `Key` filter fields BY DESIGN (growth must
    /// never stale), so the reset epoch is the only thing that can mark this
    /// transition.
    @Test func aWindowOnlyResetStalesATargetThroughTheResetEpochAlone() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.selectScope(.all)
        model.filter.windowEndDayKey = "2026-08-06"
        let armed = PendingDayScroll.Target(
            day: "2026-08-06",
            key: PendingDayScroll.key(
                for: model.filter, year: model.selectedYear, scopeResets: model.scopeResetCount))

        // Same scope (.all), same (empty) weeks: only the window is cleared.
        model.setWeekSelection([])

        #expect(model.filter.dateScope == .all)
        #expect(model.filter.windowEndDayKey == nil)
        #expect(PendingDayScroll.isStale(armed, currentKey: PendingDayScroll.key(
            for: model.filter, year: model.selectedYear, scopeResets: model.scopeResetCount)))
    }

    /// `clearAll()` replaces the whole selection — window fields included —
    /// without going through `clearScopeLocalDateState()`. From an `.all`
    /// selection whose only non-default state is a window expansion, that
    /// replacement changes no `Key` filter field, so the epoch is the only
    /// thing that can stale a target (or pinned highlight) armed before it.
    /// No current writer produces that armed state through the UI — which
    /// is exactly the #192 "can't happen until the next task adds a caller"
    /// trap this test refuses to rely on.
    @Test func clearAllStalesATargetArmedUnderIt() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.selectScope(.all)
        model.filter.windowEndDayKey = "2026-08-06"
        let armed = PendingDayScroll.Target(
            day: "2026-08-06",
            key: PendingDayScroll.key(
                for: model.filter, year: model.selectedYear, scopeResets: model.scopeResetCount))

        model.clearAll()

        #expect(model.filter.windowEndDayKey == nil)
        #expect(PendingDayScroll.isStale(armed, currentKey: PendingDayScroll.key(
            for: model.filter, year: model.selectedYear, scopeResets: model.scopeResetCount)))
    }

    /// The load-bearing property the epoch must not break: window *growth* —
    /// the very thing a pending deep-link scroll is waiting for — never
    /// stales the target. `expandWindowEnd()` is the real growth writer;
    /// `windowStartDayKey` is set directly since no start-edge writer exists
    /// yet.
    @Test func windowGrowthAloneNeverStalesAPendingTarget() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        let armed = PendingDayScroll.Target(
            day: "2026-08-06",
            key: PendingDayScroll.key(
                for: model.filter, year: model.selectedYear, scopeResets: model.scopeResetCount))

        model.expandWindowEnd()
        model.filter.windowStartDayKey = "2026-08-01"

        #expect(!PendingDayScroll.isStale(armed, currentKey: PendingDayScroll.key(
            for: model.filter, year: model.selectedYear, scopeResets: model.scopeResetCount)))
    }

    /// One user action = one derived-data rebuild. `selectScope` and
    /// `browseDay` mutate several `filter` fields; written field-by-field,
    /// each changed field fires `filter`'s `didSet` and a full
    /// `rebuildDerivedCounts()` pass (#267 review finding). Pinned through
    /// the same DEBUG counter `windowExpansionDoesNotRecomputeIt` uses,
    /// against actions arranged so at least two `Key`-visible fields really
    /// change (from a default selection most of the writes are no-ops and
    /// even the unbatched code fired once).
    @Test func scopeAndBrowseActionsRebuildNavMatchingOncePerAction() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.setWeekSelection([3])

        var before = model.navMatchingRebuildCount
        model.selectScope(.thisWeek)
        #expect(model.navMatchingRebuildCount == before + 1)

        model.expandWindowEnd()
        before = model.navMatchingRebuildCount
        model.browseDay("2026-08-06")
        #expect(model.navMatchingRebuildCount == before + 1)
    }

    // MARK: - renderedDays (#254)

    /// `renderedDays.window` must be the window the days were actually
    /// filtered by — with expansion set, the path where the filter's
    /// internal window computation and `currentWindow` could historically
    /// diverge. The days are recomputed here through the same
    /// window-taking `EventFilter` entry point with the stamped window, so
    /// a `renderedDays` that filtered with one window and stamped another
    /// cannot pass.
    @Test func renderedDaysStampsTheWindowTheDaysWereFilteredBy() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.expandWindowEnd()
        #expect(model.filter.windowEndDayKey == "2026-08-06")

        let rendered = model.renderedDays

        let window = try #require(rendered.window)
        // The stamped window reflects the expansion the days were built under…
        #expect(window.endDay == "2026-08-06")
        // …and is the same value the rail's model-side callers read.
        #expect(rendered.window == model.currentWindow)

        // The days are exactly what filtering by the stamped window yields.
        let snapshot = try #require(model.snapshot)
        let expected = EventGrouping.byDay(
            EventFilter.apply(
                model.filter, to: snapshot.events, favorites: model.favorites,
                year: model.selectedYear, window: window),
            year: model.selectedYear)
        #expect(rendered.days.map(\.id) == expected.map(\.id))
        #expect(rendered.days.map { $0.events.map(\.id) } == expected.map { $0.events.map(\.id) })
        // The expansion actually reached the list this window was stamped on.
        #expect(rendered.days.last?.id == "2026-08-06")
    }

    // MARK: - expandWindowEnd

    /// The correction phase 2 learned, applied to the model: a step lands on
    /// a day that will actually render. `2026-08-04` and `2026-08-05` are
    /// empty in this fixture and are skipped — widening onto them would move
    /// the edge, add nothing to the list, and read as a broken control.
    @Test func expandWindowEndStepsToTheNextDayThatHasEvents() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())

        #expect(model.filter.windowEndDayKey == nil)
        model.expandWindowEnd()
        #expect(model.filter.windowEndDayKey == "2026-08-06")
        model.expandWindowEnd()
        #expect(model.filter.windowEndDayKey == "2026-08-09")
    }

    @Test func expandWindowEndStopsWhenNothingIsLeftBeyondTheEdge() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.expandWindowEnd()
        model.expandWindowEnd()

        model.expandWindowEnd()

        #expect(model.filter.windowEndDayKey == "2026-08-09")
    }

    /// The non-date filters constrain where expansion can go, because they
    /// constrain what could possibly render there.
    @Test func expandWindowEndRespectsTheOtherFilters() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.filter.searchText = "nothing matches this"

        model.expandWindowEnd()

        #expect(model.filter.windowEndDayKey == nil)
    }

    /// With no snapshot loaded there are no event days at all, so
    /// `edgeTargets` has nothing forward of the base window to grant — a
    /// no-op for the same reason `expandWindowEndRespectsTheOtherFilters`
    /// is, and *also* because `.next`'s `adaptiveEndDate` never reaches its
    /// `minCount` and falls back to its 90-day cap, which lands past the
    /// season's `bounds.upperBound` besides. Either reason alone would make
    /// this a no-op; both apply here.
    @Test func expandWindowEndIsANoOpWhenTheBaseWindowAlreadyExceedsBounds() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        #expect(model.filter.windowEndDayKey == nil)

        model.expandWindowEnd()

        #expect(model.filter.windowEndDayKey == nil)
    }

    // MARK: - goToDay

    @Test func goToDayInsideTheWindowChangesNoState() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        let before = model.filter

        #expect(model.goToDay("2026-08-03"))

        #expect(model.filter == before)
    }

    @Test func goToDayBeyondTheEndGrowsTheEndEdgeToIt() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())

        #expect(model.goToDay("2026-08-09"))

        #expect(model.filter.windowEndDayKey == "2026-08-09")
        #expect(model.filter.windowStartDayKey == nil)
    }

    /// An empty day is a legal target at the *rule* layer even though Task 9
    /// disables its chip: the rail decides what to offer, `goToDay` decides
    /// what is representable, and phase 4's Siri routing will name days the
    /// rail does not offer. Keeping the rule permissive and the affordance
    /// strict is deliberate — the reverse (a rule that refuses) would make
    /// "go to tomorrow" fail silently on a quiet Tuesday.
    @Test func goToDayAcceptsAnEmptyDayEvenThoughTheRailDisablesItsChip() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())

        #expect(model.goToDay("2026-08-05"))

        #expect(model.filter.windowEndDayKey == "2026-08-05")
    }

    @Test func goToDayOutsideTheNavigableBoundsIsRefused() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())

        #expect(!model.goToDay("2027-01-01"))

        #expect(model.filter.windowEndDayKey == nil)
        #expect(model.filter.windowStartDayKey == nil)
    }

    // MARK: - Pending day deep link

    @Test func pendingDayLinkResolvesOnceASnapshotExists() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.pendingDeepLink = .day(key: "2026-08-06")

        #expect(model.resolvePendingDayDeepLinkIfPossible() == "2026-08-06")
        #expect(model.pendingDeepLink == nil)
    }

    /// Idempotent: a second call must not re-deliver a link already acted on,
    /// or every `.onChange` trigger in `EventListView` would re-scroll a reader
    /// who has since moved.
    @Test func pendingDayLinkIsDeliveredExactlyOnce() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.pendingDeepLink = .day(key: "2026-08-06")

        _ = model.resolvePendingDayDeepLinkIfPossible()

        #expect(model.resolvePendingDayDeepLinkIfPossible() == nil)
    }

    /// Before the snapshot lands there are no day sections to scroll to, so
    /// holding the link is what makes a cold launch work.
    @Test func pendingDayLinkIsHeldUntilTheSnapshotArrives() throws {
        let model = try makeInSeasonModel(defaults: makeDefaults())
        model.snapshot = nil
        model.pendingDeepLink = .day(key: "2026-08-06")

        #expect(model.resolvePendingDayDeepLinkIfPossible() == nil)
        #expect(model.pendingDeepLink == .day(key: "2026-08-06"))
    }

    @Test func pendingEventLinkIsNotResolvedAsADay() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.pendingDeepLink = .event(id: "seed0")

        #expect(model.resolvePendingDayDeepLinkIfPossible() == nil)
        #expect(model.pendingDeepLink == .event(id: "seed0"))
    }

    // MARK: - ⟳ Now
    //
    // There is no `AppModel.resetToNow()` any more (finding 2 of the phase
    // 3b review): the spec is explicit that ⟳ Now "does not touch scope,
    // weeks, categories, or search," and `resetToNow()`'s old body — forcing
    // `.next`, clearing weeks, clearing the browsed day — was exactly that
    // kind of filter change. `EventListView.nowButton` now calls
    // `selectDay(todayKey)` directly, i.e. plain `goToDay(todayKey)` on the
    // model side, so these tests pin `goToDay`'s behavior against the
    // property that motivated deleting `resetToNow()`, rather than testing
    // a method that no longer exists.

    /// The property that motivated the change: `resetToNow()` used to wipe
    /// out `selectedWeeks`. `goToDay` — Now's actual implementation — is
    /// pure navigation, so an active week selection survives the tap.
    @Test func nowSurvivesAnActiveWeekSelection() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.setWeekSelection([3])

        #expect(model.goToDay("2026-08-03"))

        #expect(model.filter.selectedWeeks == [3])
        #expect(model.filter.dateScope == .all)
    }

    /// `resetToNow()` used to collapse any forward expansion the reader had
    /// accumulated back to nothing before scrolling. `goToDay` never resets
    /// state that isn't in its way: today is already inside the expanded
    /// window here, so the tap is pure navigation and the expansion the
    /// reader made themselves is left exactly as they left it.
    @Test func nowLeavesAnyAccumulatedExpansionInPlace() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.expandWindowEnd()
        #expect(model.filter.windowEndDayKey == "2026-08-06")

        #expect(model.goToDay("2026-08-03"))

        #expect(model.filter.dateScope == .next)
        #expect(model.filter.windowEndDayKey == "2026-08-06")
    }

    /// `resetToNow()` used to force `dateScope` back to `.next` and clear a
    /// browsed day. Under the new contract, tapping Now from a browsed day
    /// grows the window to reach today without ever leaving `.day` scope or
    /// touching `selectedDayKey` — exactly like any other `goToDay` call.
    @Test func nowFromABrowsedDayGrowsTheWindowWithoutChangingScopeOrDay() throws {
        let model = try makeInSeasonModelWithSeedEvents(defaults: makeDefaults())
        model.browseDay("2026-08-09")

        #expect(model.goToDay("2026-08-03"))

        #expect(model.filter.dateScope == .day)
        #expect(model.filter.selectedDayKey == "2026-08-09")
        #expect(model.filter.windowStartDayKey == "2026-08-03")
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

        // Facet counts now respect the current selection (#152), and the
        // model's default filter is `dateScope: .next` evaluated against the
        // real system clock — so a count asserted under the default filter
        // would be a flaky, date-dependent value rather than the fixed
        // fixture total this test is pinning. Switch to `.all` so the counts
        // below are season-wide and stable, which is all this test actually
        // means to assert: that `facetCounts` tracks the snapshot across a
        // cold launch and a year switch.
        model.filter = FilterSelection(dateScope: .all)
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
        // `normalizePersistedFilterCasing`'s `guard snapshot != nil` early
        // return must leave the selection alone rather than wiping or
        // mangling it just because there's nothing to normalize against yet.
        #expect(model.filter.selectedLocations == [venue])
    }

    // MARK: - matchCount / favoritesMatchCount

    /// A model holding a synthetic snapshot, so the counts below are exact
    /// rather than whatever the shared fixture happens to contain. `.all`
    /// scope and a pinned clock keep the numbers independent of the wall
    /// clock. 2026 is `placeholderYear`, so `isCurrentYear` is true.
    private func makeSnapshotModel(
        events: [Event],
        now: Date,
        articleLinks: [String: [ArticleLink]] = [:],
        programLinks: [String: [ProgramLink]] = [:]
    ) -> AppModel {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            now: { now }
        )
        model.filter = FilterSelection(dateScope: .all)
        model.snapshot = CalendarSnapshot(
            year: 2026, events: events, articleLinks: articleLinks, programLinks: programLinks,
            themes: [], fetchedAt: now)
        return model
    }

    /// The two sheet footers read `matchCount` while `EventListView` behind
    /// them reads `dayGroups`. They must never be able to disagree — if
    /// `matchCount` ever stopped mirroring the pipeline `dayGroups` runs,
    /// the footer would promise a number the list doesn't show.
    @Test func matchCountEqualsTheSummedDayGroupCount() throws {
        let now = try #require(ChqTime.parse("2026-08-03 12:00:00"))
        let model = makeSnapshotModel(
            events: [
                makeEvent(id: "a", start: try #require(ChqTime.parse("2026-08-03 19:00:00")),
                          title: "Opera Gala", location: "Norton Hall"),
                makeEvent(id: "b", start: try #require(ChqTime.parse("2026-08-03 20:00:00")),
                          title: "Symphony", location: "Amphitheater"),
                makeEvent(id: "c", start: try #require(ChqTime.parse("2026-08-04 10:00:00")),
                          title: "Opera Talk", location: "Norton Hall"),
            ],
            now: now)

        func summedDayGroups() -> Int {
            model.dayGroups.reduce(0) { $0 + $1.events.count }
        }

        #expect(model.matchCount == 3)
        #expect(model.matchCount == summedDayGroups())

        // Across a search, a venue filter, and a week selection — every
        // stage `dayGroups` runs, `matchCount` must run identically.
        model.filter.searchText = "opera"
        #expect(model.matchCount == 2)
        #expect(model.matchCount == summedDayGroups())

        model.toggleLocation("Norton Hall")
        #expect(model.matchCount == summedDayGroups())

        model.filter.searchText = ""
        model.setWeekSelection([6])
        #expect(model.matchCount == summedDayGroups())
    }

    @Test func matchCountIsZeroWithoutASnapshot() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )
        #expect(model.snapshot == nil)
        #expect(model.matchCount == 0)
        #expect(model.favoritesMatchCount == 0)
    }

    /// The bug this replaces: the Favorites chip showed `favorites.count`,
    /// the raw saved total, while every other chip in the same sheet showed
    /// a selection-aware count. Searching "opera" with three favorites of
    /// which one is opera-related read "Favorites 3" and yielded one event.
    @Test func favoritesMatchCountRespectsTheOtherActiveFilters() throws {
        let now = try #require(ChqTime.parse("2026-08-03 12:00:00"))
        let model = makeSnapshotModel(
            events: [
                makeEvent(id: "a", start: try #require(ChqTime.parse("2026-08-03 19:00:00")),
                          title: "Opera Gala", location: "Norton Hall"),
                makeEvent(id: "b", start: try #require(ChqTime.parse("2026-08-03 20:00:00")),
                          title: "Symphony", location: "Amphitheater"),
                makeEvent(id: "c", start: try #require(ChqTime.parse("2026-08-04 10:00:00")),
                          title: "Lecture", location: "Hall of Philosophy"),
                makeEvent(id: "d", start: try #require(ChqTime.parse("2026-08-05 10:00:00")),
                          title: "Not A Favorite", location: "Amphitheater"),
            ],
            now: now)
        model.favorites = ["a", "b", "c"]

        // No other filters: the chip and the raw total agree.
        #expect(model.favoritesMatchCount == 3)
        #expect(model.favoritesMatchCount == model.favorites.count)

        // Under a search only one favorite survives — the number the chip
        // shows must be the number tapping it produces.
        model.filter.searchText = "opera"
        #expect(model.favorites.count == 3, "the saved set itself is untouched")
        #expect(model.favoritesMatchCount == 1)

        model.toggleFavoritesOnly()
        #expect(model.matchCount == model.favoritesMatchCount)

        // Already-on favorites-only must not double-count itself away: the
        // chip keeps reading the same number it did before the tap.
        #expect(model.favoritesMatchCount == 1)

        // A combination no favorite can satisfy reads 0, not 3: the only
        // "Hall of Philosophy" event is "Lecture", which no "symphony"
        // search can reach.
        model.toggleFavoritesOnly()
        model.filter.searchText = "symphony"
        model.toggleLocation("Hall of Philosophy")
        #expect(model.matchCount == 0)
        #expect(model.favoritesMatchCount == 0)
    }

    /// Favorites that are no longer in the snapshot (a stale id from a past
    /// season) must not inflate the chip — the raw `favorites.count` counted
    /// them, an `EventFilter` pass cannot.
    @Test func favoritesMatchCountIgnoresIdsAbsentFromTheSnapshot() throws {
        let now = try #require(ChqTime.parse("2026-08-03 12:00:00"))
        let model = makeSnapshotModel(
            events: [
                makeEvent(id: "a", start: try #require(ChqTime.parse("2026-08-03 19:00:00"))),
            ],
            now: now)
        model.favorites = ["a", "gone-from-2025", "also-gone"]

        #expect(model.favorites.count == 3)
        #expect(model.favoritesMatchCount == 1)
    }

    // MARK: - programLinks(for:) accessor

    @Test func programLinksAccessorReturnsLinksForEvent() throws {
        let now = try #require(ChqTime.parse("2026-08-03 12:00:00"))
        let link = ProgramLink(title: "Program", url: URL(string: "https://example.com/program")!)
        let model = makeSnapshotModel(
            events: [makeEvent(id: "a", start: now)],
            now: now,
            programLinks: ["a": [link]])

        #expect(model.programLinks(for: "a") == [link])
        #expect(model.programLinks(for: "missing") == [])
    }

    @Test func programLinksAccessorEmptyWithoutSnapshot() {
        let bare = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )
        #expect(bare.programLinks(for: "a") == [])
    }

    // MARK: - UI-test event selection hooks (DEBUG only)

    /// Backs `-uitest-select-linked-event` (index 0) and
    /// `-uitest-select-event-index <n>`. Screenshot captures have to be
    /// byte-reproducible, so this pins the ordering rule rather than
    /// leaving it to `max(by:)`: `max(by:)` is itself deterministic (it
    /// keeps the first maximum it encounters), but the input order isn't —
    /// it depends on snapshot/feed ordering, which can differ between
    /// captures — so an explicit `id` tie-break is what actually makes the
    /// selection reproducible.
    @Test func uiTestLinkedEventsAreRankedByRichnessThenIdForTieBreaks() throws {
        let now = try #require(ChqTime.parse("2026-08-03 12:00:00"))
        func link(_ title: String) -> ArticleLink {
            ArticleLink(
                title: title, url: URL(string: "https://example.com/\(title)")!,
                kind: .preview, pubDate: "2026-06-30")
        }
        let model = makeSnapshotModel(
            events: [
                // "b" and "c" have identical weight (same details length, one
                // link each) — the id tie-break must order them, not chance.
                makeEvent(id: "c", start: try #require(ChqTime.parse("2026-08-03 09:00:00")),
                          title: "Tie C", details: String(repeating: "x", count: 100)),
                makeEvent(id: "b", start: try #require(ChqTime.parse("2026-08-03 10:00:00")),
                          title: "Tie B", details: String(repeating: "x", count: 100)),
                makeEvent(id: "a", start: try #require(ChqTime.parse("2026-08-03 19:00:00")),
                          title: "Richest", details: String(repeating: "x", count: 900)),
                makeEvent(id: "unlinked", start: try #require(ChqTime.parse("2026-08-04 10:00:00")),
                          title: "No Links", details: String(repeating: "x", count: 5000)),
            ],
            now: now,
            articleLinks: ["a": [link("a1")], "b": [link("b1")], "c": [link("c1")]])

        // The 5000-character "unlinked" event outweighs every candidate but
        // has no article links, so it must not appear at all.
        #expect(model.uiTestLinkedEvents.map(\.id) == ["a", "b", "c"])
        #expect(model.uiTestFirstLinkedEvent?.id == "a")
        #expect(model.uiTestLinkedEvent(at: 0)?.id == "a")
        #expect(model.uiTestLinkedEvent(at: 1)?.id == "b")
        #expect(model.uiTestLinkedEvent(at: 2)?.id == "c")

        // Repeated reads must agree — this is the reproducibility the
        // screenshot pipeline depends on.
        #expect(model.uiTestLinkedEvents.map(\.id) == model.uiTestLinkedEvents.map(\.id))
    }

    /// The whole point of the index hook: index 1 must be a *different*
    /// event than `-uitest-select-linked-event` picks, so iPad's `01-season`
    /// and `04-detail` stop capturing byte-identical images.
    @Test func uiTestIndexOneDiffersFromTheDefaultSelection() throws {
        let now = try #require(ChqTime.parse("2026-08-03 12:00:00"))
        let link = ArticleLink(
            title: "t", url: URL(string: "https://example.com/t")!,
            kind: .preview, pubDate: "2026-06-30")
        let model = makeSnapshotModel(
            events: [
                makeEvent(id: "a", start: try #require(ChqTime.parse("2026-08-03 19:00:00")),
                          title: "Richest", details: String(repeating: "x", count: 900)),
                makeEvent(id: "b", start: try #require(ChqTime.parse("2026-08-03 20:00:00")),
                          title: "Second", details: String(repeating: "x", count: 500)),
            ],
            now: now,
            articleLinks: ["a": [link], "b": [link]])

        let first = try #require(model.uiTestFirstLinkedEvent)
        let second = try #require(model.uiTestLinkedEvent(at: 1))
        #expect(first.id != second.id)
    }

    /// Out of range is a no-op (`nil`), deliberately not a clamp — a typo'd
    /// index must leave the detail column empty and visible in review, not
    /// silently capture a different, plausible-looking event.
    @Test func uiTestLinkedEventOutOfRangeIsNilRatherThanClamped() throws {
        let now = try #require(ChqTime.parse("2026-08-03 12:00:00"))
        let link = ArticleLink(
            title: "t", url: URL(string: "https://example.com/t")!,
            kind: .preview, pubDate: "2026-06-30")
        let model = makeSnapshotModel(
            events: [
                makeEvent(id: "a", start: try #require(ChqTime.parse("2026-08-03 19:00:00")),
                          details: "some details"),
            ],
            now: now,
            articleLinks: ["a": [link]])

        #expect(model.uiTestLinkedEvents.count == 1)
        #expect(model.uiTestLinkedEvent(at: 1) == nil)
        #expect(model.uiTestLinkedEvent(at: 99) == nil)
        #expect(model.uiTestLinkedEvent(at: -1) == nil)
    }

    @Test func uiTestLinkedEventsIsEmptyWithoutASnapshotOrLinks() throws {
        let bare = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() })
        )
        #expect(bare.uiTestLinkedEvents.isEmpty)
        #expect(bare.uiTestFirstLinkedEvent == nil)
        #expect(bare.uiTestLinkedEvent(at: 0) == nil)

        // A snapshot with events but no sidecar links is still no candidates.
        let now = try #require(ChqTime.parse("2026-08-03 12:00:00"))
        let noLinks = makeSnapshotModel(
            events: [makeEvent(id: "a", start: now)], now: now, articleLinks: [:])
        #expect(noLinks.uiTestLinkedEvents.isEmpty)
        #expect(noLinks.uiTestLinkedEvent(at: 0) == nil)
    }

    /// #255: iPad's `01-season` combines `-uitest-go-to-day` (lands the rail
    /// on a named day) with `-uitest-select-event-index` (populates the
    /// detail column). Before this fix, the index picked from the
    /// season-wide richest pool regardless of which day the rail landed on,
    /// so the rail could show Thursday while the detail pane showed an
    /// unrelated Monday event — a store screenshot that visibly contradicted
    /// its own "jump to any day" caption. `dayKey` scopes the pool to the
    /// landed day *before* ranking by richness.
    @Test func uiTestLinkedEventDayKeyScopesSelectionToThatDay() throws {
        let now = try #require(ChqTime.parse("2026-08-03 12:00:00"))
        let link = ArticleLink(
            title: "t", url: URL(string: "https://example.com/t")!,
            kind: .preview, pubDate: "2026-06-30")
        let model = makeSnapshotModel(
            events: [
                // Season-wide richest overall, but lands on Aug 3 — this is
                // exactly what a day-scoped Aug-4 pick must NOT select.
                makeEvent(id: "richest-aug3", start: try #require(ChqTime.parse("2026-08-03 19:00:00")),
                          details: String(repeating: "x", count: 900)),
                // Two candidates on Aug 4, both lighter than the Aug 3 event,
                // so their relative order only shows up once scoped to Aug 4.
                makeEvent(id: "aug4-heavier", start: try #require(ChqTime.parse("2026-08-04 09:00:00")),
                          details: String(repeating: "x", count: 300)),
                makeEvent(id: "aug4-lighter", start: try #require(ChqTime.parse("2026-08-04 10:00:00")),
                          details: String(repeating: "x", count: 100)),
            ],
            now: now,
            articleLinks: [
                "richest-aug3": [link], "aug4-heavier": [link], "aug4-lighter": [link],
            ])

        // Sanity: season-wide (no dayKey) index 0 really is the Aug 3 event
        // — confirms the fixture reproduces the bug's precondition.
        #expect(model.uiTestLinkedEvent(at: 0)?.id == "richest-aug3")

        // Day-scoped to Aug 4: index 0/1 rank *within that day* only.
        #expect(model.uiTestLinkedEvent(at: 0, dayKey: "2026-08-04")?.id == "aug4-heavier")
        #expect(model.uiTestLinkedEvent(at: 1, dayKey: "2026-08-04")?.id == "aug4-lighter")

        // Out of range *within* the day-scoped pool (which has only 2
        // entries for Aug 4) is a no-op — index 2 must not clamp to, or
        // wrap into, anything. This does NOT by itself prove there's no
        // fallback to the season-wide pool: season-wide index 2 is
        // "aug4-lighter" (900/300/100 sorts to richest-aug3, aug4-heavier,
        // aug4-lighter), which is already on the right day and already sits
        // at day-scoped index 1, so a buggy implementation that fell back to
        // the season-wide pool whenever the *requested index* were out of
        // range would still read as correct here. The case below instead
        // empties the day pool entirely, which is what actually
        // distinguishes "no fallback" from "falls back once the day pool
        // runs out."
        #expect(model.uiTestLinkedEvents.count == 3)
        #expect(model.uiTestLinkedEvent(at: 2, dayKey: "2026-08-04") == nil)

        // A day with no linked events at all: an implementation that falls
        // back to the season-wide pool only when the day-scoped pool is
        // *empty* (rather than never falling back) would return
        // "richest-aug3" here. It must stay nil.
        #expect(model.uiTestLinkedEvent(at: 0, dayKey: "2026-08-05") == nil)
    }

    /// `dayKey: nil` (the default) must reproduce season-wide ranking
    /// byte-for-byte — `09-reminder`'s `-uitest-select-event-index 2` passes
    /// no day flag and must not shift when this parameter was added.
    @Test func uiTestLinkedEventWithoutDayKeyMatchesSeasonWideSelection() throws {
        let now = try #require(ChqTime.parse("2026-08-03 12:00:00"))
        let link = ArticleLink(
            title: "t", url: URL(string: "https://example.com/t")!,
            kind: .preview, pubDate: "2026-06-30")
        let model = makeSnapshotModel(
            events: [
                makeEvent(id: "a", start: try #require(ChqTime.parse("2026-08-03 19:00:00")),
                          details: String(repeating: "x", count: 900)),
                makeEvent(id: "b", start: try #require(ChqTime.parse("2026-08-04 10:00:00")),
                          details: String(repeating: "x", count: 500)),
                makeEvent(id: "c", start: try #require(ChqTime.parse("2026-08-05 10:00:00")),
                          details: String(repeating: "x", count: 100)),
            ],
            now: now,
            articleLinks: ["a": [link], "b": [link], "c": [link]])

        #expect(model.uiTestLinkedEvent(at: 2) == model.uiTestLinkedEvent(at: 2, dayKey: nil))
        #expect(model.uiTestLinkedEvent(at: 2)?.id == "c")
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

        // Pinned rather than the real wall clock: `lastSaved` above is a
        // hardcoded date, and `UserStateStore.loadFilters()` rejects
        // payloads 30+ days stale (see
        // `UserStateStoreTests.legacyLowercasedPayloadStillDecodes`, which
        // uses the same pattern). A real clock would make this test start
        // failing in CI once 30 days had passed with no code change.
        let now = try #require(ChqTime.parse("2026-08-02 12:00:00"))

        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        let api = MockAPI()
        await api.setNeverResolves(for: .years)
        let model = AppModel(
            repository: EventRepository(api: api, cache: cache),
            store: UserStateStore(defaults: defaults, now: { now })
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
        // Reload with the same pinned clock: the write-back's `lastSaved`
        // was stamped using `now` above, not the real wall clock.
        let reloaded = UserStateStore(defaults: defaults, now: { now }).loadFilters()
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

        // The guard at `AppModel.normalizePersistedFilterCasing` (only
        // persisting when the normalized casing actually differs) is the
        // only thing standing between "no match" and a write on every
        // snapshot arrival — and therefore the only thing keeping
        // `lastSaved` from being re-stamped (and the 30-day expiry reset)
        // on every launch. Comparing the raw persisted bytes before and
        // after pins both: no write at all, not just an unchanged value.
        let before = defaults.data(forKey: "chq-filters")

        Task { await model.start() }
        await waitUntil("model reaches .ready phase") { model.phase == .ready }

        #expect(model.filter.selectedLocations == ["Retired Venue"])
        let after = defaults.data(forKey: "chq-filters")
        #expect(before == after)
    }

    /// Every other year-switch test in this file (`selectYearSwapsSnapshot`,
    /// `facetCountsTrackTheSnapshotAcrossLaunchAndYearSwitch`,
    /// `refreshDiscardsStaleYearResultAfterYearSwitchedDuringInFlightRefresh`,
    /// `selectingCacheLessYearStartsOwnRefreshDespiteAnotherYearsInFlightRefresh`)
    /// reuses the same `events-sample` fixture for both years, so casing can
    /// never actually differ across years in any of them. This uses a
    /// second fixture (`events-sample-alt-casing`, added alongside the
    /// existing ones in `Fixtures/`) whose venue/category are the same
    /// facets, spelled with different casing, so re-casing following the
    /// year actually being viewed — rather than e.g. sticking with whatever
    /// year first normalized it — is pinned rather than assumed.
    @Test func normalizationFollowsTheYearBeingViewedAcrossASwitch() async throws {
        let defaults = makeDefaults()
        var filter = FilterSelection()
        // Lowercased so it case-insensitively matches both years' feeds,
        // whose display casing differs from each other and from this.
        filter.selectedLocations = ["sports club, waterfront"]
        UserStateStore(defaults: defaults, now: { Date() }).saveFilters(filter)

        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        cache.write("events-2025", data: fixtureData("events-sample-alt-casing"), etag: "e2", fetchedAt: Date())
        let api = MockAPI()
        await api.setNeverResolves(for: .years)
        let model = AppModel(
            repository: EventRepository(api: api, cache: cache),
            store: UserStateStore(defaults: defaults, now: { Date() })
        )

        Task { await model.start() }
        await waitUntil("model reaches .ready phase") { model.phase == .ready }
        #expect(model.filter.selectedLocations == ["Sports Club, Waterfront"])

        await model.select(year: 2025)
        #expect(model.filter.selectedLocations == ["SPORTS CLUB, WATERFRONT"])

        await model.select(year: 2026)
        #expect(model.filter.selectedLocations == ["Sports Club, Waterfront"])
    }

    // MARK: - Launch pins: clock + dataset year (#222)

    /// A years manifest naming `defaultYear`, as bytes — the shape
    /// `EventRepository.availableYears()` decodes. Built inline rather than
    /// as a fixture because these tests need a manifest that disagrees with
    /// the pin, and `Fixtures/years.json` deliberately agrees with it
    /// (`defaultYear: 2026`).
    private func yearsManifest(defaultYear: Int, years: [Int]) -> Data {
        let list = years.map(String.init).joined(separator: ",")
        return Data("""
        {"years":[\(list)],"defaultYear":\(defaultYear),"generated":"2027-03-01T00:00:00Z"}
        """.utf8)
    }

    @Test func frozenNowParsesTheFlagsValue() throws {
        let parsed = AppModel.parsedFrozenNow(from: ["ChqCalendar", "-uitest-freeze-now", "2026-08-04 09:41:00"])
        #expect(parsed == ChqTime.parse("2026-08-04 09:41:00"))
    }

    @Test func frozenNowIsNilWhenTheFlagIsAbsentOrUnusable() {
        #expect(AppModel.parsedFrozenNow(from: ["ChqCalendar"]) == nil)
        // Flag present but last — nothing follows it to parse.
        #expect(AppModel.parsedFrozenNow(from: ["ChqCalendar", "-uitest-freeze-now"]) == nil)
        #expect(AppModel.parsedFrozenNow(from: ["ChqCalendar", "-uitest-freeze-now", "not-a-date"]) == nil)
    }

    @Test func pinYearParsesTheFlagsValue() {
        #expect(AppModel.parsedPinYear(from: ["ChqCalendar", "-uitest-pin-year", "2026"]) == 2026)
    }

    @Test func pinYearIsNilWhenTheFlagIsAbsentOrUnusable() {
        #expect(AppModel.parsedPinYear(from: ["ChqCalendar"]) == nil)
        #expect(AppModel.parsedPinYear(from: ["ChqCalendar", "-uitest-pin-year"]) == nil)
        #expect(AppModel.parsedPinYear(from: ["ChqCalendar", "-uitest-pin-year", "twenty-twenty-six"]) == nil)
    }

    /// The two launch entry points on a process that carries neither flag —
    /// i.e. every real launch, and this test process. Proves the pins are
    /// opt-in: absent the flags, `launchNow()` hands back the real clock and
    /// `launchPinnedYear()` hands back no pin, which is exactly the (only)
    /// behavior a Release build compiles.
    @Test func aLaunchWithoutTheFlagsTakesNeitherPin() {
        #expect(AppModel.launchPinnedYear() == nil)
        #expect(abs(AppModel.launchNow()().timeIntervalSinceNow) < 5)
    }

    /// The pin has to bind at construction, not when `start()` first sees a
    /// manifest: the launching UI reads `selectedYear` before any manifest
    /// exists, so a pin that only took effect in `start()` would let a
    /// capture render the placeholder year first.
    @Test func aPinBindsBeforeStartEverRuns() {
        let model = AppModel(
            repository: EventRepository(api: MockAPI(), cache: MockCache()),
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            pinnedYear: 2025
        )

        #expect(model.selectedYear == 2025)
        #expect(model.defaultYear == 2025)
    }

    /// The pin's whole reason to exist: capturing 2026 screenshots after the
    /// server manifest has moved on to a later season.
    @Test func startKeepsThePinnedYearWhenTheManifestNamesALaterDefault() async throws {
        let fixedNow = try #require(ChqTime.parse("2026-08-04 09:41:00"))
        let cache = MockCache()
        cache.write("years", data: yearsManifest(defaultYear: 2027, years: [2026, 2027]), etag: "y1", fetchedAt: Date())
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: fixedNow)
        let api = MockAPI()
        let model = AppModel(
            repository: EventRepository(api: api, cache: cache),
            store: UserStateStore(defaults: makeDefaults(), now: { fixedNow }),
            now: { fixedNow },
            pinnedYear: 2026
        )

        await model.start()

        #expect(model.selectedYear == 2026)
        #expect(model.defaultYear == 2026)
        // The pinned year has to read as *the* current season, not as an
        // archived one — otherwise the shots carry an "archived season"
        // banner and the `.next` date scope downgrades.
        #expect(model.isCurrentYear)
        #expect(model.snapshot?.year == 2026)
        let fetched = await api.calls.map(\.resource.cacheKey)
        #expect(!fetched.contains("events-2027"))
    }

    /// The control for the test above: without the pin, the same manifest
    /// moves the app to 2027. If this ever stops holding, the test above
    /// proves nothing.
    ///
    /// Both years are seeded deliberately, so this lands on the same warm-
    /// cache path the pinned test does and the two differ in exactly one
    /// input — the pin. Seeding only 2026 would still assert the right
    /// years, but by way of a cache-miss refresh against an unscripted
    /// `MockAPI`: an offline model that happens to hold the right numbers,
    /// which is a weaker thing to compare a `.ready` model against.
    @Test func startWithoutAPinFollowsTheManifestDefault() async throws {
        let fixedNow = try #require(ChqTime.parse("2026-08-04 09:41:00"))
        let cache = MockCache()
        cache.write("years", data: yearsManifest(defaultYear: 2027, years: [2026, 2027]), etag: "y1", fetchedAt: Date())
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: fixedNow)
        cache.write("events-2027", data: fixtureData("events-sample"), etag: "e2", fetchedAt: fixedNow)
        let api = MockAPI()
        let model = AppModel(
            repository: EventRepository(api: api, cache: cache),
            store: UserStateStore(defaults: makeDefaults(), now: { fixedNow }),
            now: { fixedNow }
        )

        await model.start()

        #expect(model.selectedYear == 2027)
        #expect(model.defaultYear == 2027)
        #expect(model.phase == .ready)
        #expect(model.snapshot?.year == 2027)
    }

    /// A manifest that has dropped the pinned year entirely must still leave
    /// the year picker showing the year the app is actually displaying —
    /// `years` is what `landingState` offers as selectable.
    @Test func startListsThePinnedYearEvenWhenTheManifestOmitsIt() async throws {
        let fixedNow = try #require(ChqTime.parse("2026-08-04 09:41:00"))
        let cache = MockCache()
        cache.write("years", data: yearsManifest(defaultYear: 2028, years: [2027, 2028]), etag: "y1", fetchedAt: Date())
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: fixedNow)
        let api = MockAPI()
        let model = AppModel(
            repository: EventRepository(api: api, cache: cache),
            store: UserStateStore(defaults: makeDefaults(), now: { fixedNow }),
            now: { fixedNow },
            pinnedYear: 2026
        )

        await model.start()

        #expect(model.years == [2026, 2027, 2028])
        #expect(model.selectedYear == 2026)
    }
}
