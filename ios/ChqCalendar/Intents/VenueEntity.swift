import AppIntents
import Foundation

/// The venue slot for #193's parameterized phrases. An `AppEntity`
/// rather than the previous plain-`String` parameter because only enums
/// and entities may appear in an App Shortcut phrase — and entity values
/// reach Siri via `ChqShortcuts.updateAppShortcutParameters()`, called
/// whenever cached event data changes (see `WidgetReloading`).
///
/// `nonisolated` — same reasoning as `EventEntity`.
nonisolated struct VenueEntity: AppEntity {
    let name: String
    var id: String { name }

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Venue"
    static let defaultQuery = VenueEntityQuery()

    /// Spoken alternatives for the venues people abbreviate, keyed by
    /// lowercased feed name.
    private static let spokenSynonyms: [String: [String]] = [
        "amphitheater": ["the Amp", "the Amphitheater", "the amphitheatre"],
        "hall of philosophy": ["the Hall of Philosophy"],
        "chautauqua cinema": ["the cinema", "the movie theater"],
    ]

    var displayRepresentation: DisplayRepresentation {
        let synonyms = Self.spokenSynonyms[name.lowercased()] ?? []
        return DisplayRepresentation(
            title: "\(name)",
            subtitle: nil, image: nil,
            synonyms: synonyms.map { "\($0)" }
        )
    }
}

/// Venue values come from the same most-frequent-first ranking the
/// widget's venue picker uses, over the cached snapshot.
nonisolated struct VenueEntityQuery: EntityQuery {
    func entities(for identifiers: [String]) async -> [VenueEntity] {
        identifiers.map(VenueEntity.init(name:))
    }

    func suggestedEntities() async -> [VenueEntity] {
        WidgetConfigOptions.venueOptions(events: await IntentDataSource.events(now: Date()))
            .map(VenueEntity.init(name:))
    }
}
