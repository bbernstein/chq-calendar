import Foundation
import Testing
@testable import ChqCalendar

/// Pins `AppModel`'s two Spotlight-reindex triggers (#180, task 13 review
/// fix — Important #2): a successful `refresh(force:)` and
/// `toggleFavorite`. Mirrors `WidgetReloadingTests`'s `MockWidgetReloader`
/// role exactly: a mock conformance recording calls, so this never needs
/// the real `CSSearchableIndex` — which requires a live app process and,
/// before this seam existed, was performing real on-device Spotlight
/// delete-and-re-add writes from every successful-refresh `AppModelTests`
/// run.
@MainActor
struct SpotlightIndexingTests {
    private func makeDefaults() -> UserDefaults {
        UserDefaults(suiteName: UUID().uuidString)!
    }

    final class MockSpotlightIndexer: SpotlightIndexing {
        private(set) var reindexCount = 0
        private(set) var lastFavorites: Set<String> = []
        private(set) var lastEvents: [Event] = []
        private(set) var lastYear: Int?

        func reindex(events: [Event], favorites: Set<String>, year: Int) async {
            reindexCount += 1
            lastFavorites = favorites
            lastEvents = events
            lastYear = year
        }
    }

    @Test func successfulRefreshTriggersReindex() async {
        let cache = MockCache()
        let api = MockAPI()
        await api.setSuccess(data: fixtureData("events-sample"), etag: "e1", for: .events(year: 2026))
        let repo = EventRepository(api: api, cache: cache)
        let indexer = MockSpotlightIndexer()
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            spotlightIndexer: indexer
        )

        await model.refresh(force: true)

        #expect(model.phase == .ready)
        // The reindex fires in an un-awaited `Task`, so it may not have run
        // yet the instant `refresh(force:)` returns — poll for it instead
        // of asserting immediately.
        await waitUntil("successful refresh triggers a Spotlight reindex") {
            indexer.reindexCount == 1
        }
    }

    /// A failed refresh must not reindex — there's nothing new for
    /// Spotlight to show, and reindexing anyway would just repeat the same
    /// full delete-and-re-add for no benefit.
    @Test func failedRefreshDoesNotTriggerReindex() async {
        let api = MockAPI()
        await api.setFailure(MockAPIError.unscripted("events-down"), for: .events(year: 2026))
        let repo = EventRepository(api: api, cache: MockCache())
        let indexer = MockSpotlightIndexer()
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            spotlightIndexer: indexer
        )

        await model.refresh(force: true)

        #expect(model.phase == .offline)
        // Give the fire-and-forget path a chance to run; there's nothing to
        // poll *for* here since this proves an absence.
        try? await Task.sleep(for: .milliseconds(200))
        #expect(indexer.reindexCount == 0)
    }

    @Test func toggleFavoriteTriggersReindex() async {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        let indexer = MockSpotlightIndexer()
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            spotlightIndexer: indexer
        )

        await model.start()
        model.toggleFavorite("101037")

        await waitUntil("toggling a favorite triggers a Spotlight reindex") {
            indexer.reindexCount >= 1 && indexer.lastFavorites.contains("101037")
        }
    }

    @Test func unfavoritingAlsoTriggersReindex() async {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        let indexer = MockSpotlightIndexer()
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            spotlightIndexer: indexer
        )

        await model.start()
        model.toggleFavorite("101037")
        await waitUntil("starring triggers a Spotlight reindex") {
            indexer.reindexCount >= 1
        }

        let countAfterStar = indexer.reindexCount
        model.toggleFavorite("101037")

        await waitUntil("unstarring triggers another Spotlight reindex that drops the id") {
            indexer.reindexCount > countAfterStar && !indexer.lastFavorites.contains("101037")
        }
    }

    /// F2 pinning test (iOS 4.2 resubmission review, final whole-branch
    /// pass): browsing an archive year must not wipe the current season out
    /// of Spotlight. Before the fix, `runSpotlightReindex` fed
    /// `itemsToIndex` only `selectedYear`'s snapshot and window — so
    /// starring an event while looking at 2025 (mid-2026-season) would
    /// delete-and-re-add Spotlight with *only* 2025's events, dropping every
    /// current-season 2026 event until the next default-year refresh.
    /// `events-2026` (this file's usual `events-sample` fixture) is entirely
    /// July 2026; `events-2025` (`events-sample-alt-casing`) has one event,
    /// `301001`, dated July 2025 — a different id so the two years'
    /// contributions are unambiguous.
    @Test func archiveYearBrowsingStillIndexesTheCurrentSeason() async throws {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        cache.write("events-2025", data: fixtureData("events-sample-alt-casing"), etag: "e2", fetchedAt: Date())
        cache.write("years", data: fixtureData("years"), etag: "y1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        let indexer = MockSpotlightIndexer()
        let model = AppModel(
            repository: repo,
            store: UserStateStore(defaults: makeDefaults(), now: { Date() }),
            spotlightIndexer: indexer
        )

        await model.start()
        #expect(model.years == [2025, 2026, 2027])
        #expect(model.defaultYear == 2026)

        await model.select(year: 2025)
        #expect(model.selectedYear == 2025)

        // Star an event while the archive year is on screen — the concrete
        // scenario F2 describes.
        model.toggleFavorite("301001")

        await waitUntil("starring while browsing an archive year triggers a reindex") {
            indexer.reindexCount >= 1
        }

        // The season window must stay pinned to the *current* season...
        #expect(indexer.lastYear == 2026)

        // ...and the input events must still include 2026's in-season,
        // non-favorited events. Before the fix these were dropped entirely
        // because the reindex was fed only the 2025 snapshot.
        let indexedIDs = Set(indexer.lastEvents.map(\.id))
        #expect(indexedIDs.contains("200001"))
        #expect(indexedIDs.contains("200004"))
        // The favorited 2025 event survives too (favorites are forever).
        #expect(indexedIDs.contains("301001"))
    }

    /// The default `spotlightIndexer: nil` (every other `AppModel` test in
    /// the suite) must never crash `toggleFavorite`/`refresh` — the same
    /// no-op-by-default contract `reminderCenter`/`widgetReloader` already
    /// have.
    @Test func noIndexerIsANoOp() async {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)
        let model = AppModel(repository: repo, store: UserStateStore(defaults: makeDefaults(), now: { Date() }))

        model.toggleFavorite("evt-1")
        await model.refresh(force: true)

        #expect(model.favorites.contains("evt-1"))
    }
}
