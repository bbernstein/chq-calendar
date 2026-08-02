import SwiftUI

/// The horizontal strip of 9 week chips ("1"–"9") shown as a row of
/// `FilterBarView`. A tap selects that week (see `AppModel.selectWeek`); a
/// long-press shows the week's theme in a context menu.
///
/// Chips are styled by `WeekTimeState` so a user mid-season can tell at a
/// glance what is behind them, what week they are in, and what is ahead —
/// and the strip scrolls the current week to the leading edge on first
/// appearance rather than starting at week 1.
struct WeekStripView: View {
    let model: AppModel

    /// Guards the one-shot initial scroll so it can't fight the user's own
    /// scrolling on subsequent re-renders.
    @State private var hasScrolledToInitialWeek = false

    var body: some View {
        // Read the clock, the year and the current week ONCE per render, and
        // use those values for every chip and for `onAppear`.
        //
        // Both `referenceNow` and `model.currentWeek` call the model's clock
        // on each access, and the un-cached versions were read per chip — so
        // a single render took eighteen clock readings that were not required
        // to agree with one another. Season weeks turn over at noon on
        // Saturday, so a tick between two of those readings could render a
        // strip with no `.current` week at all, or with `.current` and the
        // "This Week" scope chip disagreeing.
        //
        // `currentWeek` also rebuilds all nine `SeasonWeek` structs per call
        // (`SeasonCalendar.weeks(forYear:)`), so hoisting it turns eighty-one
        // week constructions per render into nine.
        let now = referenceNow
        let year = model.selectedYear
        let currentWeek = model.currentWeek

        return ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(1...9, id: \.self) { number in
                        WeekChip(
                            number: number,
                            isSelected: FilterChipState.isWeekSelected(
                                number, selection: model.filter, currentWeek: currentWeek),
                            timeState: WeekStripState.timeState(
                                week: number, now: now, year: year),
                            theme: model.theme(forWeek: number)
                        ) {
                            KeyboardDismisser.dismiss()
                            model.selectWeek(number)
                        }
                        .id(number)
                    }
                }
                .padding(.horizontal)
            }
            .onAppear {
                guard !hasScrolledToInitialWeek else { return }
                hasScrolledToInitialWeek = true
                guard let target = WeekStripState.initialScrollTarget(
                    now: now, year: year
                ) else { return }
                // No animation: this is the strip's starting position, not a
                // transition the user should watch happen.
                proxy.scrollTo(target, anchor: .leading)
            }
        }
    }

    /// `nil` for a non-current year — see `WeekStripState`.
    private var referenceNow: Date? {
        model.isCurrentYear ? model.now() : nil
    }
}

private struct WeekChip: View {
    let number: Int
    let isSelected: Bool
    let timeState: WeekTimeState
    let theme: WeeklyTheme?
    let action: () -> Void

    var body: some View {
        let chip = Button(action: action) {
            Text("\(number)")
                .font(.subheadline.weight(timeState == .current ? .bold : .semibold))
                .frame(minWidth: 44, minHeight: 44)
                .foregroundStyle(foreground)
                .background(background, in: Capsule())
                .opacity(timeState == .past && !isSelected ? 0.55 : 1)
                .overlay {
                    if timeState == .current {
                        // Outset by 3pt so the ring stays visible when the
                        // chip is *also* selected — otherwise an accent ring
                        // on an accent fill disappears entirely.
                        Capsule()
                            .strokeBorder(.tint, lineWidth: 2)
                            .padding(-3)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)

        // Themeless weeks (shouldn't happen in practice, but the type is
        // optional) get no context menu attached at all, rather than one
        // with empty content.
        if let theme {
            chip.contextMenu { themeMenuContent(theme) }
        } else {
            chip
        }
    }

    private var foreground: some ShapeStyle {
        if isSelected { return AnyShapeStyle(.white) }
        switch timeState {
        case .past: return AnyShapeStyle(.secondary)
        case .current: return AnyShapeStyle(.tint)
        case .upcoming: return AnyShapeStyle(.primary)
        }
    }

    private var background: some ShapeStyle {
        if isSelected { return AnyShapeStyle(Color.accentColor) }
        return timeState == .past
            ? AnyShapeStyle(.ultraThinMaterial)
            : AnyShapeStyle(.thinMaterial)
    }

    @ViewBuilder
    private func themeMenuContent(_ theme: WeeklyTheme) -> some View {
        Text(theme.title)
            .font(.headline)
        Text("\(theme.startDate) – \(theme.endDate)")
        Text(theme.description)
    }

    private var accessibilityLabel: String {
        let prefix: String
        switch timeState {
        case .past: prefix = "Week \(number), past"
        case .current: prefix = "Week \(number), current week"
        case .upcoming: prefix = "Week \(number)"
        }
        guard let theme else { return prefix }
        return "\(prefix): \(theme.title)"
    }
}
