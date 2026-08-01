import SwiftUI

/// The root list: every day's events, grouped into sections, with search,
/// pull-to-refresh, a year picker, and empty/offline states.
struct CalendarView: View {
    @Bindable var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    /// `.searchable` is bound to this local draft rather than directly to
    /// `model.filter.searchText`, so keystrokes don't re-run the filter
    /// pipeline on every character. `.task(id:)` below debounces 200 ms
    /// before committing the draft into the model.
    @State private var searchDraft: String = ""

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Chautauqua Calendar")
                .toolbar { toolbarContent }
                .safeAreaInset(edge: .top) {
                    // Only shown once there's a snapshot to filter/count
                    // against — during initial launch (no snapshot yet) or
                    // the offline/error empty states, category/location
                    // counts would be meaningless and the bar would just be
                    // dead chrome above a loading spinner or banner.
                    if model.snapshot != nil {
                        FilterBarView(model: model)
                    }
                }
        }
        .searchable(text: $searchDraft, prompt: "Search events")
        .task(id: searchDraft) {
            try? await Task.sleep(for: .milliseconds(200))
            guard !Task.isCancelled else { return }
            model.filter.searchText = searchDraft
        }
        .task {
            await model.start()
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                Task { await model.foregrounded() }
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
        List {
            if let days = model.countdownDays {
                CountdownBanner(days: days)
            }
            if model.lastRefreshFailed {
                OfflineBanner()
            }

            ForEach(model.dayGroups) { day in
                Section {
                    ForEach(day.events) { event in
                        NavigationLink(value: event) {
                            EventRow(model: model, event: event)
                        }
                    }
                } header: {
                    dayHeader(for: day)
                }
            }

            if model.filter.dateScope == .next {
                Button("Show next day") {
                    model.showNextDay()
                }
            }
        }
        .listStyle(.plain)
        .refreshable {
            await model.refresh(force: true)
        }
        .navigationDestination(for: Event.self) { event in
            // Placeholder destination — replaced by the real event detail
            // view in a later task.
            Text(event.title)
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
                model.clearFilters()
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
