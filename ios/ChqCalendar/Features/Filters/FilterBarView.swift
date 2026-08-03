import SwiftUI

/// The one-touch filter bar mounted above the calendar list via
/// `.safeAreaInset(edge: .top)`. Row 1 is a horizontally-scrolling row of
/// date-scope chips plus a favorites toggle; row 2 is `WeekStripView`;
/// rows 3 and 4 are the venue and category `FacetRowView`s. Pure view —
/// every mutation calls straight through to `AppModel`, no local filter
/// state beyond which facet panel is open.
struct FilterBarView: View {
    let model: AppModel

    /// When true, only the scope and week rows render — the bar's other
    /// rows are given back to the event list while the user is browsing.
    /// How much space that is isn't fixed: roughly 100pt with no filters
    /// active, ~150pt with filters, and more still with a facet panel open
    /// — see `FilterBarCollapseDriver`, which measures it at runtime.
    var isCollapsed: Bool = false

    /// At most one facet panel is open at a time — two 140pt panels plus
    /// four rows would bury the list entirely.
    @State private var expandedFacet: FilterFacet?

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
                }
                .padding(.horizontal)
            }

            WeekStripView(model: model)

            if !isCollapsed {
                ForEach(FilterFacet.allCases) { facet in
                    FacetRowView(
                        model: model,
                        facet: facet,
                        isExpanded: expandedFacet == facet
                    ) {
                        expandedFacet = expandedFacet == facet ? nil : facet
                    }
                }

                // `hasNonDateFilters`, not `hasFilters`: the default
                // `.next` scope makes `hasDateFilters` true on a fresh
                // install, so `hasFilters` is true before the user has
                // touched anything — while `ActiveFilterChips` deliberately
                // emits no date or week chips (their own controls sit
                // directly above). Gating on `hasFilters` therefore renders
                // a solitary "Clear all" under two empty facet rows,
                // permanently, in the app's default state.
                //
                // The web guards the same case as `hasFilters &&
                // chips.length > 0` (`ActiveFilters.tsx`); it can afford
                // `hasFilters` alone only because `buildActiveChips` does
                // emit date and week chips. `hasNonDateFilters` is exactly
                // "this selection produces at least one chip" — see
                // `ActiveFilterChipsTests`, which pins the two together.
                //
                // "Clear all" stays reachable for date-only filtering: the
                // `All` scope chip in row 1 does the same job.
                if model.filter.hasNonDateFilters {
                    ResetFilterRow(model: model)
                }
            }
        }
        .padding(.vertical, 6)
        .background(.bar)
        .onChange(of: isCollapsed) { _, collapsed in
            if collapsed { expandedFacet = nil }
        }
        #if DEBUG
        // MARK: UI-test hooks (DEBUG only)
        // Consumes the flag `CalendarView.applyUITestHooks` sets for
        // `-uitest-show-filters`. Both `onAppear` (flag already true when
        // this view first mounts) and `onChange` (this view was already
        // mounted — e.g. from a warm cache — before `start()` finished and
        // the flag flipped) are needed to catch either ordering. Compiles
        // out of Release builds.
        .onAppear(perform: expandFacetIfNeeded)
        .onChange(of: model.uiTestShowFilters) { _, _ in expandFacetIfNeeded() }
        #endif
    }

    #if DEBUG
    /// `-uitest-show-filters` used to present the filter sheet; the sheet is
    /// gone, so it now expands the Venues panel — the equivalent "show me
    /// the filter UI" state for the App Store screenshot.
    private func expandFacetIfNeeded() {
        if model.uiTestShowFilters {
            model.uiTestShowFilters = false
            expandedFacet = .venues
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
    let action: () -> Void

    init(
        label: String,
        systemImage: String? = nil,
        isSelected: Bool,
        action: @escaping () -> Void
    ) {
        self.label = label
        self.systemImage = systemImage
        self.isSelected = isSelected
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if let systemImage {
                    Image(systemName: systemImage)
                }
                Text(label)
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
