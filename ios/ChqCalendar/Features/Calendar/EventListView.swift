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
/// countdown/offline banners, the bottom-bar filter controls, and
/// `refreshable` — is identical between the two layouts, which is the whole
/// point of sharing this view.
struct EventListView: View {
    @Bindable var model: AppModel
    var selection: Binding<Event?>?

    @State private var isAboutPresented = false

    /// Which pill's sheet is up, if any.
    @State private var activeSheet: FilterBarSheet?

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
            .sheet(isPresented: $isAboutPresented) {
                AboutView()
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

    /// Non-nil only for the single badge `-uitest-show-week-theme` targets
    /// (`AppModel.uiTestFirstThemedWeek`) — every other badge in `dayHeader`
    /// gets `nil` and behaves exactly as it did before this hook existed.
    /// See `WeekThemeBadge.uiTestAutoShow` for how the binding is consumed.
    private func uiTestAutoShowThemeBinding(day: DayGroup, week: Int) -> Binding<Bool>? {
        guard let target = model.uiTestFirstThemedWeek,
              target.dayID == day.id, target.week == week
        else { return nil }
        return $model.uiTestShowWeekTheme
    }
    #endif

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
                noMatchesView
            } else {
                list(days: days)
            }
        }
    }

    private func list(days: [DayGroup]) -> some View {
        let filtered = days.reduce(0) { $0 + $1.events.count }

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
                    }
                } header: {
                    dayHeader(for: day)
                }
            }

            if model.isCurrentYear && model.filter.dateScope == .next {
                Button("Show next day") {
                    model.showNextDay()
                }
            }
        }
        .listStyle(.plain)
        .scrollDismissesKeyboard(.immediately)
        // No `contentMargins(.bottom, …)` here on purpose. The bottom bar is
        // a real toolbar, so the system puts its height into the scroll
        // view's own content insets — measured at 86.0pt on iPhone 17 /
        // iOS 26.1 with nothing of ours contributing to it. That is a
        // stronger version of the guarantee the hand-rolled reservation used
        // to provide: the inset is owned by the navigation container, not by
        // any state of ours, so nothing we render can shift the list
        // vertically. Adding a margin back would double-count the bar.
        .refreshable {
            await model.refresh(force: true)
        }
        .navigationDestination(for: Event.self) { event in
            EventDetailView(event: event, model: model)
        }
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

    private func dayHeader(for day: DayGroup) -> some View {
        HStack {
            Text(day.title)
            Spacer()
            ForEach(day.weekNumbers, id: \.self) { number in
                #if DEBUG
                WeekThemeBadge(
                    weekNumber: number,
                    themes: model.themes,
                    uiTestAutoShow: uiTestAutoShowThemeBinding(day: day, week: number))
                #else
                WeekThemeBadge(weekNumber: number, themes: model.themes)
                #endif
            }
        }
    }

    private var noMatchesView: some View {
        ContentUnavailableView {
            Label("No matching events", systemImage: "calendar.badge.exclamationmark")
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
            Button("Show All Events") {
                model.clearAll()
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

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        // The two filter controls live in the navigation container's bottom
        // bar rather than in a floating overlay of our own. On the iOS 26
        // SDK this app builds against, `.searchable` is itself rendered as a
        // bottom-anchored floating field, so an overlay bar and the search
        // field were two separate things competing for the same edge (and
        // the overlay sat on top of list text). Bottom-bar toolbar items and
        // the search field are laid out by the system as one group, which is
        // both the platform idiom and the only way the two can coexist.
        //
        // Only once there is a snapshot to filter against — during launch or
        // the offline/error states the pills would summarise nothing. The
        // search field is unaffected by this condition; it is the system's.
        if model.snapshot != nil {
            ToolbarItemGroup(placement: .bottomBar) {
                Button {
                    KeyboardDismisser.dismiss()
                    activeSheet = .date
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "calendar")
                        // `fixedSize` so this text wins any competition for
                        // width against the search field beside it: the date
                        // label is the one thing in the bar that must never
                        // abbreviate. The system search item is designed to
                        // minimise to a magnifier when space is tight, so it
                        // is the correct thing to yield. Longest value this
                        // can take is `DateFilterLabel`'s "Weeks 1, 3, 5".
                        Text(dateLabel)
                            .lineLimit(1)
                            .fixedSize(horizontal: true, vertical: false)
                    }
                }
                .accessibilityLabel("Date range: \(dateLabel). Double tap to change.")

                Button {
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
            }
            // **Required on iOS 26, not decorative.** Declaring *any*
            // `.bottomBar` content on the iOS 26 runtime makes the app own
            // that bar, and the system search field — which on iOS 26 is
            // itself bottom-anchored — then disappears entirely rather than
            // sharing it. Verified by screenshot: with the group above and
            // without these two items, launching with `-uitest-search opera`
            // filtered the list but drew no search field and no magnifier
            // anywhere on screen, leaving search unreachable. These items put
            // it back, to the right of the pills, as one group.
            //
            // Deployment target stays 18.0; this is an availability-guarded
            // adoption, not a floor change. On the iOS 18 runtime the branch
            // is skipped and `.searchable` renders under the navigation bar,
            // which is where it has always gone there — no conflict to
            // resolve, so nothing to declare.
            //
            // Known benign log on iOS 26: "Ignoring
            // searchBarPlacementBarButtonItem because its vending navigation
            // item does not match the view controller's", twice at launch.
            // SwiftUI vends two `UINavigationItem`s that share the same
            // `searchController`. Placing `.searchable` on this view instead
            // of on the enclosing container was tried and did not change the
            // count; the field renders in the bottom bar either way.
            if #available(iOS 26.0, *) {
                ToolbarSpacer(.flexible, placement: .bottomBar)
                DefaultToolbarItem(kind: .search, placement: .bottomBar)
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
