import SwiftUI

/// The day-grouped event list shared by both the compact (iPhone,
/// `NavigationStack`) and regular (iPad, `NavigationSplitView`) layouts in
/// `CalendarView`.
///
/// `selection` is the single knob that changes behavior between the two:
/// - `nil` (compact): rows are `NavigationLink(value:)`, tapping one pushes
///   `EventDetailView` onto the enclosing `NavigationStack` via the
///   `navigationDestination(for:)` below.
/// - non-nil (regular): rows are plain, `.tag`ged views and the `List`
///   itself drives selection — tapping one updates the bound `Event?` so the
///   split view's detail column can show it, no push involved. The
///   `navigationDestination(for:)` modifier is harmless-but-unused in this
///   mode since nothing ever pushes a value.
///
/// Everything else — the loading/offline/error/no-matches states, the
/// countdown/offline banners, the Filters and search toolbar buttons, and
/// `refreshable` — is identical between the two layouts, which is the whole
/// point of sharing this view.
struct EventListView: View {
    @Bindable var model: AppModel
    var selection: Binding<Event?>?

    /// Set by the toolbar's magnifier button to focus the search field that
    /// `CalendarView` owns. A `FocusState.Binding` rather than a plain
    /// `Bool` binding because `.searchFocused` requires one.
    var searchFocus: FocusState<Bool>.Binding

    @State private var isAboutPresented = false

    /// Whether the filter sheet is up.
    @State private var isFilterSheetPresented = false

    /// Which day the rail highlights when nothing else claims it (no
    /// scroll-derived anchor yet, no pending tap). View state: derived from
    /// what is on screen, never persisted, and never part of the filter.
    @State private var anchorDay: String?

    /// Day sections currently on screen, maintained from section-header
    /// appearance rather than a per-section geometry probe.
    ///
    /// `List` recycles views, and a recycled `GeometryReader` sentinel is
    /// what made this project raise its deployment target to iOS 18 — so a
    /// geometry read per section (`onScrollGeometryChange` + a preference
    /// key per row) is the approach with a known failure mode here.
    /// `onAppear`/`onDisappear` on the section *header* uses `List`'s own
    /// lifecycle instead and adds no per-frame geometry work.
    ///
    /// Measured on iPhone 17 Pro, iOS 26.1 simulator, 2026-08-18, via two
    /// throwaway XCUITests against the `-uitest-fixture` list (neither
    /// committed):
    ///
    /// **Slow drags** (20 steps, ~0.15-screen `press(forDuration:thenDragTo:)`
    /// each) — logged which chip was selected and which day-title header was
    /// topmost on screen after each step. Selected day advanced from
    /// 2026-07-01 to 2026-08-05, strictly non-decreasing across all 20
    /// steps.
    ///
    /// **Fast swipes** (8 steps of `swipeUp(velocity: .fast)` — the same
    /// gesture the committed `testTheHighlightFollowsTheReaderDownTheList`
    /// uses, and what real readers actually do; `List` view recycling, the
    /// thing this whole approach exists to avoid, misfires far more readily
    /// under large fast deltas than small controlled ones, so this is the
    /// gesture that actually stresses it) — same logging, plus the raw
    /// `visibleDays` set contents at each step (via a temporary debug
    /// accessibility element). Selected day advanced from 2026-07-01 to
    /// 2026-08-06 over the 8 swipes (each covering ~4-6 days, several times
    /// the slow-drag step size), strictly non-decreasing across all 8.
    /// **In every one of the 9 samples, `selected == visibleDays.min()`
    /// exactly**, and each step's set was small (3-4 entries) and tightly
    /// clustered around the current position — never an orphaned low key
    /// held over from several swipes back, which is what a stuck
    /// `onDisappear` would look like (a set that either grows unboundedly or
    /// keeps a stale minimum no longer near the rest of the entries). That
    /// directly rules out a stuck `onDisappear` under the gesture that would
    /// actually expose one.
    ///
    /// Both runs also showed the selected chip occasionally *not* matching
    /// the independently-measured "topmost header" — always with the header
    /// slightly ahead, never behind. The fast-swipe run's `visibleDays` logs
    /// show why: on every one of those misses, the header measurement's own
    /// query (`frame.minY > rail.frame.maxY`, a simple boundary check) had
    /// skipped a section header that was still legitimately in
    /// `visibleDays` but sitting pinned behind/under the rail rather than
    /// fully clear of it — a limitation of that ad hoc measurement query,
    /// not of the anchor. The anchor itself was correct in every sample.
    ///
    /// Kept as-is; approach B (`.onScrollGeometryChange`) was not needed.
    @State private var visibleDays: Set<String> = []

    /// The last day whose final row triggered `expandWindowEnd()`. Guards
    /// `autoExpandIfAtTheEnd` against firing again the instant the newly
    /// appended day's own final row appears — see that function's doc.
    @State private var autoExpandedThrough: String?

    /// A day the reader has asked for that has not mounted yet, stamped with
    /// the filter identity it was tapped under.
    ///
    /// Set by a tap, cleared when the day arrives — or when waiting becomes
    /// pointless. A target that is never cleared survives every later commit
    /// and hijacks one of them, scrolling the reader to a day they tapped
    /// under a different scope, minutes ago — the `PendingDayScroll.Key`
    /// stamp is what `landPendingScroll` checks to catch a scope change that
    /// `DayRailNavigation.shouldAbandonScroll` alone cannot see (that check
    /// only fires once the window covers the target; a scope change can move
    /// the window *away* from the target without ever covering it).
    @State private var pendingScroll: PendingDayScroll.Target?

    /// A day the reader explicitly chose — by tapping a chip or a step
    /// control — that outranks `scrollAnchor` until the reader actually
    /// scrolls the list themselves.
    ///
    /// Fixes the report that the rail loses its highlight after a tap: once
    /// `pendingScroll` resolves (synchronously, for a target already inside
    /// the window — see `resolvePendingScroll`), authority used to fall
    /// straight back to `scrollAnchor`, whose `visibleDays.min()` — per the
    /// long finding on `visibleDays` above — lands a day or two short of
    /// where a `.top`-anchored `scrollTo` actually put the reader, because
    /// `List` keeps an off-screen earlier header's `onAppear` counted after
    /// a programmatic jump. That pointed the rail at a chip the reader
    /// hadn't chosen and wasn't looking at. Pinning the tapped day here,
    /// ranked above `scrollAnchor`, keeps the rail on the day the reader
    /// actually asked for regardless of that imprecision.
    ///
    /// Reuses `PendingDayScroll.Target`/`Key` rather than a second staleness
    /// notion: the same "everything but the window-expansion fields"
    /// identity that makes a pending scroll stale after a scope change makes
    /// a pinned selection stale for exactly the same reason, so
    /// `PendingDayScroll.isStale` answers both.
    @State private var pinnedSelection: PendingDayScroll.Target?

    #if DEBUG
    /// The wall-clock moment the current `pendingScroll` is allowed to
    /// resolve, stamped from `model.uiTestPendingScrollDelay` — see that
    /// property's doc. `nil` whenever the hook is inactive (every real
    /// launch, and any tap not covered by `-uitest-delay-pending-scroll`),
    /// which keeps this whole path inert.
    ///
    /// A *deadline* rather than a countdown consumed by the first caller:
    /// `list(days:)` wires two independent triggers onto `landPendingScroll`
    /// (`days.map(\.id)` and `pendingScroll` itself), and a distant tap can
    /// fire both in the same SwiftUI commit. A one-shot delay let whichever
    /// trigger ran second see it already spent and resolve synchronously —
    /// defeating the hold entirely. Stamping a deadline once, at arm time,
    /// means every later call — no matter how many, or from which trigger —
    /// re-checks the same clock and keeps deferring until it has actually
    /// passed.
    @State private var pendingScrollDeadline: Date?
    #endif

    /// How long after `resolvePendingScroll`'s first actual attempt at a
    /// target we keep re-issuing its `scrollTo` until the day is actually on
    /// screen — see `PendingDayScroll.hasLanded` for why issuing one is not
    /// landing one.
    ///
    /// Measured from the first *attempt*, not from `selectDay` arming the
    /// target — `list(days:)`, where every attempt happens, is not mounted
    /// when `model.dayGroups` is empty (a favourites-only filter with
    /// nothing upcoming, say). A deadline stamped at arm time would burn down
    /// in real time while the list is unmounted and nothing can even try;
    /// when the reader later clears the filter and the list mounts, the
    /// window could already be spent, and the first attempt would read as
    /// "already expired" and give up without ever issuing a `scrollTo`. See
    /// `resolvePendingScroll` for where this is stamped.
    ///
    /// Generous on purpose. It costs nothing when the scroll lands on the
    /// first attempt (the common case: the confirmation reads `visibleDays`,
    /// sees the target, and clears immediately). It is a ceiling on how long
    /// an unlandable target stays armed, not a latency anyone waits out, and
    /// picking a tight number here would be guessing at exactly the timing
    /// that is not understood well enough to guess at.
    private static let scrollRetryWindow: TimeInterval = 5

    /// Gap between those re-issues. Short enough that a reader never sees the
    /// list sitting still after asking for a day; long enough that each
    /// attempt gets a layout pass to actually use.
    private static let scrollRetryInterval: TimeInterval = 0.1

    /// The wall-clock moment `pendingScroll` stops being re-issued and is
    /// dropped whether or not its day ever appeared.
    ///
    /// Stamped lazily by `resolvePendingScroll`, on its first actual
    /// resolution attempt for the current target — **not** by `selectDay` at
    /// arm time. `selectDay` only resets this to `nil`. The two used to be
    /// the same moment, and that was itself a bug fixed on this branch
    /// (`resolvePendingScroll`'s `!visibleDays.isEmpty` guard, for #250): a
    /// deep link consumed while `list(days:)` is unmounted (a
    /// favourites-only filter with nothing upcoming, showing
    /// `noMatchesView`) has no `resolvePendingScroll` call to stamp anything
    /// — arming at `selectDay` would burn the whole window in real time
    /// before a single attempt could run, and the eventual first attempt,
    /// after the reader clears the filter, would find the deadline already
    /// passed and give up immediately.
    ///
    /// `nil` here means "no attempt has happened yet for the armed target",
    /// which is also the meaning while nothing is pending at all —
    /// `clearPendingScroll` resets both together. It is never read as "give
    /// up" by `PendingDayScroll.hasLanded`: `resolvePendingScroll` always
    /// stamps a concrete deadline before that call, so `hasLanded`'s own
    /// `nil` branch (its pre-existing "do not retry" default) is dead in
    /// this path and stays only as the conservative fallback if that ever
    /// stops being true.
    ///
    /// A deadline rather than an attempt counter for the same reason
    /// `pendingScrollDeadline` is one: `list(days:)` wires several
    /// independent triggers onto `landPendingScroll`, more than one can fire
    /// from a single commit, and two concurrent retry chains sharing a
    /// counter would burn the budget at twice the rate. Sharing a wall-clock
    /// deadline, they simply stop at the same moment.
    @State private var scrollRetryDeadline: Date?

    /// Bumped by a scheduled re-check so `list(days:)` re-runs
    /// `landPendingScroll` — see its `.onChange(of: scrollRetryTick)`.
    ///
    /// The retry goes through view state rather than re-entering
    /// `landPendingScroll` from the dispatched closure directly so that each
    /// attempt reads the `days` array of the *current* render. A closure
    /// capturing `days` would re-scroll against a snapshot that may since
    /// have shrunk (a filter change) or grown, which is the class of bug
    /// `PendingDayScroll.Key` exists to catch, not to reintroduce.
    @State private var scrollRetryTick = 0

    /// Guards `scheduleScrollRetry` so at most one retry timer is ever in
    /// flight at once.
    ///
    /// `resolvePendingScroll` runs once per triggering `.onChange`, and
    /// `list(days:)` wires several independent triggers onto
    /// `landPendingScroll` — more than one can fire from a single SwiftUI
    /// commit (see `scrollRetryDeadline`'s doc). Before this guard, each of
    /// those calls that failed to land its target scheduled its own
    /// `asyncAfter`, so a single commit could leave N concurrent timers
    /// running `scrollRetryInterval` apart from each other rather than from a
    /// shared start — a burst of `scrollTo` attempts and view updates instead
    /// of the one retry per interval this was designed for.
    ///
    /// Keyed on "a timer is outstanding", not on which target it is for, so
    /// it cannot suppress a genuine retry: the scheduled closure always fires
    /// and always re-checks live `pendingScroll` state before deciding
    /// whether to bump `scrollRetryTick`, exactly as before this guard
    /// existed. If the target changes (or lands, or goes stale) while a timer
    /// is outstanding, a caller that would have scheduled a second timer for
    /// the new state instead no-ops — the one outstanding timer still fires
    /// and still re-enters `landPendingScroll` against whatever is pending by
    /// then, so the retry is deduplicated, never dropped. Cleared
    /// unconditionally inside the closure — the only place it goes back to
    /// `false` — so a stale `true` can never wedge every later retry.
    @State private var scrollRetryScheduled = false

    /// The earliest visible day section — the day whose header is at (or
    /// just above) the top of the viewport. `min()` on day-key strings works
    /// because `DayGroup.id` sorts lexicographically the same as
    /// chronologically (`yyyy-MM-dd`).
    private var scrollAnchor: String? { visibleDays.min() }

    /// `pinnedSelection`, if it is still current: neither stale under the
    /// filter identity it was chosen under, nor a day navigation can no
    /// longer reach (a filter change can narrow `nav.bounds` out from under
    /// a day that was in range when it was tapped).
    private func pinnedSelectionDay(in nav: NavMatching) -> String? {
        guard let pinnedSelection else { return nil }
        let currentKey = PendingDayScroll.key(for: model.filter, year: model.selectedYear)
        guard !PendingDayScroll.isStale(pinnedSelection, currentKey: currentKey) else { return nil }
        guard nav.bounds.contains(pinnedSelection.day) else { return nil }
        return pinnedSelection.day
    }

    var body: some View {
        content
            // Inline, and shortened to fit beside the year and overflow
            // toolbar items. The large-title band was ~70pt of empty space
            // above the list with no title text ever drawn in it.
            .navigationTitle("CHQ Calendar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbarContent }
            // Only once there is a snapshot to filter against — during
            // launch or the offline/error states the pills would summarise
            // nothing.
            .safeAreaInset(edge: .top) {
                if model.snapshot != nil, let nav = model.navMatching {
                    dayRail(nav)
                }
            }
            // The link can arrive before this view exists (a cold launch from
            // Siri), at the moment the tab switch mounts it, or later while it
            // is already on screen — and in every case it can only be acted on
            // once `snapshot` lands. Hence three triggers, all funnelling into
            // one idempotent resolver: `resolvePendingDayDeepLinkIfPossible`
            // returns the key exactly once, so extra calls cost a nil check.
            // `snapshot?.fetchedAt` rather than `phase` for the same reason
            // `resolvePendingEventDeepLinkIfPossible`'s callers use it: a warm
            // launch sets `phase = .ready` immediately and never changes it
            // again when the background refresh replaces the snapshot.
            //
            // **On `body`, deliberately — not inside `list(days:)`.** `content`
            // only builds the list when `model.dayGroups` is non-empty, so
            // triggers hosted there are unmounted in exactly the states a
            // pending link most needs resolving: a persisted favourites-only
            // filter with nothing upcoming, or any filter matching nothing,
            // renders `noMatchesView` instead. Siri would say "Opening
            // tomorrow.", nothing would happen, and the link would stay
            // pending — then fire minutes later, teleporting the reader, the
            // moment they cleared the filter and the list mounted. `body` is
            // always mounted, which is also where the `.event` resolver has
            // always lived (`CalendarView`). Nothing here needs the list:
            // `selectDay` takes no `ScrollViewProxy` (it arms `pendingScroll`,
            // which `list(days:)` resolves whenever it does mount), and
            // `resolvePendingDayDeepLinkIfPossible` already gates on
            // `snapshot != nil`.
            .onChange(of: model.pendingDeepLink) { _, _ in
                consumePendingDayLinkIfPossible()
            }
            .onChange(of: model.snapshot?.fetchedAt) { _, _ in
                consumePendingDayLinkIfPossible()
            }
            .onAppear {
                consumePendingDayLinkIfPossible()
            }
            .sheet(isPresented: $isAboutPresented) {
                AboutView(model: model)
            }
            .sheet(isPresented: $isFilterSheetPresented) {
                FilterSheet(model: model)
            }
            #if DEBUG
            .onAppear(perform: presentFilterSheetIfNeeded)
            .onChange(of: model.uiTestShowFilters) { _, _ in presentFilterSheetIfNeeded() }
            .onAppear(perform: presentAboutIfNeeded)
            .onChange(of: model.uiTestShowAbout) { _, _ in presentAboutIfNeeded() }
            #endif
    }

    #if DEBUG
    // MARK: UI-test hooks (DEBUG only)

    /// `-uitest-show-filters` used to expand `FilterBarView`'s Venues panel.
    /// That view is gone, so the equivalent "show me the filter UI" state is
    /// now the filter sheet. Both `onAppear` (flag already true when this
    /// view mounts, e.g. a warm cache where `start()` finished before the
    /// view appeared) and `onChange` (view mounted before `start()` flipped
    /// the flag, e.g. a cold launch) are needed to catch either ordering.
    private func presentFilterSheetIfNeeded() {
        if model.uiTestShowFilters {
            model.uiTestShowFilters = false
            isFilterSheetPresented = true
        }
    }

    /// `-uitest-show-about` — see `presentFilterSheetIfNeeded` above for why
    /// both `onAppear` and `onChange` are wired.
    private func presentAboutIfNeeded() {
        if model.uiTestShowAbout {
            model.uiTestShowAbout = false
            isAboutPresented = true
        }
    }

    /// Non-nil only for the single badge `-uitest-show-week-theme` targets
    /// (`target`, computed once per render by `list(days:)` via
    /// `AppModel.uiTestFirstThemedWeek(in:)`) — every other badge in
    /// `dayHeader` gets `nil` and behaves exactly as it did before this hook
    /// existed. See `WeekThemeBadge.uiTestAutoShow` for how the binding is
    /// consumed.
    private func uiTestAutoShowThemeBinding(
        day: DayGroup, week: Int, target: (dayID: String, week: Int)?
    ) -> Binding<Bool>? {
        guard let target, target.dayID == day.id, target.week == week
        else { return nil }
        return $model.uiTestShowWeekTheme
    }
    #endif

    /// The day rail: every day navigation can reach, with how many events
    /// each holds under the current non-date filters.
    ///
    /// Mounted on `content` via `.safeAreaInset(edge: .top)`, so it is chrome
    /// rather than content. A `safeAreaInset` bar contributes its height to
    /// the scroll view's safe area exactly as a toolbar would, so the list
    /// insets its own content and its scroll indicator to clear it without
    /// any margin of ours.
    ///
    /// The span is `navigableBounds`, deliberately independent of the current
    /// scope: in `Today` it still shows the week around you, because the rail
    /// is a navigation surface, not a filter readout.
    private func dayRail(_ nav: NavMatching) -> some View {
        let todayKey = ChqTime.dayKey(for: model.now())
        // A pending tap outranks everything else until it lands, so a tap
        // does not flicker back to where the reader was; the pinned
        // selection then outranks the scroll anchor, so the rail stays on
        // the day the reader chose rather than the imprecise scroll-derived
        // one — see `pinnedSelection`'s doc; the scroll anchor outranks the
        // stale `anchorDay` fallback, which only still matters before any
        // section header has appeared at all.
        let anchor = pendingScroll?.day ?? pinnedSelectionDay(in: nav) ?? scrollAnchor ?? anchorDay
        let step = DayRailNavigation.stepTargets(anchor: anchor, eventDays: nav.eventDays)
        let reachableToday = DayRailNavigation.reachableTodayKey(
            model.isCurrentYear ? todayKey : nil, bounds: nav.bounds)

        return DayRailView(
            entries: MyDayChipContent.makeAll(
                days: ChqTime.dayKeys(from: nav.bounds.lowerBound, through: nav.bounds.upperBound),
                todayKey: todayKey,
                counts: nav.countsByDay,
                style: .events,
                includingYear: !model.isCurrentYear),
            selectedDay: anchor,
            accessibilityLabel: "Days in the season",
            disablesEmptyDays: true,
            onSelect: selectDay,
            leading: {
                if let reachableToday {
                    nowButton(reachableToday, nav: nav)
                }
            },
            trailing: { EmptyView() })
        .background(.bar)
        // The chevrons used to carry this capability visibly — they were the
        // only control that skipped *empty* days, since tapping a
        // neighbouring chip lands on the next chip, not the next day with
        // events. Removing them for the chip space (#256) would silently
        // drop that for VoiceOver, so it survives here as two custom
        // actions over the same `DayRailNavigation.stepTargets` the
        // chevrons used. Named by capability ("Next day with events")
        // rather than by destination ("Go to Sunday, August 16, 4 events"):
        // a rotor action is read from a list before it's chosen, where the
        // capability is the useful thing to say, unlike a button the reader
        // is already focused on.
        .accessibilityAction(named: Text("Previous day with events")) {
            if let previous = step.previous { selectDay(previous) }
        }
        .accessibilityAction(named: Text("Next day with events")) {
            if let next = step.next { selectDay(next) }
        }
    }

    /// `⟳ Now`: navigation, never a filter change — the spec is explicit
    /// that ⟳ Now "does not touch scope, weeks, categories, or search," the
    /// same premise the web's `goToToday` (`page.tsx`) is built on. This is
    /// exactly `selectDay(todayKey)`: whatever edge needs to grow to reach
    /// today grows, a scroll is queued, and nothing else about the filter
    /// moves. A reader with a week filter active keeps it after tapping Now.
    ///
    /// There used to be an `AppModel.resetToNow()` here too, which collapsed
    /// accumulated expansion and cleared weeks/scope before this scrolled —
    /// exactly the filter-touching behavior the spec rules out. It had no
    /// other caller, so it was deleted rather than left vestigial.
    ///
    /// Rendered only when `reachableToday` is non-`nil` (in-season, current
    /// year): `DayRailNavigation.reachableTodayKey` returns `nil` for most of
    /// the year, and a control whose target is refused by `selectDay` would
    /// be visible, enabled, and do nothing — disabled-not-hidden is for a
    /// control with *no* destination, not one whose destination is invalid.
    private func nowButton(_ todayKey: String, nav: NavMatching) -> some View {
        Button {
            selectDay(todayKey)
        } label: {
            Label("Now", systemImage: "arrow.clockwise")
                .labelStyle(.iconOnly)
                .font(.subheadline.weight(.semibold))
                // `.primary`, not the default accent tint — see
                // `DayStepControl`'s matching comment for why.
                .foregroundStyle(.primary)
                // Minimum, not fixed (accessibility follow-up to #245) —
                // see `DayStepControl`'s matching comment for why.
                .frame(minWidth: 44, minHeight: 62)
                .background(Color.dayRailControlBackground, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(stepLabel(for: todayKey, nav: nav))
        .accessibilityIdentifier("day-rail-now")
    }

    /// A day's spoken name, built from the same `MyDayChipContent` the
    /// rail's own chips use — so a control and the chip it points at can
    /// never describe the same day differently.
    ///
    /// Also what `⟳ Now`'s label uses: its target is always today, so
    /// `content.accessibilityLabel` already says so on its own ("Go to
    /// Wednesday, July 1, today, 3 events") — no bespoke "Go to today"
    /// prefix is needed, and adding one would say "today" twice.
    private func stepLabel(for dayKey: String, nav: NavMatching) -> String {
        let content = MyDayChipContent.make(
            dayKey: dayKey,
            todayKey: ChqTime.dayKey(for: model.now()),
            count: nav.countsByDay[dayKey] ?? 0,
            style: .events,
            includingYear: !model.isCurrentYear)
        return content?.accessibilityLabel ?? dayKey
    }

    /// A day rail chip was tapped. Grows at most one edge of the window if
    /// the day lies past it, then queues a scroll for `list(days:)` to land
    /// once the day mounts. Refused targets (outside the navigable bounds)
    /// leave `pendingScroll` untouched, so no scroll is queued for a day
    /// that will never arrive.
    ///
    /// `model.goToDay` has already applied the window expansion by the time
    /// `PendingDayScroll.key` reads `model.filter` below, but that's fine:
    /// the key deliberately excludes the window fields, so the expansion it
    /// just performed can never itself be read as a mismatch.
    private func selectDay(_ dayKey: String) {
        guard model.goToDay(dayKey) else { return }
        anchorDay = dayKey
        let target = PendingDayScroll.Target(
            day: dayKey,
            key: PendingDayScroll.key(for: model.filter, year: model.selectedYear))
        pendingScroll = target
        pinnedSelection = target
        // Reset, not stamped: a fresh arm must not inherit whatever deadline
        // (spent or otherwise) belonged to a previous target, and stamping
        // one here would measure the retry window from a moment
        // `resolvePendingScroll` may not get to run at for a while — see
        // `scrollRetryDeadline`'s doc. It gets its real value lazily, on the
        // first actual resolution attempt.
        scrollRetryDeadline = nil
        #if DEBUG
        // `model.uiTestPendingScrollDelay` is still consumed once, here —
        // reset to `0` so only this one arm is delayed, not every tap after
        // it. What changes is what the delay becomes: a deadline stamped
        // against this arm, not a countdown the first `landPendingScroll`
        // call burns for every trigger that follows in the same commit.
        let delay = model.uiTestPendingScrollDelay
        pendingScrollDeadline = delay > 0 ? Date().addingTimeInterval(delay) : nil
        model.uiTestPendingScrollDelay = 0
        #endif
    }

    /// Completes a `chqcal://day/<key>` deep link the tab route deliberately
    /// left pending (`DeepLinkTabRoute.resolve(.day)` sets
    /// `consumesLink: false`).
    ///
    /// Routes through `selectDay` — the exact function a rail chip tap calls —
    /// so for any day the rail also offers, a Siri "show me tomorrow" and a
    /// finger on tomorrow's chip leave the app in identical state: same window
    /// expansion, same pinned selection, same queued scroll. `selectDay`
    /// already refuses an unreachable day, so nothing extra is needed for a
    /// link naming a day outside the season.
    ///
    /// Voice reaches strictly *more* days than touch, and that is intended.
    /// `OpenDayTarget` bounds against the whole unfiltered year, so a day
    /// holding nothing under the reader's active filter is still a legal
    /// target — while the rail disables that day's chip, so a finger cannot
    /// choose it. This is the same asymmetry `AppModel.goToDay` already
    /// documents and `goToDayAcceptsAnEmptyDayEvenThoughTheRailDisablesItsChip`
    /// pins: a day the reader *names* is a destination even when empty. It is
    /// also not closable — an App Intent runs out of process against the
    /// shared cache and cannot see the live filter at all.
    private func consumePendingDayLinkIfPossible() {
        guard let dayKey = model.resolvePendingDayDeepLinkIfPossible() else { return }
        selectDay(dayKey)
    }

    /// Land a pending target if its day has mounted; give up if it never
    /// will, or if the reader has since left the scope/filters it was
    /// tapped under (`PendingDayScroll.isStale`) — a scope change can move
    /// the window away from the target without ever covering it, which
    /// `DayRailNavigation.shouldAbandonScroll` alone cannot see.
    ///
    /// Landing is *confirmed*, not assumed: see `PendingDayScroll.hasLanded`
    /// and `resolvePendingScroll`'s abandon guard below.
    ///
    /// **Deliberately unanimated.** A smooth scroll does not re-target
    /// mid-flight: on the web the equivalent animation ran ~2s while the
    /// document grew 1020px beneath it, and the tap landed ~1058px short of
    /// its target. Growing content plus a smooth scroll is a race the scroll
    /// loses.
    private func landPendingScroll(_ proxy: ScrollViewProxy, days: [DayGroup]) {
        guard pendingScroll != nil else { return }

        #if DEBUG
        if let deadline = pendingScrollDeadline {
            let remaining = deadline.timeIntervalSinceNow
            if remaining > 0 {
                // Re-enter this same function once the deadline is actually
                // up, rather than resolving unconditionally — any number of
                // calls landing here before then (the two triggers on
                // `list(days:)` can both fire from one commit) just
                // re-schedule against the same still-future deadline and
                // return, so none of them can jump the line.
                DispatchQueue.main.asyncAfter(deadline: .now() + remaining) { [self] in
                    landPendingScroll(proxy, days: days)
                }
                return
            }
            pendingScrollDeadline = nil
        }
        #endif
        resolvePendingScroll(proxy, days: days)
    }

    /// The actual staleness/mount decision, factored out of `landPendingScroll`
    /// so `-uitest-delay-pending-scroll` can defer *when* this runs without
    /// duplicating *what* it does.
    private func resolvePendingScroll(_ proxy: ScrollViewProxy, days: [DayGroup]) {
        guard let pending = pendingScroll else { return }

        // The retry window starts here, on the first real attempt at this
        // target — not back when `selectDay` armed it. `selectDay` only
        // resets `scrollRetryDeadline` to `nil`; a `nil` reaching this point
        // means no attempt has happened yet for `pending`; see
        // `scrollRetryDeadline`'s doc for why arm time was the wrong moment.
        // Every call to `resolvePendingScroll` after this one for the same
        // target finds a non-nil deadline and leaves it alone.
        //
        // Kept in a local as well as in `@State` because the `hasLanded`
        // call at the bottom of this function has to read *this* attempt's
        // deadline with certainty. `hasLanded` reads `nil` as "done, do not
        // retry"; if the write below were not yet visible to a read later in
        // the same function, the very first attempt would abandon its own
        // target — precisely the failure this stamping order exists to fix.
        // A local removes the question rather than resolving it, and
        // `PendingDayScroll.retryDeadline`'s non-optional return means the
        // value handed to `hasLanded` cannot be `nil` by construction.
        let retryDeadline = PendingDayScroll.retryDeadline(
            existing: scrollRetryDeadline, now: Date(), window: Self.scrollRetryWindow)
        scrollRetryDeadline = retryDeadline

        let currentKey = PendingDayScroll.key(for: model.filter, year: model.selectedYear)
        if PendingDayScroll.isStale(pending, currentKey: currentKey) {
            clearPendingScroll()
            return
        }

        if days.contains(where: { $0.id == pending.day }) {
            issueScroll(proxy, to: pending.day)
        } else if !visibleDays.isEmpty,
                  DayRailNavigation.shouldAbandonScroll(
                    target: pending.day, window: model.currentWindow) {
            // `!visibleDays.isEmpty` is the fix for #250, and it is load-
            // bearing. `shouldAbandonScroll` reads `model.currentWindow` —
            // live state — while `days` is whatever array the enclosing
            // render captured. On a cold launch consuming a day deep link
            // those two disagree exactly once, and fatally: `content` builds
            // `list(days:)` the moment `snapshot` lands, then `body`'s
            // `.onChange(of: model.pendingDeepLink)` runs `selectDay` in that
            // same update, so `goToDay` has already grown the window by the
            // time the freshly-mounted list's `.onAppear` fires — carrying
            // the *pre-growth* `days`. The rule then reads "the window covers
            // this day and it has no section", concludes it is an ordinary
            // empty day, and drops the target. The two `.onChange` triggers
            // arrive with correct data about two milliseconds later and are
            // swallowed by `landPendingScroll`'s `pendingScroll != nil`
            // guard, because there is no longer anything pending. Measured
            // on an iPhone 17 Pro / iOS 26.1 simulator: 5 failures in 18
            // runs, every one of them logging that single stale-`days` call
            // and nothing after it; 12 for 12 with this guard, with 9 of
            // those runs still hitting the stale call.
            //
            // An empty `visibleDays` means the list has not rendered a single
            // day header yet, which is true only of that first-mount call —
            // and is precisely when `days` cannot be trusted to correspond to
            // the current window. Any settled render (every chip tap, which
            // is what this rule was written for) has headers on screen and
            // still abandons immediately.
            clearPendingScroll()
            return
        }

        // Whether or not the day was mountable in `days`, the target is only
        // done once it is actually on screen — issuing a scroll is not
        // landing one, and `days` here may not even be the array this
        // render's `List` is showing. `PendingDayScroll.hasLanded` decides;
        // until it says yes, the target stays armed and
        // `scheduleScrollRetry` brings us back with whatever `days` the next
        // render has.
        if PendingDayScroll.hasLanded(
            day: pending.day,
            visibleDays: visibleDays,
            retryDeadline: retryDeadline,
            now: Date()) {
            clearPendingScroll()
        } else {
            scheduleScrollRetry()
        }
    }

    /// The one place `pendingScroll` is dropped, so its retry deadline can
    /// never outlive it and re-arm a chain for a target that is gone.
    private func clearPendingScroll() {
        pendingScroll = nil
        scrollRetryDeadline = nil
    }

    /// Ask `list(days:)` to run `landPendingScroll` again shortly, with the
    /// `days` of whatever render is current by then — see `scrollRetryTick`.
    ///
    /// Guarded by the same `pendingScroll != nil` check `landPendingScroll`
    /// itself opens with: by the time this closure runs, the target that
    /// justified the retry may already be gone — landed via an earlier
    /// retry, abandoned as stale, or cleared by a fresh tap elsewhere — and
    /// bumping the tick for nothing still forces a view update that
    /// re-enters `landPendingScroll` only to no-op. A tap that lands a new
    /// `pendingScroll` before this fires is still honored: the guard reads
    /// "something is pending", not "the same thing is still pending", so an
    /// in-flight retry for a still-armed (even if different) target keeps
    /// working exactly as before.
    ///
    /// Also guarded by `scrollRetryScheduled` so only one such timer is ever
    /// outstanding — see that property's doc for why a second, concurrent
    /// caller no-ops here rather than stacking another timer, and why that
    /// cannot drop a retry that is still genuinely owed.
    private func scheduleScrollRetry() {
        guard !scrollRetryScheduled else { return }
        scrollRetryScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.scrollRetryInterval) { [self] in
            scrollRetryScheduled = false
            guard pendingScroll != nil else { return }
            scrollRetryTick &+= 1
        }
    }

    /// `proxy.scrollTo`, with the `-uitest-drop-scrolls` hook in front of it.
    private func issueScroll(_ proxy: ScrollViewProxy, to day: String) {
        #if DEBUG
        if model.uiTestScrollsToDrop > 0 {
            // Simulate the scroll `List` drops when the target's section is
            // not resolvable yet — see `AppModel.uiTestScrollsToDrop`.
            model.uiTestScrollsToDrop -= 1
            return
        }
        #endif
        proxy.scrollTo(day, anchor: .top)
    }

    @ViewBuilder
    private var content: some View {
        if model.snapshot == nil {
            switch model.phase {
            case .offline:
                offlineUnavailableView
            case .failed(let message):
                errorUnavailableView(message)
            default:
                ProgressView("Loading events…")
            }
        } else {
            // Bound once here rather than read separately by an `.isEmpty`
            // check and then `list`: `model.dayGroups` reruns the whole
            // filter+group pipeline on every access (six `EventFilter`
            // stages over ~1,637 events plus `EventGrouping.byDay`), so
            // reading it twice would cost two full passes per render.
            let days = model.dayGroups
            if days.isEmpty {
                if model.filter.isDefault && model.landingState != .inSeason {
                    OffSeasonLandingView(model: model)
                } else {
                    noMatchesView
                }
            } else {
                list(days: days)
            }
        }
    }

    private func list(days: [DayGroup]) -> some View {
        let filtered = days.reduce(0) { $0 + $1.events.count }

        #if DEBUG
        // Computed once, here, against exactly the array this render is
        // about to show — not by re-reading `model.dayGroups` (which is
        // deliberately uncached and would both re-run the whole
        // filter+group pipeline and risk disagreeing with what actually
        // renders; see `AppModel.uiTestFirstThemedWeek(in:)`).
        let uiTestThemeTarget = model.uiTestFirstThemedWeek(in: days)
        #endif

        return ScrollViewReader { proxy in
            List(selection: selection) {
                if let countdownDays = model.countdownDays {
                    CountdownBanner(days: countdownDays)
                }
                if model.lastRefreshFailed {
                    OfflineBanner()
                }

                if model.filter.hasFilters, let total = model.snapshot?.events.count {
                    Text("\(filtered.formatted()) of \(total.formatted()) events")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .listRowSeparator(.hidden)
                }

                ForEach(days) { day in
                    Section {
                        ForEach(day.events) { event in
                            row(for: event)
                                .onAppear {
                                    autoExpandIfAtTheEnd(day: day, event: event, days: days)
                                }
                        }
                    } header: {
                        #if DEBUG
                        dayHeader(for: day, uiTestThemeTarget: uiTestThemeTarget)
                        #else
                        dayHeader(for: day)
                        #endif
                    }
                    .id(day.id)
                }
            }
            .listStyle(.plain)
            .scrollDismissesKeyboard(.immediately)
            // A reader who grabs the list themselves has moved on from
            // whatever they last tapped — clear the pin so the highlight
            // goes back to tracking where they scroll to. Same API the rail
            // itself already uses for the mirror-image guard (see
            // `DayRailView.isDragging`'s doc): `.tracking`/`.interacting` is
            // a finger actually on the list, never the programmatic
            // `scrollTo` that lands a tap. Gating on those two phases only —
            // not `.decelerating`/`.animating`/`.idle` — matters here for
            // the same reason it matters there: the programmatic scroll that
            // follows a tap must not clear the pin it just set.
            .onScrollPhaseChange { _, newPhase in
                if newPhase == .tracking || newPhase == .interacting {
                    pinnedSelection = nil
                }
            }
            // No `contentMargins(.bottom, …)` here: the list runs all the way
            // to the tab bar now that Filters lives in the toolbar (#256)
            // rather than in a bottom safe-area inset the list had to clear.
            .refreshable {
                await model.refresh(force: true)
            }
            .navigationDestination(for: Event.self) { event in
                EventDetailView(event: event, model: model)
            }
            // Retried on each commit that brings new days: `days.map(\.id)`
            // is ~30 strings and already in hand from this render, so
            // comparing it — rather than reading `model.dayGroups` again —
            // is what tells the retry a commit actually landed without
            // paying for a second filter+group pass.
            .onChange(of: days.map(\.id)) { _, _ in
                landPendingScroll(proxy, days: days)
            }
            // A tap that lands inside the window already (no expansion
            // needed) never changes `days`, so the trigger above never
            // fires — `selectDay` arms `pendingScroll` and nothing else
            // would ever resolve it. Triggering on the target itself closes
            // that gap. `PendingDayScroll.Target` is `Equatable`, so this
            // fires once per arm and once more when `resolvePendingScroll`
            // clears it back to `nil` — `landPendingScroll`'s own
            // `pendingScroll != nil` guard makes that second call a no-op,
            // so this cannot re-arm itself in a loop.
            .onChange(of: pendingScroll) { _, _ in
                landPendingScroll(proxy, days: days)
            }
            // The third trigger. The two above each fire at most once per
            // arm and `.onAppear` fires exactly once, so between them a
            // target gets a single `scrollTo` — which `List` can silently
            // drop when the section it names has not been resolved yet, and
            // which nothing would then re-issue. `resolvePendingScroll` bumps
            // `scrollRetryTick` whenever `PendingDayScroll.hasLanded` says
            // the day still is not on screen, landing back here with this
            // render's `days` to try again.
            //
            // Not the fix for #250 — that is the abandon guard in
            // `resolvePendingScroll` — but the same function's other
            // unchecked assumption, and `testADayDeepLinkSurvivesADroppedScroll`
            // pins it.
            .onChange(of: scrollRetryTick) { _, _ in
                landPendingScroll(proxy, days: days)
            }
            .onAppear {
                landPendingScroll(proxy, days: days)
            }
        }
    }

    /// Auto-expand forward, replacing the "Show next day" button.
    ///
    /// Fires when the final row of the final day appears. `autoExpandedThrough`
    /// is what stops it cascading: expansion appends a new final day, whose
    /// final row appears immediately, which would expand again — walking to
    /// the end of the season in one gesture. Recording the day we expanded
    /// *from* allows exactly one expansion per newly-reached last day, which
    /// is the same cadence the button had, minus the tap. The decision itself
    /// lives in `DayRailAutoExpand.shouldFire`, pure and unit-tested; this
    /// function is only the thin wrapper that consults it and performs the
    /// two side effects below.
    ///
    /// Forward only. Backward stays explicit (the ⟨ chevron in Task 11): the
    /// reader scrolling down has asked for more; the reader arriving at the
    /// top has not asked for the past.
    ///
    /// **Order matters: the flag is set *before* `expandWindowEnd()` runs.**
    /// At the season's actual last day, `expandWindowEnd()` finds no later
    /// day and is a no-op — the window does not change, so the trigger
    /// condition (`day == days.last`) stays true forever and this row can
    /// legitimately appear again (e.g. a scroll away and back, or a list
    /// re-layout). Setting `autoExpandedThrough` unconditionally first means
    /// the guard latches on the *attempt*, not on whether anything actually
    /// expanded, so a season-edge no-op still stops future re-fires for that
    /// same day. Setting it after would leave a window — vanishingly small
    /// in practice, since `expandWindowEnd()` has no suspension point, but
    /// real in principle — where a second `onAppear` for the same row could
    /// read the not-yet-updated flag and call in again.
    ///
    /// **A concurrent `.refreshable` pull cannot interleave with this.**
    /// `expandWindowEnd()` is synchronous and has no `await` in it, so
    /// between reading `autoExpandedThrough` and writing
    /// `filter.windowEndDayKey` nothing else can run on the main actor —
    /// there is no suspension point for a refresh's `Task` to land in. The
    /// two mechanisms also touch disjoint state even if they did somehow
    /// overlap: `refresh(force:)` replaces `snapshot`/`phase`,
    /// `expandWindowEnd()` only ever narrows/widens `filter.windowEndDayKey`
    /// — neither reads the field the other writes, so there is nothing to
    /// race even without the synchronous-call guarantee above.
    private func autoExpandIfAtTheEnd(day: DayGroup, event: Event, days: [DayGroup]) {
        guard DayRailAutoExpand.shouldFire(
            day: day.id,
            event: event.id,
            lastDay: days.last?.id,
            lastEventInDay: day.events.last?.id,
            alreadyExpandedThrough: autoExpandedThrough)
        else { return }
        autoExpandedThrough = day.id
        model.expandWindowEnd()
    }

    @ViewBuilder
    private func row(for event: Event) -> some View {
        if selection != nil {
            EventRow(model: model, event: event)
                .tag(event)
        } else {
            NavigationLink(value: event) {
                EventRow(model: model, event: event)
            }
        }
    }

    #if DEBUG
    private func dayHeader(for day: DayGroup, uiTestThemeTarget: (dayID: String, week: Int)?) -> some View {
        HStack {
            Text(day.title)
            Spacer()
            ForEach(day.weekNumbers, id: \.self) { number in
                WeekThemeBadge(
                    weekNumber: number,
                    themes: model.themes,
                    uiTestAutoShow: uiTestAutoShowThemeBinding(day: day, week: number, target: uiTestThemeTarget))
            }
        }
        .onAppear { visibleDays.insert(day.id) }
        .onDisappear { visibleDays.remove(day.id) }
    }
    #else
    private func dayHeader(for day: DayGroup) -> some View {
        HStack {
            Text(day.title)
            Spacer()
            ForEach(day.weekNumbers, id: \.self) { number in
                WeekThemeBadge(weekNumber: number, themes: model.themes)
            }
        }
        .onAppear { visibleDays.insert(day.id) }
        .onDisappear { visibleDays.remove(day.id) }
    }
    #endif

    /// Non-`nil` only off-season (`landingState != .inSeason`), when the
    /// user's *own* filters — not the adaptive window — are what emptied the
    /// list: `OffSeasonLandingView` already owns the default-filter case
    /// (`EventListView.content`), so this only ever renders alongside a
    /// narrowed selection. Worded per state since `.preSeason` has no
    /// "ended" year to name.
    private var seasonNotice: String? {
        switch model.landingState {
        case .inSeason:
            return nil
        case .postSeason(let endedSeasonYear, _, _, _):
            return "The \(endedSeasonYear) season has ended — your filters match no events."
        case .preSeason:
            return "The \(model.selectedYear) season hasn't started yet — your filters match no events."
        }
    }

    private var noMatchesView: some View {
        ContentUnavailableView {
            Label("No matching events", systemImage: "calendar.badge.exclamationmark")
        } description: {
            if let seasonNotice {
                Text(seasonNotice)
            }
        } actions: {
            // Deliberately worded differently than the filter sheet's
            // "Clear Filters" button (`FilterSheet.swift`), even though both
            // ultimately call `clearAll()` here. If this said "Clear
            // Filters" too, a user who reached an empty list via a date/week
            // selection (e.g. Week 6 at a venue with no Week 6 events) could
            // tap it expecting the sheet's scoped behavior and silently lose
            // their week. Clearing everything is correct for this empty
            // state — recovering from "nothing matches" needs a full reset —
            // but the label must say so plainly rather than reuse a phrase
            // that means something narrower elsewhere in the app.
            //
            // Off-season (#177), a second, narrower option is added: the
            // user's non-date filters (search/venue/category/favorites) are
            // just as likely the culprit as the season being over, and
            // `clearNonDateFilters()` recovers from that without also
            // discarding a deliberate date/week choice the way `clearAll()`
            // would. In-season keeps exactly the single button this view has
            // always had — the season being current was never in question,
            // so there's nothing for a second, date-preserving option to add.
            if model.landingState == .inSeason {
                Button("Show All Events") {
                    model.clearAll()
                }
            } else {
                Button("Clear Filters") {
                    model.clearNonDateFilters()
                }
                Button("Show All Events") {
                    model.clearAll()
                }
            }
        }
    }

    private var offlineUnavailableView: some View {
        ContentUnavailableView {
            Label("You're Offline", systemImage: "wifi.slash")
        } description: {
            Text("Connect to the internet to load this season's events.")
        } actions: {
            Button("Retry") {
                Task { await model.refresh(force: true) }
            }
            .disabled(model.isRefreshing)
        }
    }

    private func errorUnavailableView(_ message: String) -> some View {
        ContentUnavailableView {
            Label("Something Went Wrong", systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            Button("Retry") {
                Task { await model.refresh(force: true) }
            }
            .disabled(model.isRefreshing)
        }
    }

    private var filterCount: Int { ActiveFilterCount.value(for: model.filter) }

    private var filtersAccessibilityLabel: String {
        filterCount == 0
            ? "Filters, none active. Double tap to change."
            : "Filters, \(filterCount) active. Double tap to change."
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        // Declared before Filters so it renders leftmost (⚌ 2026 ⋯ was the
        // confirmed left-to-right order for the three items below before
        // this one existed — see the comment further down) — the magnifier
        // is what buys back search's discoverability now that `CalendarView`
        // no longer keeps the field on screen at all times (#256).
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                searchFocus.wrappedValue = true
            } label: {
                Image(systemName: "magnifyingglass")
            }
            .accessibilityLabel("Search events")
            .accessibilityIdentifier("search-toolbar-button")
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                KeyboardDismisser.dismiss()
                isFilterSheetPresented = true
            } label: {
                // The badge is what makes this legible at icon size. An
                // icon alone cannot tell "everything" from "a slice", and
                // neither could the word "Filters" it replaces — which is
                // why the count moves with it rather than being dropped as
                // decoration.
                //
                // The condition has two halves on purpose.
                // `filterCount` alone is `ActiveFilterCount.value(for:)`,
                // which deliberately excludes date scope and week selection
                // — its own doc explains why: they used to be summarised by
                // the date pill sitting next to this one, and counting them
                // in both places would have double-reported one decision.
                // That pill is gone (#256); nothing else on screen says the
                // list is narrowed by scope or weeks. Without the second
                // half, a reader with only Weeks 1, 3, and 5 selected would
                // see a plain, unfilled icon — the exact "no visible sign
                // anything is filtered" complaint that started this task, in
                // a new place. `model.filter.isDefault` closes that gap: it
                // is true only when nothing the reader chose is narrowing
                // the list, so it fills the icon for a week/scope-only
                // narrowing without duplicating `filterCount`'s own number.
                //
                // Deliberately `isDefault`, not `hasDateFilters`.
                // `FilterSelection.hasDateFilters` is true on a fresh
                // install, because the default `dateScope` is `.next` and
                // `hasDateFilters` tests `dateScope != .all` — it would light
                // the icon for every reader before they touched anything,
                // and an indicator that is always on communicates nothing.
                // `isDefault` instead asks "did the reader change anything
                // from the out-of-the-box state," which is the question this
                // badge exists to answer.
                Image(systemName: filterCount > 0 || !model.filter.isDefault
                    ? "line.3.horizontal.decrease.circle.fill"
                    : "line.3.horizontal.decrease.circle")
            }
            .accessibilityLabel(filtersAccessibilityLabel)
            .accessibilityIdentifier("filters-toolbar-button")
        }
        // Declared after Filters and before the `⋯` menu below: `topBarTrailing`
        // items render in declaration order, first-declared-leftmost — verified
        // against a screenshot, not assumed (an earlier ordering here, declared
        // ⋯-then-year, rendered ⚌ ⋯ 2026, not the ⚌ 2026 ⋯ this reads left to
        // right today).
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                ForEach(model.years, id: \.self) { year in
                    Button {
                        Task { await model.select(year: year) }
                    } label: {
                        if year == model.selectedYear {
                            Label(String(year), systemImage: "checkmark")
                        } else {
                            Text(String(year))
                        }
                    }
                }
            } label: {
                Text(String(model.selectedYear))
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                ForEach(AboutInfo.quickLinks) { link in
                    SwiftUI.Link(destination: link.url) {
                        Label(link.title, systemImage: "arrow.up.right.square")
                    }
                }
                Divider()
                Button {
                    isAboutPresented = true
                } label: {
                    Label("About", systemImage: "info.circle")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .accessibilityLabel("More")
        }
    }
}
