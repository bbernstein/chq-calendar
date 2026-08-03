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

    private var matchCount: Int {
        model.dayGroups.reduce(0) { $0 + $1.events.count }
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
                                    isSelected: model.isCurrentYear
                                        ? FilterChipState.isScopeSelected(
                                            scope, selection: model.filter,
                                            currentWeek: model.currentWeek)
                                        : true
                                ) {
                                    model.selectScope(scope)
                                }
                            }
                        }
                    }

                    if model.isCurrentYear || !weekNumbers.isEmpty {
                        section("Weeks") {
                            LazyVGrid(
                                columns: Array(
                                    repeating: GridItem(.flexible(), spacing: 8), count: 3),
                                spacing: 8
                            ) {
                                ForEach(weekNumbers, id: \.self) { number in
                                    SheetChip(
                                        label: "Week \(number)",
                                        isSelected: FilterChipState.isWeekSelected(
                                            number, selection: model.filter,
                                            currentWeek: model.currentWeek)
                                    ) {
                                        model.selectWeek(number)
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(20)
            }
            .navigationTitle("Dates")
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) {
                SheetDismissButton(count: matchCount) { dismiss() }
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

/// A selectable pill inside a sheet. Distinct from `FloatingFilterBar`'s
/// `BarPill`, which is a control that opens something rather than a value
/// that toggles.
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
                Text(label)
                    .lineLimit(1)
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
