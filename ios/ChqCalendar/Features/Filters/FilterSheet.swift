import SwiftUI

/// The filter pill's sheet: what is active, the two facets, and favorites.
///
/// Everything applies live — the list behind the sheet re-filters on every
/// tap, visible at the medium detent. The footer button only dismisses.
/// There is no staged selection, so there is nothing to cancel and no way
/// for the sheet's state and the model's to disagree.
///
/// Favorites lives here rather than in the bar so the pill's badge can
/// account for every filter that narrows the list. See `ActiveFilterCount`.
struct FilterSheet: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss

    private var chips: [ActiveFilterChip] {
        ActiveFilterChips.build(selection: model.filter)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if !chips.isEmpty {
                        activeSection
                    }
                    FacetChipCloud(model: model, facet: .venues)
                    FacetChipCloud(model: model, facet: .categories)
                    favoritesSection
                }
                .padding(20)
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !chips.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        // Clears search, venues, categories, and favorites —
                        // deliberately NOT the date scope or week selection,
                        // which have their own pill and sheet. Keep this
                        // scoped to `clearNonDateFilters()`; don't "fix" it
                        // to also reset dates.
                        Button("Clear Filters") { model.clearNonDateFilters() }
                    }
                }
            }
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

    private var activeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Active")
                .font(.caption.weight(.bold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)
            FlowLayout(spacing: 8) {
                ForEach(chips) { chip in
                    Button {
                        model.remove(chip)
                    } label: {
                        HStack(spacing: 5) {
                            Text(chip.label).lineLimit(1)
                            Image(systemName: "xmark")
                                .font(.caption2.weight(.bold))
                                .opacity(0.7)
                        }
                        .font(.footnote.weight(.medium))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .frame(minHeight: 36)
                        .foregroundStyle(.white)
                        .background(Color.accentColor, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(chip.accessibilityLabel)
                }
            }
        }
    }

    private var favoritesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Only Show")
                .font(.caption.weight(.bold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)
            // `favoritesMatchCount`, not `favorites.count`: every other chip
            // in this sheet shows how many events it would leave given the
            // rest of the selection, and this one has to mean the same thing.
            SheetChip(
                label: "Favorites",
                count: model.favoritesMatchCount,
                isSelected: model.filter.showFavoritesOnly
            ) {
                model.toggleFavoritesOnly()
            }
        }
    }
}
