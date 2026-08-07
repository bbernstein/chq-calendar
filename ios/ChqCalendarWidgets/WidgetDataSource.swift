import Foundation

/// Where every widget provider and `WidgetConfigIntent` option provider
/// reads the app's shared, offline cache from. The widget extension has no
/// network access of its own (see `SharedSnapshotLoader`'s doc comment), so
/// every entry point here goes through the same App Group cache/defaults
/// pair (`DiskCache`/`AppGroup.userDefaults()`) the app itself writes to —
/// there is no widget-specific storage.
///
/// `nonisolated`, matching every other type in the domain/data layer this
/// reads from: the widget target's `SWIFT_DEFAULT_ACTOR_ISOLATION` is
/// `MainActor`, and `TimelineProvider`/`AppIntentTimelineProvider`
/// conformers need to call this from a `nonisolated` context (see
/// `NextUpWidget.swift`'s doc comment).
nonisolated enum WidgetDataSource {
    /// One read of everything a timeline needs to be built from.
    struct Snapshot {
        let events: [Event]
        let favorites: Set<String>
        let availableYears: [Int]
        let year: Int
    }

    /// `AppModel.placeholderYear`'s widget-side twin: the year assumed when
    /// the years manifest hasn't been cached yet (e.g. a widget added to the
    /// Home Screen before the app has ever launched — see the App Group
    /// migration note on `SharedSnapshotLoader`).
    static let fallbackYear = 2026

    /// Reads everything `WidgetTimelineBuilder.timeline` needs, tolerating a
    /// cold cache at every step (each `SharedSnapshotLoader` call already
    /// degrades to empty/nil on its own).
    static func loadSnapshot(now: Date) -> Snapshot {
        let cache = DiskCache(directory: AppGroup.cacheDirectory())
        let defaults = AppGroup.userDefaults()
        let manifest = SharedSnapshotLoader.loadYears(cache: cache)
        let year = manifest?.defaultYear ?? fallbackYear
        let years = manifest?.years ?? [year]
        let events = SharedSnapshotLoader.loadEvents(year: year, cache: cache)
        let favorites = SharedSnapshotLoader.loadFavorites(defaults: defaults, now: now)
        return Snapshot(events: events, favorites: favorites, availableYears: years, year: year)
    }

    /// The full slice sequence for `config` as of `now` — what a
    /// `TimelineProvider.getTimeline`/`AppIntentTimelineProvider.timeline`
    /// call maps directly into `WidgetEntry`s.
    static func slices(config: WidgetTimelineBuilder.Config, now: Date) -> [WidgetTimelineBuilder.Slice] {
        let snapshot = loadSnapshot(now: now)
        return WidgetTimelineBuilder.timeline(
            events: snapshot.events,
            favorites: snapshot.favorites,
            config: config,
            availableYears: snapshot.availableYears,
            year: snapshot.year,
            now: now
        )
    }

    /// Just the slice that applies right now — what a `getSnapshot`/
    /// `snapshot(for:in:)` call needs. `WidgetTimelineBuilder.timeline`
    /// always returns at least one slice, so the fallback below never
    /// actually triggers; it exists only so this stays total.
    static func firstSlice(config: WidgetTimelineBuilder.Config, now: Date) -> WidgetTimelineBuilder.Slice {
        slices(config: config, now: now).first ?? WidgetTimelineBuilder.Slice(date: now, state: .empty)
    }

    // MARK: - WidgetConfigIntent options

    /// Distinct `displayLocation` values from the cached default-year
    /// snapshot, most-frequent first (ties broken alphabetically), capped at
    /// `limit`. Empty — never throws or crashes — when there is no cache
    /// yet, which is what makes `VenueOptionsProvider` resilient to a widget
    /// added before the app has ever launched.
    static func venueOptions(limit: Int = 30) -> [String] {
        rankedByFrequency(cachedEvents().compactMap(\.displayLocation), limit: limit)
    }

    /// Distinct category names (excluding `"Week "` markers, matching
    /// `DisplayNames.visibleCategories`'s own filter) from the cached
    /// default-year snapshot, most-frequent first, capped at `limit`.
    static func categoryOptions(limit: Int = 30) -> [String] {
        let names = cachedEvents().flatMap { event in
            event.categoryNames.filter { !$0.hasPrefix("Week ") }
        }
        return rankedByFrequency(names, limit: limit)
    }

    private static func cachedEvents() -> [Event] {
        let cache = DiskCache(directory: AppGroup.cacheDirectory())
        let year = SharedSnapshotLoader.loadYears(cache: cache)?.defaultYear ?? fallbackYear
        return SharedSnapshotLoader.loadEvents(year: year, cache: cache)
    }

    /// Distinct values of `values`, most-frequent first, ties broken
    /// alphabetically for a stable order, capped at `limit`.
    private static func rankedByFrequency(_ values: [String], limit: Int) -> [String] {
        var counts: [String: Int] = [:]
        for value in values {
            counts[value, default: 0] += 1
        }
        return counts.keys
            .sorted { lhs, rhs in
                let (lc, rc) = (counts[lhs] ?? 0, counts[rhs] ?? 0)
                return lc != rc ? lc > rc : lhs < rhs
            }
            .prefix(limit)
            .map { $0 }
    }

    // MARK: - Placeholder sample content

    /// Hardcoded sample events for `placeholder(in:)` and gallery previews.
    /// Never read from the cache — the widget gallery needs something
    /// plausible to render before any real data exists (or while a
    /// `context.isPreview` snapshot is requested), and `placeholder(in:)`
    /// itself is synchronous, so it can't read the (already-fast, but not
    /// instant) disk cache anyway.
    static let sampleEvents: [WidgetTimelineBuilder.EventSummary] = [
        WidgetTimelineBuilder.EventSummary(
            id: "sample-1", title: "Morning Lecture", venue: "Amphitheater",
            start: Date().addingTimeInterval(3600)
        ),
        WidgetTimelineBuilder.EventSummary(
            id: "sample-2", title: "Chautauqua Symphony Orchestra", venue: "Amphitheater",
            start: Date().addingTimeInterval(7200)
        ),
        WidgetTimelineBuilder.EventSummary(
            id: "sample-3", title: "Evening Concert", venue: "Hall of Philosophy",
            start: Date().addingTimeInterval(10800)
        )
    ]
}
