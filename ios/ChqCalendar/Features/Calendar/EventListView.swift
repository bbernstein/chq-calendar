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

    /// Which day the rail highlights. View state: derived from what is on
    /// screen, never persisted, and never part of the filter.
    @State private var anchorDay: String?

    /// The last day whose final row triggered `expandWindowEnd()`. Guards
    /// `autoExpandIfAtTheEnd` against firing again the instant the newly
    /// appended day's own final row appears — see that function's doc.
    @State private var autoExpandedThrough: String?

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
            selectedDay: anchorDay,
            accessibilityLabel: "Days in the season",
            onSelect: { _ in },   // Task 9
            leading: { EmptyView() },
            trailing: { EmptyView() })
        .background(.bar)
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

        return List(selection: selection) {
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
