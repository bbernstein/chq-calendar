import SwiftUI

/// The full list of one facet's values, pushed from `FacetChipCloud`.
///
/// This is the only facet-scoped search field in the app. It sits one level
/// below the event search (which stays in the navigation bar's `.searchable`
/// on the calendar screen), and its navigation title names the facet, so the
/// two can't be mistaken for each other.
///
/// It pushes inside the sheet's own `NavigationStack` and takes the large
/// detent, so the sheet never dismisses and the event list underneath keeps
/// its scroll position.
struct FacetAllList: View {
    let model: AppModel
    let facet: FilterFacet

    @State private var query = ""

    private func displayName(_ name: String) -> String {
        switch facet {
        case .venues: return DisplayNames.location(name)
        case .categories: return DisplayNames.category(name)
        }
    }

    private var selected: [String] {
        model.available(facet).filter { model.isSelected($0, in: facet) }
    }

    private var matches: [String] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let unselected = model.available(facet).filter { !model.isSelected($0, in: facet) }
        guard !trimmed.isEmpty else { return unselected }
        return unselected.filter {
            displayName($0).localizedCaseInsensitiveContains(trimmed)
                || $0.localizedCaseInsensitiveContains(trimmed)
        }
    }

    var body: some View {
        List {
            if !selected.isEmpty {
                Section("Selected") {
                    ForEach(selected, id: \.self) { row(for: $0) }
                }
                Section("All \(facet.title)") {
                    ForEach(matches, id: \.self) { row(for: $0) }
                }
            } else {
                // No "Selected" section, so the remaining list needs no
                // header of its own either — a bare `Section("")` still
                // reserves an empty header row's worth of spacing, which
                // would read as an accidental gap above the first row.
                Section {
                    ForEach(matches, id: \.self) { row(for: $0) }
                }
            }
        }
        .listStyle(.insetGrouped)
        .searchable(text: $query, prompt: "Search \(facet.title.lowercased())")
        .navigationTitle(facet.title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func row(for name: String) -> some View {
        Button {
            model.toggle(name, in: facet)
        } label: {
            HStack {
                // `Image(systemName:)` has no valid "blank" symbol name — an
                // empty string is a malformed request, not a placeholder.
                // Render the checkmark unconditionally but fade it out when
                // unselected, so the reserved 16pt column keeps every row's
                // text aligned regardless of selection state.
                Image(systemName: "checkmark")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 16)
                    .opacity(model.isSelected(name, in: facet) ? 1 : 0)
                Text(displayName(name))
                    .foregroundStyle(.primary)
                Spacer()
                Text("\(model.count(for: name, in: facet))")
                    .font(.footnote)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityAddTraits(model.isSelected(name, in: facet) ? [.isSelected] : [])
    }
}
