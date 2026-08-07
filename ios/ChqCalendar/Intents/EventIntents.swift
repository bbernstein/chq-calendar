import AppIntents
import Foundation

/// The handoff point between an App Intent (which can run with the app not
/// even launched) and `AppModel.pendingDeepLink` (which only exists once a
/// SwiftUI scene has created one). `OpenEventIntent.perform()` writes here;
/// `CalendarView`'s `.onChange(of: scenePhase)` — moving to `RootTabView` in
/// task 16 — reads and clears it on the next `.active` transition, the same
/// way `.onOpenURL` and a notification tap already feed `pendingDeepLink`.
///
/// A plain `UserDefaults` key rather than a direct call into `AppModel` is
/// the only channel that works regardless of whether the app is already
/// running: `OpenEventIntent` has no reference to (and, on a cold launch,
/// no way to construct) the app's `AppModel`.
///
/// `nonisolated` and stateless — a thin pair of static functions around one
/// well-known key — so it stays trivially usable from both the intent
/// (potentially off the main actor) and the app's UI layer, and easy to
/// relocate wholesale when task 16 moves its consumer to `RootTabView`.
nonisolated enum PendingIntentLink {
    static let defaultsKey = "chq-pending-deeplink"

    /// Writes `link`'s URL form to `defaults` under `defaultsKey`.
    static func write(_ link: DeepLink, to defaults: UserDefaults) {
        defaults.set(link.url.absoluteString, forKey: defaultsKey)
    }

    /// Reads, removes, and parses whatever is stored under `defaultsKey` —
    /// idempotent (a second call with nothing pending returns `nil` rather
    /// than re-delivering a stale link) and harmless when nothing is
    /// pending. Split out from the view layer specifically so it's testable
    /// without a live `AppModel`/SwiftUI scene: it's a pure read+remove+parse
    /// step over a `UserDefaults` instance a test can construct directly.
    static func consume(from defaults: UserDefaults) -> DeepLink? {
        guard let raw = defaults.string(forKey: defaultsKey) else { return nil }
        defaults.removeObject(forKey: defaultsKey)
        guard let url = URL(string: raw) else { return nil }
        return DeepLink.parse(url)
    }
}

/// "Open Event" — the Shortcuts/Siri equivalent of tapping a
/// `chqcal://event/<id>` deep link. `openAppWhenRun` brings the app to the
/// foreground; `perform()` hands the target event off via
/// `PendingIntentLink` rather than touching `AppModel` directly (see that
/// type's doc comment for why).
struct OpenEventIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Event"
    static let openAppWhenRun = true

    @Parameter(title: "Event")
    var event: EventEntity

    func perform() async throws -> some IntentResult {
        PendingIntentLink.write(.event(id: event.id), to: AppGroup.userDefaults())
        return .result()
    }
}

/// Venue options for `NextEventsIntent`'s optional venue parameter —
/// distinct `displayLocation` values from the cached snapshot, most-frequent
/// first. Reuses `WidgetConfigOptions.venueOptions`, the same pure ranking
/// `WidgetConfigIntent`'s picker uses, over `IntentDataSource`'s cache read
/// instead of `WidgetDataSource`'s.
struct NextEventsVenueOptionsProvider: DynamicOptionsProvider {
    func results() async throws -> [String] {
        WidgetConfigOptions.venueOptions(events: await IntentDataSource.shared.events(now: Date()))
    }
}

/// "What's Next" — up to 5 upcoming events, optionally narrowed to a venue,
/// spoken back as a one-line dialog plus the full list as a returned value
/// (so a Shortcuts automation can act on the results, not just hear them).
struct NextEventsIntent: AppIntent {
    static let title: LocalizedStringResource = "What's Next"

    @Parameter(title: "Venue", optionsProvider: NextEventsVenueOptionsProvider())
    var venue: String?

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<[EventEntity]> {
        let now = Date()
        let events = await IntentDataSource.shared.upcoming(venue: venue, now: now, limit: 5)
        let entities = events.map(EventEntity.init(event:))

        guard let first = events.first else {
            let place = venue.map { " at \($0)" } ?? ""
            let dialog: IntentDialog = "Nothing coming up\(place) right now."
            return .result(value: entities, dialog: dialog)
        }

        let place = first.displayLocation ?? "Chautauqua"
        let time = ChqTime.timeString(for: first.start)
        let dialog: IntentDialog = "Next up at \(place): \(first.title) at \(time)."
        return .result(value: entities, dialog: dialog)
    }
}

/// "Today at Chautauqua" — every non-cancelled event on today's NY calendar
/// day, spoken back as a count plus up to the first 3 titles, and returned
/// in full.
struct TodayEventsIntent: AppIntent {
    static let title: LocalizedStringResource = "Today at Chautauqua"

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<[EventEntity]> {
        let now = Date()
        let events = await IntentDataSource.shared.today(now: now)
        let entities = events.map(EventEntity.init(event:))

        guard !events.isEmpty else {
            let dialog: IntentDialog = "Nothing on the calendar for today."
            return .result(value: entities, dialog: dialog)
        }

        let countLabel = events.count == 1 ? "1 event" : "\(events.count) events"
        let titles = events.prefix(3).map(\.title).joined(separator: ", ")
        let dialog: IntentDialog = "\(countLabel) today: \(titles)."
        return .result(value: entities, dialog: dialog)
    }
}
