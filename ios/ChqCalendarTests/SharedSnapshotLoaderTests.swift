import Foundation
import Testing
@testable import ChqCalendar

/// Pins `SharedSnapshotLoader.loadThemes` (#193): themes decode from the
/// same `themes-<year>` cache entry `EventRepository` writes, and any
/// missing/corrupt entry degrades to `[]`.
struct SharedSnapshotLoaderTests {
    /// Creates a fresh, isolated cache directory per test so runs never collide.
    private func makeCache() -> DiskCache {
        let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        return DiskCache(directory: dir)
    }

    // The JSON matches the weekly-themes sidecar wire format (`WeeklyThemesFile`).
    private let themesJSON = """
    {"weeks":[{"number":7,"title":"The Human Brain","description":"Exploring neuroscience","startDate":"2026-08-08","endDate":"2026-08-15"}]}
    """

    @Test func loadThemesDecodesCachedSidecar() throws {
        let cache = makeCache()
        let data = try #require(themesJSON.data(using: .utf8))
        cache.write("themes-2026", data: data, etag: nil, fetchedAt: Date())
        let themes = SharedSnapshotLoader.loadThemes(year: 2026, cache: cache)
        #expect(themes.map(\.number) == [7])
        #expect(themes.first?.title == "The Human Brain")
    }

    @Test func loadThemesToleratesMissingEntry() {
        let cache = makeCache()
        #expect(SharedSnapshotLoader.loadThemes(year: 2026, cache: cache).isEmpty)
    }

    @Test func loadThemesToleratesCorruptEntry() throws {
        let cache = makeCache()
        let corruptData = try #require("not json".data(using: .utf8))
        cache.write("themes-2026", data: corruptData, etag: nil, fetchedAt: Date())
        #expect(SharedSnapshotLoader.loadThemes(year: 2026, cache: cache).isEmpty)
    }
}
