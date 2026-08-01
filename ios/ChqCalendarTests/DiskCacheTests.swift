import Foundation
import Testing
@testable import ChqCalendar

struct DiskCacheTests {
    /// A fresh, isolated cache directory per test so runs never collide.
    private func makeCache() -> DiskCache {
        let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        return DiskCache(directory: dir)
    }

    @Test func writeReadRoundTripPreservesBytesAndEtag() throws {
        let cache = makeCache()
        let payload = try #require("hello world".data(using: .utf8))
        let fetchedAt = Date(timeIntervalSince1970: 1_000_000)

        cache.write("events", data: payload, etag: "abc123", fetchedAt: fetchedAt)
        let entry = try #require(cache.read("events"))

        #expect(entry.data == payload)
        #expect(entry.metadata.etag == "abc123")
        #expect(entry.metadata.fetchedAt == fetchedAt)
    }

    @Test func isFreshTrueAt59Minutes() throws {
        let fetchedAt = Date(timeIntervalSince1970: 1_000_000)
        let metadata = CacheMetadata(etag: nil, fetchedAt: fetchedAt)
        let entry = CacheEntry(data: Data(), metadata: metadata)
        let now = fetchedAt.addingTimeInterval(59 * 60)

        #expect(entry.isFresh(ttl: 3600, now: now))
    }

    @Test func isFreshFalseAt61Minutes() throws {
        let fetchedAt = Date(timeIntervalSince1970: 1_000_000)
        let metadata = CacheMetadata(etag: nil, fetchedAt: fetchedAt)
        let entry = CacheEntry(data: Data(), metadata: metadata)
        let now = fetchedAt.addingTimeInterval(61 * 60)

        #expect(!entry.isFresh(ttl: 3600, now: now))
    }

    @Test func touchUpdatesFetchedAtWithoutTouchingPayload() throws {
        let cache = makeCache()
        let payload = try #require("payload".data(using: .utf8))
        let originalFetchedAt = Date(timeIntervalSince1970: 1_000_000)
        let touchedFetchedAt = Date(timeIntervalSince1970: 2_000_000)

        cache.write("events", data: payload, etag: "abc123", fetchedAt: originalFetchedAt)
        cache.touch("events", fetchedAt: touchedFetchedAt)
        let entry = try #require(cache.read("events"))

        #expect(entry.data == payload)
        #expect(entry.metadata.etag == "abc123")
        #expect(entry.metadata.fetchedAt == touchedFetchedAt)
    }

    @Test func readReturnsNilForCorruptMetadataFile() throws {
        let cache = makeCache()
        let payload = try #require("payload".data(using: .utf8))
        cache.write("events", data: payload, etag: "abc123", fetchedAt: Date())

        // Corrupt the metadata sidecar directly.
        let metaURL = cache.directory.appending(path: "events.meta.json")
        try Data("not valid json".utf8).write(to: metaURL)

        #expect(cache.read("events") == nil)
    }

    @Test func readReturnsNilAfterRemove() throws {
        let cache = makeCache()
        let payload = try #require("payload".data(using: .utf8))
        cache.write("events", data: payload, etag: "abc123", fetchedAt: Date())
        #expect(cache.read("events") != nil)

        cache.remove("events")

        #expect(cache.read("events") == nil)
    }

    @Test func readReturnsNilForMissingKey() throws {
        let cache = makeCache()
        #expect(cache.read("nonexistent") == nil)
    }

    @Test func touchIsNoOpWhenKeyMissing() throws {
        let cache = makeCache()
        cache.touch("nonexistent", fetchedAt: Date())
        #expect(cache.read("nonexistent") == nil)
    }

    @Test func removeIsNoOpWhenKeyMissing() throws {
        let cache = makeCache()
        cache.remove("nonexistent")
        #expect(cache.read("nonexistent") == nil)
    }
}
