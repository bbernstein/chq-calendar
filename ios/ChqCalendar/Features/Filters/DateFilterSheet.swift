import SwiftUI

/// The date pill's sheet: a scope row and a grid of the season's nine weeks.
///
/// Scope and week selection are mutually exclusive — one date range, two
/// ways of naming it. That rule lives in `AppModel.selectScope` and
/// `AppModel.selectWeek` and is deliberately not restated here; this view
/// renders state and forwards taps.
struct DateFilterSheet: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss

    private var visibleScopes: [DateScope] {
        model.isCurrentYear ? DateScope.allCases : [.all]
    }

    private var weekNumbers: [Int] {
        SeasonCalendar.weeks(forYear: model.selectedYear).map(\.number)
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
                        LazyVGrid(
                            columns: Array(
                                repeating: GridItem(.flexible(), spacing: 8), count: 3),
                            spacing: 8
                        ) {
                            ForEach(weekNumbers, id: \.self) { number in
                                // Bare number, not "Week N": the section
                                // header above already reads "WEEKS", so
                                // repeating the word in every chip is
                                // redundant. It also sidesteps a real bug —
                                // SF Pro's proportional digits made "Week 4",
                                // "Week 8", "Week 9" (and any selected chip,
                                // which loses width to its checkmark)
                                // marginally wider than the rest, so a
                                // per-chip `ViewThatFits` fit decision landed
                                // right on the boundary and split
                                // inconsistently across the grid. A fixed
                                // bare-number label can't split at all.
                                // VoiceOver still announces "Week 6" via the
                                // explicit `.accessibilityLabel` below.
                                SheetChip(
                                    label: "\(number)",
                                    isSelected: FilterChipState.isWeekSelected(
                                        number, selection: model.filter,
                                        currentWeek: model.currentWeek)
                                ) {
                                    model.selectWeek(number)
                                }
                                .accessibilityLabel("Week \(number)")
                            }
                        }
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
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.caption2.weight(.bold))
                }
                labelText
                if let count {
                    Text("\(count)")
                        .monospacedDigit()
                        .foregroundStyle(isSelected ? .white.opacity(0.7) : .secondary)
                }
            }
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .foregroundStyle(isSelected ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            .background(
                isSelected
                    ? AnyShapeStyle(Color.accentColor)
                    : AnyShapeStyle(.quaternary),
                in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
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

/// Reproduces the Weeks grid's 3-column layout at an accessibility Dynamic
/// Type size, standalone from `AppModel`/`EventRepository` (which need a
/// live cache or API client that only test-target mocks provide).
///
/// This is what to check by eye: at `.accessibility3` and larger, the bare
/// number plus a checkmark (chip 5, marked selected) still respects the
/// 44pt minimum height without truncating — the one thing that was still
/// worth confirming once the chips stopped choosing between "Week N" and
/// "N" at all.
#Preview("Weeks grid — accessibility3") {
    ScrollView {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3),
            spacing: 8
        ) {
            ForEach(1...9, id: \.self) { number in
                SheetChip(
                    label: "\(number)",
                    isSelected: number == 5
                ) {}
                .accessibilityLabel("Week \(number)")
            }
        }
        .padding(20)
    }
    .environment(\.dynamicTypeSize, .accessibility3)
}
