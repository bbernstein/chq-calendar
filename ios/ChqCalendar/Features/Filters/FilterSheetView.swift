import SwiftUI

/// The full filter sheet: multi-select category/location lists (each row
/// showing how many events in the current, unfiltered snapshot it matches)
/// plus a destructive "Clear All Filters" action. Presented from the
/// "Filters" chip in `FilterBarView`.
struct FilterSheetView: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss

    /// Per-token/location event counts against the unfiltered snapshot,
    /// built once per sheet appearance (`onAppear`) rather than recomputed
    /// per row per render.
    @State private var categoryCounts: [String: Int] = [:]
    @State private var locationCounts: [String: Int] = [:]

    var body: some View {
        NavigationStack {
            List {
                Section("Categories") {
                    ForEach(model.visibleCategories, id: \.self) { category in
                        FilterRow(
                            displayName: DisplayNames.category(category),
                            count: categoryCounts[category.lowercased()] ?? 0,
                            isSelected: model.filter.selectedCategories
                                .contains { $0.lowercased() == category.lowercased() }
                        ) {
                            model.toggleCategory(category)
                        }
                    }
                }

                Section("Locations") {
                    ForEach(model.visibleLocations, id: \.self) { location in
                        FilterRow(
                            displayName: DisplayNames.location(location),
                            count: locationCounts[location.lowercased()] ?? 0,
                            isSelected: model.filter.selectedLocations
                                .contains { $0.lowercased() == location.lowercased() }
                        ) {
                            model.toggleLocation(location)
                        }
                    }
                }

                Section {
                    Button("Clear All Filters", role: .destructive) {
                        model.clearFilters()
                    }
                }
            }
            .navigationTitle("Filters")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .onAppear(perform: computeCounts)
        }
        .presentationDetents([.medium, .large])
    }

    /// Builds both count dictionaries in a single pass over
    /// `model.snapshot?.events`. Category counts key on `filterTokens`
    /// (lowercased tags + category names) to match exactly what
    /// `EventFilter` compares `selectedCategories` against; location counts
    /// key on lowercased `displayLocation`.
    private func computeCounts() {
        guard let events = model.snapshot?.events else {
            categoryCounts = [:]
            locationCounts = [:]
            return
        }
        var categories: [String: Int] = [:]
        var locations: [String: Int] = [:]
        for event in events {
            for token in event.filterTokens {
                categories[token, default: 0] += 1
            }
            if let location = event.displayLocation?.lowercased() {
                locations[location, default: 0] += 1
            }
        }
        categoryCounts = categories
        locationCounts = locations
    }
}

private struct FilterRow: View {
    let displayName: String
    let count: Int
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Text(displayName)
                    .foregroundStyle(.primary)
                Spacer()
                Text("\(count)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if isSelected {
                    Image(systemName: "checkmark")
                        .foregroundStyle(.tint)
                }
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
