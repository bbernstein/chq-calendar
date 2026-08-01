import Foundation
@testable import ChqCalendar

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

    func fetch(_ resource: RemoteResource, ifNoneMatch: String?, timeout: TimeInterval?) async throws -> FetchResult {
        calls.append(Call(resource: resource, ifNoneMatch: ifNoneMatch, timeout: timeout))
        if neverResolvesKeys.contains(resource.cacheKey) {
            try? await Task.sleep(nanoseconds: .max)
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

    func read(_ key: String) -> CacheEntry? {
        lock.lock()
        defer { lock.unlock() }
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
