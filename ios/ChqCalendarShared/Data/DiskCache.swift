import Foundation

/// Metadata persisted alongside a cached payload: the HTTP validator (if
/// any) and the time the payload was last considered fetched, which gates
/// freshness checks via `CacheEntry.isFresh`.
nonisolated struct CacheMetadata: Codable, Sendable {
    var etag: String?
    var fetchedAt: Date
}

/// An in-memory view of a cached payload plus its metadata, as returned by
/// `DataCaching.read`.
nonisolated struct CacheEntry: Sendable {
    let data: Data
    let metadata: CacheMetadata

    /// Whether this entry is still within `ttl` seconds of its
    /// `fetchedAt`, as of `now`.
    func isFresh(ttl: TimeInterval, now: Date) -> Bool {
        now.timeIntervalSince(metadata.fetchedAt) < ttl
    }
}

/// A simple key-addressed cache for raw payload bytes plus etag/fetchedAt
/// metadata.
nonisolated protocol DataCaching: Sendable {
    /// Reads the payload and metadata for `key`, or `nil` if either file is
    /// missing or unreadable/corrupt.
    func read(_ key: String) -> CacheEntry?

    /// Writes `data` and its metadata for `key`, overwriting any existing
    /// entry.
    func write(_ key: String, data: Data, etag: String?, fetchedAt: Date)

    /// Updates only the `fetchedAt` metadata for `key`, leaving the payload
    /// and etag untouched. No-op if `key` has no existing entry.
    func touch(_ key: String, fetchedAt: Date)

    /// Removes the payload and metadata for `key`, if present.
    func remove(_ key: String)
}

/// Filesystem-backed `DataCaching` implementation.
///
/// Stores a payload file `<key>.json` and a metadata sidecar
/// `<key>.meta.json` inside `directory`. Holds no mutable state of its own
/// — every call reads or writes the filesystem directly under `directory`
/// — so the type is trivially `Sendable` as a plain struct.
///
/// All methods tolerate a missing or corrupt cache directory/files: `read`
/// returns `nil` rather than throwing, and `write`/`touch`/`remove` no-op on
/// failure instead of propagating errors.
///
/// `key` is an internal cache identifier chosen by the caller (e.g.
/// `"events-2026"`), not user input — but it is still sanitized before use
/// as a filename component, so stray path separators (`/`, `..`) can never
/// escape `directory`.
nonisolated struct DiskCache: DataCaching {
    let directory: URL

    init(directory: URL) {
        self.directory = directory
    }

    /// The app's cache location: the App Group's `chq-data/` directory
    /// when the App Group entitlement is present (so a future widget
    /// extension can share it), else the legacy `Library/Caches/chq-data/`
    /// path. Runs the one-time legacy-file migration exactly once per
    /// process launch via `didMigrate`.
    static func standard() -> DiskCache {
        _ = didMigrate
        return DiskCache(directory: AppGroup.cacheDirectory())
    }

    /// Lazily migrates legacy cache files into the App Group directory the
    /// first time `standard()` is called in this process. A `static let`
    /// is used (rather than a mutable flag) because Swift initializes
    /// globals/statics exactly once, thread-safely, which keeps this type
    /// trivially `Sendable` without needing actor isolation or a lock.
    private static let didMigrate: Bool = {
        guard let container = AppGroup.containerURL() else { return true }
        let fileManager = FileManager.default
        AppGroup.migrateIfNeeded(
            fileManager: fileManager,
            from: AppGroup.legacyCacheDirectory(fileManager: fileManager),
            to: container.appending(path: "chq-data")
        )
        return true
    }()

    private static let metadataEncoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    private static let metadataDecoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()

    /// Sanitizes `key` for use as a filename component: any character
    /// outside `[A-Za-z0-9._-]` is replaced with `_`, so a key like
    /// `"../escape"` can never resolve outside `directory`.
    private func fileName(for key: String) -> String {
        String(key.map { char in
            switch char {
            case "a"..."z", "A"..."Z", "0"..."9", ".", "_", "-":
                return char
            default:
                return "_"
            }
        })
    }

    private func payloadURL(for key: String) -> URL {
        directory.appending(path: "\(fileName(for: key)).json")
    }

    private func metadataURL(for key: String) -> URL {
        directory.appending(path: "\(fileName(for: key)).meta.json")
    }

    func read(_ key: String) -> CacheEntry? {
        let fm = FileManager.default
        guard
            let data = fm.contents(atPath: payloadURL(for: key).path),
            let metaData = fm.contents(atPath: metadataURL(for: key).path),
            let metadata = try? Self.metadataDecoder.decode(CacheMetadata.self, from: metaData)
        else {
            return nil
        }
        return CacheEntry(data: data, metadata: metadata)
    }

    func write(_ key: String, data: Data, etag: String?, fetchedAt: Date) {
        let fm = FileManager.default
        guard let metaData = try? Self.metadataEncoder.encode(CacheMetadata(etag: etag, fetchedAt: fetchedAt))
        else {
            return
        }
        try? fm.createDirectory(at: directory, withIntermediateDirectories: true)

        // Fail-safe ordering: remove the metadata sidecar *before* writing
        // the new payload, and only write the new metadata *after* the
        // payload write succeeds. Each of these three steps can fail
        // independently (crash, disk full, etc.), but this ordering
        // guarantees the only states an interruption can leave behind are
        // "no metadata" (old or new payload present) — which `read`
        // already treats as `nil` — never a *stale* metadata file paired
        // with a *new* payload.
        try? fm.removeItem(at: metadataURL(for: key))
        try? data.write(to: payloadURL(for: key), options: .atomic)
        try? metaData.write(to: metadataURL(for: key), options: .atomic)
    }

    func touch(_ key: String, fetchedAt: Date) {
        let fm = FileManager.default
        guard
            let metaData = fm.contents(atPath: metadataURL(for: key).path),
            var metadata = try? Self.metadataDecoder.decode(CacheMetadata.self, from: metaData)
        else {
            return
        }
        metadata.fetchedAt = fetchedAt
        guard let newMetaData = try? Self.metadataEncoder.encode(metadata) else { return }
        try? newMetaData.write(to: metadataURL(for: key), options: .atomic)
    }

    func remove(_ key: String) {
        let fm = FileManager.default
        try? fm.removeItem(at: payloadURL(for: key))
        try? fm.removeItem(at: metadataURL(for: key))
    }
}
