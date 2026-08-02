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
    /// Date scope and week are deliberately absent: their own controls sit
    /// directly above this row and already show selection, and unlike
    /// venues they cannot scroll out of view. "Clear all" still clears them.
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
