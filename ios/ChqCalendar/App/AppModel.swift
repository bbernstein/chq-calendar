import Foundation
import Observation

/// The app's single source of truth: owns the currently-loaded calendar
/// snapshot, the user's filter/favorite state, and every action a view can
/// trigger. `@MainActor` because it's read and mutated directly by SwiftUI
/// views; the actual data fetching/decoding/caching happens off-actor in
/// `EventRepository`, which this type merely calls into and awaits.
@Observable
@MainActor
final class AppModel {
    /// Coarse lifecycle state for the root list view.
    ///
    /// `.ready` means "we have a snapshot to show" — it does not imply the
    /// most recent refresh succeeded; see `lastRefreshFailed` for that.
    /// `.offline` means "no snapshot at all, and the last attempt to get one
    /// failed" (first launch with no network). `.failed` is reserved for a
    /// snapshot-less failure worth surfacing a specific message for (e.g. a
    /// decoding error), distinct from a plain connectivity failure.
    enum Phase: Equatable {
        case launching
        case ready
        case offline
        case failed(String)
    }

    /// The year guessed at construction time, before the years manifest has
    /// ever been fetched. Chosen to match `EventRepository.availableYears()`'s
    /// own ultimate fallback, so an offline-first-launch never disagrees with
    /// itself about "the current year."
    private static let placeholderYear = 2026

    // MARK: - State

    var snapshot: CalendarSnapshot?
    var phase: Phase = .launching
    var filter: FilterSelection
    var favorites: Set<String>
    var selectedYear: Int
    var years: [Int] = []
    var defaultYear: Int
    var isRefreshing: Bool = false

    /// Set whenever a `refresh(force:)` call fails. Distinct from `phase`,
    /// which stays `.ready` (data preserved) on a failed background refresh
    /// when a snapshot already exists — this flag is what drives showing a
    /// transient offline banner over otherwise-good, possibly-stale data.
    var lastRefreshFailed: Bool = false

    private let repository: EventRepository
    private let store: UserStateStore
    private let now: @Sendable () -> Date

    /// The most recent non-nil `remoteVersion()` observed, used by
    /// `foregrounded()` to detect a new deploy.
    private var lastSeenRemoteVersion: String?

    init(repository: EventRepository, store: UserStateStore, now: @escaping @Sendable () -> Date = { Date() }) {
        self.repository = repository
        self.store = store
        self.now = now
        self.filter = store.loadFilters() ?? FilterSelection()
        self.favorites = store.loadFavorites()
        self.selectedYear = Self.placeholderYear
        self.defaultYear = Self.placeholderYear
    }

    // MARK: - Derived

    /// The events currently shown, filtered then grouped by NY calendar day.
    /// Recomputed on every access rather than cached — at ~1.6k events this
    /// is cheap enough that memoization isn't worth the extra state.
    var dayGroups: [DayGroup] {
        guard let snapshot else { return [] }
        let filtered = EventFilter.apply(
            filter,
            to: snapshot.events,
            favorites: favorites,
            now: now(),
            year: selectedYear,
            isCurrentYear: isCurrentYear
        )
        return EventGrouping.byDay(filtered, year: selectedYear)
    }

    var visibleCategories: [String] {
        guard let snapshot else { return [] }
        return DisplayNames.visibleCategories(from: snapshot.events)
    }

    var visibleLocations: [String] {
        guard let snapshot else { return [] }
        return DisplayNames.visibleLocations(from: snapshot.events)
    }

    var themes: [WeeklyTheme] {
        snapshot?.themes ?? []
    }

    var currentWeek: Int? {
        SeasonCalendar.currentWeekNumber(at: now(), year: selectedYear)
    }

    var isCurrentYear: Bool { selectedYear == defaultYear }

    /// Days remaining until `defaultYear`'s season starts, or `nil` unless
    /// we're both viewing the current year and still before its season
    /// start.
    var countdownDays: Int? {
        guard isCurrentYear else { return nil }
        let start = SeasonCalendar.seasonStart(year: defaultYear)
        let current = now()
        guard current < start else { return nil }
        let days = ChqTime.calendar.dateComponents([.day], from: current, to: start).day ?? 0
        return max(days, 0)
    }

    func articleLinks(for eventID: String) -> [ArticleLink] {
        snapshot?.articleLinks[eventID] ?? []
    }

    func theme(forWeek n: Int) -> WeeklyTheme? {
        themes.first { $0.number == n }
    }

    // MARK: - Actions

    /// Loads whatever's on disk immediately (so the UI can render right
    /// away if a cached snapshot exists), then fetches the years manifest,
    /// then refreshes if the cached snapshot is missing or stale.
    func start() async {
        if let cached = await repository.cachedSnapshot(year: selectedYear) {
            snapshot = cached
            phase = .ready
        }

        let manifest = await repository.availableYears()
        years = manifest.years
        defaultYear = manifest.defaultYear

        if selectedYear != manifest.defaultYear {
            selectedYear = manifest.defaultYear
            if let cached = await repository.cachedSnapshot(year: selectedYear) {
                snapshot = cached
                phase = .ready
            } else {
                snapshot = nil
            }
        }

        if await repository.needsRefresh(year: selectedYear, now: now()) {
            await refresh(force: false)
        }
    }

    /// Revalidates the currently-selected year against the network.
    /// On success, replaces `snapshot` and marks `.ready`. On failure,
    /// existing data (if any) is preserved and `phase` stays `.ready`;
    /// only a snapshot-less failure moves `phase` to `.offline`.
    func refresh(force: Bool) async {
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            let result = try await repository.refresh(year: selectedYear, force: force)
            snapshot = result
            phase = .ready
            lastRefreshFailed = false
        } catch {
            lastRefreshFailed = true
            if snapshot == nil {
                phase = .offline
            }
        }
    }

    /// Called when the app returns to the foreground. Refreshes only when
    /// there's reason to believe something changed: a new deploy (detected
    /// via `remoteVersion()` differing from the last one we saw) or a
    /// simply-stale cache.
    func foregrounded() async {
        let latest = await repository.remoteVersion()
        var versionChanged = false
        if let latest {
            if let previous = lastSeenRemoteVersion, previous != latest {
                versionChanged = true
            }
            lastSeenRemoteVersion = latest
        }

        let stale = await repository.needsRefresh(year: selectedYear, now: now())
        if versionChanged || stale {
            await refresh(force: false)
        }
    }

    func toggleFavorite(_ id: String) {
        if favorites.contains(id) {
            favorites.remove(id)
        } else {
            favorites.insert(id)
        }
        store.saveFavorites(favorites)
    }

    func select(year: Int) async {
        selectedYear = year
        if let cached = await repository.cachedSnapshot(year: year) {
            snapshot = cached
            phase = .ready
        } else {
            snapshot = nil
            phase = .launching
        }

        if await repository.needsRefresh(year: year, now: now()) {
            await refresh(force: false)
        }
    }

    func setScope(_ s: DateScope) {
        filter.dateScope = s
        persistFilter()
    }

    func toggleWeek(_ n: Int) {
        if filter.selectedWeeks.contains(n) {
            filter.selectedWeeks.remove(n)
        } else {
            filter.selectedWeeks.insert(n)
        }
        persistFilter()
    }

    /// Resets the persisted facets (scope/weeks/locations/categories/
    /// favorites-only) back to their defaults. `searchText`/`extraDays` are
    /// session-only and deliberately left untouched — clearing filters
    /// shouldn't also blow away what the user just typed.
    func clearFilters() {
        filter = FilterSelection(searchText: filter.searchText, extraDays: filter.extraDays)
        persistFilter()
    }

    func showNextDay() {
        filter.extraDays += 1
    }

    private func persistFilter() {
        store.saveFilters(filter)
    }
}
