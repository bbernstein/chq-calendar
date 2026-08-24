import Foundation
import Testing
@testable import ChqCalendar

struct AppGroupTests {
    /// A fresh, isolated directory per test so runs never collide. Created
    /// on disk so it behaves like a real "populated" or "existing" dir.
    private func makeDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    // MARK: - identifier

    @Test func identifierIsTheChqcalAppGroup() {
        #expect(AppGroup.identifier == "group.org.chqcal.app")
    }

    // MARK: - cacheDirectory()

    @Test func cacheDirectoryEndsInChqData() {
        #expect(AppGroup.cacheDirectory().lastPathComponent == "chq-data")
    }

    // MARK: - migrateIfNeeded (disk cache files)

    @Test func migrateIfNeededCopiesJSONFilesFromLegacyToEmptyGroupDir() throws {
        let legacyDir = try makeDir()
        let groupDir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let payload = Data("hello".utf8)
        try payload.write(to: legacyDir.appending(path: "events.json"))
        try payload.write(to: legacyDir.appending(path: "events.meta.json"))

        AppGroup.migrateIfNeeded(fileManager: .default, from: legacyDir, to: groupDir)

        let copied = try FileManager.default.contentsOfDirectory(atPath: groupDir.path).sorted()
        #expect(copied == ["events.json", "events.meta.json"])

        // Copy, not move: the legacy files remain in place.
        let legacyRemaining = try FileManager.default.contentsOfDirectory(atPath: legacyDir.path).sorted()
        #expect(legacyRemaining == ["events.json", "events.meta.json"])
    }

    @Test func migrateIfNeededIsNoOpWhenDestinationAlreadyHasFiles() throws {
        let legacyDir = try makeDir()
        let groupDir = try makeDir()
        try Data("legacy".utf8).write(to: legacyDir.appending(path: "events.json"))
        try Data("existing".utf8).write(to: groupDir.appending(path: "already-there.json"))

        AppGroup.migrateIfNeeded(fileManager: .default, from: legacyDir, to: groupDir)

        let contents = try FileManager.default.contentsOfDirectory(atPath: groupDir.path)
        #expect(contents == ["already-there.json"])
    }

    @Test func migrateIfNeededIgnoresNonJSONFiles() throws {
        let legacyDir = try makeDir()
        let groupDir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try Data("payload".utf8).write(to: legacyDir.appending(path: "events.json"))
        try Data("notes".utf8).write(to: legacyDir.appending(path: "readme.txt"))

        AppGroup.migrateIfNeeded(fileManager: .default, from: legacyDir, to: groupDir)

        let contents = try FileManager.default.contentsOfDirectory(atPath: groupDir.path)
        #expect(contents == ["events.json"])
    }

    @Test func migrateIfNeededSwallowsErrorsWhenLegacyDirIsMissing() throws {
        let legacyDir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let groupDir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)

        AppGroup.migrateIfNeeded(fileManager: .default, from: legacyDir, to: groupDir)

        // No crash, and the destination is left present-but-empty rather
        // than half-populated.
        let contents = try FileManager.default.contentsOfDirectory(atPath: groupDir.path)
        #expect(contents.isEmpty)
    }

    // MARK: - migrateDefaultsIfNeeded

    @Test func migrateDefaultsIfNeededCopiesAbsentKeysOnlyFromSourceToDestination() {
        let old = UserDefaults(suiteName: UUID().uuidString)!
        let new = UserDefaults(suiteName: UUID().uuidString)!
        let keys = ["chq-filters", "chq-favorites", "chq-recents"]

        old.set(Data("filters".utf8), forKey: "chq-filters")
        old.set(Data("favorites".utf8), forKey: "chq-favorites")
        old.set(Data("recents".utf8), forKey: "chq-recents")
        new.set(Data("existing-favorites".utf8), forKey: "chq-favorites")

        AppGroup.migrateDefaultsIfNeeded(from: old, to: new, keys: keys)

        #expect(new.data(forKey: "chq-filters") == Data("filters".utf8))
        #expect(new.data(forKey: "chq-favorites") == Data("existing-favorites".utf8))
        #expect(new.data(forKey: "chq-recents") == Data("recents".utf8))
    }

    @Test func migrateDefaultsIfNeededNoOpsOnASecondCallEvenIfSourceChanges() {
        let old = UserDefaults(suiteName: UUID().uuidString)!
        let new = UserDefaults(suiteName: UUID().uuidString)!
        let keys = ["chq-filters"]

        old.set(Data("first".utf8), forKey: "chq-filters")
        AppGroup.migrateDefaultsIfNeeded(from: old, to: new, keys: keys)
        #expect(new.data(forKey: "chq-filters") == Data("first".utf8))

        // Simulate the destination value being cleared after the first
        // migration: a second call must not re-copy, because the
        // destination suite is now flagged as already migrated.
        new.removeObject(forKey: "chq-filters")
        old.set(Data("second".utf8), forKey: "chq-filters")
        AppGroup.migrateDefaultsIfNeeded(from: old, to: new, keys: keys)

        #expect(new.data(forKey: "chq-filters") == nil)
    }

    @Test func migrateDefaultsIfNeededNoOpWhenSourceHasNoData() {
        let old = UserDefaults(suiteName: UUID().uuidString)!
        let new = UserDefaults(suiteName: UUID().uuidString)!

        AppGroup.migrateDefaultsIfNeeded(from: old, to: new, keys: ["chq-filters"])

        #expect(new.data(forKey: "chq-filters") == nil)
    }

    /// F1 pinning test 1 (iOS 4.2 resubmission review): an empty source must
    /// not burn the "already migrated" flag. Without the data-present check
    /// in `migrateDefaultsIfNeeded`, this first call — copying nothing —
    /// would still set the flag in `new`, and the second call below (from a
    /// source that *does* have data) would then find the flag already set
    /// and no-op, permanently losing the real data.
    @Test func migrateDefaultsIfNeededWithEmptySourceDoesNotBlockALaterPopulatedMigration() {
        let emptySource = UserDefaults(suiteName: UUID().uuidString)!
        let populatedSource = UserDefaults(suiteName: UUID().uuidString)!
        let group = UserDefaults(suiteName: UUID().uuidString)!
        let keys = ["chq-filters", "chq-favorites", "chq-recents"]
        populatedSource.set(Data("favorites".utf8), forKey: "chq-favorites")

        // First call: nothing to copy.
        AppGroup.migrateDefaultsIfNeeded(from: emptySource, to: group, keys: keys)
        #expect(keys.allSatisfy { group.data(forKey: $0) == nil })

        // Second call, from a real source: must still succeed, proving the
        // first (empty) call never set the flag.
        AppGroup.migrateDefaultsIfNeeded(from: populatedSource, to: group, keys: keys)
        #expect(group.data(forKey: "chq-favorites") == Data("favorites".utf8))
    }

    /// F1 pinning test 2: the concrete widget-first upgrade scenario — the
    /// widget extension constructs a `UserStateStore` (and therefore calls
    /// this migration) from its own empty `.standard` before the app has
    /// ever launched on the new version; the app's later migration, from
    /// its real (populated) `.standard`, must still land.
    @Test func migrateDefaultsIfNeededSimulatesWidgetFirstThenAppMigrationSucceeding() {
        let widgetsEmptyStandard = UserDefaults(suiteName: UUID().uuidString)!
        let appsPopulatedStandard = UserDefaults(suiteName: UUID().uuidString)!
        let groupSuite = UserDefaults(suiteName: UUID().uuidString)!
        let keys = ["chq-filters", "chq-favorites", "chq-recents"]
        appsPopulatedStandard.set(Data("real-filters".utf8), forKey: "chq-filters")
        appsPopulatedStandard.set(Data("real-favorites".utf8), forKey: "chq-favorites")

        // The widget's timeline refresh runs first (empty source).
        AppGroup.migrateDefaultsIfNeeded(from: widgetsEmptyStandard, to: groupSuite, keys: keys)

        // The app then launches for the first time and runs its own
        // migration against the same group suite.
        AppGroup.migrateDefaultsIfNeeded(from: appsPopulatedStandard, to: groupSuite, keys: keys)

        #expect(groupSuite.data(forKey: "chq-filters") == Data("real-filters".utf8))
        #expect(groupSuite.data(forKey: "chq-favorites") == Data("real-favorites".utf8))
    }

    // MARK: - isAppProcess / shouldRunAppOnlyMigration

    /// `Bundle.main` is `ChqCalendar.app` here too (the unit test target's
    /// `TEST_HOST` hosts tests inside the app, so `Bundle.main` never
    /// resolves to the `org.chqcal.calendarTests` test bundle) — so
    /// `isAppProcess` reads `true` in the unit test host, same as it would
    /// on a real app launch. It can only ever read `false` inside the
    /// widget extension's own separate process, which isn't reachable from
    /// this target — hence `shouldRunAppOnlyMigration` (tested below)
    /// taking `isAppProcess` as an explicit parameter, so both branches are
    /// still exercisable from here.
    @Test func isAppProcessIsTrueInsideTheAppHostedUnitTestTarget() {
        #expect(AppGroup.isAppProcess)
    }

    @Test func shouldRunAppOnlyMigrationRequiresBothAppProcessAndGroupContainer() {
        #expect(AppGroup.shouldRunAppOnlyMigration(isAppProcess: true, hasGroupContainer: true))
        #expect(!AppGroup.shouldRunAppOnlyMigration(isAppProcess: true, hasGroupContainer: false))
        #expect(!AppGroup.shouldRunAppOnlyMigration(isAppProcess: false, hasGroupContainer: true))
        #expect(!AppGroup.shouldRunAppOnlyMigration(isAppProcess: false, hasGroupContainer: false))
    }
}
