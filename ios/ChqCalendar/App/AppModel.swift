import Foundation
import Observation
import UserNotifications

/// Everything the **non-date** filters admit, anywhere navigation can reach —
/// the day rail's source of truth.
///
/// The rail spans the navigable bounds, not the current window, so counting
/// from `dayGroups` would mark every day outside the current scope "no events"
/// and make the rail a readout of the filter it exists to navigate past.
///
/// Cached rather than computed on access: building it is a full
/// `EventFilter.apply` pass, and the rail reads it once per chip.
nonisolated struct NavMatching: Equatable, Sendable {
    /// Days with at least one matching event, sorted. Navigation steps
    /// through exactly this set, so a step always lands somewhere that will
    /// render.
    let eventDays: [String]
    /// How many matching events each of `eventDays` holds. A day absent from
    /// this map has none.
    let countsByDay: [String: Int]
    /// The outer limit of everything navigation can reach.
    let bounds: ClosedRange<String>
}

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
            rebuildDerivedCounts()
        }
    }

    /// Per-venue / per-category event counts for the current selection.
    ///
    /// Rebuilt only when an input actually changes — the snapshot, the
    /// filter, the favorites set, or the year — never on render. Each
    /// rebuild is two `EventFilter.apply` passes over the snapshot (see
    /// `FacetCounts`), plus a third for `navMatching` alongside it (see
    /// `rebuildDerivedCounts`), which together are affordable at that
    /// cadence and would not be per-render.
    private(set) var facetCounts: FacetCounts = .empty

    /// See `NavMatching`. `nil` until a snapshot exists — there is no rail to
    /// draw before then.
    private(set) var navMatching: NavMatching?

    /// The user's most-recently-used venue and category filters.
    private(set) var recents: RecentFilters

    var phase: Phase = .launching

    var filter: FilterSelection {
        didSet {
            guard filter != oldValue else { return }
            rebuildDerivedCounts()
        }
    }

    var favorites: Set<String> {
        didSet {
            guard favorites != oldValue else { return }
            rebuildDerivedCounts()
        }
    }

    /// The user's reminder preferences (season-wide default preset plus
    /// per-event overrides). Read-only from outside: mutate it only through
    /// `setDefaultReminderPreset`/`setReminderOverride`, which persist the
    /// change and re-sync `reminderCenter` in the same step — a bare
    /// `didSet` here (mirroring `filter`/`favorites`) would only know
    /// *that* something changed, not what to tell `UserStateStore.saveReminderSettings`
    /// or `reminderCenter.sync` beyond "the whole struct", which is fine for
    /// persistence but would still need an explicit method to kick off the
    /// `async` sync anyway — so the explicit methods below do both jobs at
    /// once instead of splitting them across a `didSet` and a caller.
    private(set) var reminderSettings: ReminderSettings

    /// The system notification authorization status, as last observed by
    /// this model. `nil` until the first query resolves (either
    /// `refreshReminderAuthorizationStatus()` or `ensureReminderAuthorization()`)
    /// or when there is no `reminderCenter` at all — deliberately distinct
    /// from `.notDetermined`, which is a real system answer, not "unknown."
    ///
    /// This is the single source of truth `EventDetailView`'s "denied"
    /// hint reads (#178 review fix): every path that can change the real
    /// authorization state — the in-flow ask from `toggleFavorite`
    /// (`requestReminderAuthorizationIfNeeded`), the "Remind me" menu's own
    /// ask (`ensureReminderAuthorization`), and a plain re-query (
    /// `refreshReminderAuthorizationStatus`, called on `.task` and on
    /// returning to the foreground) — writes here, so the view never has to
    /// separately remember to refresh a private copy.
    private(set) var reminderAuthorizationStatus: UNAuthorizationStatus?

    var selectedYear: Int {
        didSet {
            guard selectedYear != oldValue else { return }
            rebuildDerivedCounts()
        }
    }

    var years: [Int] = []

    var defaultYear: Int {
        didSet {
            guard defaultYear != oldValue else { return }
            rebuildDerivedCounts()
        }
    }

    var isRefreshing: Bool = false

    /// Set by any deep-link entry point — `.onOpenURL` (task 3), a
    /// notification tap (task 8), a widget's `widgetURL` (task 11), an App
    /// Intent (task 12), or Spotlight (task 13) — and consumed in two
    /// stages since the tab shell landed (task 16):
    /// - `RootTabView` switches to the link's tab for every kind, and fully
    ///   consumes `.myDay`/`.map` there (a `.map` venue surviving as
    ///   `mapFocusVenue` below).
    /// - `.event` stays pending for `CalendarView`, via
    ///   `resolvePendingEventDeepLinkIfPossible()` below: it can arrive
    ///   before the snapshot has loaded, so it stays pending across `phase`/
    ///   `snapshot` changes until the target event is found (or the snapshot
    ///   is loaded, no refresh that could still surface the event is in
    ///   flight, and it's confirmed unknown).
    /// - `.day` likewise stays pending, for `EventListView` (task 12,
    ///   phase 4), via `resolvePendingDayDeepLinkIfPossible()` below: the
    ///   day key needs no lookup, but navigating to it does need a snapshot
    ///   (`goToDay` bounds against it), so the link waits exactly as long.
    ///   `EventListView` hosts those triggers on its `body`, not on the list
    ///   it may not be rendering — see its own comment there.
    var pendingDeepLink: DeepLink?

    /// The venue a consumed `chqcal://map/<venue>` deep link asked to focus
    /// (task 16) — `RootTabView` writes it (including writing `nil` for a
    /// plain `chqcal://map`, which clears any stale earlier focus), and
    /// `GroundsMapView` (task 18) reads it, focuses the venue, and clears
    /// it back to `nil` once acted on. Distinct from `pendingDeepLink` so
    /// the "which tab" decision and the "what the map should do when it
    /// gets there" payload have independent lifetimes.
    var mapFocusVenue: String?

    /// Set whenever a `refresh(force:)` call fails. Distinct from `phase`,
    /// which stays `.ready` (data preserved) on a failed background refresh
    /// when a snapshot already exists — this flag is what drives showing a
    /// transient offline banner over otherwise-good, possibly-stale data.
    var lastRefreshFailed: Bool = false

    private let repository: EventRepository
    private let store: UserStateStore

    /// Schedules/cancels local notifications for favorited events. `nil` by
    /// default so every existing call site and test that constructs an
    /// `AppModel` without knowing about reminders at all keeps working
    /// unchanged; `enqueueReminderSync()` below is a no-op whenever this is
    /// `nil`. Only `ChqCalendarApp` (and reminder-specific tests) pass a
    /// real one.
    let reminderCenter: ReminderCenter?

    /// Reloads Home Screen/Lock Screen widget timelines after a data change
    /// that could affect them. `nil` by default — same rationale as
    /// `reminderCenter` above — so no existing call site or test needs to
    /// know about `WidgetKit` at all; only `ChqCalendarApp` passes a real
    /// one.
    private let widgetReloader: WidgetReloading?

    /// Performs a full Spotlight reindex after a data change that could
    /// affect what's searchable. `nil` by default — same rationale as
    /// `reminderCenter`/`widgetReloader` above — so no existing call site or
    /// test needs to know about `SpotlightIndexer`/`CSSearchableIndex` at
    /// all; only `ChqCalendarApp` passes a real one. Review fix (task 13,
    /// Important #2): before this seam existed, every `AppModelTests` run
    /// that exercised a successful `refresh()` also fired a real
    /// `CSSearchableIndex` round trip in the test process.
    private let spotlightIndexer: SpotlightIndexing?

    /// The injected clock — the single instant every time-relative
    /// derivation in the app reads. It drives the filter pipeline's
    /// `.next`/`.today`/`.thisWeek` scopes and `FacetCounts` rebuilds (both
    /// via `EventFilter.apply`), `countdownDays`, and `currentWeek` (which
    /// in turn decides which date chips light up). Exposed rather than
    /// private so any view needing "now" uses the same instant the pipeline
    /// did, and so a test can pin all of them together.
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

    /// The tail of a serial chain of reminder syncs — mirrors
    /// `ReminderCenter`'s own internal `syncChain` one layer up, so that
    /// even the *decision of which state to build a plan from* is
    /// serialized, not just the scheduling calls `ReminderCenter` makes
    /// with whatever plan it's handed. See `enqueueReminderSync()`.
    private var reminderSyncChain: Task<Void, Never>?

    /// Whether a Spotlight reindex `Task` spawned by
    /// `enqueueSpotlightReindex()` is currently running. Paired with
    /// `spotlightReindexQueuedAgain` below to coalesce a burst of triggers
    /// into at most one reindex in flight plus one more queued behind it —
    /// see `enqueueSpotlightReindex()`'s doc comment for why a full
    /// `reminderSyncChain`-style serial chain isn't the right shape here.
    private var isSpotlightReindexInFlight = false

    /// Set when `enqueueSpotlightReindex()` is called while a reindex is
    /// already in flight. Checked when that in-flight reindex finishes: if
    /// set, exactly one more reindex is started (reading `favorites`/
    /// `snapshot`/`selectedYear` fresh at that later point, so it reflects
    /// everything that changed during the run it's following), and the flag
    /// is cleared.
    private var spotlightReindexQueuedAgain = false

    /// Whether `requestReminderAuthorizationIfNeeded()` has already fired a
    /// permission request this launch. See that method's doc comment for
    /// why a plain synchronous flag — not a re-read of
    /// `reminderCenter.authorizationStatus()` on every star — is what makes
    /// "ask once" actually deterministic.
    private var hasRequestedReminderAuthorizationThisLaunch = false

    /// The dataset year this launch is nailed to, or `nil` — every real
    /// launch — for the normal "whatever the years manifest calls default"
    /// behavior.
    ///
    /// Non-nil only under `-uitest-pin-year` in a DEBUG build (see
    /// `launchPinnedYear()`), which is what keeps an App Store screenshot
    /// capture on the 2026 season after the manifest has moved on to a
    /// later one. Freezing the clock with `-uitest-freeze-now` is not
    /// enough on its own: `start()` takes the year from the *manifest*, not
    /// from `now`, so a capture run in March 2027 with only the clock
    /// pinned would render 2027 events under a summer-2026 clock — worse
    /// than pinning nothing (#222).
    private let pinnedYear: Int?

    init(
        repository: EventRepository,
        store: UserStateStore,
        now: @escaping @Sendable () -> Date = { Date() },
        pinnedYear: Int? = nil,
        reminderCenter: ReminderCenter? = nil,
        widgetReloader: WidgetReloading? = nil,
        spotlightIndexer: SpotlightIndexing? = nil
    ) {
        self.repository = repository
        self.store = store
        self.now = now
        self.reminderCenter = reminderCenter
        self.widgetReloader = widgetReloader
        self.spotlightIndexer = spotlightIndexer
        self.filter = store.loadFilters() ?? FilterSelection()
        self.favorites = store.loadFavorites()
        self.recents = store.loadRecents()
        self.reminderSettings = store.loadReminderSettings()
        self.pinnedYear = pinnedYear
        // A pin is in force from construction, not from `start()`: the
        // launching UI reads `selectedYear` before any manifest has been
        // fetched, and a pinned run must never briefly render the
        // placeholder year's state.
        self.selectedYear = pinnedYear ?? Self.placeholderYear
        self.defaultYear = pinnedYear ?? Self.placeholderYear
    }

    // MARK: - Derived

    /// The events currently shown, filtered then grouped by NY calendar day.
    /// Recomputed on every access rather than cached — at ~1.6k events this
    /// is cheap enough that memoization isn't worth the extra state.
    var dayGroups: [DayGroup] {
        EventGrouping.byDay(filteredEvents(filter), year: selectedYear)
    }

    /// How many events the current selection matches — the same number as
    /// summing `dayGroups`, without paying for the grouping pass.
    ///
    /// Both filter sheets' footers ("Show N events") want a count, not
    /// grouped days, and they are presented over `EventListView`, which is
    /// reading `dayGroups` at the same time. Reaching through `dayGroups`
    /// there meant re-running the whole pipeline *and* `EventGrouping.byDay`
    /// for a number that never needed the days. `EventListView`'s own "n of
    /// m" line is a different case and correctly keeps using `dayGroups`:
    /// it already has the grouped days in hand.
    ///
    /// `AppModelTests.matchCountEqualsTheSummedDayGroupCount` pins the two
    /// together so they cannot drift.
    var matchCount: Int {
        filteredEvents(filter).count
    }

    /// How many events the Favorites chip would leave if it were switched
    /// on — i.e. favorites that also satisfy every *other* active filter.
    ///
    /// The raw `favorites.count` was wrong in the same way an unfiltered
    /// facet count is wrong (#152): searching "opera" with five favorites of
    /// which one is opera-related showed "Favorites 5" and yielded one
    /// event. This applies `FacetCounts.build`'s own-dimension-exclusion
    /// rule to the favorites dimension — drop the dimension's current value,
    /// then count with it applied — so the number means the same thing as
    /// every venue and category count beside it in `FilterSheet`.
    ///
    /// Computed on access rather than folded into `facetCounts`: it is a
    /// single scalar read only while the filter sheet is open, so it does
    /// not need to ride along on every rebuild.
    var favoritesMatchCount: Int {
        var selection = filter
        selection.showFavoritesOnly = true
        return filteredEvents(selection).count
    }

    private func filteredEvents(_ selection: FilterSelection) -> [Event] {
        guard let snapshot else { return [] }
        return EventFilter.apply(
            selection,
            to: snapshot.events,
            favorites: favorites,
            now: now(),
            year: selectedYear,
            isCurrentYear: isCurrentYear
        )
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

    /// Whether the season is upcoming, live, or over for `selectedYear`, and
    /// (off-season) when the next one opens — see `LandingState` for why
    /// this exists (#177). Computed from the same `now()`/`selectedYear`/
    /// `isCurrentYear` values `dayGroups` uses, but against a fresh
    /// `FilterSelection()` rather than the user's current `filter`: this has
    /// to answer "would the *default* view have anything to show", which is
    /// a different question than "does the user's current filter have
    /// anything to show" (an empty result from, say, an overly-narrow search
    /// is not the app going empty off-season).
    ///
    /// Without a `snapshot` yet, this deliberately reports `.inSeason` —
    /// meaning "no off-season claim to make" — rather than running
    /// `LandingState.determine` with a count forced to `0`. An offline first
    /// launch (or any snapshot-less state) has no event data to say
    /// anything about the calendar from, and `0` upcoming events for that
    /// reason looks identical to `determine` as `0` upcoming events because
    /// the season is over: mid-July 2026, offline, would otherwise
    /// misreport `.postSeason`. `phase` (`.launching`/`.offline`/`.failed`)
    /// already owns what the screen shows while there's no snapshot; this
    /// property only has something to say once real event data exists.
    var landingState: LandingState {
        guard snapshot != nil else { return .inSeason }
        let upcomingDefaultCount = filteredEvents(FilterSelection()).count
        return LandingState.determine(
            now: now(),
            selectedYear: selectedYear,
            availableYears: years,
            upcomingDefaultCount: upcomingDefaultCount
        )
    }

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

    func programLinks(for eventID: String) -> [ProgramLink] {
        snapshot?.programLinks[eventID] ?? []
    }

    func theme(forWeek n: Int) -> WeeklyTheme? {
        themes.first { $0.number == n }
    }

    /// Every NY calendar day with at least one favorited event in the
    /// current snapshot, sorted ascending — the day chips `MyDayView`
    /// (#181) offers. Thin wrapper over `DayPlan.availableDayKeys`; empty
    /// without a snapshot.
    var myDayAvailableDays: [String] {
        guard let snapshot else { return [] }
        return DayPlan.availableDayKeys(favorites: favorites, events: snapshot.events, year: selectedYear)
    }

    /// The outer limit of the My Day strip — see `DayWindow.bounds`.
    ///
    /// `nil` without a snapshot. Season bounds are computable from
    /// `selectedYear` alone, but until the first snapshot lands
    /// `selectedYear` is still the placeholder year, and a placeholder
    /// season has no business reaching the UI. Mirrors the guard
    /// `myDayAvailableDays` already uses.
    var myDayBounds: ClosedRange<String>? {
        guard snapshot != nil else { return nil }
        return DayWindow.bounds(year: selectedYear, starredDays: myDayAvailableDays)
    }

    /// The slice of `myDayBounds` the strip shows for a given expansion
    /// state — see `DayWindow.make`. An empty window without a snapshot.
    ///
    /// `selectedDay` is threaded straight through to `DayWindow.make` so a
    /// selection reachable only while expanded is never orphaned when the
    /// end it lives in collapses.
    func myDayWindow(showsEarlier: Bool, showsLater: Bool, selectedDay: String? = nil) -> DayWindow {
        guard let bounds = myDayBounds else {
            return DayWindow(
                days: [], canExpandEarlier: false, canExpandLater: false,
                hiddenEarlierCount: 0, hiddenLaterCount: 0)
        }
        return myDayWindow(
            bounds: bounds,
            showsEarlier: showsEarlier,
            showsLater: showsLater,
            selectedDay: selectedDay)
    }

    /// `myDayWindow` for a caller that has already derived `myDayBounds`.
    ///
    /// `myDayBounds` is O(events) and uncached (filter+map+Set+sort over
    /// ~1,470 events). `MyDayView.body` deliberately reads it once into a
    /// local and threads it down; without this overload the day-plan branch
    /// would call the deriving version and pay for a second full pass,
    /// defeating the hoist (#197 item 2).
    func myDayWindow(
        bounds: ClosedRange<String>,
        showsEarlier: Bool,
        showsLater: Bool,
        selectedDay: String? = nil
    ) -> DayWindow {
        DayWindow.make(
            bounds: bounds,
            today: ChqTime.dayKey(for: now()),
            showsEarlier: showsEarlier,
            showsLater: showsLater,
            selectedDay: selectedDay)
    }

    /// Starred-event counts per day, for the chip labels. One pass over the
    /// event list — see `DayPlan.starredCountsByDay` for why this is not
    /// `dayPlan(for:)` called once per visible chip.
    var myDayStarredCounts: [String: Int] {
        guard let snapshot else { return [:] }
        return DayPlan.starredCountsByDay(favorites: favorites, events: snapshot.events)
    }

    /// Which day `MyDayView` opens to by default — see
    /// `DayWindow.defaultSelection`. `nil` on two distinct paths: no
    /// snapshot yet (the guard below), or a snapshot with no favorited days
    /// at all (`DayWindow.defaultSelection`'s own `starredDays.isEmpty`
    /// guard). Either way the view shows its all-season empty state instead.
    ///
    /// Computes `myDayAvailableDays` once and reuses it for both the bounds
    /// and the default-selection call, rather than going through
    /// `myDayBounds` (which would recompute it internally) — avoids walking
    /// the full event list twice per access.
    var myDayDefaultDay: String? {
        guard snapshot != nil else { return nil }
        let starredDays = myDayAvailableDays
        return DayWindow.defaultSelection(
            bounds: DayWindow.bounds(year: selectedYear, starredDays: starredDays),
            today: ChqTime.dayKey(for: now()),
            starredDays: starredDays)
    }

    /// Builds the day plan for `dayKey` from the current snapshot and
    /// favorites. Thin wrapper over `DayPlan.build`; an empty plan (no
    /// items, `nil` bounds, zero counts) without a snapshot.
    func dayPlan(for dayKey: String) -> DayPlan {
        DayPlan.build(dayKey: dayKey, favorites: favorites, events: snapshot?.events ?? [])
    }

    // MARK: - Actions

    /// Loads whatever's on disk immediately (so the UI can render right
    /// away if a cached snapshot exists), then fetches the years manifest,
    /// then refreshes if the cached snapshot is missing or stale.
    func start() async {
        if let cached = await repository.cachedSnapshot(year: selectedYear) {
            snapshot = cached
            phase = .ready
            await enqueueReminderSync()?.value
        }

        let manifest = await repository.availableYears()
        years = manifest.years
        // A pinned launch (`-uitest-pin-year`, DEBUG only) overrides the
        // manifest outright, including its `defaultYear` — the pinned year
        // has to read as *the current season* (`isCurrentYear`), or the
        // shots pick up the archived-season chrome and the downgraded date
        // scope that go with viewing a past year. It is also force-listed
        // among the selectable years, so the year picker cannot end up
        // disagreeing with what is actually on screen if the manifest has
        // already dropped the pinned season.
        let effectiveDefault = pinnedYear ?? manifest.defaultYear
        if let pinnedYear, !years.contains(pinnedYear) {
            years = (years + [pinnedYear]).sorted()
        }
        defaultYear = effectiveDefault

        if selectedYear != effectiveDefault {
            selectedYear = effectiveDefault
            if let cached = await repository.cachedSnapshot(year: selectedYear) {
                snapshot = cached
                phase = .ready
                await enqueueReminderSync()?.value
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
            await enqueueReminderSync()?.value
            widgetReloader?.reloadAll()
            enqueueSpotlightReindex()
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

    /// Resolves a pending `.event(id:)` deep link against the current
    /// snapshot, clearing `pendingDeepLink` and returning the matched
    /// `Event` once it's found — or clearing it (returning `nil`) once the
    /// id is confirmed absent. Non-`.event` links, and an `.event` link with
    /// no snapshot yet, return `nil` without touching `pendingDeepLink`.
    ///
    /// Callers (`CalendarView`) are expected to invoke this on every signal
    /// that could mean "the answer might be different now": `pendingDeepLink`
    /// itself changing, `phase` changing, `isRefreshing` changing, and
    /// `snapshot?.fetchedAt` changing. That last one exists because `phase`
    /// alone is not a reliable "the snapshot changed" signal: a warm launch
    /// with a stale cached snapshot sets `phase = .ready` immediately in
    /// `start()`, and the background `refresh(force:)` it kicks off then
    /// replaces `snapshot` with fresh data while `phase` stays `.ready` the
    /// whole time — same value, so a hypothetical `.onChange(of: phase)`
    /// alone would never fire again. `CalendarSnapshot` isn't `Equatable`
    /// (its `Event` payload and sidecar dictionaries make that expensive to
    /// maintain for no other consumer), so `fetchedAt` — which does change on
    /// every completed fetch, including a `304 Not Modified` revalidation
    /// (see `EventRepository.refresh`'s `cache.touch`) — stands in as the
    /// snapshot-identity signal.
    ///
    /// The unknown-id case is the one the fix is about: clearing it only
    /// once `!isRefreshing && phase != .launching` means a refresh already
    /// in flight when this is first asked gets a chance to land — and, via
    /// the `fetchedAt` signal above, another call once it does — before the
    /// link is given up on as unknown. Only when a refresh has actually
    /// settled (succeeded or failed) and still doesn't know the id does this
    /// clear it.
    func resolvePendingEventDeepLinkIfPossible() -> Event? {
        guard case .event(let id) = pendingDeepLink else { return nil }
        guard let snapshot else { return nil }

        if let event = snapshot.events.first(where: { $0.id == id }) {
            pendingDeepLink = nil
            return event
        }

        guard !isRefreshing, phase != .launching else { return nil }
        pendingDeepLink = nil
        return nil
    }

    /// Resolves a pending `.day(key:)` deep link, clearing `pendingDeepLink`
    /// and returning the key once a snapshot exists to navigate within.
    ///
    /// Unlike the `.event` resolver above there is no "is it present?"
    /// question to retry: a day key needs no lookup, and `goToDay` is the
    /// authority on whether the day is reachable. So this clears the link as
    /// soon as the list has data, whether or not the caller's subsequent
    /// `goToDay` accepts it — a day outside `navigableBounds` is refused, not
    /// retried, and holding the link would make it fire again on the next
    /// snapshot refresh.
    ///
    /// Waiting for `snapshot` is what makes a cold launch work: before it
    /// lands there are no day sections mounted for `PendingDayScroll` to find.
    func resolvePendingDayDeepLinkIfPossible() -> String? {
        guard case .day(let key) = pendingDeepLink else { return nil }
        guard snapshot != nil else { return nil }
        pendingDeepLink = nil
        return key
    }

    func toggleFavorite(_ id: String) {
        if favorites.contains(id) {
            favorites.remove(id)
        } else {
            favorites.insert(id)
            requestReminderAuthorizationIfNeeded()
        }
        store.saveFavorites(favorites)
        enqueueReminderSync()
        widgetReloader?.reloadAll()
        enqueueSpotlightReindex()
    }

    func select(year: Int) async {
        selectedYear = year
        if let cached = await repository.cachedSnapshot(year: year) {
            snapshot = cached
            phase = .ready
            await enqueueReminderSync()?.value
        } else {
            snapshot = nil
            phase = .launching
        }

        if await repository.needsRefresh(year: year, now: now()) {
            await refresh(force: false)
        }
    }

    /// Sets the season-wide default reminder preset, persists it, and
    /// re-syncs `reminderCenter` so the change takes effect immediately
    /// (not just the next time something else happens to sync).
    func setDefaultReminderPreset(_ preset: ReminderPreset) {
        reminderSettings.defaultPreset = preset
        store.saveReminderSettings(reminderSettings)
        enqueueReminderSync()
    }

    /// Sets (or, passing `ReminderPreset.none` as `nil`, clears) a
    /// per-event override, persists it, and re-syncs `reminderCenter`.
    ///
    /// `preset` is `ReminderPreset?`: passing `nil` clears the override
    /// (reverting that event to the season-wide default), while passing
    /// `ReminderPreset.none` sets an explicit "off for this event" override
    /// that persists even if the default later changes. Callers must write
    /// `ReminderPreset.none` rather than bare `.none` when that's what they
    /// mean — in a `ReminderPreset?` context, bare `.none` resolves to
    /// `Optional<ReminderPreset>.none` (i.e. `nil`), a different meaning.
    /// See `ReminderPreset`'s own doc comment.
    func setReminderOverride(_ preset: ReminderPreset?, for eventID: String) {
        reminderSettings.setOverride(preset, for: eventID)
        store.saveReminderSettings(reminderSettings)
        enqueueReminderSync()
    }

    /// Fires (without blocking or awaiting) the one-time system permission
    /// prompt the first time a user favorites an event while a season-wide
    /// default reminder preset is active (#178). Never touches `favorites`
    /// and is never awaited from `toggleFavorite` — starring an event must
    /// not be blocked by, reordered around, or (on denial) undone by the
    /// permission flow; this is purely a side effect of the star.
    ///
    /// **Why a plain flag, not a re-check of the real authorization status
    /// on every star.** `ReminderCenter.ensureAuthorization()` already
    /// no-ops once status is no longer `.notDetermined`, so in principle
    /// calling it unconditionally on every star would also converge on "one
    /// real prompt" — but only once the *first* call's async round trip to
    /// `scheduler.authorizationStatus()` has actually settled. Three stars
    /// fired back-to-back (as `AppModelTests` does, synchronously, with no
    /// `await` between them) would spawn three concurrent
    /// `ensureAuthorization()` calls that could all observe `.notDetermined`
    /// before any of them updates it, each independently deciding to
    /// prompt. `hasRequestedReminderAuthorizationThisLaunch` sidesteps that
    /// race entirely: it's set **synchronously**, inside this (non-async)
    /// method, before the async `ensureAuthorization()` call is even
    /// spawned — so the second and third of three synchronous stars see it
    /// already `true` and never spawn a second request, deterministically,
    /// regardless of how quickly the first one's `Task` gets scheduled.
    ///
    /// Resetting to `false` on every fresh launch is harmless: a genuinely
    /// fresh install is `.notDetermined` and gets one real prompt as
    /// intended, while a launch after the user already decided (in this
    /// session or a previous one) just re-asks a question
    /// `ensureAuthorization()` itself will answer instantly without
    /// prompting again.
    private func requestReminderAuthorizationIfNeeded() {
        guard let reminderCenter, reminderSettings.defaultPreset != ReminderPreset.none else { return }
        guard !hasRequestedReminderAuthorizationThisLaunch else { return }
        hasRequestedReminderAuthorizationThisLaunch = true
        Task {
            _ = await ensureReminderAuthorization()
        }
    }

    #if DEBUG
    /// UI-test-only escape hatch: marks the one-time reminder-authorization
    /// ask as already fired, so `toggleFavorite` → `requestReminderAuthorizationIfNeeded()`
    /// no-ops instead of spawning `ensureReminderAuthorization()`.
    ///
    /// Exists because `CalendarView.applyUITestHooks()`'s `-uitest-seed-favorites`
    /// (and the pre-existing `-uitest-star-selected-event`) call
    /// `toggleFavorite` directly, and the shipped default preset is
    /// `.thirtyMinutesBefore` — not `.none` — so on a freshly-erased
    /// simulator (`.notDetermined` authorization, exactly the state
    /// `ios/Scripts/capture-screenshots.sh` starts from) that would spawn a
    /// real system notification-permission dialog. That dialog "survives
    /// `simctl terminate` + `simctl launch`" per the script's own comments,
    /// so once it appears it poisons every screenshot captured after it in
    /// the same run, not just the one that triggered it. Any `-uitest-*`
    /// launch is a screenshot/automation context where a system dialog is
    /// never wanted, so `applyUITestHooks()` calls this unconditionally
    /// before touching any hook-specific argument.
    func uitestSuppressReminderAuthorizationPrompt() {
        hasRequestedReminderAuthorizationThisLaunch = true
    }
    #endif

    /// Requests notification authorization (via `reminderCenter.ensureAuthorization()`,
    /// which itself only prompts when status is still `.notDetermined`) and
    /// publishes the resulting real status to `reminderAuthorizationStatus`
    /// once it resolves. Returns whether the app is authorized after the
    /// call; `false` with no `reminderCenter`.
    ///
    /// This is the fix for the in-flow "Don't Allow" case (#178 review
    /// fix): both the fire-and-forget ask spawned by
    /// `requestReminderAuthorizationIfNeeded()` (the star flow) and
    /// `EventDetailView`'s own "Remind me" menu route through here, so
    /// either path resolving to a denial updates the same published
    /// property the view's hint reads — there is no longer a call site that
    /// can ask for authorization and leave `reminderAuthorizationStatus`
    /// stale.
    ///
    /// Deliberately re-queries `authorizationStatus()` after
    /// `ensureAuthorization()` returns, rather than mapping its `Bool`
    /// result directly (`true` → `.authorized`, `false` → `.denied`):
    /// `ensureAuthorization()` also returns `false` while genuinely
    /// `.notDetermined` would be wrong to infer from that (it never does in
    /// practice, since it only returns without prompting when already
    /// decided one way or the other) — reading the real status back keeps
    /// this correct even if the mapping's assumptions ever changed, and
    /// costs one more cheap read.
    @discardableResult
    func ensureReminderAuthorization() async -> Bool {
        guard let reminderCenter else { return false }
        let granted = await reminderCenter.ensureAuthorization()
        reminderAuthorizationStatus = await reminderCenter.authorizationStatus()
        return granted
    }

    /// Re-queries the current system authorization status without
    /// prompting, and publishes it to `reminderAuthorizationStatus`.
    ///
    /// This is the fix for the Settings-return case (#178 review fix):
    /// `EventDetailView` calls this from `.onChange(of: scenePhase)` when
    /// the app becomes `.active` again, so granting access via the "Open
    /// Settings" link and switching back updates the row's hint without
    /// requiring another star or menu selection. Query-only by design —
    /// never call `ensureReminderAuthorization()` from a foreground hook,
    /// which would re-prompt a user who backgrounded the app mid-decision.
    func refreshReminderAuthorizationStatus() async {
        guard let reminderCenter else { return }
        reminderAuthorizationStatus = await reminderCenter.authorizationStatus()
    }

    /// Links a fresh reminder sync onto `reminderSyncChain` and returns the
    /// resulting `Task`, or `nil` immediately (no `Task` created at all)
    /// when there's no `reminderCenter` to sync.
    ///
    /// **Why a chain, not a bare `Task { await syncReminders() }`.** Two
    /// state changes that both want to trigger a sync (e.g. a rapid
    /// double-tap of a favorite's star, or a `toggleFavorite` racing a
    /// `refresh` landing) each spawn their own unstructured work. If each
    /// independently read `favorites`/`snapshot`/`reminderSettings` and
    /// called `reminderCenter.sync(plan:)` whenever the Swift concurrency
    /// runtime happened to schedule it, there would be no guarantee that
    /// whichever call was made *last* also reads state *last* — an earlier
    /// call reading fresher state than expected, or simply finishing its
    /// scheduling calls after a later call's, can leave stale reminders
    /// pending. (`ReminderCenter.sync` now serializes its own scheduling
    /// calls in call order — see its doc comment — but that alone doesn't
    /// help if the *plans* handed to it were built from state read out of
    /// order.)
    ///
    /// This method fixes that the same way `ReminderCenter.sync` fixes its
    /// half of the problem: `let previous = reminderSyncChain` captures
    /// whatever was already chained, **synchronously**, before this
    /// function's first `await` — so link order is exactly call order,
    /// regardless of later scheduling. The new link's body `await`s
    /// `previous` to finish, and only *then* reads `favorites`/`snapshot`/
    /// `reminderSettings` and builds the plan — deferring the state read
    /// to execution time is what makes each link's plan reflect whatever
    /// is truest once it's actually that link's turn, not whatever was
    /// true when it was merely enqueued.
    @discardableResult
    private func enqueueReminderSync() -> Task<Void, Never>? {
        guard reminderCenter != nil else { return nil }
        let previous = reminderSyncChain
        let chained = Task { [weak self] in
            await previous?.value
            guard let self, let reminderCenter = self.reminderCenter else { return }
            let events = await self.allCachedYearEvents()
            let plan = ReminderPlanner.plan(
                favorites: self.favorites,
                events: events,
                settings: self.reminderSettings,
                now: self.now()
            )
            await reminderCenter.sync(plan: plan)
        }
        reminderSyncChain = chained
        return chained
    }

    /// Fires (without blocking or awaiting) a full Spotlight reindex after a
    /// data change Spotlight should reflect — a successful `refresh(force:)`
    /// (the same "side effect of fresh data landing" spot as the reminder
    /// sync and widget reload immediately above that call site) and
    /// `toggleFavorite` (review fix, task 13, Important #1: starring an
    /// off-season event must make it searchable before the next refresh,
    /// and unstarring one must remove its now-stale entry, not leave both
    /// waiting on a refresh that might not happen for hours).
    ///
    /// **Coalescing, not a serial chain — and why not.**
    /// `SpotlightIndexer.reindex` is a full delete-and-re-add of every
    /// currently-selected event (~1,600 at full season), an order of
    /// magnitude heavier than a `reminderSync` link, which only ever
    /// schedules however many events are actually favorited. Wiring this
    /// into `toggleFavorite` means a rapid burst of stars (double-tapping
    /// one, or starring several in a row) could otherwise spawn one full
    /// reindex `Task` per tap. A `reminderSyncChain`-style serial chain
    /// would fix the *correctness* half of that (each link still reads
    /// state in call order) but not the *cost* half — it would still run
    /// one full reindex per tap, just one after another instead of
    /// concurrently. `isSpotlightReindexInFlight` /
    /// `spotlightReindexQueuedAgain` fix both: a trigger that arrives while
    /// a reindex is already running just sets the "queued again" flag and
    /// returns immediately — no new `Task`, no redundant delete-and-re-add —
    /// and once the in-flight reindex finishes, it checks that flag and, if
    /// set, starts exactly one more reindex, which reads `favorites`/
    /// every cached year's events/`defaultYear` fresh at that later point
    /// (so it reflects every change that arrived during the run it's
    /// following). A burst of
    /// N triggers therefore costs at most 2 reindexes, not N, while still
    /// converging on a correct final index because no two reindexes ever
    /// run concurrently against each other.
    ///
    /// Deliberately not awaited: a slow or failing Spotlight write must
    /// never delay `refresh(force:)`/`toggleFavorite` returning, and
    /// `SpotlightIndexer.reindex` itself already logs-and-continues on every
    /// CoreSpotlight error, so there is nothing for this call site to do
    /// with a result even if it awaited one.
    private func enqueueSpotlightReindex() {
        guard spotlightIndexer != nil, snapshot != nil else { return }
        guard !isSpotlightReindexInFlight else {
            spotlightReindexQueuedAgain = true
            return
        }
        runSpotlightReindex()
    }

    /// Starts the actual reindex `Task` for `enqueueSpotlightReindex()`.
    /// Captures `favorites`/`year` synchronously (before the `Task` is even
    /// spawned) so they reflect state as of the moment it started running,
    /// not a value read out of order once the `Task` happens to be
    /// scheduled — see the note above about why the follow-up run this
    /// schedules for `spotlightReindexQueuedAgain` re-reads state instead of
    /// reusing what this call captured.
    ///
    /// `year` is `defaultYear`, not `selectedYear` (review fix, F2): the
    /// season window Spotlight indexes against must always be the *current*
    /// season, regardless of which year's archive the user happens to be
    /// browsing — mirroring `allCachedYearEvents()`'s existing use for the
    /// same hazard on the reminder side. `events` is the union of every cached
    /// year (`allCachedYearEvents()`), not just `selectedYear`'s snapshot,
    /// for the same reason: browsing 2025 mid-2026-season must not wipe
    /// 2026's events out of the reindex input. Building that union needs an
    /// `await` (each year's cached snapshot is read from the `EventRepository`
    /// actor), so unlike `favorites`/`year` it can't be captured before the
    /// `Task` is spawned — it's read at the top of the `Task` body instead,
    /// which is still call-order-correct here because
    /// `isSpotlightReindexInFlight` already prevents more than one reindex
    /// `Task` from running at a time.
    private func runSpotlightReindex() {
        guard snapshot != nil, let spotlightIndexer else { return }
        isSpotlightReindexInFlight = true
        let favorites = favorites
        let year = defaultYear
        Task { [weak self] in
            guard let self else { return }
            let events = await self.allCachedYearEvents()
            await spotlightIndexer.reindex(events: events, favorites: favorites, year: year)
            self.isSpotlightReindexInFlight = false
            if self.spotlightReindexQueuedAgain {
                self.spotlightReindexQueuedAgain = false
                self.enqueueSpotlightReindex()
            }
        }
    }

    /// Every event from every cached year in `years`, not just
    /// `selectedYear`'s — what both a reminder plan and a Spotlight reindex
    /// must be built from.
    ///
    /// Neither reminder scheduling nor Spotlight indexing may be scoped to
    /// whichever year the user happens to be *looking at*: the year picker
    /// lets someone browse a past season at any time, and doing so must not
    /// cancel a reminder for, or drop from search, a favorited/current-
    /// season event just because it isn't in `snapshot?.events` while an
    /// archive year is on screen (review fix, F2 — Spotlight's reindex used
    /// to be scoped to `selectedYear` alone, the same defect this was
    /// already fixed for on the reminder side). So this unions every year's
    /// cached snapshot (favorites are global, keyed only by `Event.id`, with
    /// no notion of "which year was selected when the reminder/index entry
    /// was made") rather than reading `snapshot` alone.
    ///
    /// Falls back to `snapshot?.events` alone when `years` is still empty
    /// (the very first moment of `start()`, before the years manifest has
    /// ever been fetched) so the first sync/reindex still has something to
    /// work from instead of unconditionally scheduling/indexing nothing.
    private func allCachedYearEvents() async -> [Event] {
        guard !years.isEmpty else { return snapshot?.events ?? [] }
        var combined: [Event] = []
        for year in years {
            if let cached = await repository.cachedSnapshot(year: year) {
                combined.append(contentsOf: cached.events)
            }
        }
        return combined
    }

    /// The off-season "browse the season that just ended" action: switches
    /// the filter to `.season`, which shows the whole 9-week season
    /// regardless of "now" — unlike `.next`, it isn't subject to the
    /// adaptive window's 90-day cap, so it always has the ended season's
    /// events to show. Does not touch `selectedYear`; `landingState`'s
    /// `endedSeasonYear` is already the year being viewed.
    ///
    /// Only ever reachable from `.postSeason`: `OffSeasonLandingView` hides
    /// the "Browse the _ season" button entirely in `.preSeason` (see
    /// `LandingState.archiveYear`), because this method has no way to honor
    /// a `.preSeason` label of `selectedYear - 1` — applying `.season` scope
    /// unconditionally would show `selectedYear` (the *upcoming* year), not
    /// the labeled past year. A year-aware `browsePastSeason(year:)` that
    /// also calls `select(year:)` is the future path if pre-season archive
    /// browsing is wanted; not implemented here (follow-up).
    func browseArchiveSeason() {
        filter = FilterSelection(dateScope: .season)
    }

    /// The off-season "peek at next season" action: switches to the year
    /// `landingState` says is next, then sets the filter to `.all` so
    /// whatever's been announced so far — however sparse — is what's shown,
    /// rather than `.next`'s adaptive window (which has nothing to adapt to
    /// yet, this early). A no-op when `landingState` isn't `.postSeason`
    /// with a known next year, e.g. if this is called before the year has
    /// been announced or while still in/pre-season.
    ///
    /// `select(year:)` never throws — a network failure just leaves
    /// `snapshot`/`phase` reflecting that (see its doc comment) — so there's
    /// nothing to catch here. The filter is set unconditionally afterward
    /// specifically so a failed fetch doesn't strand it mid-transition: the
    /// user asked to preview next season, and that's now the filter's
    /// intent regardless of whether the data made it down yet.
    func previewNextSeason() async {
        guard case .postSeason(_, let nextSeasonYear?, _, _) = landingState else { return }
        await select(year: nextSeasonYear)
        filter = FilterSelection(dateScope: .all)
    }

    /// Selects a date scope, clearing any week selection: the scope row and
    /// the week strip are two ways of expressing one date range, never two
    /// ranges to intersect.
    ///
    /// Re-tapping the active scope *resets* it: any scope-local date state
    /// — a window widened by "Show next day", a window grown by day-rail
    /// navigation, a browsed day — is cleared, leaving exactly what a fresh
    /// selection of that scope would give. Only a re-tap with nothing left
    /// to clear is a no-op. The web toggles back to "all" here, but it has
    /// no All button; iOS does, so the scope row behaves as a radio group
    /// instead.
    ///
    /// The rail is the *likeliest* source of that state since #258, not an
    /// afterthought: `goToDay` writes `windowStartDayKey` and
    /// `windowEndDayKey`, and every rail chip tap reaches it through
    /// `EventListView.selectDay` — including the rail's own `⟳ Now`. So the
    /// common path into this reset is navigate the rail → open Filters →
    /// re-tap the active chip, and the accumulated expansion collapses.
    /// `expandWindowEnd` ("Show next day") is only the other writer.
    ///
    /// The guard therefore tests "nothing would change", not "same scope"
    /// (#234). Its purpose is unchanged — not writing `filter`, and so not
    /// firing its `didSet` or a `persistFilter`, when genuinely nothing
    /// changes — but the old one-liner made the early return the single path
    /// into this method that skipped `clearScopeLocalDateState()`, so
    /// "Show next day" ×2 → Now kept the widened window.
    ///
    /// This is the *only* "put me back" gesture in the app, which is why it
    /// has to actually reset. The rail's `⟳ Now` is not a second one: #258
    /// deleted `AppModel.resetToNow()` precisely so that control could be
    /// pure navigation — the spec has it "not touch scope, weeks,
    /// categories, or search," and
    /// `AppModelTests.nowLeavesAnyAccumulatedExpansionInPlace` pins that it
    /// leaves a widened window alone. The two controls share a name, not a
    /// job (#258 finding 2).
    ///
    /// Also drops the two pieces of state that only mean something under a
    /// scope the user is leaving, via `clearScopeLocalDateState()` — see
    /// that method for why both belong to the scope rather than to the
    /// selection as a whole (#156, #197).
    func selectScope(_ scope: DateScope) {
        let unchanged = filter.dateScope == scope
            && filter.selectedWeeks.isEmpty
            && filter.windowStartDayKey == nil
            && filter.windowEndDayKey == nil
            && filter.selectedDayKey == nil
        guard !unchanged else { return }
        filter.dateScope = scope
        filter.selectedWeeks = []
        clearScopeLocalDateState()
        persistFilter()
    }

    /// Resets the date state that belongs to a *specific* scope rather than
    /// to the selection as a whole, so changing scope cannot leave a
    /// previous scope's state behind to take effect again later.
    ///
    /// - `windowStartDayKey`/`windowEndDayKey` are how far the user has
    ///   navigated beyond whatever scope was active when they did it —
    ///   meaningless once that scope is gone. Without this, "Show next day"
    ///   ×2 → This Week → Now returns to a window two days wider than a
    ///   fresh `.next` selection, with nothing on screen explaining why
    ///   (#156).
    /// - `selectedDayKey` is `.day`-only. Leaving it set is inert *today*
    ///   because it is read only while `dateScope == .day`, but that is an
    ///   invariant held by convention across three methods; clearing it
    ///   here makes it hold by construction (#197 item 3). It also removes
    ///   the "week filter over a day-filtered list" state that
    ///   `DateFilterLabel` would have to describe (#197 item 5).
    ///
    /// `browseDay` deliberately does *not* call this: it is the one writer
    /// that sets `selectedDayKey` and clears the window fields in the same
    /// assignment, in that order.
    private func clearScopeLocalDateState() {
        filter.selectedDayKey = nil
        filter.windowStartDayKey = nil
        filter.windowEndDayKey = nil
    }

    /// Replaces the week selection wholesale — the strip owns tap/drag
    /// semantics (`WeekStripDrag.commit`); the model just stores the result.
    /// Unconditionally forces `.all`: weeks and relative scopes are mutually
    /// exclusive, one date range at a time, and an empty commit means "no
    /// week filter" — which `.all` represents, same as every other deselect
    /// path.
    ///
    /// Forcing `.all` is a scope change like any other, so it owes the same
    /// `clearScopeLocalDateState()` cleanup `selectScope` does — this is the
    /// other route out of `.day` and out of a `.next`-widened window.
    func setWeekSelection(_ weeks: Set<Int>) {
        filter.dateScope = .all
        filter.selectedWeeks = weeks
        clearScopeLocalDateState()
        persistFilter()
    }

    /// Pins the event list to one named calendar day — the action behind My
    /// Day's empty-day "Browse …" button (#192).
    ///
    /// `dayKey` must parse as a calendar day (`ChqTime.parse`'s underlying
    /// `DateFormatter` accepts some non-canonical shapes, e.g. `"2026-8-9"`,
    /// alongside the canonical `"yyyy-MM-dd"`); anything unparseable is
    /// ignored rather than applied, because a `.day` scope carrying a key
    /// that matches no event would show an empty list under a pill that
    /// still says "All Year". A key that does parse is normalized to
    /// `ChqTime.dayKey(for:)`'s canonical form before being stored, since
    /// `EventFilter.apply` compares `selectedDayKey` against that same
    /// canonical form with plain string equality — storing the input
    /// verbatim would silently produce the same empty-list failure mode for
    /// a non-canonical (but validly parsed) key.
    ///
    /// Clears `selectedWeeks`, since a standing week filter can exclude the
    /// very day the user asked for, and the window-expansion fields, which
    /// only mean something relative to the scope being left behind.
    /// Deliberately leaves `searchText`, venues, categories, and
    /// favorites-only alone: those are the user's standing preferences, not
    /// date state.
    func browseDay(_ dayKey: String) {
        guard let parsed = ChqTime.parse("\(dayKey) 00:00:00") else { return }
        filter.dateScope = .day
        filter.selectedDayKey = ChqTime.dayKey(for: parsed)
        filter.selectedWeeks = []
        filter.windowStartDayKey = nil
        filter.windowEndDayKey = nil
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

    /// Replaces the location filter wholesale with every raw feed-name
    /// string `venue` aggregates (`VenueAtlas.feedNames(forVenueID:)`), so
    /// "show every event at this building" actually shows every event
    /// there — a building with room-level feed names (e.g. "Hultquist 101"
    /// / "Hultquist Porch") needs all of them selected at once, not just
    /// whichever room happened to be visible when the user tapped the
    /// marker. Backs `GroundsMapView`'s "Show all events here" (#182).
    ///
    /// Unlike `toggleLocation`, which flips a single name in place, this
    /// always sets an exact replacement set and leaves `recents` alone —
    /// selecting a venue from the map isn't the same gesture as picking one
    /// from the filter chip cloud.
    func selectVenueExclusively(_ venue: VenueLocation) {
        filter.selectedLocations = VenueAtlas.feedNames(forVenueID: venue.id)
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
    /// and the window-expansion fields, and drops the scope to `.all`.
    /// Mirrors the web's CLEAR_FILTERS.
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

    /// Widens the window forward to the nearest later day that has events
    /// under the current non-date filters.
    ///
    /// **Not the next calendar day**, which is what this did before phase 3b.
    /// With Favourites on, or any search or venue filter that leaves gaps,
    /// the adjacent day usually has no matches: the edge moves, nothing new
    /// mounts, and the control reads as dead. Pressing again recomputes the
    /// same dead target. The web rail ships the corrected rule and
    /// `DayRailNavigation.stepTargets` documents why.
    func expandWindowEnd() {
        guard let later = DayRailNavigation.edgeTargets(
            eventDays: navMatching?.eventDays ?? [], window: currentWindow).later
        else { return }
        filter.windowEndDayKey = later
    }

    /// *Take me to that day.* Grows at most one edge of the window to include
    /// `dayKey`, then leaves the scrolling to the view.
    ///
    /// Returns whether the target was accepted, so a caller can decide not to
    /// queue a scroll for a day that will never arrive. A target outside the
    /// navigable bounds, or any target at all while the scope resolves to no
    /// window, is refused rather than clamped: clamping would move the window
    /// to an edge and then scroll to a day that is not there.
    ///
    /// Unlike an empty *step*, an empty *day* is a legal target. The reader
    /// asked for that day by name and the rail's own label already told them
    /// it has nothing; landing there is honest, and it is how they get to the
    /// days on either side.
    ///
    /// The window is assembled and assigned once. `filter`'s `didSet` rebuilds
    /// every derived count, so two assignments would run the pipeline twice
    /// for one tap.
    @discardableResult
    func goToDay(_ dayKey: String) -> Bool {
        guard let plan = DayRailNavigation.plan(
            target: dayKey, window: currentWindow, bounds: navigableBounds)
        else { return false }

        var next = filter
        if let start = plan.expandStart { next.windowStartDayKey = start }
        if let end = plan.expandEnd { next.windowEndDayKey = end }
        filter = next
        return true
    }

    private func persistFilter() {
        store.saveFilters(filter)
    }

    /// Recomputes everything derived from (snapshot × filter × favorites ×
    /// year): the facet counts behind the filter sheet, and the navigation
    /// data behind the day rail.
    ///
    /// `facetCounts` is rebuilt on every call — it depends on the window,
    /// via the date scope, so there is no cheaper answer for it.
    /// `navMatching` does not: `rebuildNavMatchingIfNeeded()` below skips its
    /// own pass whenever nothing that could change the result has changed.
    private func rebuildDerivedCounts() {
        rebuildFacetCounts()
        rebuildNavMatchingIfNeeded()
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

    /// Everything that can change what `rebuildNavMatching()` computes:
    /// the snapshot's identity (`fetchedAt` stands in for `CalendarSnapshot`
    /// itself, which isn't `Equatable` — the same convention
    /// `resolvePendingEventDeepLinkIfPossible`'s doc comment explains),
    /// favourites, and the *non-window* filter identity. `PendingDayScroll.Key`
    /// already models exactly that — it exists to say "the reader left the
    /// context a tap was made under", which is the identical question this
    /// needs answered, just for a rebuild instead of a stale-scroll check —
    /// so this reuses it (including its `year`) rather than inventing a
    /// second, parallel notion of "the filter identity that isn't the
    /// window." `windowStartDayKey`/`windowEndDayKey` are excluded by that
    /// same `Key`, which is exactly right here too: `rebuildNavMatching()`
    /// clears both before calling `EventFilter.apply`, so they never affect
    /// its result.
    private struct NavMatchingInputs: Equatable {
        let snapshotFetchedAt: Date?
        let favorites: Set<String>
        let filterKey: PendingDayScroll.Key
    }

    /// The inputs `navMatching` was last computed from — `nil` until the
    /// first rebuild (mirroring `navMatching` itself being `nil` before a
    /// snapshot exists).
    private var lastNavMatchingInputs: NavMatchingInputs?

    #if DEBUG
    /// Counts every completed `rebuildNavMatching()` pass — test-only
    /// instrumentation (`AppModelTests`/`NavMatchingTests`) for pinning that
    /// a window-only filter mutation is skipped here, not just that it
    /// leaves `navMatching` unchanged (which an identical recompute would
    /// also do).
    private(set) var navMatchingRebuildCount = 0
    #endif

    /// Recomputes `navMatching` only when one of its actual inputs changed —
    /// see `NavMatchingInputs`. `goToDay` and `expandWindowEnd` (the latter
    /// fired repeatedly by scroll-driven auto-expansion) only ever write
    /// `windowStartDayKey`/`windowEndDayKey`, which `NavMatchingInputs`
    /// excludes by construction, so every window-only tick lands on the
    /// `guard` below and skips the `EventFilter.apply` pass over ~1,686
    /// events that a full `rebuildNavMatching()` would otherwise repeat for
    /// a provably identical result.
    private func rebuildNavMatchingIfNeeded() {
        guard let snapshot else {
            navMatching = nil
            lastNavMatchingInputs = nil
            return
        }
        // `PendingDayScroll.key` is deliberately *wider* than this cache
        // strictly needs: it carries `dateScope` and `selectedDayKey`, which
        // `rebuildNavMatching()` immediately overwrites with `.all`/`nil`, so
        // a pure scope change or a browse-day change re-runs a pass whose
        // result cannot differ. That waste is accepted on purpose.
        //
        // The expensive case this guard exists for is `expandWindowEnd()`
        // firing repeatedly as the reader scrolls — window-only changes, which
        // the key excludes and which are therefore correctly skipped. What
        // remains is one redundant pass per deliberate scope tap, which no
        // reader can perceive. A narrower, purpose-built fingerprint would
        // save that pass and introduce a far worse failure mode: omit one
        // input that does matter (weeks, venues, categories, favourites-only,
        // search) and `navMatching` goes silently stale, which shows up as a
        // rail quietly disagreeing with the list rather than as a test
        // failure. Reusing one key that is known-complete beats hand-tuning a
        // second one that has to stay complete forever.
        let inputs = NavMatchingInputs(
            snapshotFetchedAt: snapshot.fetchedAt,
            favorites: favorites,
            filterKey: PendingDayScroll.key(for: filter, year: selectedYear))
        guard inputs != lastNavMatchingInputs else { return }
        lastNavMatchingInputs = inputs
        rebuildNavMatching()
    }

    /// The filter pipeline re-run with the date stage wide open.
    ///
    /// `.all` rather than "skip the stage": there is one date stage and it is
    /// driven by the scope, so opening it is expressed the same way the user
    /// would. `selectedDayKey` and both window keys are cleared with it —
    /// leaving them set would let a `.day` selection or a previous expansion
    /// narrow the very set that decides how far navigation may go.
    ///
    /// `selectedWeeks` deliberately stays. Weeks are a filter the reader
    /// chose, not a scope edge to escape, and the web's `nonDateFilterOpts`
    /// keeps them for the same reason.
    ///
    /// Called only from `rebuildNavMatchingIfNeeded()`, which is what
    /// decides whether a rebuild is actually owed — never call this
    /// directly from a `didSet` or action method.
    private func rebuildNavMatching() {
        #if DEBUG
        navMatchingRebuildCount += 1
        #endif
        guard let snapshot else {
            navMatching = nil
            return
        }

        var open = filter
        open.dateScope = .all
        open.selectedDayKey = nil
        open.windowStartDayKey = nil
        open.windowEndDayKey = nil

        let matching = EventFilter.apply(
            open, to: snapshot.events, favorites: favorites,
            now: now(), year: selectedYear, isCurrentYear: isCurrentYear)

        var counts: [String: Int] = [:]
        for event in matching {
            counts[ChqTime.dayKey(for: event.start), default: 0] += 1
        }

        navMatching = NavMatching(
            eventDays: counts.keys.sorted(),
            countsByDay: counts,
            bounds: ViewWindow.navigableBounds(
                year: selectedYear, events: snapshot.events, starredDays: []))
    }

    /// Everything navigation can reach. Falls back to the season-only range
    /// before a snapshot exists, so a control asking "is this day reachable"
    /// never has to handle a missing answer.
    var navigableBounds: ClosedRange<String> {
        navMatching?.bounds ?? DayWindow.bounds(year: selectedYear, starredDays: [])
    }

    /// The window the list is currently showing, or `nil` when the scope
    /// resolves to no window at all. The rail's controls all key off this:
    /// a nil window refuses every tap, because expansion cannot rescue it.
    var currentWindow: ViewWindow? {
        guard let snapshot else { return nil }
        return ViewWindow.make(
            selection: filter, events: snapshot.events, now: now(),
            year: selectedYear, isCurrentYear: isCurrentYear, bounds: navigableBounds)
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

    /// The `now` closure `ChqCalendarApp` hands to its `init`. In Release
    /// this is always `{ Date() }` — real launches never take another
    /// clock. In DEBUG, honors `-uitest-freeze-now "yyyy-MM-dd HH:mm:ss"`
    /// (NY wall-clock, parsed via `ChqTime.parse`) so a season boundary
    /// (off-season landing, #177) can be screenshotted without moving the
    /// simulator's device date. Must run *before* `start()` — unlike the
    /// other `-uitest-*` flags in `CalendarView.applyUITestHooks`, which
    /// flip a flag `AppModel` consumes later, `now` is captured once into a
    /// `let` at `init` and never replaced, so the seam has to be the
    /// closure passed into that `init`, not a post-hoc mutation. A missing
    /// flag, or a value `ChqTime.parse` rejects, falls back to `Date()`
    /// exactly as if the flag were never wired up.
    static func launchNow() -> @Sendable () -> Date {
        #if DEBUG
        if let frozen = parsedFrozenNow(from: ProcessInfo.processInfo.arguments) {
            return { frozen }
        }
        #endif
        return { Date() }
    }

    /// The dataset year `ChqCalendarApp` hands to its `init` as
    /// `pinnedYear`. In Release this is always `nil` — real launches always
    /// take the year the server's manifest names. In DEBUG, honors
    /// `-uitest-pin-year <year>` so an App Store capture run keeps rendering
    /// the 2026 season however many seasons the manifest has moved on by
    /// (#222); see `pinnedYear`'s own doc comment for why the clock pin
    /// alone does not achieve that. A missing flag, or a value that is not
    /// an integer, falls back to `nil` exactly as if the flag were never
    /// wired up.
    static func launchPinnedYear() -> Int? {
        #if DEBUG
        return parsedPinYear(from: ProcessInfo.processInfo.arguments)
        #else
        return nil
        #endif
    }

    #if DEBUG
    // MARK: UI-test hooks (DEBUG only)

    /// Shared flags/lookups consumed by `CalendarView`, `EventListView`, and
    /// `EventDetailView` to make interactive states reachable for
    /// screenshot-based verification when `xcrun simctl` can't synthesize a
    /// tap (see task-12 brief). This whole section compiles out of Release
    /// builds.

    /// The value following `flag` in `arguments`, or `nil` if the flag is
    /// absent or trailing (nothing follows it to read).
    ///
    /// The two launch pins parse their own value out of this rather than
    /// each re-deriving "the argument after the flag" — and they take
    /// `arguments` rather than reading `ProcessInfo` themselves so the parse
    /// is testable without re-launching the test process under different
    /// arguments. Worth doing now that *every* shot in the screenshot plan
    /// depends on the clock parse, not just the one off-season shot it was
    /// originally written for.
    static func launchArgumentValue(_ flag: String, in arguments: [String]) -> String? {
        guard let flagIndex = arguments.firstIndex(of: flag) else { return nil }
        let valueIndex = arguments.index(after: flagIndex)
        guard valueIndex < arguments.endIndex else { return nil }
        return arguments[valueIndex]
    }

    /// The `-uitest-freeze-now` value in `arguments`, parsed as NY
    /// wall-clock — `nil` if the flag is absent, trailing, or followed by
    /// something `ChqTime.parse` rejects.
    static func parsedFrozenNow(from arguments: [String]) -> Date? {
        launchArgumentValue("-uitest-freeze-now", in: arguments).flatMap { ChqTime.parse($0) }
    }

    /// The `-uitest-pin-year` value in `arguments` — `nil` if the flag is
    /// absent, trailing, or followed by a non-integer.
    ///
    /// Deliberately does **not** bound the year to something plausible,
    /// though review has asked for it twice. Note first that no bound exists
    /// today: `Int("-5")` succeeds, so `-uitest-pin-year -5` pins year -5 and
    /// the app goes looking for `all-events--5.json`. That fails visibly —
    /// the operator sees an empty app and goes looking at the flag they just
    /// typed. Rejecting the value here would instead return `nil`, and `nil`
    /// does not mean "bad pin", it means *no pin*: the app quietly renders
    /// the current season and looks entirely correct while ignoring the
    /// argument it was handed. For a hook whose only job is to make a launch
    /// depict something other than now, failing loudly beats failing into
    /// today.
    ///
    /// The plausibility check therefore lives where a run can actually be
    /// stopped and a reason printed — `capture-screenshots.sh`, which
    /// requires a 4-digit year before booting a simulator. That is the only
    /// such check in the system, not a second line of defense.
    static func parsedPinYear(from arguments: [String]) -> Int? {
        launchArgumentValue("-uitest-pin-year", in: arguments).flatMap { Int($0) }
    }

    /// Set by `CalendarView` on launch when `-uitest-show-filters` is
    /// present. Its original consumer — the four-row `FilterBarView` — is
    /// gone; it is now consumed by `EventListView`, which presents
    /// `FilterSheet` (and resets the flag) on `onAppear`/`onChange`.
    var uiTestShowFilters = false

    /// Set by `CalendarView` on launch when `-uitest-show-add-to-calendar`
    /// is present; consumed (and reset) by `EventDetailView.onAppear`.
    var uiTestShowAddToCalendar = false

    /// Set by `CalendarView` on launch when `-uitest-show-about` is
    /// present; consumed (and reset) by `EventListView`, which presents
    /// `AboutView` (the Reminders default-preset picker lives there, #178).
    var uiTestShowAbout = false

    /// Set by `CalendarView` on launch when `-uitest-show-week-theme` is
    /// present; consumed (and reset) by whichever `WeekThemeBadge` matches
    /// `uiTestFirstThemedWeek` below (see `EventListView.dayHeader`).
    var uiTestShowWeekTheme = false

    /// Seconds `EventListView.landPendingScroll` should hold off resolving
    /// the *very next* pending scroll it sees, set by `CalendarView` from
    /// `-uitest-delay-pending-scroll` and consumed (reset to `0`) by
    /// `EventListView.selectDay` the moment a tap arms a target.
    ///
    /// Exists because a real device resolves a pending scroll within the
    /// same SwiftUI commit that arms it — `PendingDayScroll`'s staleness
    /// check (Important 1, task 9 review) exists for exactly the case where
    /// the reader changes scope *before* that commit lands, but no UI test
    /// can reliably win that race: every `XCUIElement` action first waits
    /// for the app to go idle, and idle-detection tracks in-flight
    /// animations/layout, not this view's own `pendingScroll` state — so by
    /// the time a second synthesized tap is even sent, the first commit has
    /// always already resolved (confirmed empirically: the tapped day was
    /// already `isHittable` while a *sheet was still presenting* over it,
    /// before any second action could run). The delay is scheduled via
    /// `DispatchQueue.main.asyncAfter`, which — unlike a `CADisplayLink` or
    /// animation — does not register as app activity, so XCUITest sees the
    /// app as idle and hands control back to the test immediately after the
    /// tap, giving it a real window to act in. `0` (the default, and the
    /// value in every real launch) keeps this path fully inert.
    ///
    /// Mutually exclusive with `uiTestScrollsToDrop` below: a delay shorter
    /// than the drop-retry window is swallowed by it, so the pair produces a
    /// failure unrelated to whatever the test is probing (#252).
    /// `UITestScrollHooks.parse` rejects a launch that passes both flags.
    var uiTestPendingScrollDelay: TimeInterval = 0

    /// How many of the next `proxy.scrollTo` calls `EventListView.issueScroll`
    /// should swallow instead of performing, set by `CalendarView` from
    /// `-uitest-drop-scrolls <n>` and decremented once per swallowed call.
    ///
    /// Makes reachable, deterministically and on any machine, a state that
    /// otherwise depends on winning a layout race: a `scrollTo` that is
    /// issued and does nothing, because the section it names was not part of
    /// the scroll view's resolved content yet (see
    /// `PendingDayScroll.hasLanded`). Forcing that race directly did not work
    /// — 24 CPU spinners on a 12-core host and a cold-booted simulator both
    /// still landed the scroll — so the hook models the *observable
    /// consequence* instead: the scroll goes nowhere. Before the retry chain,
    /// one dropped call was fatal, since nothing fired again; with it, the
    /// pending target survives and the next attempt lands it.
    ///
    /// Note this is not the #250 CI failure itself — that one never issued a
    /// scroll at all (see `EventListView.resolvePendingScroll`'s abandon
    /// guard, and `testADayDeepLinkLandsOnThatDay`, which falsifies it
    /// directly). This covers the neighbouring assumption in the same
    /// function.
    ///
    /// `0` (the default, and every real launch) keeps this fully inert.
    ///
    /// Mutually exclusive with `uiTestPendingScrollDelay` above — the
    /// retry chain and a deferred `resolvePendingScroll` interfere (#252) —
    /// and `UITestScrollHooks.parse` rejects a launch that passes both flags.
    var uiTestScrollsToDrop = 0

    /// The first `(day, week)` pairing — in `days` display order — whose
    /// badge actually has a theme. The deterministic target for
    /// `-uitest-show-week-theme`: not every week has one (a partial sidecar
    /// fetch, or the 2025 season, which has none at all), so "the first
    /// badge" and "the first *themed* badge" can differ, and only the
    /// latter has anything to open. `nil` when nothing in the current
    /// selection has a themed week.
    ///
    /// Takes the caller's already-computed `days` — `EventListView.list(days:)`'s
    /// own `days` parameter — rather than reading `dayGroups` itself.
    /// `dayGroups` is deliberately uncached (see the comment above) and
    /// re-runs the whole filter+group pipeline on every access, so this used
    /// to run it a second time here, and `EventListView` was running it a
    /// *third* time per badge realized by the `List` (see
    /// `EventListView.content`'s comment on `days`). At ~1,637 events that
    /// makes scrolling the season pay for a full filter-and-group pass per
    /// header in a DEBUG build. Worse, calling `dayGroups` here means this
    /// hook decides its target against a separate pipeline run than the one
    /// that actually got rendered: a `now()` tick between the two runs (the
    /// default `.next` scope, on the current year, drops or admits days as
    /// the clock crosses midnight) can shift which days match, producing a
    /// target no rendered header matches — the hook then silently never
    /// fires. Passing in the exact array being rendered makes the decision
    /// and the render agree by construction, and costs nothing extra: the
    /// caller already has `days` in hand.
    func uiTestFirstThemedWeek(in days: [DayGroup]) -> (dayID: String, week: Int)? {
        for day in days {
            for week in day.weekNumbers {
                guard WeekThemeSummary.make(forWeek: week, in: themes) != nil else { continue }
                return (day.id, week)
            }
        }
        return nil
    }

    /// Every event with article links, richest first — the single candidate
    /// list behind `-uitest-select-linked-event`,
    /// `-uitest-show-add-to-calendar`, `-uitest-scroll-to-articles` and
    /// `-uitest-select-event-index <n>`.
    ///
    /// Deliberately ranks by *richness* (longest `details`, then most links;
    /// see `uiTestContentWeight`) rather than feed order. The detail
    /// screenshot pair (`04-detail` / `05-articles`) only differs by scroll
    /// position, and on iPad's wide `NavigationSplitView` detail column,
    /// body text wraps into far fewer lines than on iPhone for the same
    /// character count — a short-description event's full detail view (hero
    /// image + metadata + description + links + buttons) can render with no
    /// overflow at all, making `scrollTo` a no-op and the two shots
    /// byte-identical. Ranking by content makes the detail view reliably
    /// taller than the tallest on-screen viewport across both device sizes,
    /// so the scroll always has somewhere to go.
    ///
    /// `id` breaks weight ties. `max(by:)` is itself deterministic — it
    /// keeps the first maximum it encounters — but the *input order* isn't:
    /// which equal-weight element comes first depends on snapshot/feed
    /// ordering, which can differ between captures. Breaking ties on `id`
    /// makes the selection independent of that ordering, so two capture
    /// runs of the same build select the same event and produce identical
    /// bytes; screenshot captures have to be reproducible.
    var uiTestLinkedEvents: [Event] {
        guard let snapshot else { return [] }
        return snapshot.events
            .filter { !articleLinks(for: $0.id).isEmpty }
            .sorted { lhs, rhs in
                let lhsWeight = uiTestContentWeight(lhs)
                let rhsWeight = uiTestContentWeight(rhs)
                if lhsWeight != rhsWeight { return lhsWeight > rhsWeight }
                return lhs.id < rhs.id
            }
    }

    /// The richest linked event — index 0 of `uiTestLinkedEvents`, and what
    /// `-uitest-select-linked-event` selects.
    var uiTestFirstLinkedEvent: Event? {
        uiTestLinkedEvents.first
    }

    /// The `index`-th richest linked event, for
    /// `-uitest-select-event-index <n>`. Exists so a shot can populate the
    /// detail column with an event *other* than index 0: on iPad both
    /// columns are always visible, so `01-season` and `04-detail` were
    /// selecting the same event and capturing byte-identical images.
    ///
    /// `dayKey`, when non-nil, scopes the ranked pool to events whose
    /// `ChqTime.dayKey(for: event.start)` equals it *before* picking the
    /// `index`-th richest — so a shot that also lands the rail on that day
    /// via `-uitest-go-to-day` gets a detail pane whose date agrees with the
    /// rail, instead of the season-wide richest event landing on an
    /// unrelated day (#255: iPad's `01-season` showed the rail on one day
    /// and the detail column on another once the caption started promising
    /// day navigation). `dayKey` defaults to `nil`, reproducing the exact
    /// season-wide ranking every other caller relies on — `09-reminder`'s
    /// `-uitest-select-event-index 2` carries no day flag and must not
    /// shift.
    ///
    /// Out of range — within the day-scoped pool when `dayKey` is set, or
    /// the season-wide pool otherwise — returns `nil`, which makes the hook
    /// a **no-op** (the detail column stays on its "Select an event"
    /// placeholder) rather than clamping to the nearest valid index, or
    /// (when day-scoped) falling back to the season-wide pool. Either kind
    /// of silent substitution would capture a *different, plausible-looking*
    /// event than the plan asked for — a typo'd index, or a day with fewer
    /// linked events than expected, would ship a wrong-but-believable store
    /// screenshot. A no-op is visible in the review pass instead.
    func uiTestLinkedEvent(at index: Int, dayKey: String? = nil) -> Event? {
        let events: [Event]
        if let dayKey {
            events = uiTestLinkedEvents.filter { ChqTime.dayKey(for: $0.start) == dayKey }
        } else {
            events = uiTestLinkedEvents
        }
        guard events.indices.contains(index) else { return nil }
        return events[index]
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
