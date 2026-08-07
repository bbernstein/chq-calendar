import Foundation
import Observation
import UserNotifications

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

    /// Set by any deep-link entry point — `.onOpenURL` (task 3), a
    /// notification tap (task 8), a widget's `widgetURL` (task 11), an App
    /// Intent (task 12), or Spotlight (task 13) — and consumed by whoever
    /// routes it. `CalendarView` currently only consumes `.event`, via
    /// `resolvePendingEventDeepLinkIfPossible()` below: it can arrive before
    /// the snapshot has loaded, so it stays pending across `phase`/
    /// `snapshot` changes until the target event is found (or the snapshot
    /// is loaded, no refresh that could still surface the event is in
    /// flight, and it's confirmed unknown). `.myDay` and `.map` are left
    /// pending here — nothing consumes them until the tab shell lands
    /// (task 16).
    var pendingDeepLink: DeepLink?

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

    init(
        repository: EventRepository,
        store: UserStateStore,
        now: @escaping @Sendable () -> Date = { Date() },
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
        self.selectedYear = Self.placeholderYear
        self.defaultYear = Self.placeholderYear
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
        defaultYear = manifest.defaultYear

        if selectedYear != manifest.defaultYear {
            selectedYear = manifest.defaultYear
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
            let events = await self.reminderPlanEvents()
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
    /// `snapshot`/`selectedYear` fresh at that later point (so it reflects
    /// every change that arrived during the run it's following). A burst of
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
    /// Captures `events`/`favorites`/`year` synchronously (before the
    /// `Task` is even spawned) so the work in flight always reflects state
    /// as of the moment it started running, not a value read out of order
    /// once the `Task` happens to be scheduled — see the note above about
    /// why the follow-up run this schedules for `spotlightReindexQueuedAgain`
    /// re-reads state instead of reusing what this call captured.
    private func runSpotlightReindex() {
        guard let snapshot, let spotlightIndexer else { return }
        isSpotlightReindexInFlight = true
        let events = snapshot.events
        let favorites = favorites
        let year = selectedYear
        Task { [weak self] in
            await spotlightIndexer.reindex(events: events, favorites: favorites, year: year)
            guard let self else { return }
            self.isSpotlightReindexInFlight = false
            if self.spotlightReindexQueuedAgain {
                self.spotlightReindexQueuedAgain = false
                self.enqueueSpotlightReindex()
            }
        }
    }

    /// Every event from every cached year in `years`, not just
    /// `selectedYear`'s — what a reminder plan must be built from.
    ///
    /// Reminder scheduling must not be scoped to whichever year the user
    /// happens to be *looking at*: the year picker lets someone browse a
    /// past season at any time, and doing so must not cancel a reminder for
    /// a favorited event in the current season just because that event
    /// isn't in `snapshot?.events` while an archive year is on screen. So
    /// this unions every year's cached snapshot (favorites are global, keyed
    /// only by `Event.id`, with no notion of "which year was selected when
    /// the reminder was made") rather than reading `snapshot` alone.
    ///
    /// Falls back to `snapshot?.events` alone when `years` is still empty
    /// (the very first moment of `start()`, before the years manifest has
    /// ever been fetched) so the first sync still has something to work
    /// from instead of unconditionally scheduling nothing.
    private func reminderPlanEvents() async -> [Event] {
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
    /// Re-tapping the active scope is a no-op. The web toggles back to
    /// "all" here, but it has no All button; iOS does, so the scope row
    /// behaves as a radio group instead.
    func selectScope(_ scope: DateScope) {
        guard filter.dateScope != scope || !filter.selectedWeeks.isEmpty else { return }
        filter.dateScope = scope
        filter.selectedWeeks = []
        persistFilter()
    }

    /// Replaces the week selection wholesale — the strip owns tap/drag
    /// semantics (`WeekStripDrag.commit`); the model just stores the result.
    /// Unconditionally forces `.all`: weeks and relative scopes are mutually
    /// exclusive, one date range at a time, and an empty commit means "no
    /// week filter" — which `.all` represents, same as every other deselect
    /// path.
    func setWeekSelection(_ weeks: Set<Int>) {
        filter.dateScope = .all
        filter.selectedWeeks = weeks
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
        let arguments = ProcessInfo.processInfo.arguments
        if let flagIndex = arguments.firstIndex(of: "-uitest-freeze-now"),
           arguments.index(after: flagIndex) < arguments.endIndex,
           let frozen = ChqTime.parse(arguments[arguments.index(after: flagIndex)]) {
            return { frozen }
        }
        #endif
        return { Date() }
    }

    #if DEBUG
    // MARK: UI-test hooks (DEBUG only)

    /// Shared flags/lookups consumed by `CalendarView`, `EventListView`, and
    /// `EventDetailView` to make interactive states reachable for
    /// screenshot-based verification when `xcrun simctl` can't synthesize a
    /// tap (see task-12 brief). This whole section compiles out of Release
    /// builds.

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
    /// Out of range returns `nil`, which makes the hook a **no-op** (the
    /// detail column stays on its "Select an event" placeholder) rather
    /// than clamping to the nearest valid index. Clamping would silently
    /// capture a *different, plausible-looking* event than the plan asked
    /// for, and a typo'd index would ship a wrong-but-believable store
    /// screenshot. A no-op is visible in the review pass instead.
    func uiTestLinkedEvent(at index: Int) -> Event? {
        let events = uiTestLinkedEvents
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
