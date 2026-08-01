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
        await api.setSuccess(data: fixtureData("themes-sample"), etag: "themes-etag-1", for: .weeklyThemes(year: 2026))
        let cache = MockCache()
        let repo = EventRepository(api: api, cache: cache)

        let snapshot = try await repo.refresh(year: 2026, force: false)

        #expect(snapshot.year == 2026)
        #expect(snapshot.events.count == 5)
        #expect(snapshot.articleLinks["101037"]?.count == 1)
        #expect(snapshot.themes.count == 9)

        #expect(cache.read("events-2026")?.metadata.etag == "events-etag-1")
        #expect(cache.read("article-links-2026")?.metadata.etag == "links-etag-1")
        #expect(cache.read("themes-2026")?.metadata.etag == "themes-etag-1")

        // Also directly readable from cache afterward, with no network.
        let cached = await repo.cachedSnapshot(year: 2026)
        #expect(cached?.events.count == 5)
    }

    // MARK: - (c) second refresh sends stored etag; 304 decodes from cache, updates fetchedAt

    @Test func secondRefreshSendsStoredEtagAndHandlesNotModified() async throws {
        let api = MockAPI()
        await api.setSuccess(data: fixtureData("events-sample"), etag: "events-etag-1", for: .events(year: 2026))
        await api.setSuccess(data: fixtureData("article-links-sample"), etag: "links-etag-1", for: .articleLinks(year: 2026))
        await api.setSuccess(data: fixtureData("themes-sample"), etag: "themes-etag-1", for: .weeklyThemes(year: 2026))
        let cache = MockCache()
        let repo = EventRepository(api: api, cache: cache)

        _ = try await repo.refresh(year: 2026, force: false)

        // Reconfigure the mock to answer "unchanged" on the next round.
        // `force: true` is required here to bypass the freshly-cached TTL
        // short-circuit, so the second network round-trip actually happens.
        await api.setNotModified(for: .events(year: 2026))
        await api.setNotModified(for: .articleLinks(year: 2026))
        await api.setNotModified(for: .weeklyThemes(year: 2026))

        let snapshot = try await repo.refresh(year: 2026, force: true)

        #expect(snapshot.events.count == 5)
        #expect(snapshot.articleLinks["101037"]?.count == 1)
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
        await api.setFailure(MockAPIError.unscripted("themes-down"), for: .weeklyThemes(year: 2026))
        let cache = MockCache()
        let repo = EventRepository(api: api, cache: cache)

        let snapshot = try await repo.refresh(year: 2026, force: false)

        #expect(snapshot.events.count == 5)
        #expect(snapshot.articleLinks.isEmpty)
        #expect(snapshot.themes.isEmpty)
    }

    @Test func sidecarFailureFallsBackToCachedSidecarWhenPresent() async throws {
        let api = MockAPI()
        await api.setSuccess(data: fixtureData("events-sample"), etag: "events-etag-1", for: .events(year: 2026))
        await api.setSuccess(data: fixtureData("article-links-sample"), etag: "links-etag-1", for: .articleLinks(year: 2026))
        await api.setSuccess(data: fixtureData("themes-sample"), etag: "themes-etag-1", for: .weeklyThemes(year: 2026))
        let cache = MockCache()
        let repo = EventRepository(api: api, cache: cache)
        _ = try await repo.refresh(year: 2026, force: false)

        await api.setFailure(MockAPIError.unscripted("links-down"), for: .articleLinks(year: 2026))
        await api.setFailure(MockAPIError.unscripted("themes-down"), for: .weeklyThemes(year: 2026))
        // Events must also be re-scripted since force bypasses the cache short-circuit.
        await api.setSuccess(data: fixtureData("events-sample"), etag: "events-etag-2", for: .events(year: 2026))

        let snapshot = try await repo.refresh(year: 2026, force: true)

        #expect(snapshot.events.count == 5)
        #expect(snapshot.articleLinks["101037"]?.count == 1)
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
            // Expected: the failure propagates rather than being swallowed.
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
}
