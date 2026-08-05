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
    private let cache: DataCaching
    private let ttl: TimeInterval
    private let sidecarTimeout: TimeInterval

    init(api: CalendarAPIClient, cache: DataCaching, ttl: TimeInterval = 3600, sidecarTimeout: TimeInterval = 3) {
        self.api = api
        self.cache = cache
        self.ttl = ttl
        self.sidecarTimeout = sidecarTimeout
    }

    // MARK: - Reading cached data (no network)

    /// Decodes whatever is currently on disk for `year`, regardless of age.
    /// Returns `nil` only if no cached events payload exists at all — the
    /// sidecars (article links, program links, weekly themes) are optional
    /// and simply come back empty when absent or undecodable.
    func cachedSnapshot(year: Int) -> CalendarSnapshot? {
        guard let eventsEntry = cache.read(RemoteResource.events(year: year).cacheKey) else {
            return nil
        }
        guard let events = try? decodeEvents(eventsEntry.data) else {
            return nil
        }

        return CalendarSnapshot(
            year: year,
            events: events,
            articleLinks: cachedArticleLinks(year: year),
            programLinks: cachedProgramLinks(year: year),
            themes: cachedThemes(year: year),
            fetchedAt: eventsEntry.metadata.fetchedAt
        )
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
            cache.touch(eventsResource.cacheKey, fetchedAt: now)
            guard let cachedEventsEntry else {
                throw EventRepositoryError.notModifiedWithoutCache
            }
            events = try decodeEvents(cachedEventsEntry.data)
        case .success(let data, let etag):
            // Decode before writing: a malformed 200 body must never
            // overwrite a previously-good cached payload.
            events = try decodeEvents(data)
            cache.write(eventsResource.cacheKey, data: data, etag: etag, fetchedAt: now)
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
                cache.touch(resource.cacheKey, fetchedAt: now)
                if let cachedEntry, let manifest = try? JSONDecoder().decode(YearsManifest.self, from: cachedEntry.data) {
                    return manifest
                }
            case .success(let data, let etag):
                // Decode before writing: a malformed 200 body must never
                // overwrite a previously-good cached payload.
                if let manifest = try? JSONDecoder().decode(YearsManifest.self, from: data) {
                    cache.write(resource.cacheKey, data: data, etag: etag, fetchedAt: now)
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
            cache.touch(resource.cacheKey, fetchedAt: now)
            return cachedArticleLinks(year: year)
        case .success(let data, let etag):
            guard let file = try? JSONDecoder().decode(ArticleLinksFile.self, from: data) else {
                return cachedArticleLinks(year: year)
            }
            cache.write(resource.cacheKey, data: data, etag: etag, fetchedAt: now)
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
            cache.touch(resource.cacheKey, fetchedAt: now)
            return cachedProgramLinks(year: year)
        case .success(let data, let etag):
            guard let file = try? JSONDecoder().decode(ProgramLinksFile.self, from: data) else {
                return cachedProgramLinks(year: year)
            }
            cache.write(resource.cacheKey, data: data, etag: etag, fetchedAt: now)
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
            cache.touch(resource.cacheKey, fetchedAt: now)
            return cachedThemes(year: year)
        case .success(let data, let etag):
            guard let file = try? JSONDecoder().decode(WeeklyThemesFile.self, from: data) else {
                return cachedThemes(year: year)
            }
            cache.write(resource.cacheKey, data: data, etag: etag, fetchedAt: now)
            return file.weeks
        }
    }
}
