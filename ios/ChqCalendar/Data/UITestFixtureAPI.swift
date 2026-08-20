#if DEBUG
import Foundation

/// The deterministic world a `-uitest-fixture` launch lives in.
///
/// **Why this exists.** The three defects phase 3a's browser pass caught were
/// integration defects — a rail that was not pinned, a tap that dragged the
/// page, a distant tap that landed short. Catching their iOS equivalents
/// needs a running app, and a running app that fetches live CloudFront data
/// gives a UI test no stable ground to assert against: the feed changes, and
/// after the season ends every date assertion in it is off-season and wrong.
///
/// **Why it is generated, not a bundled JSON file.** Xcode 26 synchronized
/// folder groups add every file under `ios/ChqCalendar/` to the target,
/// including Release builds. `#if DEBUG` can exclude code; it cannot exclude
/// a resource. So the payload is built in Swift and this entire file
/// disappears from a Release build.
///
/// **The shape, which UI tests assert against.** Season 2026. Days run
/// `2026-06-27` through `2026-08-23` inclusive. Every third day (index % 3 ==
/// 2) is left empty, because a rail's interesting cases are the gaps: an
/// empty chip is not a destination, and a chevron must step past it. Each
/// non-empty day carries three events at 09:00, 13:00 and 19:00 so day
/// sections are tall enough for a scroll to be a real scroll.
nonisolated enum UITestFixture {
    static let firstDay = "2026-06-27"
    static let lastDay = "2026-08-23"
    static let year = 2026

    /// True when the app was launched with `-uitest-fixture`.
    static var isActive: Bool {
        ProcessInfo.processInfo.arguments.contains("-uitest-fixture")
    }

    /// Every day the fixture covers, in order.
    static var allDays: [String] {
        ChqTime.dayKeys(from: firstDay, through: lastDay)
    }

    /// The days that actually carry events — what navigation can reach.
    static var eventDays: [String] {
        allDays.enumerated().compactMap { index, day in
            index % 3 == 2 ? nil : day
        }
    }

    /// A repository wired to the fixture client and an in-memory cache.
    ///
    /// The in-memory cache matters as much as the client: `DiskCache.standard()`
    /// is the real app's cache, so a fixture launch sharing it would write
    /// synthetic events into the container the next real launch reads.
    static func makeRepository() -> EventRepository {
        EventRepository(api: UITestFixtureAPI(), cache: UITestMemoryCache())
    }

    static func eventsJSON() -> Data {
        var entries: [String] = []
        for day in eventDays {
            for (slot, time) in ["09:00:00", "13:00:00", "19:00:00"].enumerated() {
                entries.append("""
                {
                  "id": "\(day)-\(slot)",
                  "title": "Fixture Event \(slot + 1)",
                  "description": "A deterministic fixture event.",
                  "startDate": "\(day) \(time)",
                  "endDate": "\(day) \(time)",
                  "timezone": "America/New_York",
                  "venue": { "name": "Amphitheater", "id": 1, "showMap": false },
                  "location": "Amphitheater",
                  "categories": [
                    { "name": "Lecture", "parent": 0, "id": 1,
                      "taxonomy": "tribe_events_cat", "slug": "lecture" }
                  ]
                }
                """)
            }
        }
        return Data("{ \"data\": [\(entries.joined(separator: ","))] }".utf8)
    }

    static func yearsJSON() -> Data {
        Data("""
        { "years": [2026], "defaultYear": 2026, "generated": "2026-01-01T00:00:00Z" }
        """.utf8)
    }
}

/// Serves `UITestFixture`'s payloads and fails every other resource.
///
/// Sidecars (article links, program links, weekly themes) fail deliberately.
/// `EventRepository.fetchSidecarLinks` and its siblings already treat a
/// failed sidecar as "keep what's cached", which for a cold in-memory cache
/// is an empty map — so the snapshot is well-formed without this file having
/// to invent three more payload shapes that nothing in the rail reads.
nonisolated struct UITestFixtureAPI: CalendarAPIClient {
    func fetch(
        _ resource: RemoteResource, ifNoneMatch: String?, timeout: TimeInterval?
    ) async throws -> FetchResult {
        switch resource {
        case .events(let year) where year == UITestFixture.year:
            return .success(data: UITestFixture.eventsJSON(), etag: "fixture")
        case .years:
            return .success(data: UITestFixture.yearsJSON(), etag: "fixture")
        default:
            throw CalendarAPIError.httpStatus(404)
        }
    }
}

/// A `DataCaching` that forgets everything when the process exits.
final class UITestMemoryCache: DataCaching, @unchecked Sendable {
    private let lock = NSLock()
    private var entries: [String: CacheEntry] = [:]

    func read(_ key: String) -> CacheEntry? {
        lock.lock(); defer { lock.unlock() }
        return entries[key]
    }

    func write(_ key: String, data: Data, etag: String?, fetchedAt: Date) {
        lock.lock(); defer { lock.unlock() }
        entries[key] = CacheEntry(
            data: data, metadata: CacheMetadata(etag: etag, fetchedAt: fetchedAt))
    }

    func touch(_ key: String, fetchedAt: Date) {
        lock.lock(); defer { lock.unlock() }
        guard let existing = entries[key] else { return }
        entries[key] = CacheEntry(
            data: existing.data,
            metadata: CacheMetadata(etag: existing.metadata.etag, fetchedAt: fetchedAt))
    }

    func remove(_ key: String) {
        lock.lock(); defer { lock.unlock() }
        entries[key] = nil
    }
}
#endif
