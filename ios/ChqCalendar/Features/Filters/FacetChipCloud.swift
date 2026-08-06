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
/// Recents sit between the two, so a value this user keeps picking is
/// reachable even when the season's counts disagree — Lenna Hall ranks
/// 21st of 64 venues, so count-ordering alone never surfaces it.
/// `FacetChipOrder` drops any recent absent from the currently-viewed
/// year, which is what makes this safe to show at all: the old strip was
/// removed because a name remembered from another year rendered
/// identically to a live one (#157).
struct FacetChipCloud: View {
    let model: AppModel
    let facet: FilterFacet

    /// Sized so both facet sections clear the fold at the sheet's medium
    /// detent — how many rows that takes depends on name length, not chip
    /// count, since long venue names (e.g. "Sports Club, Lawn Bowling
    /// Green") wrap to one or two chips per row. Everything beyond this
    /// lives behind the drill-down.
    private static let visibleLimit = 8

    /// How many recents may take one of those slots. `RecentFilters` stores
    /// more (10); the surplus absorbs entries dropped for not existing in
    /// the currently-viewed year.
    private static let recentLimit = 5

    private var allNames: [String] { model.available(facet) }

    private var ordered: [FacetChipOrder.Entry] {
        FacetChipOrder.build(
            all: allNames,
            isSelected: { model.isSelected($0, in: facet) },
            recent: model.recentNames(facet),
            count: { model.count(for: $0, in: facet) },
            recentLimit: Self.recentLimit,
            visibleLimit: Self.visibleLimit)
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
                // Compare against what `ordered` actually renders, not
                // against `visibleLimit` directly. A selected value counts
                // toward `ordered` without counting toward the cap, so a
                // facet can render fewer than `visibleLimit` chips while
                // still hiding some (e.g. 8 selected + 1 unselected, all cut
                // by `prefix`) — or render exactly `allNames.count` chips
                // when the facet has few enough values that nothing is cut,
                // in which case the link would otherwise show with nothing
                // behind it. Deriving from `ordered.count` keeps this
                // condition unable to drift from the truncation it describes,
                // and is also what closes the "vanishing chip": a deselected
                // value that re-enters the unselected pool past the cap
                // still has a way back via `All n` even when the facet's
                // total is ≤ `visibleLimit`.
                if ordered.count < allNames.count {
                    NavigationLink {
                        FacetAllList(model: model, facet: facet)
                    } label: {
                        Text("All \(allNames.count)")
                            .font(.caption.weight(.semibold))
                    }
                }
            }

            FlowLayout(spacing: 6) {
                ForEach(ordered) { entry in
                    SheetChip(
                        label: displayName(entry.name),
                        count: model.count(for: entry.name, in: facet),
                        isRecent: entry.isRecent,
                        isSelected: model.isSelected(entry.name, in: facet)
                    ) {
                        model.toggle(entry.name, in: facet)
                    }
                }
            }
        }
    }
}
