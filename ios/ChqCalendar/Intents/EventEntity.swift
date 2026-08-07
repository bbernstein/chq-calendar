import AppIntents
import Foundation

/// The `AppEntity` Shortcuts/Siri operate on — a lightweight projection of
/// `Event` carrying just what a shortcut result needs to display or hand
/// back to `OpenEventIntent`. Kept separate from `Event` itself (rather than
/// conforming `Event` to `AppEntity` directly) because `AppEntity` pulls in
/// `AppIntents`, which the rest of the domain layer this reads through
/// (`ChqCalendarShared`, shared with the widget extension) has no reason to
/// depend on.
///
/// `nonisolated`, matching `WidgetDataSource`/`NextUpProvider`'s reasoning
/// (see `NextUpWidget.swift`): the project's `SWIFT_DEFAULT_ACTOR_ISOLATION`
/// is `MainActor`, but `AppEntity`'s `displayRepresentation` and
/// `typeDisplayRepresentation` are synchronous, non-isolated protocol
/// requirements — the Shortcuts/Siri runtime can read them from off the
/// main actor. A conforming type left at its default (main-actor) isolation
/// can't satisfy a synchronous nonisolated requirement at all (not just
/// "slow" — a compile error), so the whole type is marked `nonisolated`
/// here rather than fighting that per member.
nonisolated struct EventEntity: AppEntity {
    let id: String
    let title: String
    let venue: String?
    let start: Date

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Event"

    static let defaultQuery = EventEntityQuery()

    var displayRepresentation: DisplayRepresentation {
        let when = "\(ChqTime.dayTitle(for: start)) at \(ChqTime.timeString(for: start))"
        let subtitle = [venue, when].compactMap { $0 }.joined(separator: " · ")
        return DisplayRepresentation(title: "\(title)", subtitle: "\(subtitle)")
    }

    init(id: String, title: String, venue: String?, start: Date) {
        self.id = id
        self.title = title
        self.venue = venue
        self.start = start
    }

    /// The usual construction path: everything else in this file builds
    /// entities straight from cached `Event`s.
    init(event: Event) {
        self.init(id: event.id, title: event.title, venue: event.displayLocation, start: event.start)
    }
}

/// Looks up/searches/suggests `EventEntity` values against
/// `IntentDataSource`'s cached snapshot — no network, matching every other
/// entry point through that type.
nonisolated struct EventEntityQuery: EntityQuery, EntityStringQuery {
    /// How many results `entities(matching:)`/`suggestedEntities()` cap at
    /// — enough for Siri/Shortcuts to offer a meaningful picker without
    /// listing the whole season.
    private static let resultLimit = 10

    /// Exact lookup by id — what Shortcuts calls to re-resolve a
    /// previously-picked `EventEntity` (e.g. re-running a saved shortcut).
    /// Unknown ids are silently dropped rather than erroring, matching
    /// `DeepLink`/`SharedSnapshotLoader`'s "missing data degrades to
    /// nothing" convention throughout this layer.
    func entities(for identifiers: [String]) async -> [EventEntity] {
        let events = await IntentDataSource.shared.events(now: Date())
        let byID = Dictionary(uniqueKeysWithValues: events.map { ($0.id, $0) })
        return identifiers.compactMap { byID[$0] }.map(EventEntity.init(event:))
    }

    /// Free-text search, ranked by `EventFilter.searchScore` (the same
    /// title/location/token/details/presenter scoring the in-app search bar
    /// uses) and capped at `resultLimit`.
    func entities(matching string: String) async -> [EventEntity] {
        let events = await IntentDataSource.shared.events(now: Date())
        return Self.rank(events: events, matching: string, limit: Self.resultLimit).map(EventEntity.init(event:))
    }

    /// The picker's default suggestions before the user has typed
    /// anything: the next `resultLimit` upcoming events, soonest first.
    func suggestedEntities() async -> [EventEntity] {
        let now = Date()
        let events = await IntentDataSource.shared.events(now: now)
        return IntentDataSource.selectUpcoming(events: events, venue: nil, now: now, limit: Self.resultLimit)
            .map(EventEntity.init(event:))
    }

    /// Pure ranking helper: `events` scored against `term` via
    /// `EventFilter.searchScore`, zero-score entries dropped, highest score
    /// first, capped at `limit`. Split out from `entities(matching:)` so it
    /// can be exercised directly in `IntentSelectionTests` without the
    /// AppIntents runtime.
    static func rank(events: [Event], matching term: String, limit: Int) -> [Event] {
        events
            .map { ($0, EventFilter.searchScore(event: $0, term: term)) }
            .filter { $0.1 > 0 }
            .sorted { $0.1 > $1.1 }
            .prefix(limit)
            .map { $0.0 }
    }
}
