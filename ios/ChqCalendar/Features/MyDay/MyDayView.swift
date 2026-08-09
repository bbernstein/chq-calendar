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

    /// One-time discovery tip for the My Schedule Siri phrase (#193) —
    /// shown only where it's personally relevant (the user has starred
    /// days), dismissed forever via the tip's own close button.
    @AppStorage("chq-myday-siri-tip-visible") private var siriTipVisible = true

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("My Day")
                .navigationDestination(for: Event.self) { event in
                    EventDetailView(event: event, model: model)
                }
        }
        .task { reconcileSelection(in: model.myDayAvailableDays) }
        // `myDayAvailableDays` changes whenever a favorite is toggled (or a
        // fresh snapshot lands) — reconcile every time, not just once, so a
        // day that loses its last favorited event doesn't leave the view
        // showing a plan `dayPlan(for:)` would now report as empty.
        .onChange(of: model.myDayAvailableDays) { _, newDays in
            reconcileSelection(in: newDays)
        }
    }

    @ViewBuilder
    private var content: some View {
        let availableDays = model.myDayAvailableDays
        if availableDays.isEmpty {
            emptyState
        } else if let selectedDay, availableDays.contains(selectedDay) {
            planContent(for: selectedDay, availableDays: availableDays)
        } else {
            // Between `availableDays` changing and `onChange` above running
            // `reconcileSelection` for it, `selectedDay` can briefly point
            // at a day that's no longer available. Render nothing rather
            // than a stale/empty plan for that one frame.
            Color.clear
        }
    }

    // MARK: - Selection

    /// Keeps `selectedDay` valid as favorites (and therefore
    /// `availableDays`) change.
    ///
    /// - First appearance (`selectedDay == nil`): picks
    ///   `AppModel.myDayDefaultDay`.
    /// - The previously-selected day dropped out of `availableDays` (its
    ///   last favorited event was unstarred, or all its events were
    ///   filtered from the snapshot): falls back to whichever remaining day
    ///   is calendar-closest to the one that disappeared, not straight back
    ///   to `myDayDefaultDay` — jumping to "today" (or the next future day)
    ///   would relocate a user who was deliberately looking at a specific
    ///   past or future day just because one event on it got unstarred.
    /// - No day is close enough to fall back to (`availableDays` itself is
    ///   now empty): falls back to `myDayDefaultDay`, which is `nil` in
    ///   that case — `content` above shows the empty state instead.
    private func reconcileSelection(in availableDays: [String]) {
        if let selectedDay, availableDays.contains(selectedDay) { return }
        if let selectedDay, let nearest = nearestDay(to: selectedDay, in: availableDays) {
            self.selectedDay = nearest
        } else {
            self.selectedDay = model.myDayDefaultDay
        }
    }

    private func nearestDay(to missingDay: String, in candidates: [String]) -> String? {
        guard !candidates.isEmpty else { return nil }
        guard let missingDate = ChqTime.parse("\(missingDay) 00:00:00") else {
            return candidates.sorted().first
        }
        return candidates.min { lhs, rhs in
            let lhsDelta = abs((ChqTime.parse("\(lhs) 00:00:00") ?? .distantFuture).timeIntervalSince(missingDate))
            let rhsDelta = abs((ChqTime.parse("\(rhs) 00:00:00") ?? .distantFuture).timeIntervalSince(missingDate))
            return lhsDelta < rhsDelta
        }
    }

    // MARK: - Day plan

    private func planContent(for day: String, availableDays: [String]) -> some View {
        let plan = model.dayPlan(for: day)
        return VStack(alignment: .leading, spacing: 12) {
            if siriTipVisible {
                SiriTipView(intent: MyScheduleIntent(), isVisible: $siriTipVisible)
                    .padding(.horizontal)
            }
            dayChipsRow(availableDays: availableDays, selectedDay: day)
            summaryHeader(for: plan)
            Divider()
                .padding(.horizontal)
            timeline(for: plan)
        }
        .padding(.top, 8)
    }

    // MARK: - Day chips

    private func compactDayLabel(for dayKey: String) -> String {
        guard let date = ChqTime.parse("\(dayKey) 00:00:00") else { return dayKey }
        return ChqTime.compactDayLabel(for: date)
    }

    private func fullDayTitle(for dayKey: String) -> String {
        guard let date = ChqTime.parse("\(dayKey) 00:00:00") else { return dayKey }
        return ChqTime.dayTitle(for: date)
    }

    private func dayChipsRow(availableDays: [String], selectedDay: String) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(availableDays, id: \.self) { day in
                    MyDayChip(
                        label: compactDayLabel(for: day),
                        fullTitle: fullDayTitle(for: day),
                        isSelected: day == selectedDay
                    ) {
                        self.selectedDay = day
                    }
                }
            }
            .padding(.horizontal)
        }
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
}

/// One selectable day chip in `MyDayView`'s horizontal day strip.
///
/// `label` is the compact form shown on-screen ("Sat 27"); `fullTitle` is
/// the same day spelled out ("Saturday, July 27") and is exposed only to
/// VoiceOver via `accessibilityLabel`.
private struct MyDayChip: View {
    let label: String
    let fullTitle: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.subheadline.weight(isSelected ? .semibold : .regular))
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(
                    isSelected ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.thinMaterial),
                    in: Capsule()
                )
                .foregroundStyle(isSelected ? .white : .primary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(fullTitle)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}
