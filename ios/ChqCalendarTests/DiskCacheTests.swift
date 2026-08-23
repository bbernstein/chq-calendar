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

    @Test func readReturnsNilWhenMetadataSidecarIsMissing() throws {
        let cache = makeCache()
        let payload = try #require("payload".data(using: .utf8))
        cache.write("events", data: payload, etag: "abc123", fetchedAt: Date())

        // Simulate a torn write (or a manual deletion) that leaves the
        // payload behind with no metadata sidecar.
        try FileManager.default.removeItem(at: cache.directory.appending(path: "events.meta.json"))

        #expect(cache.read("events") == nil)
    }

    // MARK: - triggerMigrationIfNeeded isAppProcess gate (F1, "for symmetry")

    /// Same rationale as `UserStateStoreTests`'s pair of the same name:
    /// whether either branch actually migrates anything depends on the
    /// host environment (`AppGroup.containerURL()` is `nil` on a simulator
    /// with no provisioned App Group container, non-`nil` on one that has
    /// it; `isAppProcess` is always `true` in this app-hosted test target),
    /// so on a provisioned simulator the `isAppProcess: true` call really
    /// does reach `AppGroup.migrateIfNeeded` against the test host's own
    /// legacy cache directory — harmlessly, since that migration copies
    /// rather than moves and is skipped entirely once the group directory
    /// is non-empty. These two pin only that the parameterized trigger is
    /// callable and total for both values.
    @Test func triggerMigrationIfNeededReturnsTrueWhenIsAppProcessIsTrue() {
        #expect(DiskCache.triggerMigrationIfNeeded(isAppProcess: true))
    }

    @Test func triggerMigrationIfNeededReturnsTrueWhenIsAppProcessIsFalse() {
        #expect(DiskCache.triggerMigrationIfNeeded(isAppProcess: false))
    }

    @Test func writeSanitizesPathTraversalKeyToStayInsideDirectory() throws {
        let cache = makeCache()
        let payload = try #require("payload".data(using: .utf8))

        cache.write("../escape", data: payload, etag: nil, fetchedAt: Date())

        let fm = FileManager.default
        let namesInCacheDir = try fm.contentsOfDirectory(atPath: cache.directory.path)
        #expect(namesInCacheDir.contains(".._escape.json"))
        #expect(namesInCacheDir.contains(".._escape.meta.json"))

        // Nothing escaped one level up into the parent (temp) directory.
        let parentDir = cache.directory.deletingLastPathComponent()
        let namesInParent = try fm.contentsOfDirectory(atPath: parentDir.path)
        #expect(!namesInParent.contains("escape.json"))
        #expect(!namesInParent.contains("escape.meta.json"))
    }
}
