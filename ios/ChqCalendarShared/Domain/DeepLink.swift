import Foundation

/// A parsed `chqcal://` deep link — the single hand-off point every launch
/// surface funnels through on its way to `AppModel.pendingDeepLink`:
/// `.onOpenURL` (this task), a notification tap (task 8), a widget's
/// `widgetURL` (task 11), an App Intent (task 12), and Spotlight (task 13).
/// `nonisolated` and `Sendable` — it carries nothing but its case payload, so
/// it can cross from a background delegate callback onto the main actor
/// without ceremony.
///
/// Scheme: `chqcal`. Recognized shapes:
/// - `chqcal://event/<id>` — open that event's detail view.
/// - `chqcal://my-day` — the (not-yet-built, task 16) My Day tab.
/// - `chqcal://map` / `chqcal://map/<venue>` — the (not-yet-built) map tab,
///   optionally centered on a venue.
/// - `chqcal://day/<yyyy-MM-dd>` — open the Events tab on that day, growing
///   the window if the day lies past an edge. The key must be canonical
///   (`ChqTime.isCanonicalDayKey`); see `dayWithANonCanonicalKeyIsRejected`.
nonisolated enum DeepLink: Equatable, Sendable {
    case event(id: String)
    case myDay
    case map(venue: String?)
    case day(key: String)

    private static let scheme = "chqcal"

    /// `nil` for anything this app doesn't recognize as a `chqcal://` link:
    /// a different scheme, an unknown host, or a known host missing a
    /// required path component (e.g. `chqcal://event/` with no id). Never
    /// throws — every caller (`.onOpenURL`, notification handling, App
    /// Intents) wants "ignore it" on failure, not an error to propagate.
    static func parse(_ url: URL) -> DeepLink? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == scheme,
              let host = components.host, !host.isEmpty
        else { return nil }

        // `components.path` is the non-percent-encoded accessor, so a venue
        // like "Sports%20Club%2C%20Waterfront" comes back already decoded to
        // "Sports Club, Waterfront" here.
        let pathComponents = components.path
            .split(separator: "/", omittingEmptySubsequences: true)
            .map(String.init)

        switch host {
        case "event":
            guard let id = pathComponents.first, !id.isEmpty else { return nil }
            return .event(id: id)
        case "my-day":
            return .myDay
        case "map":
            return .map(venue: pathComponents.first)
        case "day":
            guard let key = pathComponents.first, ChqTime.isCanonicalDayKey(key) else { return nil }
            return .day(key: key)
        default:
            return nil
        }
    }

    /// The inverse of `parse` — used by widgets (`widgetURL`), notification
    /// payloads, and App Intents to hand this app a link it can round-trip
    /// through `parse` itself. `URLComponents` percent-encodes the venue name
    /// (spaces, commas, etc.) rather than hand-rolled escaping.
    var url: URL {
        var components = URLComponents()
        components.scheme = Self.scheme

        switch self {
        case .event(let id):
            components.host = "event"
            components.path = "/\(id)"
        case .myDay:
            components.host = "my-day"
        case .map(let venue):
            components.host = "map"
            if let venue {
                components.path = "/\(venue)"
            }
        case .day(let key):
            components.host = "day"
            components.path = "/\(key)"
        }

        // Every case above builds `components` from an ASCII scheme/host and
        // a path `URLComponents` can always percent-encode, so this never
        // fails in practice — `DeepLinkTests` pins the round trip.
        guard let url = components.url else {
            preconditionFailure("DeepLink.url failed to build a URL from \(self)")
        }
        return url
    }
}
