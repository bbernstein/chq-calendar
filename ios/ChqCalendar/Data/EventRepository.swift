import Foundation

/// A decoded, ready-to-render view of one year's calendar data, as produced
/// by `EventRepository`.
nonisolated struct CalendarSnapshot: Sendable {
    let year: Int
    let events: [Event]
    let articleLinks: [String: [ArticleLink]]
    let programLinks: [String: [ProgramLink]]
    let themes: [WeeklyTheme]
    let fetchedAt: Date
}

/// Errors raised by `EventRepository` itself (as opposed to ones surfaced
/// from `CalendarAPIClient`).
nonisolated enum EventRepositoryError: Error, Sendable, Equatable {
    /// The API reported `304 Not Modified` for events, but no cached events
    /// payload exists to decode — the server and our cache have disagreed
    /// about what's stored, which should never happen in practice.
    case notModifiedWithoutCache

    /// The events payload (freshly fetched or cached) failed to decode.
    case decodingFailed
}

/// Fetches and caches calendar data with a stale-while-revalidate policy:
/// callers can always read `cachedSnapshot` instantly, and `refresh`
/// revalidates against the network using stored ETags, falling back to
/// cached data wherever the network is unavailable or unchanged.
///
/// An `actor` because it owns mutable-by-effect (disk) state accessed from
/// concurrent call sites (e.g. multiple views triggering a refresh), and
/// all JSON decoding is done here, off the main actor.
actor EventRepository {
    private let api: CalendarAPIClient

    /// Never call `cache.write`/`cache.touch`/`cache.remove` directly from
    /// this actor — go through `writeCache`/`touchCache` below, which also
    /// invalidate `snapshotMemo`. A direct mutation would leave the memo
    /// serving a snapshot of data that is no longer on disk.
    ///
    /// `remove` has no wrapper because it has no caller: nothing in the app
    /// invokes `DataCaching.remove` today. If that changes — a "clear cached
    /// data" setting is the obvious candidate — add a `removeCache` wrapper
    /// rather than calling through, for exactly the reason above.
    private let cache: DataCaching
    private let ttl: TimeInterval
    private let sidecarTimeout: TimeInterval

    /// Decoded snapshots, keyed by year (#187).
    ///
    /// `cachedSnapshot(year:)` is on a hot path that is not obvious from
    /// its call sites: `AppModel.allCachedYearEvents()` unions *every*
    /// cached year, and both the reminder sync and the Spotlight reindex
    /// call it — so without this memo a single star tap would cost one
    /// payload read plus a full JSON decode per cached year, twice over.
    /// The events payload is the largest thing the app decodes.
    ///
    /// Safe to hold because this actor is the only writer to the cache:
    /// the widget extension reads the shared App Group cache but never
    /// writes to it. Every mutation therefore goes through
    /// `writeCache`/`touchCache` below, which drop the memo.
    ///
    /// The trade this makes is residency: decoding used to be transient
    /// (decode, use, free), and now one decoded `[Event]` per cached year
    /// stays alive for as long as the actor does. That is bounded by the
    /// years manifest, which is small — it currently lists 2025/2026/2027,
    /// and only seasons the user has actually opened are ever cached — so
    /// the ceiling is a couple of full seasons plus a mostly-empty upcoming
    /// one. `AppModel` already holds the selected year's `snapshot`
    /// permanently, so the *incremental* cost is the non-selected years.
    /// This lives in the app process only; the widget extension, which has
    /// a far tighter memory budget, does not use `EventRepository` (it
    /// reads through `SharedSnapshotLoader`). If the manifest ever grows to
    /// many years, this should become bounded (an LRU, or just the
    /// selected year plus `defaultYear`) rather than unbounded-by-manifest.
    private var snapshotMemo: [Int: CalendarSnapshot] = [:]

    init(api: CalendarAPIClient, cache: DataCaching, ttl: TimeInterval = 3600, sidecarTimeout: TimeInterval = 3) {
        self.api = api
        self.cache = cache
        self.ttl = ttl
        self.sidecarTimeout = sidecarTimeout
    }

    // MARK: - Cache mutation (memo-invalidating)

    /// Writes through to the cache and drops the whole snapshot memo.
    ///
    /// Clearing every year rather than just the one whose key changed is
    /// deliberate: a `CalendarSnapshot` composes an events payload with
    /// three sidecars, and mapping an arbitrary cache key back to the year
    /// whose snapshot it feeds would be a second source of truth about the
    /// key scheme — one that fails silently if a new sidecar is ever added.
    /// Writes only happen on refresh; reads are the hot path. Do not call
    /// `cache.write`/`cache.touch` directly from this actor.
    private func writeCache(_ key: String, data: Data, etag: String?, fetchedAt: Date) {
        cache.write(key, data: data, etag: etag, fetchedAt: fetchedAt)
        snapshotMemo.removeAll()
    }

    /// As `writeCache`, for the 304 path. `touch` leaves the payload alone
    /// and moves only `fetchedAt` — but `CalendarSnapshot.fetchedAt` is
    /// copied from that metadata, and freshness decisions are made against
    /// it, so a memo kept across a touch would hand out a stale timestamp.
    private func touchCache(_ key: String, fetchedAt: Date) {
        cache.touch(key, fetchedAt: fetchedAt)
        snapshotMemo.removeAll()
    }

    // MARK: - Reading cached data (no network)

    /// Decodes whatever is currently on disk for `year`, regardless of age.
    /// Returns `nil` only if no cached events payload exists at all — the
    /// sidecars (article links, program links, weekly themes) are optional
    /// and simply come back empty when absent or undecodable.
    /// Memoized per year — see `snapshotMemo`. A `nil` result is
    /// deliberately *not* memoized, so it is recomputed on every call.
    ///
    /// Two `nil` cases, and they are not equally cheap. A missing payload
    /// costs a failed cache lookup and nothing more. A **corrupt** payload
    /// costs a full read plus a failed `decodeEvents` — so this does repeat
    /// real work, just less of it than a successful decode of the largest
    /// payload the app has. Not caching it anyway is still the right call:
    /// caching an absence would need its own trigger for "a payload just
    /// appeared", and the only thing that makes one appear is `writeCache`,
    /// which already clears the whole memo. A separate negative cache would
    /// duplicate that invalidation path to save a cost that only shows up
    /// when the cache is already broken.
    func cachedSnapshot(year: Int) -> CalendarSnapshot? {
        if let memoized = snapshotMemo[year] {
            return memoized
        }

        guard let eventsEntry = cache.read(RemoteResource.events(year: year).cacheKey) else {
            return nil
        }
        guard let events = try? decodeEvents(eventsEntry.data) else {
            return nil
        }

        let snapshot = CalendarSnapshot(
            year: year,
            events: events,
            articleLinks: cachedArticleLinks(year: year),
            programLinks: cachedProgramLinks(year: year),
            themes: cachedThemes(year: year),
            fetchedAt: eventsEntry.metadata.fetchedAt
        )
        snapshotMemo[year] = snapshot
        return snapshot
    }

    /// `true` when there is no cached events payload for `year`, or the
    /// cached one is older than `ttl` as of `now`.
    func needsRefresh(year: Int, now: Date) -> Bool {
        guard let entry = cache.read(RemoteResource.events(year: year).cacheKey) else {
            return true
        }
        return !entry.isFresh(ttl: ttl, now: now)
    }

    // MARK: - Refreshing (network + cache)

    /// Revalidates `year`'s events (and, in parallel, its sidecars) against
    /// the network.
    ///
    /// Unless `force` is `true`, a still-fresh cached events entry short-
    /// circuits this call entirely (no network access at all) — `force`'s
    /// only effect is to bypass that short-circuit; the stored ETag is
    /// always sent when present, forced or not.
    ///
    /// Sidecar (article links, program links, weekly themes) fetches are
    /// best-effort: each
    /// runs in parallel with its own `sidecarTimeout` and falls back to its
    /// cached payload (or empty, if none) on any failure. The events fetch
    /// itself is not guarded this way — a failure there propagates, unless
    /// answered from cache via `.notModified`.
    func refresh(year: Int, force: Bool) async throws -> CalendarSnapshot {
        let eventsResource = RemoteResource.events(year: year)
        let cachedEventsEntry = cache.read(eventsResource.cacheKey)
        let now = Date()

        if !force, let cachedEventsEntry, cachedEventsEntry.isFresh(ttl: ttl, now: now),
           let snapshot = cachedSnapshot(year: year) {
            return snapshot
        }

        async let linksResult = fetchSidecarLinks(year: year)
        async let programsResult = fetchSidecarPrograms(year: year)
        async let themesResult = fetchSidecarThemes(year: year)

        let eventsFetch = try await api.fetch(eventsResource, ifNoneMatch: cachedEventsEntry?.metadata.etag, timeout: nil)

        let events: [Event]
        switch eventsFetch {
        case .notModified:
            touchCache(eventsResource.cacheKey, fetchedAt: now)
            guard let cachedEventsEntry else {
                throw EventRepositoryError.notModifiedWithoutCache
            }
            events = try decodeEvents(cachedEventsEntry.data)
        case .success(let data, let etag):
            // Decode before writing: a malformed 200 body must never
            // overwrite a previously-good cached payload.
            events = try decodeEvents(data)
            writeCache(eventsResource.cacheKey, data: data, etag: etag, fetchedAt: now)
        }

        return CalendarSnapshot(
            year: year,
            events: events,
            articleLinks: await linksResult,
            programLinks: await programsResult,
            themes: await themesResult,
            fetchedAt: now
        )
    }

    /// The known years for the app to offer, preferring a fresh cached
    /// copy, then a freshly fetched one, then a stale cached copy, and
    /// finally a hardcoded default so the app always has *something* to
    /// show even fully offline on first launch.
    func availableYears() async -> YearsManifest {
        let resource = RemoteResource.years
        let now = Date()
        let cachedEntry = cache.read(resource.cacheKey)

        if let cachedEntry, cachedEntry.isFresh(ttl: ttl, now: now),
           let manifest = try? JSONDecoder().decode(YearsManifest.self, from: cachedEntry.data) {
            return manifest
        }

        if let result = try? await api.fetch(resource, ifNoneMatch: cachedEntry?.metadata.etag, timeout: nil) {
            switch result {
            case .notModified:
                touchCache(resource.cacheKey, fetchedAt: now)
                if let cachedEntry, let manifest = try? JSONDecoder().decode(YearsManifest.self, from: cachedEntry.data) {
                    return manifest
                }
            case .success(let data, let etag):
                // Decode before writing: a malformed 200 body must never
                // overwrite a previously-good cached payload.
                if let manifest = try? JSONDecoder().decode(YearsManifest.self, from: data) {
                    writeCache(resource.cacheKey, data: data, etag: etag, fetchedAt: now)
                    return manifest
                }
            }
        }

        if let cachedEntry, let manifest = try? JSONDecoder().decode(YearsManifest.self, from: cachedEntry.data) {
            return manifest
        }

        return YearsManifest(years: [2026], defaultYear: 2026)
    }

    /// The server's current deployed version string, or `nil` if the
    /// request fails or the payload can't be parsed. Never touches the
    /// disk cache — this is a lightweight liveness/update check, not
    /// calendar data.
    nonisolated func remoteVersion() async -> String? {
        struct VersionPayload: Decodable {
            let version: String
        }

        guard let result = try? await api.fetch(.version, ifNoneMatch: nil, timeout: nil),
              case .success(let data, _) = result
        else {
            return nil
        }

        return try? JSONDecoder().decode(VersionPayload.self, from: data).version
    }

    // MARK: - Decoding helpers

    private func decodeEvents(_ data: Data) throws -> [Event] {
        do {
            return try JSONDecoder().decode(EventEnvelope.self, from: data).data
        } catch {
            throw EventRepositoryError.decodingFailed
        }
    }

    private func cachedArticleLinks(year: Int) -> [String: [ArticleLink]] {
        guard let entry = cache.read(RemoteResource.articleLinks(year: year).cacheKey),
              let file = try? JSONDecoder().decode(ArticleLinksFile.self, from: entry.data)
        else {
            return [:]
        }
        return file.links
    }

    private func cachedProgramLinks(year: Int) -> [String: [ProgramLink]] {
        guard let entry = cache.read(RemoteResource.programLinks(year: year).cacheKey),
              let file = try? JSONDecoder().decode(ProgramLinksFile.self, from: entry.data)
        else {
            return [:]
        }
        return file.links
    }

    private func cachedThemes(year: Int) -> [WeeklyTheme] {
        guard let entry = cache.read(RemoteResource.weeklyThemes(year: year).cacheKey),
              let file = try? JSONDecoder().decode(WeeklyThemesFile.self, from: entry.data)
        else {
            return []
        }
        return file.weeks
    }

    // MARK: - Sidecar fetches (best-effort, parallel)

    private func fetchSidecarLinks(year: Int) async -> [String: [ArticleLink]] {
        let resource = RemoteResource.articleLinks(year: year)
        let cachedEntry = cache.read(resource.cacheKey)
        let now = Date()

        guard let result = try? await api.fetch(resource, ifNoneMatch: cachedEntry?.metadata.etag, timeout: sidecarTimeout) else {
            return cachedArticleLinks(year: year)
        }

        switch result {
        case .notModified:
            touchCache(resource.cacheKey, fetchedAt: now)
            return cachedArticleLinks(year: year)
        case .success(let data, let etag):
            guard let file = try? JSONDecoder().decode(ArticleLinksFile.self, from: data) else {
                return cachedArticleLinks(year: year)
            }
            writeCache(resource.cacheKey, data: data, etag: etag, fetchedAt: now)
            return file.links
        }
    }

    private func fetchSidecarPrograms(year: Int) async -> [String: [ProgramLink]] {
        let resource = RemoteResource.programLinks(year: year)
        let cachedEntry = cache.read(resource.cacheKey)
        let now = Date()

        guard let result = try? await api.fetch(resource, ifNoneMatch: cachedEntry?.metadata.etag, timeout: sidecarTimeout) else {
            return cachedProgramLinks(year: year)
        }

        switch result {
        case .notModified:
            touchCache(resource.cacheKey, fetchedAt: now)
            return cachedProgramLinks(year: year)
        case .success(let data, let etag):
            guard let file = try? JSONDecoder().decode(ProgramLinksFile.self, from: data) else {
                return cachedProgramLinks(year: year)
            }
            writeCache(resource.cacheKey, data: data, etag: etag, fetchedAt: now)
            return file.links
        }
    }

    private func fetchSidecarThemes(year: Int) async -> [WeeklyTheme] {
        let resource = RemoteResource.weeklyThemes(year: year)
        let cachedEntry = cache.read(resource.cacheKey)
        let now = Date()

        guard let result = try? await api.fetch(resource, ifNoneMatch: cachedEntry?.metadata.etag, timeout: sidecarTimeout) else {
            return cachedThemes(year: year)
        }

        switch result {
        case .notModified:
            touchCache(resource.cacheKey, fetchedAt: now)
            return cachedThemes(year: year)
        case .success(let data, let etag):
            guard let file = try? JSONDecoder().decode(WeeklyThemesFile.self, from: data) else {
                return cachedThemes(year: year)
            }
            writeCache(resource.cacheKey, data: data, etag: etag, fetchedAt: now)
            return file.weeks
        }
    }
}
