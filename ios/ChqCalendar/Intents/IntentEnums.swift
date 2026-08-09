import AppIntents
import Foundation

/// AppEnum conformances for the shared #193 vocabulary types. Kept in the
/// app target (not `ChqCalendarShared`) so the shared layer never depends
/// on AppIntents — same split as `EventEntity` vs `Event`.
///
/// The dictionaries below are deliberately LITERAL, duplicating
/// `displayTitle`/`spokenSynonyms`/`spokenLabel`: the App Intents
/// metadata processor const-extracts these at build time, and a computed
/// dictionary can silently export no synonyms. `IntentEnumsTests` pins
/// every literal to the shared source of truth, so drift fails CI.
///
/// `nonisolated`: AppEnum's static requirements are read off the main
/// actor by the Shortcuts/Siri runtime — see `EventEntity.swift`.
nonisolated extension EventKind: AppEnum {
    static let typeDisplayRepresentation =
        TypeDisplayRepresentation(name: "Kind of Event", synonyms: ["Type of Event"])

    static let caseDisplayRepresentations: [EventKind: DisplayRepresentation] = [
        .lectures: DisplayRepresentation(title: "lectures",
            synonyms: ["lecture", "talks", "talk", "speakers"]),
        .symphonyConcerts: DisplayRepresentation(title: "symphony concerts",
            synonyms: ["symphony", "the symphony", "CSO", "classical concerts", "orchestra concerts"]),
        .concerts: DisplayRepresentation(title: "concerts",
            synonyms: ["concert", "shows", "performances", "music", "entertainment"]),
        .movies: DisplayRepresentation(title: "movies",
            synonyms: ["movie", "films", "film", "cinema"]),
        .operas: DisplayRepresentation(title: "operas", synonyms: ["opera"]),
        .plays: DisplayRepresentation(title: "plays",
            synonyms: ["play", "theater", "theatre", "drama"]),
        .dance: DisplayRepresentation(title: "dance performances",
            synonyms: ["dance", "ballet"]),
        .worshipServices: DisplayRepresentation(title: "worship services",
            synonyms: ["services", "church services", "religious services", "sacred song services"]),
        .recreation: DisplayRepresentation(title: "recreation activities",
            synonyms: ["recreation", "sports", "fitness", "activities"]),
        .familyActivities: DisplayRepresentation(title: "family activities",
            synonyms: ["kids activities", "kids events", "youth programs", "children's activities"]),
    ]
}

nonisolated extension IntentTimeframe: AppEnum {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "When")

    static let caseDisplayRepresentations: [IntentTimeframe: DisplayRepresentation] = [
        .today: DisplayRepresentation(title: "today"),
        .tonight: DisplayRepresentation(title: "tonight"),
        .tomorrow: DisplayRepresentation(title: "tomorrow"),
        .thisWeek: DisplayRepresentation(title: "this week"),
        .nextWeek: DisplayRepresentation(title: "next week"),
        .week1: DisplayRepresentation(title: "week 1"),
        .week2: DisplayRepresentation(title: "week 2"),
        .week3: DisplayRepresentation(title: "week 3"),
        .week4: DisplayRepresentation(title: "week 4"),
        .week5: DisplayRepresentation(title: "week 5"),
        .week6: DisplayRepresentation(title: "week 6"),
        .week7: DisplayRepresentation(title: "week 7"),
        .week8: DisplayRepresentation(title: "week 8"),
        .week9: DisplayRepresentation(title: "week 9"),
    ]
}

nonisolated extension ThemeWeek: AppEnum {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Week")

    static let caseDisplayRepresentations: [ThemeWeek: DisplayRepresentation] = [
        .thisWeek: DisplayRepresentation(title: "this week"),
        .nextWeek: DisplayRepresentation(title: "next week"),
        .week1: DisplayRepresentation(title: "week 1"),
        .week2: DisplayRepresentation(title: "week 2"),
        .week3: DisplayRepresentation(title: "week 3"),
        .week4: DisplayRepresentation(title: "week 4"),
        .week5: DisplayRepresentation(title: "week 5"),
        .week6: DisplayRepresentation(title: "week 6"),
        .week7: DisplayRepresentation(title: "week 7"),
        .week8: DisplayRepresentation(title: "week 8"),
        .week9: DisplayRepresentation(title: "week 9"),
    ]
}
