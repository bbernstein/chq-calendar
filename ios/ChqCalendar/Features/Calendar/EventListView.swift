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
/// countdown/offline banners, the filter pill bar, and
/// `refreshable` — is identical between the two layouts, which is the whole
/// point of sharing this view.
struct EventListView: View {
    @Bindable var model: AppModel
    var selection: Binding<Event?>?

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @State private var isAboutPresented = false

    /// Which pill's sheet is up, if any.
    @State private var activeSheet: FilterBarSheet?

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

    private enum FilterBarSheet: String, Identifiable {
        case date
        case filters
        var id: String { rawValue }
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
            .safeAreaInset(edge: .bottom) {
                if model.snapshot != nil {
                    filterPillBar
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
            .sheet(item: $activeSheet) { sheet in
                switch sheet {
                case .date: DateFilterSheet(model: model)
                case .filters: FilterSheet(model: model)
                }
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
            activeSheet = .filters
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
    /// Mounted on `content` via `.safeAreaInset(edge: .top)` — the mirror of
    /// `filterPillBar` at the bottom — so it is chrome rather than content.
    /// A `safeAreaInset` bar contributes its height to the scroll view's safe
    /// area exactly as a toolbar would, so the list insets its own content
    /// and its scroll indicator to clear it without any margin of ours.
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
                DayStepControl(
                    symbol: "chevron.left",
                    identifier: "day-step-previous",
                    destinationLabel: step.previous.map { stepLabel(for: $0, nav: nav) },
                    emptyLabel: "No earlier days with events"
                ) {
                    if let previous = step.previous { selectDay(previous) }
                }
            },
            trailing: {
                DayStepControl(
                    symbol: "chevron.right",
                    identifier: "day-step-next",
                    destinationLabel: step.next.map { stepLabel(for: $0, nav: nav) },
                    emptyLabel: "No later days with events"
                ) {
                    if let next = step.next { selectDay(next) }
                }
            })
        .background(.bar)
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

        let currentKey = PendingDayScroll.key(for: model.filter, year: model.selectedYear)
        if PendingDayScroll.isStale(pending, currentKey: currentKey) {
            pendingScroll = nil
            return
        }

        if days.contains(where: { $0.id == pending.day }) {
            proxy.scrollTo(pending.day, anchor: .top)
            pendingScroll = nil
            return
        }

        if DayRailNavigation.shouldAbandonScroll(target: pending.day, window: model.currentWindow) {
            pendingScroll = nil
        }
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
            // No `contentMargins(.bottom, …)` here on purpose. Since task 16,
            // the date/filter pills are no longer a toolbar item — they're this
            // view's own hand-rolled `filterPillBar`, applied to `content` via
            // `.safeAreaInset(edge: .bottom)` in `body` above. A
            // `.safeAreaInset` bar contributes its height to the scroll view's
            // safe area the same way a real toolbar would, so the list already
            // insets its content (and its scroll indicator) to clear the pills
            // without any margin of ours. The inset is owned by the
            // `.safeAreaInset` modifier itself, not by any state of ours, so
            // nothing we render can shift the list vertically. Adding a margin
            // back would double-count it.
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

    /// The date pill's label. Never abbreviates — it is precisely the thing
    /// a scrolling user wants to keep reading.
    private var dateLabel: String {
        DateFilterLabel.text(
            for: model.filter,
            seasonWeekCount: SeasonCalendar.weeks(forYear: model.selectedYear).count,
            isCurrentYear: model.isCurrentYear)
    }

    private var filterCount: Int { ActiveFilterCount.value(for: model.filter) }

    private var filtersAccessibilityLabel: String {
        filterCount == 0
            ? "Filters, none active. Double tap to change."
            : "Filters, \(filterCount) active. Double tap to change."
    }

    /// The date/filter pill bar, floated above the tab bar via
    /// `.safeAreaInset(edge: .bottom)` in `body`.
    ///
    /// History: before the tab shell (task 16) these two buttons were a
    /// `ToolbarItemGroup(placement: .bottomBar)`, sharing the system's
    /// bottom bar with a `DefaultToolbarItem(kind: .search)` on iOS 26
    /// (where `.searchable`'s default placement was bottom-anchored — see
    /// git history of this comment for that arrangement's own rationale).
    /// `RootTabView`'s tab bar ended it: on both iOS 26 and the tab shell's
    /// first screenshots, the tab bar rendered ON TOP of any app-declared
    /// `.bottomBar` content — date pill, Filters, and the search item were
    /// all present but covered and untappable. So search moved to
    /// `.navigationBarDrawer` placement (in `CalendarView`), and these
    /// pills moved out of the toolbar system entirely into a safe-area
    /// inset, which the tab bar's own safe-area contribution stacks
    /// *above* rather than under (screenshot-verified in task 16).
    ///
    /// At accessibility text sizes the two pills no longer fit side by side —
    /// the date pill is `fixedSize` (abbreviating the date is worse than
    /// scrolling for it), so `Filters` was the one that truncated to `…`.
    /// Scrolling the row keeps both labels whole.
    ///
    /// **Both halves of that fix are gated on `isAccessibilitySize`, and the
    /// two gates must stay in step**: this `ScrollView`, and `Filters`' own
    /// `fixedSize` in `pillRow`. `fixedSize` without the `ScrollView` to
    /// rescue it is worse than the truncation it replaces — the row overflows
    /// with neither truncation nor scrolling, and the Filters capsule is
    /// clipped at the screen edge. That band is real and reachable:
    /// `.xxLarge`/`.xxxLarge` are large text but not *accessibility* text, so
    /// `isAccessibilitySize` is `false` there, and a long date label
    /// (`DateFilterLabel`'s "Weeks 1, 3, 5") on a 375pt-wide iPhone overflows
    /// the row. Those sizes therefore keep the pre-existing behaviour —
    /// `Filters` truncates to `…` and stays fully on screen — rather than
    /// getting the scrolling row. Below them both pills fit with room to
    /// spare, so the default layout keeps its `Spacer` and is pixel-identical
    /// either way.
    private var filterPillBar: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                ScrollView(.horizontal, showsIndicators: false) {
                    pillRow
                }
            } else {
                pillRow
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
    }

    private var pillRow: some View {
        HStack(spacing: 10) {
            pillButton {
                KeyboardDismisser.dismiss()
                activeSheet = .date
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "calendar")
                    // `fixedSize` so the date label never abbreviates — it
                    // is precisely the thing a scrolling user wants to keep
                    // reading. Longest value this can take is
                    // `DateFilterLabel`'s "Weeks 1, 3, 5".
                    Text(dateLabel)
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                }
            }
            .accessibilityLabel("Date range: \(dateLabel). Double tap to change.")

            pillButton {
                KeyboardDismisser.dismiss()
                activeSheet = .filters
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "line.3.horizontal.decrease")
                    Text(filterCount > 0 ? "Filters (\(filterCount))" : "Filters")
                        .lineLimit(1)
                        // Only where `filterPillBar`'s `ScrollView` is there
                        // to scroll to it — see that property's comment for
                        // why an ungated `fixedSize` clips this capsule off
                        // the screen edge at `.xxLarge`/`.xxxLarge`. Both
                        // arguments `false` is a no-op, so the non-
                        // accessibility bands keep truncating to `…` exactly
                        // as they always have.
                        .fixedSize(
                            horizontal: dynamicTypeSize.isAccessibilitySize, vertical: false)
                }
            }
            .accessibilityLabel(filtersAccessibilityLabel)

            Spacer(minLength: 0)
        }
    }

    /// One pill: a plain button whose chrome matches the platform — Liquid
    /// Glass on iOS 26 (what the old system bottom bar drew around these
    /// same labels), a material capsule on iOS 18.
    private func pillButton(
        action: @escaping () -> Void, @ViewBuilder label: () -> some View
    ) -> some View {
        let button = Button(action: action) {
            label()
                .padding(.vertical, 11)
                .padding(.horizontal, 14)
        }
        return Group {
            if #available(iOS 26.0, *) {
                button.glassEffect(.regular.interactive())
            } else {
                button.background(.regularMaterial, in: Capsule())
            }
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
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
    }
}
