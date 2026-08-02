import SwiftUI

/// The one-touch filter bar mounted above the calendar list via
/// `.safeAreaInset(edge: .top)`. Row 1 is a horizontally-scrolling row of
/// date-scope chips, a favorites toggle, and a button that opens the full
/// `FilterSheetView`; row 2 is `WeekStripView`. Pure view — every mutation
/// calls straight through to `AppModel`, no local filter state.
struct FilterBarView: View {
    let model: AppModel
    @State private var isFilterSheetPresented = false

    var body: some View {
        VStack(spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(visibleScopes, id: \.self) { scope in
                        FilterChip(
                            label: scope.label,
                            isSelected: model.isCurrentYear
                                ? FilterChipState.isScopeSelected(
                                    scope, selection: model.filter, currentWeek: model.currentWeek)
                                : true
                        ) {
                            KeyboardDismisser.dismiss()
                            model.selectScope(scope)
                        }
                    }

                    FilterChip(
                        label: "\(model.favorites.count)",
                        systemImage: "star.fill",
                        isSelected: model.filter.showFavoritesOnly
                    ) {
                        KeyboardDismisser.dismiss()
                        model.toggleFavoritesOnly()
                    }
                    .accessibilityLabel("Favorites, \(model.favorites.count)")

                    FilterChip(
                        label: "Filters",
                        systemImage: "line.3.horizontal.decrease.circle",
                        isSelected: false,
                        badge: model.filter.activeCount > 0 ? model.filter.activeCount : nil
                    ) {
                        KeyboardDismisser.dismiss()
                        isFilterSheetPresented = true
                    }
                }
                .padding(.horizontal)
            }

            WeekStripView(model: model)
        }
        .padding(.vertical, 6)
        .background(.bar)
        .sheet(isPresented: $isFilterSheetPresented) {
            FilterSheetView(model: model)
        }
        #if DEBUG
        // MARK: UI-test hooks (DEBUG only)
        // Consumes the flag `CalendarView.applyUITestHooks` sets for
        // `-uitest-show-filters`. Both `onAppear` (flag already true when
        // this view first mounts) and `onChange` (this view was already
        // mounted — e.g. from a warm cache — before `start()` finished and
        // the flag flipped) are needed to catch either ordering. Compiles
        // out of Release builds.
        .onAppear(perform: presentFilterSheetIfNeeded)
        .onChange(of: model.uiTestShowFilters) { _, _ in presentFilterSheetIfNeeded() }
        #endif
    }

    #if DEBUG
    private func presentFilterSheetIfNeeded() {
        if model.uiTestShowFilters {
            model.uiTestShowFilters = false
            isFilterSheetPresented = true
        }
    }
    #endif

    /// All `DateScope` cases in a current-year season; only `.all` once the
    /// viewed year is no longer the current one (past/future seasons have
    /// no meaningful "now"/"today"/"this week").
    private var visibleScopes: [DateScope] {
        model.isCurrentYear ? DateScope.allCases : [.all]
    }
}

/// A single pill-shaped filter control: `.thinMaterial` when unselected,
/// solid accent fill with white text when selected. Explicit `minHeight: 44`
/// keeps the hit target ≥ 44pt regardless of label length.
private struct FilterChip: View {
    let label: String
    var systemImage: String?
    let isSelected: Bool
    var badge: Int?
    let action: () -> Void

    init(
        label: String,
        systemImage: String? = nil,
        isSelected: Bool,
        badge: Int? = nil,
        action: @escaping () -> Void
    ) {
        self.label = label
        self.systemImage = systemImage
        self.isSelected = isSelected
        self.badge = badge
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if let systemImage {
                    Image(systemName: systemImage)
                }
                Text(label)
                if let badge {
                    Text("\(badge)")
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .foregroundStyle(.white)
                        .background(
                            isSelected ? AnyShapeStyle(Color.white.opacity(0.3)) : AnyShapeStyle(Color.accentColor),
                            in: Capsule()
                        )
                }
            }
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 14)
            .frame(minWidth: 44, minHeight: 44)
            .foregroundStyle(isSelected ? .white : .primary)
            .background(
                isSelected ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.thinMaterial),
                in: Capsule()
            )
        }
        .buttonStyle(.plain)
    }
}
