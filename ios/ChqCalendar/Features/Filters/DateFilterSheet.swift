import SwiftUI

/// The date pill's sheet: a scope row and the nine-week range strip.
///
/// Scope and week selection are mutually exclusive — one date range, two
/// ways of naming it. That rule lives in `AppModel.selectScope` and
/// `AppModel.setWeekSelection` and is deliberately not restated here; this
/// view renders state and forwards taps.
struct DateFilterSheet: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss

    private var visibleScopes: [DateScope] {
        model.isCurrentYear ? [.next, .today, .season, .all] : [.all]
    }

    private var seasonWeeks: [SeasonWeek] {
        SeasonCalendar.weeks(forYear: model.selectedYear)
    }

    private var weekNumbers: [Int] {
        seasonWeeks.map(\.number)
    }

    /// What a strip gesture should treat as already-selected. A persisted
    /// `.thisWeek` scope highlights the current week without any stored
    /// weeks — treating it as that one week makes tapping it deselect
    /// (rather than confusingly "re-select") on the first touch.
    private var effectiveWeekSelection: Set<Int> {
        if model.filter.selectedWeeks.isEmpty,
           model.filter.dateScope == .thisWeek,
           let currentWeek = model.currentWeek {
            return [currentWeek]
        }
        return model.filter.selectedWeeks
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    section("When") {
                        FlowLayout(spacing: 8) {
                            ForEach(visibleScopes, id: \.self) { scope in
                                SheetChip(
                                    label: scope.label,
                                    // Always defer to `FilterChipState`, even
                                    // when `visibleScopes` has collapsed to
                                    // the lone `.all` chip for a non-current
                                    // year: a week selection made in another
                                    // year survives `AppModel.select(year:)`
                                    // (it doesn't clear the filter), and only
                                    // `FilterChipState.isScopeSelected` knows
                                    // that a non-empty `selectedWeeks` means
                                    // "All" is *not* selected. Hardcoding
                                    // `true` here previously let this one
                                    // chip and the week grid both show as
                                    // checked at once.
                                    //
                                    // `isCurrentYear` is what tells it that a
                                    // persisted `.next`/`.today`/`.thisWeek`
                                    // is being ignored by the pipeline on a
                                    // past season, so the collapsed "All"
                                    // chip reads selected there instead of
                                    // leaving the sheet's only date control
                                    // unchecked.
                                    isSelected: FilterChipState.isScopeSelected(
                                        scope, selection: model.filter,
                                        currentWeek: model.currentWeek,
                                        isCurrentYear: model.isCurrentYear)
                                ) {
                                    model.selectScope(scope)
                                }
                            }
                        }
                    }

                    section("Weeks") {
                        let now: Date? = model.isCurrentYear ? model.now() : nil
                        let weeks = seasonWeeks
                        WeekRangeStrip(
                            weekNumbers: weekNumbers,
                            isSelected: { number in
                                FilterChipState.isWeekSelected(
                                    number, selection: model.filter,
                                    currentWeek: model.currentWeek)
                            },
                            effectiveSelection: effectiveWeekSelection,
                            timeState: { WeekStripState.timeState(week: $0, now: now, weeks: weeks) },
                            commit: { model.setWeekSelection($0) })
                    }
                }
                .padding(20)
            }
            .navigationTitle("Dates")
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) {
                // `matchCount`, not `dayGroups` — the footer needs a number,
                // and this sheet is presented over `EventListView`, which is
                // already grouping the same events behind it.
                SheetDismissButton(count: model.matchCount) { dismiss() }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackgroundInteraction(.enabled(upThrough: .medium))
    }

    @ViewBuilder
    private func section(
        _ title: String,
        @ViewBuilder content: () -> some View
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.caption.weight(.bold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)
            content()
        }
    }
}

/// A selectable pill inside a sheet. Distinct from the bottom-bar buttons
/// in `EventListView`, which are controls that open something rather than
/// values that toggle.
struct SheetChip: View {
    let label: String
    var count: Int?
    /// Marks a value the user picked recently. Renders a leading dot, and
    /// is announced by VoiceOver — without that the distinction would be
    /// purely visual. Only ever true for *unselected* chips: a selected
    /// chip is already accent-filled with a checkmark and has moved to the
    /// front group, so a dot inside it would be noise.
    var isRecent: Bool = false
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.caption2.weight(.bold))
                } else if isRecent {
                    Circle()
                        .fill(Color.accentColor)
                        .frame(width: 5, height: 5)
                }
                labelText
                if let count {
                    Text("\(count)")
                        .monospacedDigit()
                        .foregroundStyle(isSelected ? .white.opacity(0.7) : .secondary)
                }
            }
            // Metrics are deliberately below the 44pt HIG floor, which
            // governs isolated controls rather than dense grids of
            // same-kind, adjacent, non-destructive targets. 36pt is the
            // threshold at which Venues and Categories both clear the fold
            // at the sheet's medium detent — the whole point of the change.
            // `minHeight` is a floor, and the vertical padding is what
            // keeps the text breathing at large Dynamic Type sizes, where
            // the floor stops binding.
            .font(.footnote.weight(.medium))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .frame(minHeight: 36)
            .foregroundStyle(isSelected ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            .background(
                isSelected
                    ? AnyShapeStyle(Color.accentColor)
                    : AnyShapeStyle(.quaternary),
                in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(voiceOverLabel)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    /// Set explicitly rather than inferred, because the recency dot is a
    /// bare `Circle` with no implicit VoiceOver label. Keeps the count in
    /// the announcement, which the inferred label included.
    ///
    /// Named `voiceOverLabel`, not `accessibilityLabel`, so it cannot be
    /// confused with the SwiftUI modifier of that name one line above.
    private var voiceOverLabel: String {
        var parts = [label]
        if isRecent { parts.append("recently used") }
        if let count { parts.append("\(count) events") }
        return parts.joined(separator: ", ")
    }

    private var labelText: some View {
        Text(label)
            .lineLimit(1)
    }
}

/// The footer both sheets share. It **dismisses** — filters have already
/// applied live behind the sheet. There is no staged selection to commit,
/// so there is nothing to cancel either.
struct SheetDismissButton: View {
    let count: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text("Show \(count.formatted()) event\(count == 1 ? "" : "s")")
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.borderedProminent)
        .padding(.horizontal, 20)
        .padding(.bottom, 12)
        .background(.bar)
    }
}

#Preview("Week strip — accessibility3") {
    WeekRangeStrip(
        weekNumbers: Array(1...9),
        isSelected: { (4...6).contains($0) },
        effectiveSelection: [4, 5, 6],
        timeState: { $0 < 6 ? .past : $0 == 6 ? .current : .upcoming },
        commit: { _ in })
    .padding(20)
    .environment(\.dynamicTypeSize, .accessibility3)
}
