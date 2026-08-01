import Foundation
@testable import ChqCalendar

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

    func setSuccess(data: Data, etag: String?, for resource: RemoteResource) {
        results[resource.cacheKey] = .success(.success(data: data, etag: etag))
    }

    func setNotModified(for resource: RemoteResource) {
        results[resource.cacheKey] = .success(.notModified)
    }

    func setFailure(_ error: Error, for resource: RemoteResource) {
        results[resource.cacheKey] = .failure(error)
    }

    func fetch(_ resource: RemoteResource, ifNoneMatch: String?, timeout: TimeInterval?) async throws -> FetchResult {
        calls.append(Call(resource: resource, ifNoneMatch: ifNoneMatch, timeout: timeout))
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
