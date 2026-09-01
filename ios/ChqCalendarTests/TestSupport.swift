import Foundation
import Testing
@testable import ChqCalendar

/// Polls `condition` on the main actor every `pollInterval` until it
/// returns `true`, or fails the test if `timeout` elapses first.
///
/// `AppModelTests` synchronizes with `Task`s it starts but doesn't
/// directly `await` (e.g. `Task { await model.start() }`) by waiting for
/// the state that `Task` is expected to eventually produce. A **fixed**
/// `Task.sleep` used for that purpose is inherently racy: Swift Testing
/// runs suites in parallel, and under full-suite load a fixed wait can
/// elapse before the awaited state has actually settled — producing a
/// failure that has nothing to do with the production code under test.
/// `waitUntil` polls instead of guessing a duration, so it stays correct
/// regardless of scheduler load. Do not reintroduce fixed sleeps to
/// synchronize with an expected state change; if a new async test needs
/// to wait for something to happen, poll for it with this helper instead.
///
/// This is **not** appropriate for proving a negative ("this must NOT
/// happen") — polling can only detect that a condition became true, never
/// that it stayed false forever, so tests asserting an absence should
/// keep a bounded `Task.sleep` before asserting.
@MainActor
func waitUntil(
    _ description: String,
    timeout: Duration = .seconds(5),
    pollInterval: Duration = .milliseconds(10),
    sourceLocation: SourceLocation = #_sourceLocation,
    _ condition: () async -> Bool
) async {
    let deadline = ContinuousClock.now + timeout
    while true {
        if await condition() {
            return
        }
        if ContinuousClock.now >= deadline {
            Issue.record("Timed out waiting for: \(description)", sourceLocation: sourceLocation)
            return
        }
        try? await Task.sleep(for: pollInterval)
    }
}

/// Builds an `Event` directly (via `Event`'s internal memberwise
/// initializer) for filter/grouping/display-name tests, without needing to
/// round-trip through JSON. Only the fields a given test cares about need
/// to be supplied — everything else defaults to an inert value.
func makeEvent(
    id: String,
    start: Date,
    title: String = "Test Event",
    location: String? = nil,
    categories: [String] = [],
    tags: [String] = [],
    details: String? = nil,
    presenter: String? = nil,
    end: Date? = nil,
    week: Int? = nil,
    status: EventStatus = .scheduled
) -> Event {
    Event(
        id: id,
        title: title,
        start: start,
        end: end,
        details: details,
        displayLocation: location,
        venueAddress: nil,
        categoryNames: categories,
        tags: tags,
        presenter: presenter,
        cost: nil,
        pageURL: nil,
        imageURL: nil,
        status: status,
        week: week
    )
}

/// Errors used to script `MockAPI` failures in tests.
enum MockAPIError: Error, Sendable, Equatable {
    case unscripted(String)
}

/// A scripted, in-memory `CalendarAPIClient` for tests: each resource's
/// response is set ahead of time (success/notModified/failure), and every
/// call — including the `ifNoneMatch` it was sent — is recorded for later
/// assertion.
///
/// An `actor` (rather than a lock-guarded class) both because it needs to
/// satisfy the `Sendable` `CalendarAPIClient` protocol and because tests
/// naturally call it with `await` alongside the `EventRepository` under
/// test.
actor MockAPI: CalendarAPIClient {
    struct Call: Sendable {
        let resource: RemoteResource
        let ifNoneMatch: String?
        let timeout: TimeInterval?
    }

    private(set) var calls: [Call] = []
    private var results: [String: Result<FetchResult, Error>] = [:]
    private var neverResolvesKeys: Set<String> = []
    private var suspendedKeys: Set<String> = []
    private var suspendedContinuations: [String: [CheckedContinuation<Void, Never>]] = [:]

    func setSuccess(data: Data, etag: String?, for resource: RemoteResource) {
        results[resource.cacheKey] = .success(.success(data: data, etag: etag))
    }

    func setNotModified(for resource: RemoteResource) {
        results[resource.cacheKey] = .success(.notModified)
    }

    func setFailure(_ error: Error, for resource: RemoteResource) {
        results[resource.cacheKey] = .failure(error)
    }

    /// Makes `fetch` suspend forever for `resource`, instead of ever
    /// returning a scripted result. Used to prove a code path renders from
    /// cache alone, without depending on (or waiting for) any network call
    /// to complete.
    func setNeverResolves(for resource: RemoteResource) {
        neverResolvesKeys.insert(resource.cacheKey)
    }

    /// Makes `fetch` suspend for `resource` until `resume(for:)` is called
    /// for the same resource — a controllable version of
    /// `setNeverResolves`, for tests that need to let an in-flight call
    /// complete at a precise, chosen moment (e.g. proving a stale result is
    /// discarded rather than merely never observed).
    func setSuspended(for resource: RemoteResource) {
        suspendedKeys.insert(resource.cacheKey)
    }

    /// Releases any `fetch` call(s) currently parked by `setSuspended(for:)`
    /// for `resource`, letting them proceed to the scripted result (or
    /// throw `.unscripted` if none was set).
    func resume(for resource: RemoteResource) {
        suspendedKeys.remove(resource.cacheKey)
        let waiting = suspendedContinuations.removeValue(forKey: resource.cacheKey) ?? []
        for continuation in waiting {
            continuation.resume()
        }
    }

    func fetch(_ resource: RemoteResource, ifNoneMatch: String?, timeout: TimeInterval?) async throws -> FetchResult {
        calls.append(Call(resource: resource, ifNoneMatch: ifNoneMatch, timeout: timeout))
        if neverResolvesKeys.contains(resource.cacheKey) {
            try? await Task.sleep(nanoseconds: .max)
        }
        if suspendedKeys.contains(resource.cacheKey) {
            await withCheckedContinuation { continuation in
                suspendedContinuations[resource.cacheKey, default: []].append(continuation)
            }
        }
        guard let result = results[resource.cacheKey] else {
            throw MockAPIError.unscripted(resource.cacheKey)
        }
        return try result.get()
    }
}

/// A dictionary-backed `DataCaching` for tests, guarded by a lock since
/// `DataCaching`'s methods are synchronous but may be called both from
/// inside the `EventRepository` actor and directly from test assertions.
final class MockCache: DataCaching, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String: CacheEntry] = [:]
    private var reads: [String: Int] = [:]

    /// How many times `read(_:)` has been called for `key`.
    ///
    /// Exists so tests can assert on *how often* the repository goes to the
    /// cache, not just what it gets back — the observable for the snapshot
    /// memoization in #187.
    ///
    /// Scoped to `cachedSnapshot(year:)`: *there*, a payload read is a
    /// faithful proxy for the expensive part (the full JSON decode that
    /// immediately follows it), because that method never reads a payload
    /// without decoding it. That is not true of the repository generally —
    /// `refresh` reads the cached entry for its ETag and freshness check
    /// and then, on a `200`, decodes the *network* payload instead, leaving
    /// that read with no decode attached. So only count reads in tests that
    /// exercise `cachedSnapshot`.
    func readCount(for key: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        return reads[key] ?? 0
    }

    func read(_ key: String) -> CacheEntry? {
        lock.lock()
        defer { lock.unlock() }
        reads[key, default: 0] += 1
        return storage[key]
    }

    func write(_ key: String, data: Data, etag: String?, fetchedAt: Date) {
        lock.lock()
        defer { lock.unlock() }
        storage[key] = CacheEntry(data: data, metadata: CacheMetadata(etag: etag, fetchedAt: fetchedAt))
    }

    func touch(_ key: String, fetchedAt: Date) {
        lock.lock()
        defer { lock.unlock() }
        guard let entry = storage[key] else { return }
        storage[key] = CacheEntry(data: entry.data, metadata: CacheMetadata(etag: entry.metadata.etag, fetchedAt: fetchedAt))
    }

    func remove(_ key: String) {
        lock.lock()
        defer { lock.unlock() }
        storage.removeValue(forKey: key)
    }
}

/// Two cached seasons (2025 and 2026) plus the `[2025, 2026, 2027]`
/// years manifest, with `now` mid-season 2026 — so 2026 is
/// `isCurrentYear` and 2025 is an archived season. `start()` has already
/// run, so `selectedYear` is the manifest's `defaultYear` (2026) and
/// `years` is populated: the state a deep link actually arrives in.
///
/// 2025 gets its own fixture rather than a second helping of
/// `events-sample`. `ViewWindow.navigableBounds` widens a year's bounds
/// to cover every event in its snapshot, so filing 2026-dated events
/// under 2025 would make 2026 days reachable from *within* 2025 — and
/// every cross-year test would then pass without a year switch ever
/// happening.
///
/// Shared rather than private to `AppModelTests` because `PendingDayLinkTests`
/// needs the identical two-season state to exercise the deep-link consumer
/// across a year switch, and two hand-kept copies of a fixture whose whole
/// point is a subtle bounds relationship between the years is exactly the
/// divergence this project keeps paying for.
@MainActor
func makeTwoSeasonModel(defaults: UserDefaults) async throws -> AppModel {
    let cache = MockCache()
    cache.write(
        "events-2025", data: fixtureData("events-2025-sparse"), etag: "e25", fetchedAt: Date())
    cache.write(
        "events-2026", data: fixtureData("events-sample"), etag: "e26", fetchedAt: Date())
    cache.write("years", data: fixtureData("years"), etag: "y1", fetchedAt: Date())
    let now = try #require(ChqTime.parse("2026-08-03 12:00:00"))
    let model = AppModel(
        repository: EventRepository(api: MockAPI(), cache: cache),
        store: UserStateStore(defaults: defaults, now: { Date() }),
        now: { now }
    )
    await model.start()
    return model
}
