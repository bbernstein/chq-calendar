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
/// countdown/offline banners, the floating filter bar overlay, and
/// `refreshable` — is identical between the two layouts, which is the whole
/// point of sharing this view.
struct EventListView: View {
    @Bindable var model: AppModel
    var selection: Binding<Event?>?

    @State private var isAboutPresented = false

    /// Which pill's sheet is up, if any.
    @State private var activeSheet: FilterBarSheet?

    /// Drives the bar's expanded/compact state from the scroll stream.
    /// Not `@Observable` — it is fed from a scroll callback and its own
    /// bookkeeping must not invalidate this body.
    @State private var barPresentation = BarPresentation()

    /// Mirrors `barPresentation.state` so the bar re-renders on a change.
    @State private var barState: BarState = .expanded

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Height reserved at the bottom of the list for the floating bar.
    ///
    /// **Constant by design.** The bar is an overlay and this margin never
    /// changes, so the list's geometry is unaffected by the bar's state —
    /// which is what makes the whole collapse-oscillation problem
    /// unreachable rather than merely mitigated. `@ScaledMetric` so the
    /// reservation grows with Dynamic Type; it still does not vary with
    /// scroll position, which is the property that matters.
    ///
    /// 76 dominates the bar's real footprint at every Dynamic Type size.
    /// `FloatingFilterBar` measures `pillHeight + 6 + 6` (its own vertical
    /// padding) `+ 10` (its bottom padding) = `pillHeight + 22`, and
    /// `BarPill.pillHeight` is `@ScaledMetric(relativeTo: .subheadline)`
    /// from a 44pt base — the *same* text style this metric scales against,
    /// so both sides move by the identical factor `s`. The reservation wins
    /// whenever `76s > 44s + 22`, i.e. `s > 0.6875`; the smallest factor
    /// `.subheadline` ever produces is `xSmall` at 12/15 = 0.8. At the
    /// default size that is 76 vs 66 (10pt of clearance) and at
    /// `.accessibility5` roughly 223 vs 151, so the headroom widens rather
    /// than narrows as text grows. Do not make this depend on `barState`.
    @ScaledMetric(relativeTo: .subheadline) private var barReservedHeight: CGFloat = 76

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
            .overlay(alignment: .bottom) {
                // Only once there is a snapshot to filter against — during
                // launch or the offline/error states the pills would
                // summarise nothing.
                if model.snapshot != nil {
                    FloatingFilterBar(
                        dateLabel: DateFilterLabel.text(
                            for: model.filter,
                            seasonWeekCount: SeasonCalendar.weeks(
                                forYear: model.selectedYear).count),
                        filterCount: ActiveFilterCount.value(for: model.filter),
                        state: barState,
                        onDate: {
                            KeyboardDismisser.dismiss()
                            activeSheet = .date
                        },
                        onFilters: {
                            KeyboardDismisser.dismiss()
                            activeSheet = .filters
                        })
                    .animation(
                        reduceMotion ? nil : .easeInOut(duration: 0.2), value: barState)
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
        .contentMargins(.bottom, barReservedHeight, for: .scrollContent)
        .onScrollGeometryChange(for: ScrollSample.self) { geometry in
            ScrollSample(
                offset: geometry.contentOffset.y,
                insetTop: geometry.contentInsets.top)
        } action: { _, sample in
            // This action closure isn't `@Sendable`, so it runs on whatever
            // actor called this modifier (MainActor, since this is a view's
            // body) — no manual actor hop is needed to touch `@State` here.
            guard let next = barPresentation.received(
                offset: sample.offset, insetTop: sample.insetTop) else { return }
            barState = next
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

/// The two numbers `BarPresentation` needs from the scroll stream.
private struct ScrollSample: Equatable {
    let offset: CGFloat
    let insetTop: CGFloat
}
