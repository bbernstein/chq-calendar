import Foundation

/// Shared-storage coordination for the App Group `group.org.chqcal.app`,
/// which lets the main app and a future widget extension read the same
/// disk cache and `UserDefaults` state.
///
/// Every function here degrades gracefully when the App Group entitlement
/// is absent — unit-test hosts and un-entitled builds fall back to the
/// pre-App-Group legacy paths (`Library/Caches/chq-data` and
/// `UserDefaults.standard`), so nothing here changes behavior for a build
/// that hasn't picked up the entitlement yet.
nonisolated enum AppGroup {
    static let identifier = "group.org.chqcal.app"

    /// Flag key, stored in the *destination* suite passed to
    /// `migrateDefaultsIfNeeded`, that marks the one-time defaults
    /// migration as already having run.
    private static let migratedDefaultsFlagKey = "chq-group-migrated"

    /// The shared container for the App Group, or `nil` if the running
    /// process lacks the `com.apple.security.application-groups`
    /// entitlement (unit-test hosts, un-entitled builds).
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
    static func migrateDefaultsIfNeeded(from old: UserDefaults, to new: UserDefaults, keys: [String]) {
        guard !new.bool(forKey: migratedDefaultsFlagKey) else { return }

        for key in keys {
            guard new.data(forKey: key) == nil, let data = old.data(forKey: key) else { continue }
            new.set(data, forKey: key)
        }
        new.set(true, forKey: migratedDefaultsFlagKey)
    }
}
