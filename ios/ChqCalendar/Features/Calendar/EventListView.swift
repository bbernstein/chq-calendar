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
/// countdown/offline banners, the filter-bar `safeAreaInset`, and
/// `refreshable` — is identical between the two layouts, which is the whole
/// point of sharing this view.
struct EventListView: View {
    @Bindable var model: AppModel
    var selection: Binding<Event?>?

    @State private var isAboutPresented = false

    /// Mirrors `collapseDriver.isCollapsed` so the bar re-renders on a
    /// flip. The driver, not this, is the decision state — see
    /// `FilterBarCollapseDriver`, which deliberately isn't observed so its
    /// per-frame bookkeeping can't invalidate this body.
    @State private var isFilterBarCollapsed = false

    @State private var collapseDriver = FilterBarCollapseDriver(
        minimumHeadroomToCollapse: EventListView.collapsedBarHeightGiveBack + 40)

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Roughly how much height collapsing hands back to the list — the
    /// venue, category, and reset rows `FilterBarView` drops when
    /// `isCollapsed`. Measured on a device: the list's top content inset
    /// goes 330pt → 230pt across the transition. A collapse is refused
    /// unless at least this much (plus a margin) of scrollable range
    /// remains below the current position, so that giving it back can never
    /// force the scroll view to move the content — see
    /// `FilterBarCollapse.next`.
    private static let collapsedBarHeightGiveBack: CGFloat = 100

    /// How long the collapse/expand transition runs. Named because the
    /// driver's settle window is defined by this animation completing, not
    /// by any separately-tuned duration.
    private static let collapseAnimationDuration: TimeInterval = 0.2

    var body: some View {
        content
            // Inline, and shortened to fit beside the year and overflow
            // toolbar items. The large-title band was ~70pt of empty space
            // above the filter bar with no title text ever drawn in it.
            .navigationTitle("CHQ Calendar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbarContent }
            .sheet(isPresented: $isAboutPresented) {
                AboutView()
            }
            .safeAreaInset(edge: .top) {
                // Only shown once there's a snapshot to filter/count
                // against — during initial launch (no snapshot yet) or the
                // offline/error empty states, category/location counts
                // would be meaningless and the bar would just be dead
                // chrome above a loading spinner or banner.
                if model.snapshot != nil {
                    FilterBarView(model: model, isCollapsed: isFilterBarCollapsed)
                }
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
        .onScrollGeometryChange(for: ScrollGeometrySample.self) { geometry in
            ScrollGeometrySample(
                contentOffset: geometry.contentOffset.y,
                insetTop: geometry.contentInsets.top,
                insetBottom: geometry.contentInsets.bottom,
                containerHeight: geometry.containerSize.height,
                contentHeight: geometry.contentSize.height)
        } action: { _, sample in
            // This action closure isn't `@Sendable`, so it runs on whatever
            // actor called this modifier (MainActor, since this is a view's
            // body) — no manual actor hop is needed to touch `@State` here.
            //
            // Every decision, including which samples to trust at all,
            // lives in the driver; see its doc comment for why animating
            // the bar makes raw geometry unreadable while it animates.
            guard let collapsed = collapseDriver.received(sample) else { return }
            withAnimation(
                reduceMotion ? nil : .easeInOut(duration: Self.collapseAnimationDuration),
                completionCriteria: .removed
            ) {
                isFilterBarCollapsed = collapsed
            } completion: {
                // The settle window *is* the animation: geometry is
                // re-admitted the moment this transition is fully removed,
                // never before and never on a timer. Verified to fire on
                // both branches, including the `nil` (Reduce Motion) one.
                collapseDriver.settled()
            }
        }
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
                Text("Wk \(number)")
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.secondary.opacity(0.15), in: Capsule())
            }
        }
    }

    private var noMatchesView: some View {
        ContentUnavailableView {
            Label("No matching events", systemImage: "calendar.badge.exclamationmark")
        } actions: {
            Button("Clear Filters") {
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
