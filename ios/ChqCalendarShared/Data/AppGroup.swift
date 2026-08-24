import Foundation

/// Shared-storage coordination for the App Group `group.org.chqcal.app`,
/// which lets the main app and a future widget extension read the same
/// disk cache and `UserDefaults` state.
///
/// Every function here degrades gracefully when the App Group container is
/// unavailable — un-entitled builds fall back to the pre-App-Group legacy
/// paths (`Library/Caches/chq-data` and `UserDefaults.standard`), so
/// nothing here changes behavior for a build that hasn't picked up the
/// entitlement yet.
///
/// A unit-test host is **not** reliably in that category, despite the
/// obvious guess (#235). The test bundle is hosted inside `ChqCalendar.app`
/// and inherits its entitlement, so `containerURL()` returns a real URL on
/// any simulator where the group container has been provisioned, and `nil`
/// only on one where it never has. Which of the two a given machine is, is
/// an environment fact: branch on the value, and never treat "running in
/// tests" as a synonym for "no group container".
nonisolated enum AppGroup {
    static let identifier = "group.org.chqcal.app"

    /// Whether this process is (running inside) the main app, as opposed to
    /// the widget extension (`org.chqcal.app.widgets`).
    ///
    /// Used to gate the one-time App-Group migrations
    /// (`UserStateStore`'s defaults migration, `DiskCache.standard()`'s
    /// file migration) to the app process only. Both migrations build
    /// their "did I already run" answer from state stored in the *shared*
    /// App Group container, but the widget extension constructs its own
    /// `UserStateStore`/`DiskCache` on every timeline refresh — before the
    /// app has necessarily ever launched on a fresh install/upgrade. If the
    /// widget ran a migration first, it would migrate from its own empty
    /// `.standard`/cache directory, mark the shared flag/directory as
    /// "migrated", and permanently skip the app's real migration once it
    /// finally launches. See `shouldRunAppOnlyMigration` and
    /// `migrateDefaultsIfNeeded`'s doc comment.
    ///
    /// Reads `Bundle.main`, which is `ChqCalendar.app` for both a real app
    /// launch *and* an `xctest` run (the unit test target's `TEST_HOST`
    /// builds tests hosted inside the app, so `Bundle.main` resolves to the
    /// app bundle there too, not the test bundle) — meaning this is `true`
    /// in both. That's fine for what this actually needs to distinguish:
    /// "app-family process" vs. "the widget extension's own separate
    /// process", not "a real launch" vs. "a test run". It is `false` only
    /// inside the widget extension, whose own `Bundle.main` is
    /// `org.chqcal.app.widgets`.
    static var isAppProcess: Bool {
        Bundle.main.bundleIdentifier == "org.chqcal.app"
    }

    /// Flag key, stored in the *destination* suite passed to
    /// `migrateDefaultsIfNeeded`, that marks the one-time defaults
    /// migration as already having run.
    private static let migratedDefaultsFlagKey = "chq-group-migrated"

    /// The gate behind both app-only migration triggers
    /// (`UserStateStore.didMigrateDefaults`, `DiskCache.didMigrate`): a
    /// migration should only actually run when the process is the app
    /// (not the widget extension) *and* the App Group entitlement is
    /// present (a real device/simulator build, not an un-entitled unit-test
    /// host).
    ///
    /// Broken out as a pure function of two `Bool`s — rather than reading
    /// `isAppProcess`/`containerURL()` live inline at each call site — so
    /// both branches of the gate are directly testable even though neither
    /// live value can be *flipped* from within the unit-test host:
    /// `isAppProcess` is always `true` there (see `isAppProcess`'s own doc
    /// comment on why `Bundle.main` can't distinguish a test run from a
    /// real app launch), and `containerURL()` is whatever the host
    /// environment makes it — `nil` on a simulator that has never had the
    /// App Group container provisioned, non-`nil` on one that has.
    ///
    /// That container value is an environment fact rather than a property of
    /// this code, so no test asserts it (#235 deleted the one that did).
    /// `isAppProcess` is the opposite case — it is fixed for this target,
    /// and `AppGroupTests.isAppProcessIsTrueInsideTheAppHostedUnitTestTarget`
    /// pins it. The decision matrix itself is pinned against this pure
    /// function, by
    /// `AppGroupTests.shouldRunAppOnlyMigrationRequiresBothAppProcessAndGroupContainer`.
    static func shouldRunAppOnlyMigration(isAppProcess: Bool, hasGroupContainer: Bool) -> Bool {
        isAppProcess && hasGroupContainer
    }

    /// The shared container for the App Group, or `nil` when the running
    /// process lacks the `com.apple.security.application-groups`
    /// entitlement (un-entitled builds) or the container has never been
    /// provisioned on this device/simulator.
    ///
    /// A unit-test host is not automatically a `nil` case — see this type's
    /// own doc comment: it inherits the app host's entitlement, so this
    /// answers per-simulator rather than per-configuration (#235).
    static func containerURL() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier)
    }

    /// The pre-App-Group cache location: `Library/Caches/chq-data/`.
    /// Kept available (not `private`) so callers that need to migrate
    /// *into* the group container can also compute where to migrate
    /// *from*.
    static func legacyCacheDirectory(fileManager: FileManager) -> URL {
        let caches = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? fileManager.temporaryDirectory
        return caches.appending(path: "chq-data")
    }

    /// Where `DiskCache` should read/write: `<group container>/chq-data`
    /// when the App Group entitlement is present, else the legacy
    /// `Library/Caches/chq-data` path.
    static func cacheDirectory() -> URL {
        guard let container = containerURL() else {
            return legacyCacheDirectory(fileManager: .default)
        }
        return container.appending(path: "chq-data")
    }

    /// The `UserDefaults` suite `UserStateStore` should read/write: the App
    /// Group suite when the entitlement is present, else `.standard`.
    static func userDefaults() -> UserDefaults {
        guard containerURL() != nil else { return .standard }
        return UserDefaults(suiteName: identifier) ?? .standard
    }

    /// One-time file migration from a legacy cache directory into the App
    /// Group cache directory. Copies (never moves) each regular `*.json`
    /// file — matching both `DiskCache`'s `<key>.json` payloads and
    /// `<key>.meta.json` sidecars — so the legacy directory is left intact
    /// as a fallback.
    ///
    /// No-op if `groupDir` already contains any entries: this both makes
    /// the migration idempotent across launches (once files land in the
    /// group directory, they're never touched again) and protects an
    /// already-populated group directory from ever being clobbered.
    /// Per-file copy errors (permissions, races with a concurrently
    /// launching widget extension, etc.) are swallowed rather than
    /// propagated — a partial migration is preferable to a crash, since
    /// `DiskCache` itself already tolerates missing entries.
    static func migrateIfNeeded(fileManager: FileManager, from legacyDir: URL, to groupDir: URL) {
        let existingGroupEntries = (try? fileManager.contentsOfDirectory(atPath: groupDir.path)) ?? []
        guard existingGroupEntries.isEmpty else { return }

        try? fileManager.createDirectory(at: groupDir, withIntermediateDirectories: true)

        guard let items = try? fileManager.contentsOfDirectory(
            at: legacyDir,
            includingPropertiesForKeys: [.isRegularFileKey]
        ) else {
            return
        }

        for item in items where item.pathExtension == "json" {
            guard (try? item.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true else {
                continue
            }
            let destination = groupDir.appending(path: item.lastPathComponent)
            try? fileManager.copyItem(at: item, to: destination)
        }
    }

    /// One-time `UserDefaults` migration: for each of `keys`, copies the
    /// `Data` blob from `old` into `new` only if `new` doesn't already
    /// have a value for that key. Guarded by `migratedDefaultsFlagKey` in
    /// `new` so a second call is always a no-op, even if `old` has since
    /// changed — matching `migrateIfNeeded`'s "touch the destination at
    /// most once" behavior for files.
    ///
    /// The flag is set only when `old` actually had data for at least one
    /// of `keys` — an `old` with nothing to migrate (e.g. a process whose
    /// own `.standard` is a brand-new, empty container) leaves the flag
    /// untouched, so a later call from a process whose `old` *does* have
    /// real data can still migrate. Without this check, any process that
    /// happens to construct a migration source first — even one with
    /// nothing to copy — would permanently burn the "already migrated"
    /// flag against a source that never got a chance to run. (This is one
    /// of two belts fixing the same hazard; the other is
    /// `AppGroup.shouldRunAppOnlyMigration`, which stops the widget
    /// extension's *empty* `.standard` from ever reaching this function as
    /// `old` in the first place.)
    static func migrateDefaultsIfNeeded(from old: UserDefaults, to new: UserDefaults, keys: [String]) {
        guard !new.bool(forKey: migratedDefaultsFlagKey) else { return }
        guard keys.contains(where: { old.data(forKey: $0) != nil }) else { return }

        for key in keys {
            guard new.data(forKey: key) == nil, let data = old.data(forKey: key) else { continue }
            new.set(data, forKey: key)
        }
        new.set(true, forKey: migratedDefaultsFlagKey)
    }
}
