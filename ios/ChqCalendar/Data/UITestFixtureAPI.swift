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
/// **The shape, which UI tests assert against.** Three seasons, because a
/// single-year manifest makes every cross-year path in the app unreachable
/// from a UI test — which is why #186 (a reader waiting for a season browses
/// the previous one) and #253 (a day link naming another season) had never
/// been exercised end to end by anything but unit tests.
///
/// | year | in `years` | events served | the state it exists to reach |
/// | ---- | ---------- | ------------- | ---------------------------- |
/// | 2025 | yes | `2025-06-21` … `2025-08-17` | the archived season a cross-year link or the "Browse the _ season" button lands in |
/// | 2026 | yes, and `defaultYear` | `2026-06-27` … `2026-08-23` | every pre-existing test's world, unchanged |
/// | 2027 | yes | **a valid, empty payload** | `LandingState.preSeason` |
///
/// **2027 serves `{ "data": [] }`, and that is load-bearing, not laziness.**
/// `.preSeason` is reachable only through a needle's eye. `LandingState`'s
/// rule 1 returns `.inSeason` for any year holding an event at or after
/// `now`, so a *populated* future year never reaches it; and
/// `AppModel.landingState` guards `snapshot != nil`, so a future year whose
/// events request **404s** yields no snapshot and does not reach it either.
/// Only a well-formed payload that decodes to zero events, under a clock
/// frozen before that year's season start, lands on `.preSeason` — which is
/// also exactly the real state this models: the server announces next season
/// in the manifest months before its feed has anything in it.
///
/// **2026 is byte-identical to what it was before the fixture grew.** Its
/// day span, its every-third-day gaps and its three events per day are
/// asserted against by name throughout `DayRailUITests` and
/// `DayRailAccessibilityUITests` (`2026-06-27`, `2026-08-21`, `2026-06-29`,
/// "Fixture Event 1", …). `firstDay`/`lastDay`/`year`/`allDays`/`eventDays`
/// still mean 2026 and only 2026; the multi-year forms are the
/// `(inYear:)`/`(for:)` overloads below.
///
/// Days run first-to-last inclusive per season. Every third day (index % 3 ==
/// 2) is left empty, because a rail's interesting cases are the gaps: an
/// empty chip is not a destination, and a chevron must step past it. Each
/// non-empty day carries three events at 09:00, 13:00 and 19:00 so day
/// sections are tall enough for a scroll to be a real scroll.
nonisolated enum UITestFixture {
    static let firstDay = "2026-06-27"
    static let lastDay = "2026-08-23"
    static let year = 2026

    /// The season a reader is sent *back* to: by the pre-season landing's
    /// "Browse the 2026 season" button (#186), or by a `chqcal://day/2025-…`
    /// link arriving while the app sits on another year (#253).
    ///
    /// Its span mirrors 2026's exactly — 58 days long, opening on the
    /// season's own first Saturday — so the every-third-day gap pattern
    /// falls in the same places relative to each season's start and a test
    /// written against one year reads the same way against the other.
    /// `SeasonCalendar.seasonStart` puts the 2025 opening on 2025-06-21 and
    /// the 2026 opening on 2026-06-27.
    static let archivedYear = 2025
    static let archivedFirstDay = "2025-06-21"
    static let archivedLastDay = "2025-08-17"

    /// The season the manifest announces before its feed has anything in it
    /// — the only year that reaches `LandingState.preSeason`. See the type
    /// header for why it must serve an empty payload rather than a 404.
    ///
    /// `SeasonCalendar.seasonStart(year: 2027)` is 2027-06-26 at noon NY, so
    /// any `-uitest-freeze-now` before that instant, with
    /// `-uitest-pin-year 2027`, lands on the pre-season landing.
    static let announcedYear = 2027

    /// Exactly what `yearsJSON` lists, in the order it lists them.
    ///
    /// `LandingState.determine` derives `.preSeason`'s `archiveYear` from
    /// this list (`availableYears.filter { $0 < selectedYear }.max()`) and
    /// `AppModel.goToDay(crossingYears:)` refuses any year absent from it,
    /// so a test asserting "Browse the 2026 season" is asserting a fact
    /// about this array.
    static let manifestYears = [archivedYear, year, announcedYear]

    /// The day span of every season that actually serves events. A year in
    /// `manifestYears` but absent here — 2027 — is announced with an empty
    /// payload; a year in neither still 404s (`UITestFixtureAPI.fetch`).
    private static let seasons: [Int: (first: String, last: String)] = [
        archivedYear: (archivedFirstDay, archivedLastDay),
        year: (firstDay, lastDay),
    ]

    /// True when the app was launched with `-uitest-fixture`.
    static var isActive: Bool {
        ProcessInfo.processInfo.arguments.contains("-uitest-fixture")
    }

    /// Every day `season` covers, in order — empty for a season this fixture
    /// serves no events for.
    static func allDays(inYear season: Int) -> [String] {
        guard let span = seasons[season] else { return [] }
        return ChqTime.dayKeys(from: span.first, through: span.last)
    }

    /// The days of `season` that actually carry events — what navigation can
    /// reach.
    static func eventDays(inYear season: Int) -> [String] {
        allDays(inYear: season).enumerated().compactMap { index, day in
            index % 3 == 2 ? nil : day
        }
    }

    /// Every day the fixture's default season (2026) covers, in order.
    static var allDays: [String] { allDays(inYear: year) }

    /// 2026's days that actually carry events — what navigation can reach.
    static var eventDays: [String] { eventDays(inYear: year) }

    /// A repository wired to the fixture client and an in-memory cache.
    ///
    /// The in-memory cache matters as much as the client: `DiskCache.standard()`
    /// is the real app's cache, so a fixture launch sharing it would write
    /// synthetic events into the container the next real launch reads.
    static func makeRepository() -> EventRepository {
        EventRepository(api: UITestFixtureAPI(), cache: UITestMemoryCache())
    }

    /// `season`'s events payload — a **well-formed, empty** one for a season
    /// the fixture announces but does not populate (2027). See the type
    /// header: an empty payload and a 404 reach different landing states,
    /// and only the empty one reaches `.preSeason`.
    static func eventsJSON(for season: Int) -> Data {
        var entries: [String] = []
        for day in eventDays(inYear: season) {
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
        let list = manifestYears.map(String.init).joined(separator: ", ")
        return Data("""
        { "years": [\(list)], "defaultYear": \(year), "generated": "2026-01-01T00:00:00Z" }
        """.utf8)
    }
}

/// Serves `UITestFixture`'s payloads and fails every other resource.
///
/// **Every year the manifest announces is served**, including the one with
/// no events in it: a 404 there would leave `AppModel.snapshot` nil, and
/// `AppModel.landingState`'s `guard snapshot != nil` would report
/// `.inSeason` — silently making the pre-season landing unreachable while
/// looking, from the test's side, exactly like a fixture that "just serves
/// 2027". A year *outside* the manifest still 404s, which is the real
/// server's behaviour and what `goToDay(crossingYears:)`'s
/// `years.contains(year)` refusal is written against.
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
        case .events(let year) where UITestFixture.manifestYears.contains(year):
            return .success(data: UITestFixture.eventsJSON(for: year), etag: "fixture-\(year)")
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
