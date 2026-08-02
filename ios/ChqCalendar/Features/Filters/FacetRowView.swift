import SwiftUI

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
        // `labelText` first, so the selected count a sighted user reads in
        // the label ("Venues (2)") is not dropped by the override — the
        // same reason `FacetChip` appends ", selected" rather than
        // replacing its label.
        .accessibilityLabel("\(labelText), \(isExpanded ? "hide" : "show") all")
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
        .accessibilityLabel(accessibilityLabel)
    }

    /// The chip's visible count (`FacetChip(count:)`, shown only in the
    /// expanded panel — `recentsStrip` always passes `nil`) is otherwise
    /// invisible to VoiceOver, unlike `disclosureLabel`'s selected-count,
    /// which is deliberately kept in its label for exactly this reason.
    private var accessibilityLabel: String {
        var parts = [label]
        if let count {
            parts.append("\(count) events")
        }
        if isSelected {
            parts.append("selected")
        }
        return parts.joined(separator: ", ")
    }
}
