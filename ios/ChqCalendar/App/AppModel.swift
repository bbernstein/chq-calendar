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

    var snapshot: CalendarSnapshot? {
        didSet {
            normalizePersistedFilterCasing()
            rebuildFacetCounts()
        }
    }

    /// Per-venue / per-category event counts for the current selection.
    ///
    /// Rebuilt only when an input actually changes — the snapshot, the
    /// filter, the favorites set, or the year — never on render. Each
    /// rebuild is two `EventFilter.apply` passes over the snapshot (see
    /// `FacetCounts`), which is affordable at that cadence and would not be
    /// per-render.
    private(set) var facetCounts: FacetCounts = .empty

    /// The user's most-recently-used venue and category filters.
    private(set) var recents: RecentFilters

    var phase: Phase = .launching

    var filter: FilterSelection {
        didSet {
            guard filter != oldValue else { return }
            rebuildFacetCounts()
        }
    }

    var favorites: Set<String> {
        didSet {
            guard favorites != oldValue else { return }
            rebuildFacetCounts()
        }
    }

    var selectedYear: Int {
        didSet {
            guard selectedYear != oldValue else { return }
            rebuildFacetCounts()
        }
    }

    var years: [Int] = []

    var defaultYear: Int {
        didSet {
            guard defaultYear != oldValue else { return }
            rebuildFacetCounts()
        }
    }

    var isRefreshing: Bool = false

    /// Set whenever a `refresh(force:)` call fails. Distinct from `phase`,
    /// which stays `.ready` (data preserved) on a failed background refresh
    /// when a snapshot already exists — this flag is what drives showing a
    /// transient offline banner over otherwise-good, possibly-stale data.
    var lastRefreshFailed: Bool = false

    private let repository: EventRepository
    private let store: UserStateStore

    /// The injected clock. Exposed (rather than private) so views computing
    /// time-relative presentation — `DateFilterSheet`'s past/current week
    /// styling —
    /// use the same instant the filter pipeline does, and so tests can pin
    /// both together.
    let now: @Sendable () -> Date

    /// The most recent non-nil `remoteVersion()` observed, used by
    /// `foregrounded()` to detect a new deploy.
    private var lastSeenRemoteVersion: String?

    /// Years with a non-forced `refresh(force:)` currently in flight. Scoped
    /// per-year (rather than one global flag) so that switching to a year
    /// with no cache while another year's refresh is still in flight can
    /// start its own refresh instead of being starved by a same-process
    /// dedupe check for an unrelated year. `isRefreshing` mirrors
    /// `!refreshingYears.isEmpty` for the UI, which only needs to know
    /// "is *anything* in flight."
    private var refreshingYears: Set<Int> = []

    init(repository: EventRepository, store: UserStateStore, now: @escaping @Sendable () -> Date = { Date() }) {
        self.repository = repository
        self.store = store
        self.now = now
        self.filter = store.loadFilters() ?? FilterSelection()
        self.favorites = store.loadFavorites()
        self.recents = store.loadRecents()
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
                phase = .launching
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
    ///
    /// Two guards protect against races inherent in an `async` call that
    /// mutates shared state after an arbitrarily-long `await`:
    /// - Reentrancy, scoped per-year: a non-forced `refresh` already in
    ///   flight for `requestedYear` makes a second non-forced call for that
    ///   *same* year a no-op, rather than starting a second overlapping
    ///   network round trip. This is deliberately per-year rather than
    ///   global — a global flag would let an in-flight refresh for year A
    ///   silently starve a `select(year: B)` to a cache-less year B, since
    ///   B's own follow-up refresh would no-op against A's still-in-flight
    ///   one and B would be stuck showing nothing. A `force: true` call
    ///   (pull-to-refresh) always bypasses the dedupe — user intent, and
    ///   any resulting double-fetch is harmless (ETag-conditional).
    /// - Year affinity: `selectedYear` is captured as `requestedYear` before
    ///   the await. If the user switches years (via `select(year:)`) while
    ///   this call is still in flight, its eventual result — for a year
    ///   that's no longer selected — is discarded instead of clobbering
    ///   whatever `select(year:)` already put in `snapshot`.
    func refresh(force: Bool) async {
        let requestedYear = selectedYear
        if !force && refreshingYears.contains(requestedYear) {
            return
        }
        refreshingYears.insert(requestedYear)
        isRefreshing = true
        defer {
            refreshingYears.remove(requestedYear)
            isRefreshing = !refreshingYears.isEmpty
        }

        do {
            let result = try await repository.refresh(year: requestedYear, force: force)
            guard requestedYear == selectedYear else { return }
            snapshot = result
            phase = .ready
            lastRefreshFailed = false
        } catch {
            guard requestedYear == selectedYear else { return }
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

    /// Selects a date scope, clearing any week selection: the scope row and
    /// the week strip are two ways of expressing one date range, never two
    /// ranges to intersect.
    ///
    /// Re-tapping the active scope is a no-op. The web toggles back to
    /// "all" here, but it has no All button; iOS does, so the scope row
    /// behaves as a radio group instead.
    func selectScope(_ scope: DateScope) {
        guard filter.dateScope != scope || !filter.selectedWeeks.isEmpty else { return }
        filter.dateScope = scope
        filter.selectedWeeks = []
        persistFilter()
    }

    /// Mirrors the web's `handleWeekTap` (frontend/src/hooks/useScrollState.ts).
    func selectWeek(_ n: Int) {
        if n == currentWeek, filter.selectedWeeks.isEmpty {
            // The current week *is* "This Week" — same range, so store it as
            // the scope and let both chips light up.
            filter.dateScope = .thisWeek
        } else if filter.dateScope != .all {
            // A relative scope was active and the user picked a different
            // week: the week replaces the scope rather than narrowing it.
            filter.dateScope = .all
            filter.selectedWeeks = [n]
        } else if filter.selectedWeeks.contains(n) {
            filter.selectedWeeks.remove(n)
        } else {
            filter.selectedWeeks.insert(n)
        }
        persistFilter()
    }

    /// Toggles `name` in `filter.selectedLocations`, storing the original
    /// casing and comparing case-insensitively — the web's `toggleInList`.
    /// Selecting (not deselecting) also promotes `name` to the front of
    /// recents, matching `useFilterState`'s TOGGLE_LOCATION case.
    func toggleLocation(_ name: String) {
        let wasSelected = isSelected(name, in: .venues)
        filter.selectedLocations = Self.toggling(name, in: filter.selectedLocations)
        if !wasSelected {
            recents.locations = RecentFilters.adding(name, to: recents.locations)
            store.saveRecents(recents)
        }
        persistFilter()
    }

    /// Toggles `name` in `filter.selectedCategories`. See `toggleLocation`.
    func toggleCategory(_ name: String) {
        let wasSelected = isSelected(name, in: .categories)
        filter.selectedCategories = Self.toggling(name, in: filter.selectedCategories)
        if !wasSelected {
            recents.categories = RecentFilters.adding(name, to: recents.categories)
            store.saveRecents(recents)
        }
        persistFilter()
    }

    // MARK: Facet-generic accessors
    //
    // `FacetChipCloud` is one view driving either facet, so it reaches the
    // model through these rather than branching on the facet itself.

    /// Every venue/category present in the current snapshot, original
    /// casing, sorted by display name.
    func available(_ facet: FilterFacet) -> [String] {
        switch facet {
        case .venues: return visibleLocations
        case .categories: return visibleCategories
        }
    }

    /// Named `recentNames` rather than `recents(_:)` so it can't be misread
    /// against the `recents` property it reads from.
    func recentNames(_ facet: FilterFacet) -> [String] {
        switch facet {
        case .venues: return recents.locations
        case .categories: return recents.categories
        }
    }

    func isSelected(_ name: String, in facet: FilterFacet) -> Bool {
        let key = name.lowercased()
        switch facet {
        case .venues: return filter.selectedLocations.contains { $0.lowercased() == key }
        case .categories: return filter.selectedCategories.contains { $0.lowercased() == key }
        }
    }

    func toggle(_ name: String, in facet: FilterFacet) {
        switch facet {
        case .venues: toggleLocation(name)
        case .categories: toggleCategory(name)
        }
    }

    func count(for name: String, in facet: FilterFacet) -> Int {
        let key = name.lowercased()
        switch facet {
        case .venues: return facetCounts.locations[key] ?? 0
        case .categories: return facetCounts.categories[key] ?? 0
        }
    }

    /// How many of `facet`'s values are currently selected, for the row
    /// label ("Venues (2)").
    func selectedCount(_ facet: FilterFacet) -> Int {
        switch facet {
        case .venues: return filter.selectedLocations.count
        case .categories: return filter.selectedCategories.count
        }
    }

    /// Removes every case-insensitive match of `name`, or appends `name`
    /// (original casing) when there is none. Appending — rather than
    /// inserting — is what keeps the chip row in selection order.
    private static func toggling(_ name: String, in list: [String]) -> [String] {
        let key = name.lowercased()
        if list.contains(where: { $0.lowercased() == key }) {
            return list.filter { $0.lowercased() != key }
        }
        return list + [name]
    }

    func toggleFavoritesOnly() {
        filter.showFavoritesOnly.toggle()
        persistFilter()
    }

    /// "Show all events" — clears every filter, including the search term
    /// and `extraDays`, and drops the scope to `.all`. Mirrors the web's
    /// CLEAR_FILTERS.
    ///
    /// This deliberately clears `searchText`, which the previous
    /// `clearFilters()` preserved. That preservation only made sense while
    /// the term had no visible representation; now it is a chip in the reset
    /// row and individually removable, so leaving it behind after "Clear
    /// all" would be the surprising behavior.
    func clearAll() {
        filter = FilterSelection(dateScope: .all)
        persistFilter()
    }

    /// "Keep dates, show all" — clears search, venues, categories, and
    /// favorites-only, leaving the date scope and week selection intact.
    /// Mirrors the web's CLEAR_NON_DATE_FILTERS.
    func clearNonDateFilters() {
        filter.searchText = ""
        filter.selectedLocations = []
        filter.selectedCategories = []
        filter.showFavoritesOnly = false
        persistFilter()
    }

    /// Removes the single filter a reset-row chip represents.
    ///
    /// No `persistFilter()` here: the three toggles persist themselves, and
    /// `searchText` is session-only and never written to disk.
    func remove(_ chip: ActiveFilterChip) {
        switch chip.kind {
        case .search: filter.searchText = ""
        case .location(let name): toggleLocation(name)
        case .category(let name): toggleCategory(name)
        case .favorites: toggleFavoritesOnly()
        }
    }

    func showNextDay() {
        filter.extraDays += 1
    }

    private func persistFilter() {
        store.saveFilters(filter)
    }

    /// Recomputes `facetCounts` against the current selection.
    ///
    /// `normalizePersistedFilterCasing()` can mutate `filter`, whose own
    /// `didSet` calls back into here — so loading a snapshot may rebuild
    /// twice. That is one extra pass, once, on snapshot load; the result is
    /// identical either way, and suppressing it would need a re-entrancy
    /// flag that costs more clarity than the pass costs time.
    private func rebuildFacetCounts() {
        guard let snapshot else {
            facetCounts = .empty
            return
        }
        facetCounts = FacetCounts.build(
            events: snapshot.events,
            selection: filter,
            favorites: favorites,
            now: now(),
            year: selectedYear,
            isCurrentYear: isCurrentYear)
    }

    /// Persisted `selectedLocations`/`selectedCategories` may carry different
    /// casing than the feed currently serves — most concretely, a build
    /// prior to this branch stored them lowercased (see
    /// `UserStateStoreTests.legacyLowercasedPayloadStillDecodes`), and
    /// `FilterSelection` now stores original casing instead, with
    /// lowercasing applied only at the point of comparison
    /// (`EventFilter.apply`, `isSelected`, `count(for:in:)`). Filtering
    /// itself is correct either way, but `ActiveFilterChips.build` passes
    /// the persisted string straight into `DisplayNames.location`/
    /// `.category`, which do an *exact*-match lookup and silently fall
    /// through unchanged on a case mismatch — so a lowercased legacy name
    /// would render as a raw lowercase chip (and skip shortcuts like "Lenna
    /// Hall"/"CSO") until the user toggled the filter off/on or hit "Clear
    /// all". Called from `snapshot`'s `didSet` so this is corrected on the
    /// very first launch after upgrading, not just after the next
    /// interaction — `visibleLocations`/`visibleCategories` read the new
    /// `snapshot` value, which `didSet` runs after assigning.
    private func normalizePersistedFilterCasing() {
        guard snapshot != nil else { return }
        let normalizedLocations = Self.normalizedCasing(filter.selectedLocations, against: visibleLocations)
        let normalizedCategories = Self.normalizedCasing(filter.selectedCategories, against: visibleCategories)
        guard normalizedLocations != filter.selectedLocations || normalizedCategories != filter.selectedCategories else {
            return
        }
        filter.selectedLocations = normalizedLocations
        filter.selectedCategories = normalizedCategories
        persistFilter()
    }

    /// Replaces each of `names` with the entry in `canonical` it
    /// case-insensitively matches, if any — order and any non-matching
    /// entries are preserved untouched.
    private static func normalizedCasing(_ names: [String], against canonical: [String]) -> [String] {
        guard !canonical.isEmpty else { return names }
        let byLowercased = Dictionary(canonical.map { ($0.lowercased(), $0) }, uniquingKeysWith: { first, _ in first })
        return names.map { byLowercased[$0.lowercased()] ?? $0 }
    }

    #if DEBUG
    // MARK: UI-test hooks (DEBUG only)

    /// Shared flags/lookups consumed by `CalendarView`, `EventListView`, and
    /// `EventDetailView` to make interactive states reachable for
    /// screenshot-based verification when `xcrun simctl` can't synthesize a
    /// tap (see task-12 brief). This whole section compiles out of Release
    /// builds.

    /// Set by `CalendarView` on launch when `-uitest-show-filters` is
    /// present. Its consumer — the four-row `FilterBarView` — is gone; the
    /// flag is deliberately kept for the follow-up task that rewires it to
    /// present `FilterSheet` from `EventListView`, so nothing reads it right
    /// now.
    var uiTestShowFilters = false

    /// Set by `CalendarView` on launch when `-uitest-show-add-to-calendar`
    /// is present; consumed (and reset) by `EventDetailView.onAppear`.
    var uiTestShowAddToCalendar = false

    /// The linked-content-richest event in the current snapshot — the
    /// deterministic target for `-uitest-select-linked-event` /
    /// `-uitest-show-add-to-calendar` / `-uitest-scroll-to-articles`.
    ///
    /// Deliberately picks the *richest* event with article links (longest
    /// `details`, then most links) rather than merely the first one found.
    /// The detail screenshot pair (`04-detail` / `05-articles`) only differs
    /// by scroll position, and on iPad's wide `NavigationSplitView` detail
    /// column, body text wraps into far fewer lines than on iPhone for the
    /// same character count — a short-description event's full detail view
    /// (hero image + metadata + description + links + buttons) can render
    /// with no overflow at all, making `scrollTo` a no-op and the two shots
    /// byte-identical. Picking the richest available content makes the
    /// detail view reliably taller than the tallest on-screen viewport
    /// across both device sizes, so the scroll always has somewhere to go.
    var uiTestFirstLinkedEvent: Event? {
        snapshot?.events
            .filter { !articleLinks(for: $0.id).isEmpty }
            .max { lhs, rhs in
                uiTestContentWeight(lhs) < uiTestContentWeight(rhs)
            }
    }

    /// Rough proxy for an event's rendered detail-view height: description
    /// length dominates real-world variance (up to ~7000 characters seen in
    /// production data) but a per-link weight is added so an event with many
    /// short links isn't undervalued against one with a single long
    /// description.
    private func uiTestContentWeight(_ event: Event) -> Int {
        (event.details?.count ?? 0) + articleLinks(for: event.id).count * 400
    }
    #endif
}
