import SwiftUI

/// The horizontal strip of 9 week chips ("1"–"9") shown as row 2 of
/// `FilterBarView`. A tap toggles that week in `filter.selectedWeeks`; a
/// long-press shows the week's theme (title, date range, description) in a
/// context menu. The current week (if the viewed year is the current one)
/// gets an additional accent ring regardless of selection state.
struct WeekStripView: View {
    let model: AppModel

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(1...9, id: \.self) { number in
                    WeekChip(
                        number: number,
                        isSelected: model.filter.selectedWeeks.contains(number),
                        isCurrent: model.isCurrentYear && model.currentWeek == number,
                        theme: model.theme(forWeek: number)
                    ) {
                        model.toggleWeek(number)
                    }
                }
            }
            .padding(.horizontal)
        }
    }
}

private struct WeekChip: View {
    let number: Int
    let isSelected: Bool
    let isCurrent: Bool
    let theme: WeeklyTheme?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text("\(number)")
                .font(.subheadline.weight(.semibold))
                .frame(minWidth: 44, minHeight: 44)
                .foregroundStyle(isSelected ? .white : .primary)
                .background(
                    isSelected ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.thinMaterial),
                    in: Capsule()
                )
                .overlay {
                    if isCurrent {
                        Capsule().strokeBorder(.tint, lineWidth: 2)
                    }
                }
        }
        .buttonStyle(.plain)
        .contextMenu {
            if let theme {
                themeMenuContent(theme)
            }
        }
        .accessibilityLabel(accessibilityLabel)
    }

    @ViewBuilder
    private func themeMenuContent(_ theme: WeeklyTheme) -> some View {
        Text(theme.title)
            .font(.headline)
        Text("\(theme.startDate) – \(theme.endDate)")
        Text(theme.description)
    }

    private var accessibilityLabel: String {
        guard let theme else { return "Week \(number)" }
        return "Week \(number): \(theme.title)"
    }
}
