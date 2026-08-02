import SwiftUI

/// Which of the two orthogonal filter facets a `FacetRowView` drives.
///
/// "Venues" rather than the web's "Locations": every value in this list is
/// a place an event happens, and the shorter word leaves more of the row
/// for the chips that matter.
enum FilterFacet: String, Identifiable, CaseIterable, Sendable {
    case venues
    case categories

    var id: String { rawValue }

    var title: String {
        switch self {
        case .venues: return "Venues"
        case .categories: return "Categories"
        }
    }
}

/// One facet's row: a disclosure label, that facet's recently-used filters
/// inline beside it, and — when expanded — the full list in place.
///
/// The inline recents are the point of the whole control: applying a repeat
/// filter costs one tap with no preceding tap, and MRU ordering keeps the
/// filter you just used leftmost, hence always on screen and always one tap
/// from being removed. Mirrors `LocationFilter.tsx` / `CategoryFilter.tsx`.
struct FacetRowView: View {
    let model: AppModel
    let facet: FilterFacet
    let isExpanded: Bool
    let onToggleExpanded: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                disclosureLabel
                recentsStrip
            }
            .padding(.horizontal)

            if isExpanded {
                expandedPanel
                    .padding(.horizontal)
            }
        }
    }

    private var disclosureLabel: some View {
        Button {
            KeyboardDismisser.dismiss()
            onToggleExpanded()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.bold))
                    .rotationEffect(.degrees(isExpanded ? 90 : 0))
                Text(labelText)
                    .font(.subheadline.weight(.medium))
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            isExpanded ? "Hide all \(facet.title.lowercased())"
                       : "Show all \(facet.title.lowercased())")
    }

    private var labelText: String {
        let selected = model.selectedCount(facet)
        return selected > 0 ? "\(facet.title) (\(selected))" : facet.title
    }

    private var recentsStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(model.recentNames(facet), id: \.self) { name in
                    FacetChip(
                        label: displayName(name),
                        count: nil,
                        isSelected: model.isSelected(name, in: facet)
                    ) {
                        KeyboardDismisser.dismiss()
                        model.toggle(name, in: facet)
                    }
                }
            }
        }
    }

    private var expandedPanel: some View {
        ScrollView(.vertical, showsIndicators: true) {
            FlowLayout(spacing: 8) {
                ForEach(model.available(facet), id: \.self) { name in
                    FacetChip(
                        label: displayName(name),
                        count: model.count(for: name, in: facet),
                        isSelected: model.isSelected(name, in: facet)
                    ) {
                        KeyboardDismisser.dismiss()
                        model.toggle(name, in: facet)
                    }
                }
            }
            .padding(.vertical, 4)
        }
        // Capped so the panel never pushes the event list off screen —
        // the list staying visible and updating live underneath is the
        // whole reason this is inline rather than a sheet.
        .frame(maxHeight: 140)
    }

    private func displayName(_ name: String) -> String {
        switch facet {
        case .venues: return DisplayNames.location(name)
        case .categories: return DisplayNames.category(name)
        }
    }
}

private struct FacetChip: View {
    let label: String
    let count: Int?
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(label)
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.caption2.weight(.bold))
                }
                if let count {
                    Text("\(count)")
                        .font(.caption2)
                        .foregroundStyle(isSelected ? .white.opacity(0.7) : .secondary)
                }
            }
            .font(.subheadline)
            .lineLimit(1)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .foregroundStyle(isSelected ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            .background(
                isSelected ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.thinMaterial),
                in: Capsule()
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isSelected ? "\(label), selected" : label)
    }
}
