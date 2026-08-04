/// Which of the two orthogonal filter facets a `FacetChipCloud` drives.
///
/// "Venues" rather than the web's "Locations": every value in this list is
/// a place an event happens, and the shorter word leaves more of the row
/// for the chips that matter.
///
/// Lives in `Domain/` rather than beside `FacetChipCloud` because it is not a
/// view-layer detail: `AppModel` takes it in six signatures
/// (`selectedCount`, `recentNames`, `available`, `count(for:in:)`,
/// `isSelected`, `toggle`), so declaring it in `Features/` would have `App/`
/// depending on the view layer.
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
