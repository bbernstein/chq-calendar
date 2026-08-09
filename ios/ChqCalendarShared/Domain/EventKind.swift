import Foundation

/// The controlled "kind of event" vocabulary behind the Siri surface
/// (#193): each case carries the natural plural spoken title (Siri bakes
/// display titles verbatim into generated utterances), the synonyms a
/// user might say instead, and a matching rule over the feed's slug-form
/// tags (`Event.filterTokens`) plus, for movies, the venue itself.
///
/// Slug tags (e.g. `chautauqua-lecture-series`) are used rather than the
/// human-readable category names because slugs are stable ASCII — names
/// carry HTML entities and punctuation that vary (`popular entertainment
/// & concerts`).
///
/// `nonisolated`, like every type in this layer — see
/// `IntentDataSource.swift`'s doc comment.
nonisolated enum EventKind: String, CaseIterable, Sendable {
    case lectures
    case symphonyConcerts
    case concerts
    case movies
    case operas
    case plays
    case dance
    case worshipServices
    case recreation
    case familyActivities

    /// Natural plural spoken form — becomes the AppEnum case display title.
    var displayTitle: String {
        switch self {
        case .lectures: return "lectures"
        case .symphonyConcerts: return "symphony concerts"
        case .concerts: return "concerts"
        case .movies: return "movies"
        case .operas: return "operas"
        case .plays: return "plays"
        case .dance: return "dance performances"
        case .worshipServices: return "worship services"
        case .recreation: return "recreation activities"
        case .familyActivities: return "family activities"
        }
    }

    /// What a user might say instead of `displayTitle` — becomes the
    /// AppEnum case synonyms.
    var spokenSynonyms: [String] {
        switch self {
        case .lectures: return ["lecture", "talks", "talk", "speakers"]
        case .symphonyConcerts: return ["symphony", "the symphony", "CSO", "classical concerts", "orchestra concerts"]
        case .concerts: return ["concert", "shows", "performances", "music", "entertainment"]
        case .movies: return ["movie", "films", "film", "cinema"]
        case .operas: return ["opera"]
        case .plays: return ["play", "theater", "theatre", "drama"]
        case .dance: return ["dance", "ballet"]
        case .worshipServices: return ["services", "church services", "religious services", "sacred song services"]
        case .recreation: return ["recreation", "sports", "fitness", "activities"]
        case .familyActivities: return ["kids activities", "kids events", "youth programs", "children's activities"]
        }
    }

    /// Slug-form feed tags that identify this kind (matched against
    /// `Event.filterTokens`, which is already lowercased).
    private var slugTags: Set<String> {
        switch self {
        case .lectures:
            return ["chautauqua-lecture-series", "interfaith-lecture", "special-lectures",
                    "chautauqua-literary-and-scientific-circle-clsc", "master-class"]
        case .symphonyConcerts:
            return ["chautauqua-symphony-orchestra-classical-concerts", "chautauqua-chamber-music"]
        case .concerts:
            return ["popular-entertainment-concerts", "chautauqua-symphony-orchestra-classical-concerts",
                    "chautauqua-chamber-music", "school-of-music"]
        case .movies: return ["movies"]
        case .operas: return ["opera"]
        case .plays: return ["theater"]
        case .dance: return ["dance"]
        case .worshipServices: return ["faith-and-spiritual-programming", "service", "weekly-chaplains"]
        case .recreation: return ["recreation"]
        case .familyActivities: return ["youth-programs-and-activities"]
        }
    }

    /// Whether `event` is this kind. Movies additionally match by venue:
    /// everything at Chautauqua Cinema is a movie whether or not tagged.
    func matches(_ event: Event) -> Bool {
        if self == .movies, event.displayLocation?.lowercased() == "chautauqua cinema" {
            return true
        }
        return !slugTags.isDisjoint(with: event.filterTokens)
    }

    /// The venues whose events lead a spoken answer when several match —
    /// "what's the next lecture" should answer the 10:45 Amp lecture, not
    /// a porch chat (lowercased for comparison).
    static let flagshipVenues: Set<String> = [
        "amphitheater", "hall of philosophy", "norton hall", "bratton theater", "lenna hall"
    ]

    static func isFlagshipVenue(_ name: String?) -> Bool {
        guard let name else { return false }
        return flagshipVenues.contains(name.lowercased())
    }
}
