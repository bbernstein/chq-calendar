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
    /// Measured on iPhone 17 Pro, iOS 26.1 simulator, 2026-08-18, via a
    /// throwaway XCUITest that drove the `-uitest-fixture` list with 20 small
    /// (~0.15-screen) drags and logged, after each one, which chip was
    /// selected and which day-title header was topmost on screen:
    /// - **Moves at all**: yes — the selected day advanced from 2026-07-01 to
    ///   2026-08-05 over the 20 drags.
    /// - **Never backwards**: the logged sequence of selected days was
    ///   strictly non-decreasing across all 20 steps — no recycling
    ///   signature (a recycled header would have inserted a stale earlier
    ///   key at some point in a 20-sample run).
    /// - **Right time, not early**: 16 of 21 samples had the selected chip
    ///   matching the topmost header exactly; the handful of misses (a drag
    ///   sampled mid-momentum) all had the header slightly *ahead* of the
    ///   selection, never behind — i.e. any lag this produces is
    ///   conservative (the highlight is never ahead of where the reader
    ///   actually is), not the "two days early" failure mode the brief warns
    ///   about. Kept as-is; approach B (`.onScrollGeometryChange`) was not
    ///   needed.
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

    #if DEBUG
    /// Captured once per tap from `model.uiTestPendingScrollDelay` — see
    /// that property's doc. `0` in every real launch, so this whole path is
    /// inert outside `-uitest-delay-pending-scroll`.
    @State private var pendingScrollLandingDelay: TimeInterval = 0
    #endif

    /// The earliest visible day section — the day whose header is at (or
    /// just above) the top of the viewport. `min()` on day-key strings works
    /// because `DayGroup.id` sorts lexicographically the same as
    /// chronologically (`yyyy-MM-dd`).
    private var scrollAnchor: String? { visibleDays.min() }

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
        DayRailView(
            entries: MyDayChipContent.makeAll(
                days: ChqTime.dayKeys(from: nav.bounds.lowerBound, through: nav.bounds.upperBound),
                todayKey: ChqTime.dayKey(for: model.now()),
                counts: nav.countsByDay,
                style: .events,
                includingYear: !model.isCurrentYear),
            // A pending tap outranks the scroll anchor until it lands, so a
            // tap does not flicker back to where the reader was; the scroll
            // anchor outranks the stale `anchorDay` fallback, which only
            // still matters before any section header has appeared at all.
            selectedDay: pendingScroll?.day ?? scrollAnchor ?? anchorDay,
            accessibilityLabel: "Days in the season",
            disablesEmptyDays: true,
            onSelect: selectDay,
            leading: { EmptyView() },
            trailing: { EmptyView() })
        .background(.bar)
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
        pendingScroll = PendingDayScroll.Target(
            day: dayKey,
            key: PendingDayScroll.key(for: model.filter, year: model.selectedYear))
        #if DEBUG
        // Consumed once, here — the very next `landPendingScroll` call holds
        // off; every one after that (including the one the reader's own
        // scope change triggers) resolves immediately, same as production.
        pendingScrollLandingDelay = model.uiTestPendingScrollDelay
        model.uiTestPendingScrollDelay = 0
        #endif
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
        if pendingScrollLandingDelay > 0 {
            let delay = pendingScrollLandingDelay
            pendingScrollLandingDelay = 0
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [self] in
                resolvePendingScroll(proxy, days: days)
            }
            return
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
    private var filterPillBar: some View {
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
                }
            }
            .accessibilityLabel(filtersAccessibilityLabel)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
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
