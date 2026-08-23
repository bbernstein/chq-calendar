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
        // ~1,470 events) and uncached. `bounds` is read once per body
        // evaluation and reused everywhere below that needs it: `content`,
        // the toolbar condition, `.task`, and both `.onChange` handlers —
        // `.onChange(of:)` evaluates its argument during body evaluation
        // too, so the local carries exactly the value a direct property
        // read would have produced, one full O(events) pass cheaper. The
        // one nuance is `.task`, which runs asynchronously after this body
        // evaluation completes, so it captures a snapshot slightly older
        // than a live re-read would be — see the comment on `.task` below
        // for why that's still safe.
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
        // Reuses the `bounds` local rather than re-reading `model.myDayBounds`.
        // Not byte-identical to a live read — `.task` runs asynchronously
        // after the body evaluation that captured `bounds`, so this can be a
        // one-pass-stale snapshot. That's safe: `reconcileSelection` assigns
        // `model.myDayDefaultDay`, which is always a fresh read of model
        // state, so a stale `bounds` can only affect the containment check,
        // never which day gets selected. Worst case is a redundant reset to
        // a still-correct day.
        .task { reconcileSelection(in: bounds) }
        .onChange(of: bounds) { _, newBounds in
            reconcileSelection(in: newBounds)
        }
        // `myDayBounds` is the season widened by starred days *outside* it —
        // an in-season favorite going from none to some never moves it. So
        // if `selectedDay` is `nil` (reconcile last ran while
        // `myDayAvailableDays` was empty) and a snapshot then lands with
        // in-season favorites, bounds are byte-identical, the trigger above
        // never fires, and `content(bounds:)` falls through to `Color.clear`
        // — a blank tab until the user switches away and back. Watching
        // `.isEmpty` instead of the array itself restores exactly the
        // coverage the pre-#192 `.onChange(of: model.myDayAvailableDays)`
        // had for this transition, without re-reconciling on every single
        // star/unstar the way watching the array would. The cost is one
        // extra O(events) pass over the event list per body evaluation (to
        // read `myDayAvailableDays.isEmpty`); worth it since the
        // alternative is a reachable blank screen.
        .onChange(of: model.myDayAvailableDays.isEmpty) { _, _ in
            reconcileSelection(in: bounds)
        }
    }

    @ViewBuilder
    private func content(bounds: ClosedRange<String>?) -> some View {
        if model.myDayAvailableDays.isEmpty {
            emptyState
        } else if let selectedDay, let bounds, bounds.contains(selectedDay) {
            planContent(for: selectedDay, bounds: bounds)
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

    /// - Parameter bounds: the `myDayBounds` value `body` already derived.
    ///   Taken as a parameter rather than re-read so the hoist in `body`
    ///   actually holds it to one O(events) derivation per evaluation
    ///   (#197 item 2); `content(bounds:)` has already unwrapped it and
    ///   confirmed it contains `day`.
    private func planContent(for day: String, bounds: ClosedRange<String>) -> some View {
        let plan = model.dayPlan(for: day)
        let window = model.myDayWindow(
            bounds: bounds, showsEarlier: showsEarlier, showsLater: showsLater, selectedDay: day)
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
        DayRailView(
            entries: MyDayChipContent.makeAll(
                days: window.days,
                todayKey: todayKey,
                counts: starredCounts,
                style: .starred,
                includingYear: !model.isCurrentYear),
            selectedDay: selectedDay,
            accessibilityLabel: "Days",
            onSelect: { self.selectedDay = $0 },
            leading: {
                if window.canExpandEarlier {
                    MyDayExpandControl(
                        direction: .earlier,
                        isExpanded: showsEarlier,
                        hiddenCount: window.hiddenEarlierCount
                    ) {
                        showsEarlier.toggle()
                    }
                }
            },
            trailing: {
                if window.canExpandLater {
                    MyDayExpandControl(
                        direction: .later,
                        isExpanded: showsLater,
                        hiddenCount: window.hiddenLaterCount
                    ) {
                        showsLater.toggle()
                    }
                }
            })
        // Expanding an end prepends or appends chips, which shifts the
        // content under the user. Re-anchoring on the same day holds the
        // selection still, so revealing the past never moves you.
        .reanchoring(on: [showsEarlier, showsLater])
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

/// The chevron chip at each end of `MyDayView`'s strip, revealing the rest of
/// the season in that direction (#192).
///
/// The visible chip stays narrow — the count lives in the accessibility
/// label, not on screen.
/// Internal rather than `private` so `DayRailDynamicTypeTests` can name it:
/// #261 found the rail's accessibility audit is structurally blind to this
/// control (an icon-only button presents no text for a Dynamic Type audit to
/// measure), so the guard on its frame growing had to move to a measured unit
/// test — and a test cannot host a `private` view.
struct MyDayExpandControl: View {
    enum Direction { case earlier, later }

    let direction: Direction
    let isExpanded: Bool
    let hiddenCount: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            // Tint, frame and background all live in
            // `DayRailEndControlLabel`, shared with the Events tab's `⟳ Now`
            // — see its doc comment for why each of them is load-bearing and
            // why a second copy here was a drift risk. At the default text
            // size the chevron is far smaller than either minimum, so the
            // frame only starts doing work at large Dynamic Type sizes.
            DayRailEndControlLabel {
                Image(systemName: symbol)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityIdentifier("day-rail-expand-\(direction)")
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
