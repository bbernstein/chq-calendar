import AppIntents
import SwiftUI

/// The My Day planner (#181): a day-by-day itinerary built from the user's
/// starred events, flagging schedule conflicts and tight walking gaps
/// between venues. Replaces the task 16 placeholder.
///
/// - `model`: the shared `AppModel` (favorites, snapshot, day-plan inputs).
/// - `switchToEvents`: switches the tab shell to the Events tab — the
///   empty-state escape hatch ("no favorites yet → go browse events").
struct MyDayView: View {
    @Bindable var model: AppModel
    var switchToEvents: () -> Void = {}

    /// The day currently shown. Initialized from `AppModel.myDayDefaultDay`
    /// by `reconcileSelection(in:)` on first appearance (`nil` here so that
    /// happens exactly once, in one place, rather than duplicating
    /// `defaultDayKey`'s logic in a property initializer that can't read
    /// `model` yet).
    @State private var selectedDay: String?

    /// Whether each end of the strip is expanded to the season edge.
    /// Session-scoped deliberately: these survive tab switches for the life
    /// of the process but reset on launch, so the app always reopens on the
    /// tight window (#192).
    @State private var showsEarlier = false
    @State private var showsLater = false

    /// One-time discovery tip for the My Schedule Siri phrase (#193) —
    /// shown only where it's personally relevant (the user has starred
    /// days), dismissed forever via the tip's own close button.
    @AppStorage("chq-myday-siri-tip-visible") private var siriTipVisible = true

    var body: some View {
        // Read once: `myDayBounds` is O(events) (filter+map+Set+sort over
        // ~1,470 events) and uncached, and both `content` and the toolbar
        // condition below need it. `.onChange(of: model.myDayBounds)`
        // further down still reads the property directly — SwiftUI has to
        // evaluate that expression itself to diff it, so this local can't
        // substitute there.
        let bounds = model.myDayBounds
        NavigationStack {
            content(bounds: bounds)
                .navigationTitle("My Day")
                .toolbar {
                    // Absent in a past season — there is no today to return
                    // to — and absent when you are already on today. The
                    // `selectedDay != nil` check also keeps the button from
                    // flashing in the one frame before `.task` runs
                    // `reconcileSelection`, since `nil != todayKey` would
                    // otherwise satisfy the "not already on today" guard.
                    if let bounds, bounds.contains(todayKey),
                       let currentDay = selectedDay, currentDay != todayKey {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Today") { selectedDay = todayKey }
                        }
                    }
                }
                .navigationDestination(for: Event.self) { event in
                    EventDetailView(event: event, model: model)
                }
        }
        .task { reconcileSelection(in: model.myDayBounds) }
        .onChange(of: model.myDayBounds) { _, newBounds in
            reconcileSelection(in: newBounds)
        }
    }

    @ViewBuilder
    private func content(bounds: ClosedRange<String>?) -> some View {
        if model.myDayAvailableDays.isEmpty {
            emptyState
        } else if let selectedDay, let bounds, bounds.contains(selectedDay) {
            planContent(for: selectedDay)
        } else {
            // One frame, between the bounds changing and `reconcileSelection`
            // running for them.
            Color.clear
        }
    }

    // MARK: - Selection

    /// Keeps `selectedDay` inside the current bounds.
    ///
    /// Since #192 the strip is driven by the calendar rather than by the
    /// favorites set, so a day can no longer vanish because its last starred
    /// event was unstarred — the only things that move the bounds are a new
    /// snapshot and a year switch. The previous `nearestDay` fallback existed
    /// solely for the vanishing case and is gone with it.
    private func reconcileSelection(in bounds: ClosedRange<String>?) {
        guard let bounds else { return }
        if let selectedDay, bounds.contains(selectedDay) { return }
        selectedDay = model.myDayDefaultDay
    }

    // MARK: - Day plan

    private func planContent(for day: String) -> some View {
        let plan = model.dayPlan(for: day)
        let window = model.myDayWindow(
            showsEarlier: showsEarlier, showsLater: showsLater, selectedDay: day)
        // Read once per body evaluation and index per chip below —
        // `myDayStarredCounts` rebuilds its dictionary with a full pass over
        // the event list on every access, so calling it inside the `ForEach`
        // would turn one O(events) pass into one per visible chip.
        let starredCounts = model.myDayStarredCounts
        return VStack(alignment: .leading, spacing: 12) {
            if siriTipVisible {
                SiriTipView(intent: MyScheduleIntent(), isVisible: $siriTipVisible)
                    .padding(.horizontal)
            }
            dayChipsRow(window: window, selectedDay: day, todayKey: todayKey, starredCounts: starredCounts)
            selectedDayHeader(for: day)
            if plan.items.isEmpty {
                emptyDayState(for: day)
                    .frame(maxHeight: .infinity)
            } else {
                summaryHeader(for: plan)
                Divider()
                    .padding(.horizontal)
                timeline(for: plan)
            }
        }
        .padding(.top, 8)
    }

    // MARK: - Day chips

    private var todayKey: String { ChqTime.dayKey(for: model.now()) }

    private func dayChipsRow(
        window: DayWindow, selectedDay: String, todayKey: String, starredCounts: [String: Int]
    ) -> some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if window.canExpandEarlier {
                        MyDayExpandControl(
                            direction: .earlier,
                            isExpanded: showsEarlier,
                            hiddenCount: window.hiddenEarlierCount
                        ) {
                            showsEarlier.toggle()
                        }
                    }

                    ForEach(window.days, id: \.self) { day in
                        if let content = MyDayChipContent.make(
                            dayKey: day,
                            todayKey: todayKey,
                            starCount: starredCounts[day] ?? 0,
                            includingYear: !model.isCurrentYear
                        ) {
                            MyDayChip(content: content, isSelected: day == selectedDay) {
                                self.selectedDay = day
                            }
                            .id(day)
                        }
                    }

                    if window.canExpandLater {
                        MyDayExpandControl(
                            direction: .later,
                            isExpanded: showsLater,
                            hiddenCount: window.hiddenLaterCount
                        ) {
                            showsLater.toggle()
                        }
                    }
                }
                .padding(.horizontal)
            }
            .onAppear { scroll(proxy, to: selectedDay) }
            .onChange(of: selectedDay) { _, day in scroll(proxy, to: day) }
            // Expanding an end prepends or appends chips, which shifts the
            // content under the user. Re-anchoring on the same day holds the
            // selection still, so revealing the past never moves you.
            .onChange(of: showsEarlier) { _, _ in scroll(proxy, to: selectedDay) }
            .onChange(of: showsLater) { _, _ in scroll(proxy, to: selectedDay) }
        }
    }

    private func scroll(_ proxy: ScrollViewProxy, to day: String) {
        withAnimation(.easeInOut(duration: 0.2)) {
            proxy.scrollTo(day, anchor: .center)
        }
    }

    // MARK: - Day header

    /// Names the day being shown. The screen previously stated this
    /// *nowhere* — the only indicator was the highlighted chip, which was
    /// reliably off-screen (#192).
    private func selectedDayHeader(for day: String) -> some View {
        HStack(spacing: 8) {
            Text(dayTitle(for: day))
                .font(.headline)
            if let badge = relativeBadge(for: day) {
                Text(badge)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.accentColor, in: Capsule())
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal)
    }

    private func dayTitle(for dayKey: String) -> String {
        guard let date = ChqTime.parse("\(dayKey) 00:00:00") else { return dayKey }
        return ChqTime.dayTitle(for: date, includingYear: !model.isCurrentYear)
    }

    private func relativeBadge(for dayKey: String) -> String? {
        let today = todayKey
        if dayKey == today { return "Today" }
        if dayKey == ChqTime.day(today, offsetBy: 1) { return "Tomorrow" }
        if dayKey == ChqTime.day(today, offsetBy: -1) { return "Yesterday" }
        return nil
    }

    // MARK: - Summary header

    private func summaryHeader(for plan: DayPlan) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(summaryLine(for: plan))
                .font(.subheadline)
                .foregroundStyle(.secondary)

            if plan.conflictCount > 0 || plan.tightCount > 0 {
                HStack(spacing: 8) {
                    if plan.conflictCount > 0 {
                        summaryBadge(
                            countedLabel(plan.conflictCount, "overlap", "overlaps"),
                            background: .orange,
                            foreground: .white)
                    }
                    if plan.tightCount > 0 {
                        summaryBadge(
                            countedLabel(plan.tightCount, "tight walk", "tight walks"),
                            background: Color.yellow.opacity(0.35),
                            foreground: .primary)
                    }
                }
            }
        }
        .padding(.horizontal)
    }

    private func summaryLine(for plan: DayPlan) -> String {
        var parts = [countedLabel(plan.items.count, "event", "events")]
        if let first = plan.firstStart {
            parts.append("first \(ChqTime.timeString(for: first))")
        }
        if let last = plan.lastEnd {
            parts.append("last \(ChqTime.timeString(for: last))")
        }
        return parts.joined(separator: " · ")
    }

    private func countedLabel(_ count: Int, _ singular: String, _ plural: String) -> String {
        "\(count) \(count == 1 ? singular : plural)"
    }

    private func summaryBadge(_ text: String, background: some ShapeStyle, foreground: some ShapeStyle) -> some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(foreground)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(background, in: Capsule())
    }

    // MARK: - Timeline

    private func timeline(for plan: DayPlan) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(plan.items, id: \.event.id) { item in
                    if let transition = item.transitionFromPrevious {
                        transitionRow(transition)
                    }
                    NavigationLink(value: item.event) {
                        itemRow(item)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal)
            .padding(.bottom)
        }
    }

    /// Width of the leading time column, reused to indent transition rows
    /// so they visually sit "between" the time column and the title column
    /// of the items around them.
    private static let timeColumnWidth: CGFloat = 72
    private static let rowSpacing: CGFloat = 12

    private func itemRow(_ item: DayPlan.Item) -> some View {
        HStack(alignment: .top, spacing: Self.rowSpacing) {
            VStack(alignment: .leading, spacing: 2) {
                Text(ChqTime.timeString(for: item.event.start))
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                if item.event.end > item.event.start {
                    Text(ChqTime.timeString(for: item.event.end))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }
            .frame(width: Self.timeColumnWidth, alignment: .leading)

            VStack(alignment: .leading, spacing: 4) {
                Text(item.event.title)
                    .font(.body)
                    .lineLimit(2)
                    .strikethrough(item.event.status == .cancelled)
                    .foregroundStyle(item.event.status == .cancelled ? .secondary : .primary)
                    .multilineTextAlignment(.leading)

                if let location = item.event.displayLocation {
                    Text(DisplayNames.location(location))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                statusBadge(for: item.event.status)
            }

            Spacer(minLength: 0)
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private func statusBadge(for status: EventStatus) -> some View {
        switch status {
        case .cancelled:
            badge("Cancelled", color: .red)
        case .rescheduled:
            badge("Rescheduled", color: .orange)
        case .scheduled:
            EmptyView()
        }
    }

    private func badge(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color, in: Capsule())
    }

    @ViewBuilder
    private func transitionRow(_ transition: DayPlan.Transition) -> some View {
        switch transition {
        case .overlap(let minutes):
            transitionBanner(
                icon: "exclamationmark.triangle.fill",
                text: "Overlaps previous by \(minutes) min",
                background: .orange,
                foreground: .white)
        case .tight(let walkMinutes, let gapMinutes):
            transitionBanner(
                icon: "figure.walk",
                text: "Only \(gapMinutes) min between venues — about a \(walkMinutes) min walk",
                background: Color.yellow.opacity(0.35),
                foreground: .primary)
        case .fine(let walkMinutes):
            if let walkMinutes, walkMinutes > 0 {
                Text("\(walkMinutes) min walk")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .padding(.leading, Self.timeColumnWidth + Self.rowSpacing)
                    .padding(.vertical, 2)
            }
            // `.fine(0)` (same venue) and `.fine(nil)` (an unresolved
            // venue) show nothing — see `DayPlan.Transition`'s doc comment.
        }
    }

    private func transitionBanner(
        icon: String, text: String, background: some ShapeStyle, foreground: some ShapeStyle
    ) -> some View {
        Label(text, systemImage: icon)
            .font(.caption.weight(.medium))
            .foregroundStyle(foreground)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(background, in: RoundedRectangle(cornerRadius: 8))
            .padding(.leading, Self.timeColumnWidth + Self.rowSpacing)
            .padding(.vertical, 4)
    }

    // MARK: - Empty state

    private var emptyState: some View {
        ContentUnavailableView {
            Label("Star events to build your day", systemImage: "star.circle")
        } description: {
            Text("Tap the star on any event to add it to your personalized day-by-day itinerary.")
        } actions: {
            Button("Browse Events") { switchToEvents() }
        }
    }

    /// A day inside the window with nothing starred on it. Offers a way to
    /// fill the gap rather than being a dead end — which is the whole reason
    /// empty days are shown at all (#192).
    private func emptyDayState(for day: String) -> some View {
        let label = ChqTime.parse("\(day) 00:00:00").map(ChqTime.monthDayLabel(for:)) ?? day
        return ContentUnavailableView {
            Label("Nothing starred yet", systemImage: "star")
        } description: {
            Text("You haven't starred anything for this day.")
        } actions: {
            Button("Browse \(label) events") {
                model.browseDay(day)
                switchToEvents()
            }
        }
    }
}

/// One selectable day chip in `MyDayView`'s strip (#192).
///
/// All labelling lives in `MyDayChipContent` so it can be tested without a
/// view host; this type owns only the visual encoding of the four states,
/// which must compose because a day can be empty *and* today *and* selected
/// at once:
///
/// - **Fill** = selected, and nothing else uses fill.
/// - **Today** = the word `"Today"` in `content.topLine` — carried in text
///   precisely so a selected fill cannot swallow it.
/// - **Empty** = dashed stroke plus secondary content, kept (in white) even
///   while selected.
/// - **Count** = the third line, which always occupies its space so chip
///   heights never jitter as events are starred and unstarred.
private struct MyDayChip: View {
    let content: MyDayChipContent
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Text(content.topLine)
                    .font(.caption.weight(content.isToday ? .bold : .regular))
                Text(content.dateLine)
                    .font(.subheadline.weight(isSelected ? .semibold : .regular))
                countLine
            }
            .frame(minWidth: 58)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(
                isSelected ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.thinMaterial),
                in: RoundedRectangle(cornerRadius: 12)
            )
            .overlay {
                if content.isEmpty {
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(
                            isSelected ? Color.white.opacity(0.7) : Color.secondary.opacity(0.5),
                            style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                }
            }
            .foregroundStyle(foreground)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(content.accessibilityLabel)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    /// Always rendered, blank when the count is zero, so every chip is the
    /// same height whether or not anything is starred on it.
    @ViewBuilder
    private var countLine: some View {
        if content.starCount > 0 {
            Label("\(content.starCount)", systemImage: "star.fill")
                .font(.caption2)
                .labelStyle(.titleAndIcon)
        } else {
            Text(" ").font(.caption2)
        }
    }

    private var foreground: AnyShapeStyle {
        if isSelected { return AnyShapeStyle(.white) }
        return content.isEmpty ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary)
    }
}

/// The chevron chip at each end of `MyDayView`'s strip, revealing the rest of
/// the season in that direction (#192).
///
/// The visible chip stays narrow — the count lives in the accessibility
/// label, not on screen.
private struct MyDayExpandControl: View {
    enum Direction { case earlier, later }

    let direction: Direction
    let isExpanded: Bool
    let hiddenCount: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.subheadline.weight(.semibold))
                .frame(width: 34, height: 62)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }

    private var symbol: String {
        switch (direction, isExpanded) {
        case (.earlier, false): return "chevron.left"
        case (.earlier, true): return "chevron.right"
        case (.later, false): return "chevron.right"
        case (.later, true): return "chevron.left"
        }
    }

    private var accessibilityLabel: String {
        switch (direction, isExpanded) {
        case (.earlier, false): return "Show \(hiddenCount) earlier days"
        case (.earlier, true): return "Hide earlier days"
        case (.later, false): return "Show \(hiddenCount) later days"
        case (.later, true): return "Hide later days"
        }
    }
}
