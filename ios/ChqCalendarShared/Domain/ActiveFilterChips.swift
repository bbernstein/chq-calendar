import Foundation

/// One removable filter in the reset row.
nonisolated struct ActiveFilterChip: Identifiable, Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case search
        /// The stored name, in the feed's original casing — passed straight
        /// back to `AppModel.toggleLocation` to remove it.
        case location(String)
        case category(String)
        case favorites
    }

    let id: String
    let kind: Kind
    /// Display-ready: `DisplayNames` shortcut already applied.
    let label: String

    /// What VoiceOver reads for the chip's remove button.
    ///
    /// The search chip's visible label is just the quoted term, which read
    /// aloud on its own (`Remove filter "Burns"`) gives no clue which of the
    /// four filter kinds is about to go. Mirrors the web, whose `FilterChip`
    /// prefixes exactly this one kind: `Remove filter Search: "Burns"`
    /// (`ActiveFilters.tsx`). Venue, category, and favorites chips carry
    /// their own meaning in the label and take no prefix, there or here.
    var accessibilityLabel: String {
        switch kind {
        case .search: return "Remove filter Search: \(label)"
        case .location, .category, .favorites: return "Remove filter \(label)"
        }
    }
}

/// Builds the reset row's chip list from the selection alone.
///
/// It needs nothing else because `FilterSelection` stores names in the
/// feed's original casing (see `EventFilter` for where the lowercasing
/// happens instead) — so `DisplayNames`' exact-match shortcuts just work.
nonisolated enum ActiveFilterChips {
    /// Order mirrors the web's `buildActiveChips`: search, locations,
    /// categories, favorites — and selection order within each group.
    ///
    /// Date scope and week are deliberately absent — and since #256 none of
    /// the reasons this comment used to give for that are true any more, so
    /// here is the one that is.
    ///
    /// They no longer have "their own controls directly above this row":
    /// they are the WHEN section of this same sheet, rendered *below* the
    /// ACTIVE row, inside a vertical `ScrollView` at a `.medium` detent —
    /// so they can scroll out of view exactly like a venue can. And there is
    /// no "Clear all": the button beside this row is `Clear Filters`, wired
    /// to `AppModel.clearNonDateFilters()`, which `FilterSheet` spends
    /// eleven lines warning must never be "fixed" into clearing dates.
    ///
    /// This row is the remove-one-of-these surface for exactly the filters
    /// that button clears. Dates are deliberately outside its scope — a
    /// reader who reached an empty list through a week selection needs the
    /// other filters cleared without losing the dates they chose — so a date
    /// chip here would sit in a row whose own reset control cannot reset it.
    static func build(selection: FilterSelection) -> [ActiveFilterChip] {
        var chips: [ActiveFilterChip] = []

        let term = selection.searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !term.isEmpty {
            chips.append(ActiveFilterChip(id: "search", kind: .search, label: "\"\(term)\""))
        }

        for name in selection.selectedLocations {
            chips.append(ActiveFilterChip(
                id: "loc-\(name)", kind: .location(name), label: DisplayNames.location(name)))
        }

        for name in selection.selectedCategories {
            chips.append(ActiveFilterChip(
                id: "cat-\(name)", kind: .category(name), label: DisplayNames.category(name)))
        }

        if selection.showFavoritesOnly {
            chips.append(ActiveFilterChip(
                id: "favorites", kind: .favorites, label: "Favorites"))
        }

        return chips
    }
}
