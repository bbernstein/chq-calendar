import AppIntents
import WidgetKit

/// Venue options offered by `WidgetConfigIntent`'s picker: distinct
/// `displayLocation` values from the cached snapshot, most-frequent first.
/// This type is just the AppIntents seam — all the real logic (and its
/// cold-cache resilience) lives in `WidgetDataSource.venueOptions`.
struct VenueOptionsProvider: DynamicOptionsProvider {
    func results() async throws -> [String] {
        WidgetDataSource.venueOptions()
    }
}

/// Category options offered by `WidgetConfigIntent`'s picker — see
/// `WidgetDataSource.categoryOptions`.
struct CategoryOptionsProvider: DynamicOptionsProvider {
    func results() async throws -> [String] {
        WidgetDataSource.categoryOptions()
    }
}

/// The widget's user-configurable narrowing, surfaced through iOS's own
/// widget configuration UI (long-press a placed widget → Edit Widget, or
/// the picker shown while adding one). A single venue/category/starred-only
/// combination, matching `WidgetTimelineBuilder.Config`'s one-picker-per-
/// facet shape rather than `FilterSelection`'s multi-select — see
/// `timelineConfig` below for the translation.
///
/// No explicit `init()`/`perform()`: `WidgetConfigurationIntent` supplies a
/// default `perform()` (this intent exists purely to hold configuration,
/// never to run an action), and every `@Parameter` here has an implicit or
/// explicit default, so the memberwise zero-argument initializer WidgetKit
/// needs to construct a fresh, unconfigured instance is synthesized for
/// free — the same shape as Xcode's own "Widget Extension" template.
struct WidgetConfigIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Configure CHQ Widget"
    static let description = IntentDescription(
        "Narrow this widget to a venue, a category, or your starred events."
    )

    @Parameter(title: "Venue", optionsProvider: VenueOptionsProvider())
    var venue: String?

    @Parameter(title: "Category", optionsProvider: CategoryOptionsProvider())
    var category: String?

    @Parameter(title: "Starred only", default: false)
    var favoritesOnly: Bool
}

extension WidgetConfigIntent {
    /// This intent's parameters, translated into the domain type
    /// `WidgetTimelineBuilder.timeline(...)` actually consumes.
    var timelineConfig: WidgetTimelineBuilder.Config {
        WidgetTimelineBuilder.Config(venue: venue, category: category, favoritesOnly: favoritesOnly)
    }
}
