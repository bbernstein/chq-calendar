import SwiftUI

/// One facet's chips inside the filter sheet: everything selected, then the
/// highest-count values that remain, then a link to the rest.
///
/// Ordering is the feature. The feed carries 76 distinct venues, so no flat
/// alphabetical list fits and no fixed subset is right for everyone.
/// Selected-first guarantees a selection is never scrolled out of sight;
/// count-descending after that puts the venues that actually host events at
/// the top.
///
/// This replaces the old recents strip, which showed names remembered from a
/// previous session that might not exist in the loaded year at all (#157).
/// Count-ordering surfaces the same frequently-used values without ever
/// offering a name the current snapshot cannot match.
struct FacetChipCloud: View {
    let model: AppModel
    let facet: FilterFacet

    /// Roughly two rows of chips on an iPhone. Everything beyond this lives
    /// behind the drill-down.
    private static let visibleLimit = 8

    private var allNames: [String] { model.available(facet) }

    private var ordered: [String] {
        let selected = allNames.filter { model.isSelected($0, in: facet) }
        let rest = allNames
            .filter { !model.isSelected($0, in: facet) }
            .sorted { model.count(for: $0, in: facet) > model.count(for: $1, in: facet) }
        return selected + rest.prefix(max(0, Self.visibleLimit - selected.count))
    }

    private func displayName(_ name: String) -> String {
        switch facet {
        case .venues: return DisplayNames.location(name)
        case .categories: return DisplayNames.category(name)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(facet.title)
                    .font(.caption.weight(.bold))
                    .textCase(.uppercase)
                    .foregroundStyle(.secondary)
                Spacer()
                if allNames.count > Self.visibleLimit {
                    NavigationLink {
                        FacetAllList(model: model, facet: facet)
                    } label: {
                        Text("All \(allNames.count)")
                            .font(.caption.weight(.semibold))
                    }
                }
            }

            FlowLayout(spacing: 8) {
                ForEach(ordered, id: \.self) { name in
                    SheetChip(
                        label: displayName(name),
                        count: model.count(for: name, in: facet),
                        isSelected: model.isSelected(name, in: facet)
                    ) {
                        model.toggle(name, in: facet)
                    }
                }
            }
        }
    }
}
