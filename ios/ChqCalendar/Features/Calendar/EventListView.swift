import SwiftUI

/// Publishes the event list's scroll offset up to `EventListView`.
///
/// `static let` rather than `static var`: a `let` satisfies the protocol's
/// `{ get }` requirement and keeps the type Sendable under Swift 6 strict
/// concurrency.
private struct ScrollOffsetKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

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
    @State private var isFilterBarCollapsed = false
    @State private var collapsePivot: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let scrollSpace = "eventList"

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
        } else if model.dayGroups.isEmpty {
            noMatchesView
        } else {
            list
        }
    }

    private var list: some View {
        // Bound once: `model.dayGroups` reruns the whole filter pipeline on
        // every access, so reading it for both the count and the sections
        // would filter ~1,500 events twice per render.
        let days = model.dayGroups
        let filtered = days.reduce(0) { $0 + $1.events.count }

        return List(selection: selection) {
            GeometryReader { proxy in
                Color.clear.preference(
                    key: ScrollOffsetKey.self,
                    value: -proxy.frame(in: .named(Self.scrollSpace)).minY
                )
            }
            .frame(height: 0)
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)

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
        .coordinateSpace(.named(Self.scrollSpace))
        .onPreferenceChange(ScrollOffsetKey.self) { offset in
            // `onPreferenceChange`'s action is @Sendable, so the hop back to
            // the main actor is required to touch @State.
            Task { @MainActor in
                let next = FilterBarCollapse.next(
                    isCollapsed: isFilterBarCollapsed, offset: offset, pivot: collapsePivot)
                collapsePivot = next.pivot
                guard next.isCollapsed != isFilterBarCollapsed else { return }
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) {
                    isFilterBarCollapsed = next.isCollapsed
                }
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
            Button {
                isAboutPresented = true
            } label: {
                Image(systemName: "info.circle")
            }
            .accessibilityLabel("About CHQ Calendar")
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
