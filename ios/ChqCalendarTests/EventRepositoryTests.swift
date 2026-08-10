import Foundation
import Testing
@testable import ChqCalendar

struct EventRepositoryTests {
    // MARK: - RemoteResource mapping

    @Test func remoteResourcePathsAndCacheKeys() {
        #expect(RemoteResource.years.path == "/cache/calendar-cache/years.json")
        #expect(RemoteResource.years.cacheKey == "years")

        #expect(RemoteResource.events(year: 2026).path == "/cache/calendar-cache/all-events-2026.json")
        #expect(RemoteResource.events(year: 2026).cacheKey == "events-2026")

        #expect(RemoteResource.articleLinks(year: 2026).path == "/cache/calendar-cache/article-links-2026.json")
        #expect(RemoteResource.articleLinks(year: 2026).cacheKey == "article-links-2026")

        #expect(RemoteResource.programLinks(year: 2026).path == "/cache/calendar-cache/program-links-2026.json")
        #expect(RemoteResource.programLinks(year: 2026).cacheKey == "program-links-2026")

        #expect(RemoteResource.weeklyThemes(year: 2026).path == "/data/weekly-themes/2026.json")
        #expect(RemoteResource.weeklyThemes(year: 2026).cacheKey == "themes-2026")

        #expect(RemoteResource.version.path == "/version.json")
    }

    // MARK: - (a) cachedSnapshot returns nil on empty cache

    @Test func cachedSnapshotReturnsNilOnEmptyCache() async {
        let repo = EventRepository(api: MockAPI(), cache: MockCache())
        let snapshot = await repo.cachedSnapshot(year: 2026)
        #expect(snapshot == nil)
    }

    // MARK: - (b) refresh populates snapshot + cache with etags

    @Test func refreshPopulatesSnapshotAndCacheWithEtags() async throws {
        let api = MockAPI()
        await api.setSuccess(data: fixtureData("events-sample"), etag: "events-etag-1", for: .events(year: 2026))
        await api.setSuccess(data: fixtureData("article-links-sample"), etag: "links-etag-1", for: .articleLinks(year: 2026))
        await api.setSuccess(data: fixtureData("program-links-sample"), etag: "programs-etag-1", for: .programLinks(year: 2026))
        await api.setSuccess(data: fixtureData("themes-sample"), etag: "themes-etag-1", for: .weeklyThemes(year: 2026))
        let cache = MockCache()
        let repo = EventRepository(api: api, cache: cache)

        let snapshot = try await repo.refresh(year: 2026, force: false)

        #expect(snapshot.year == 2026)
        #expect(snapshot.events.count == 5)
        #expect(snapshot.articleLinks["101037"]?.count == 1)
        #expect(snapshot.programLinks["event-1"]?.count == 1)
        #expect(snapshot.themes.count == 9)

        #expect(cache.read("events-2026")?.metadata.etag == "events-etag-1")
        #expect(cache.read("article-links-2026")?.metadata.etag == "links-etag-1")
        #expect(cache.read("program-links-2026")?.metadata.etag == "programs-etag-1")
        #expect(cache.read("themes-2026")?.metadata.etag == "themes-etag-1")

        // Also directly readable from cache afterward, with no network.
        let cached = await repo.cachedSnapshot(year: 2026)
        #expect(cached?.events.count == 5)
        #expect(cached?.programLinks["event-1"]?.count == 1)
    }

    // MARK: - (c) second refresh sends stored etag; 304 decodes from cache, updates fetchedAt

    @Test func secondRefreshSendsStoredEtagAndHandlesNotModified() async throws {
        let api = MockAPI()
        await api.setSuccess(data: fixtureData("events-sample"), etag: "events-etag-1", for: .events(year: 2026))
        await api.setSuccess(data: fixtureData("article-links-sample"), etag: "links-etag-1", for: .articleLinks(year: 2026))
        await api.setSuccess(data: fixtureData("program-links-sample"), etag: "programs-etag-1", for: .programLinks(year: 2026))
        await api.setSuccess(data: fixtureData("themes-sample"), etag: "themes-etag-1", for: .weeklyThemes(year: 2026))
        let cache = MockCache()
        let repo = EventRepository(api: api, cache: cache)

        _ = try await repo.refresh(year: 2026, force: false)

        // Reconfigure the mock to answer "unchanged" on the next round.
        // `force: true` is required here to bypass the freshly-cached TTL
        // short-circuit, so the second network round-trip actually happens.
        await api.setNotModified(for: .events(year: 2026))
        await api.setNotModified(for: .articleLinks(year: 2026))
        await api.setNotModified(for: .programLinks(year: 2026))
        await api.setNotModified(for: .weeklyThemes(year: 2026))

        let snapshot = try await repo.refresh(year: 2026, force: true)

        #expect(snapshot.events.count == 5)
        #expect(snapshot.articleLinks["101037"]?.count == 1)
        #expect(snapshot.programLinks["event-1"]?.count == 1)
        #expect(snapshot.themes.count == 9)

        let eventCalls = await api.calls.filter {
            if case .events = $0.resource { return true }
            return false
        }
        #expect(eventCalls.count == 2)
        #expect(eventCalls.last?.ifNoneMatch == "events-etag-1")

        #expect(await repo.needsRefresh(year: 2026, now: Date()) == false)
    }

    // MARK: - (d) sidecar failure keeps events working with empty links/themes

    @Test func sidecarFailureFallsBackToEmptyWhenNoCachedSidecar() async throws {
        let api = MockAPI()
        await api.setSuccess(data: fixtureData("events-sample"), etag: "events-etag-1", for: .events(year: 2026))
        await api.setFailure(MockAPIError.unscripted("links-down"), for: .articleLinks(year: 2026))
        await api.setFailure(MockAPIError.unscripted("programs-down"), for: .programLinks(year: 2026))
        await api.setFailure(MockAPIError.unscripted("themes-down"), for: .weeklyThemes(year: 2026))
        let cache = MockCache()
        let repo = EventRepository(api: api, cache: cache)

        let snapshot = try await repo.refresh(year: 2026, force: false)

        #expect(snapshot.events.count == 5)
        #expect(snapshot.articleLinks.isEmpty)
        #expect(snapshot.programLinks.isEmpty)
        #expect(snapshot.themes.isEmpty)
    }

    @Test func sidecarFailureFallsBackToCachedSidecarWhenPresent() async throws {
        let api = MockAPI()
        await api.setSuccess(data: fixtureData("events-sample"), etag: "events-etag-1", for: .events(year: 2026))
        await api.setSuccess(data: fixtureData("article-links-sample"), etag: "links-etag-1", for: .articleLinks(year: 2026))
        await api.setSuccess(data: fixtureData("program-links-sample"), etag: "programs-etag-1", for: .programLinks(year: 2026))
        await api.setSuccess(data: fixtureData("themes-sample"), etag: "themes-etag-1", for: .weeklyThemes(year: 2026))
        let cache = MockCache()
        let repo = EventRepository(api: api, cache: cache)
        _ = try await repo.refresh(year: 2026, force: false)

        await api.setFailure(MockAPIError.unscripted("links-down"), for: .articleLinks(year: 2026))
        await api.setFailure(MockAPIError.unscripted("programs-down"), for: .programLinks(year: 2026))
        await api.setFailure(MockAPIError.unscripted("themes-down"), for: .weeklyThemes(year: 2026))
        // Events must also be re-scripted since force bypasses the cache short-circuit.
        await api.setSuccess(data: fixtureData("events-sample"), etag: "events-etag-2", for: .events(year: 2026))

        let snapshot = try await repo.refresh(year: 2026, force: true)

        #expect(snapshot.events.count == 5)
        #expect(snapshot.articleLinks["101037"]?.count == 1)
        #expect(snapshot.programLinks["event-1"]?.count == 1)
        #expect(snapshot.themes.count == 9)
    }

    // MARK: - (e) events fetch failure propagates when no cache exists

    @Test func eventsFetchFailurePropagatesWhenNoCacheExists() async throws {
        let api = MockAPI()
        await api.setFailure(MockAPIError.unscripted("events-down"), for: .events(year: 2026))
        let cache = MockCache()
        let repo = EventRepository(api: api, cache: cache)

        do {
            _ = try await repo.refresh(year: 2026, force: false)
            Issue.record("Expected refresh(year:force:) to throw when events fetch fails with no cache")
        } catch {
            #expect(error as? MockAPIError == .unscripted("events-down"))
        }
    }

    // MARK: - decode-before-write (cache poisoning guard)

    @Test func refreshThrowsAndLeavesCacheUntouchedWhenNewEventsPayloadIsGarbage() async throws {
        let api = MockAPI()
        let cache = MockCache()
        let originalFetchedAt = Date(timeIntervalSince1970: 1_000_000)
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "events-etag-good", fetchedAt: originalFetchedAt)
        let garbage = try #require("not valid json".data(using: .utf8))
        await api.setSuccess(data: garbage, etag: "events-etag-garbage", for: .events(year: 2026))
        let repo = EventRepository(api: api, cache: cache, ttl: 0)

        do {
            _ = try await repo.refresh(year: 2026, force: false)
            Issue.record("Expected refresh(year:force:) to throw on undecodable events payload")
        } catch {
            #expect(error as? EventRepositoryError == .decodingFailed)
        }

        // The cache must be entirely untouched: same bytes, same etag, same fetchedAt.
        let entry = try #require(cache.read("events-2026"))
        #expect(entry.data == fixtureData("events-sample"))
        #expect(entry.metadata.etag == "events-etag-good")
        #expect(entry.metadata.fetchedAt == originalFetchedAt)

        // And the disk-only read path still sees the old good data.
        let cached = await repo.cachedSnapshot(year: 2026)
        #expect(cached?.events.count == 5)
    }

    @Test func refreshFallsBackToCachedProgramLinksAndLeavesCacheUntouchedWhenNewPayloadIsGarbage() async throws {
        let api = MockAPI()
        let cache = MockCache()
        let originalFetchedAt = Date(timeIntervalSince1970: 1_000_000)
        cache.write("program-links-2026", data: fixtureData("program-links-sample"), etag: "programs-etag-good", fetchedAt: originalFetchedAt)
        await api.setSuccess(data: fixtureData("events-sample"), etag: "events-etag-1", for: .events(year: 2026))
        let garbage = try #require("not valid json".data(using: .utf8))
        await api.setSuccess(data: garbage, etag: "programs-etag-garbage", for: .programLinks(year: 2026))
        let repo = EventRepository(api: api, cache: cache)

        // Sidecar fetches are best-effort: a malformed payload never throws,
        // it just falls back to whatever's cached — unlike the events path.
        let snapshot = try await repo.refresh(year: 2026, force: false)

        #expect(snapshot.programLinks["event-1"]?.count == 1)

        // The cache must be entirely untouched: same bytes, same etag, same fetchedAt.
        let entry = try #require(cache.read("program-links-2026"))
        #expect(entry.data == fixtureData("program-links-sample"))
        #expect(entry.metadata.etag == "programs-etag-good")
        #expect(entry.metadata.fetchedAt == originalFetchedAt)
    }

    @Test func availableYearsReturnsCachedValueAndLeavesCacheUntouchedWhenNewYearsPayloadIsGarbage() async throws {
        let api = MockAPI()
        let cache = MockCache()
        let originalFetchedAt = Date(timeIntervalSince1970: 1_000_000)
        cache.write("years", data: fixtureData("years"), etag: "years-etag-good", fetchedAt: originalFetchedAt)
        let garbage = try #require("not valid json".data(using: .utf8))
        await api.setSuccess(data: garbage, etag: "years-etag-garbage", for: .years)
        // ttl: 0 so the cached copy isn't fresh and availableYears actually goes to the network.
        let repo = EventRepository(api: api, cache: cache, ttl: 0)

        let manifest = await repo.availableYears()

        #expect(manifest.years == [2025, 2026, 2027])
        #expect(manifest.defaultYear == 2026)

        let entry = try #require(cache.read("years"))
        #expect(entry.data == fixtureData("years"))
        #expect(entry.metadata.etag == "years-etag-good")
        #expect(entry.metadata.fetchedAt == originalFetchedAt)
    }

    // MARK: - 304 with no cached events

    @Test func refreshThrowsNotModifiedWithoutCacheWhenEventsIs304AndCacheEmpty() async throws {
        let api = MockAPI()
        await api.setNotModified(for: .events(year: 2026))
        let cache = MockCache()
        let repo = EventRepository(api: api, cache: cache)

        do {
            _ = try await repo.refresh(year: 2026, force: false)
            Issue.record("Expected refresh(year:force:) to throw notModifiedWithoutCache")
        } catch {
            #expect(error as? EventRepositoryError == .notModifiedWithoutCache)
        }
    }

    // MARK: - (f) availableYears falls back to [2026]/2026 when fetch fails and cache empty

    @Test func availableYearsFallsBackToDefaultWhenFetchFailsAndCacheEmpty() async {
        let api = MockAPI()
        await api.setFailure(MockAPIError.unscripted("years-down"), for: .years)
        let repo = EventRepository(api: api, cache: MockCache())

        let manifest = await repo.availableYears()

        #expect(manifest.years == [2026])
        #expect(manifest.defaultYear == 2026)
    }

    @Test func availableYearsUsesFreshCacheWithoutTouchingNetwork() async {
        let api = MockAPI()
        let cache = MockCache()
        cache.write("years", data: fixtureData("years"), etag: "years-etag-1", fetchedAt: Date())
        let repo = EventRepository(api: api, cache: cache)

        let manifest = await repo.availableYears()

        #expect(manifest.years == [2025, 2026, 2027])
        #expect(manifest.defaultYear == 2026)
        #expect(await api.calls.isEmpty)
    }

    // MARK: - needsRefresh

    @Test func needsRefreshTrueWhenNoCache() async {
        let repo = EventRepository(api: MockAPI(), cache: MockCache())
        #expect(await repo.needsRefresh(year: 2026, now: Date()))
    }

    @Test func needsRefreshTrueWhenCacheStale() async {
        let cache = MockCache()
        let old = Date(timeIntervalSince1970: 1_000_000)
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: old)
        let repo = EventRepository(api: MockAPI(), cache: cache, ttl: 3600)

        #expect(await repo.needsRefresh(year: 2026, now: old.addingTimeInterval(3601)))
    }

    // MARK: - remoteVersion

    @Test func remoteVersionParsesSuccessPayload() async throws {
        let api = MockAPI()
        let payload = try #require("{\"version\":\"abc123\"}".data(using: .utf8))
        await api.setSuccess(data: payload, etag: nil, for: .version)
        let repo = EventRepository(api: api, cache: MockCache())

        let version = await repo.remoteVersion()
        #expect(version == "abc123")
    }

    @Test func remoteVersionReturnsNilOnFailure() async {
        let api = MockAPI()
        await api.setFailure(MockAPIError.unscripted("version-down"), for: .version)
        let repo = EventRepository(api: api, cache: MockCache())

        let version = await repo.remoteVersion()
        #expect(version == nil)
    }

    // MARK: - Snapshot memoization (#187)

    /// `cachedSnapshot(year:)` sits on a hot path: `AppModel`'s reminder
    /// sync and Spotlight reindex each union *every* cached year, and a
    /// single star tap fires both. Without memoization that is one full
    /// payload read + JSON decode per cached year, twice per tap.
    ///
    /// Reading the payload is the proxy for decoding it — the repository
    /// never reads one without decoding it — so counting reads counts the
    /// expensive work.
    @Test func repeatedCachedSnapshotCallsDecodeAnUnchangedYearOnlyOnce() async {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date())
        let repo = EventRepository(api: MockAPI(), cache: cache)

        let first = await repo.cachedSnapshot(year: 2026)
        #expect(first != nil)
        let readsAfterFirst = cache.readCount(for: "events-2026")

        _ = await repo.cachedSnapshot(year: 2026)
        _ = await repo.cachedSnapshot(year: 2026)

        #expect(cache.readCount(for: "events-2026") == readsAfterFirst)
    }

    /// Memoizing must not outlive the data it memoized. A refresh that
    /// writes a new payload has to be visible to the very next
    /// `cachedSnapshot` call, or starring an event would plan reminders
    /// against events the app has already replaced.
    @Test func writingNewEventsInvalidatesTheMemoizedSnapshot() async throws {
        let cache = MockCache()
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: Date(timeIntervalSince1970: 1_000_000))
        let api = MockAPI()
        let refreshed = try #require("""
        {"data": [{"id": "555555", "title": "Freshly Published", "startDate": "2026-08-10 10:00:00"}]}
        """.data(using: .utf8))
        await api.setSuccess(data: refreshed, etag: "e2", for: .events(year: 2026))
        let repo = EventRepository(api: api, cache: cache)

        // Prime the memo with the stale payload.
        let before = await repo.cachedSnapshot(year: 2026)
        #expect(before?.events.contains { $0.id == "555555" } == false)

        _ = try await repo.refresh(year: 2026, force: true)

        let after = await repo.cachedSnapshot(year: 2026)
        #expect(after?.events.contains { $0.id == "555555" } == true)
    }

    /// A 304 takes the `touch` path: the payload on disk is unchanged but
    /// its `fetchedAt` moves. The snapshot handed out afterwards must carry
    /// the new `fetchedAt` rather than the memoized older one, since that
    /// timestamp is what freshness decisions are made against.
    @Test func notModifiedRefreshLeavesCachedSnapshotReadableWithUpdatedFetchedAt() async throws {
        let cache = MockCache()
        let stale = Date(timeIntervalSince1970: 1_000_000)
        cache.write("events-2026", data: fixtureData("events-sample"), etag: "e1", fetchedAt: stale)
        let api = MockAPI()
        await api.setNotModified(for: .events(year: 2026))
        let repo = EventRepository(api: api, cache: cache)

        _ = await repo.cachedSnapshot(year: 2026)
        _ = try await repo.refresh(year: 2026, force: true)

        let after = await repo.cachedSnapshot(year: 2026)
        #expect(after != nil)
        #expect(after?.events.isEmpty == false)
        #expect((after?.fetchedAt ?? stale) > stale)
    }
}
