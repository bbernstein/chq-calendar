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

/// "Show a Day" — the Siri/Shortcuts equivalent of tapping a day chip on the
/// rail. Closes the inconsistency #226 recorded: `IntentTimeframe` has shipped
/// `tomorrow` and `nextWeek` as spoken targets since #193, so a user could
/// *ask* Siri for tomorrow but, until phase 3b's rail, could not *tap* their
/// way there. Routing this through the same `chqcal://day/<key>` link the rail
/// resolves means voice and touch land in identical state.
///
/// `openAppWhenRun` brings the app forward; `perform()` hands the day off via
/// `PendingIntentLink` rather than touching `AppModel` (see that type's doc
/// comment — an intent can run with the app not launched at all).
///
/// Every decision lives in `OpenDayTarget`; this is the delivery shell.
struct OpenDayIntent: AppIntent {
    static let title: LocalizedStringResource = "Show a Day"
    static let openAppWhenRun = true

    @Parameter(title: "When")
    var timeframe: IntentTimeframe?

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let now = Date()
        let events = await IntentDataSource.events(now: now)
        let year = await IntentDataSource.defaultYear()

        switch OpenDayTarget.resolve(
            timeframe: timeframe, now: now, year: year, events: events) {
        case .refuse(let dialog):
            return .result(dialog: "\(dialog)")
        case .navigate(let dayKey):
            PendingIntentLink.write(.day(key: dayKey), to: AppGroup.userDefaults())
            return .result(dialog: "\((timeframe ?? .today).spokenLabel.capitalized).")
        }
    }
}

/// "What's Next" — the #193 workhorse: upcoming events optionally
/// narrowed by kind of event, timeframe, or venue (each narrowable by
/// voice through its own phrase family — one parameter per phrase is a
/// platform rule), spoken back as a one-line dialog plus the full list
/// as a returned value. Selection and dialog copy live in
/// `IntentDataSource`/`IntentDialogText`, both unit-tested.
struct NextEventsIntent: AppIntent {
    static let title: LocalizedStringResource = "What's Next"

    @Parameter(title: "Kind of Event")
    var kind: EventKind?

    @Parameter(title: "When")
    var timeframe: IntentTimeframe?

    @Parameter(title: "Venue")
    var venue: VenueEntity?

    /// How many events the returned value is capped at (the dialog's
    /// count is NOT capped — it reports the true match count).
    private static let entityLimit = 5

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<[EventEntity]> {
        let now = Date()
        let events = await IntentDataSource.events(now: now)
        guard !events.isEmpty else {
            return .result(value: [], dialog: "\(IntentDialogText.coldCache())")
        }
        let year = await IntentDataSource.defaultYear()
        let results = IntentDataSource.selectMatching(
            events: events, kind: kind, timeframe: timeframe, venue: venue?.name, now: now, year: year)

        guard let firstMatch = IntentDataSource.featured(in: results) else {
            if let offSeason = IntentDialogText.offSeason(SeasonStatus.make(now: now, year: year), year: year) {
                return .result(value: [], dialog: "\(offSeason)")
            }
            let next = IntentDataSource.selectMatching(
                events: events, kind: kind, timeframe: nil, venue: venue?.name, now: now, year: year).first
            let text = IntentDialogText.noMatch(
                kindTitle: kind?.displayTitle, timeframeLabel: timeframe?.spokenLabel, next: next)
            return .result(value: [], dialog: "\(text)")
        }

        let entities = IntentDataSource
            .entityWindow(results: results, featured: firstMatch, limit: Self.entityLimit)
            .map(EventEntity.init(event:))

        let text: String
        if results.count == 1 {
            text = IntentDialogText.nextUp(kindTitle: kind?.displayTitle, event: firstMatch)
        } else if timeframe != nil {
            text = IntentDialogText.listSummary(
                count: results.count, kindTitle: kind?.displayTitle,
                timeframeLabel: timeframe?.spokenLabel, first: results[0])
        } else {
            text = IntentDialogText.nextUp(kindTitle: kind?.displayTitle, event: firstMatch)
        }
        return .result(value: entities, dialog: "\(text)")
    }
}

/// "Today at Chautauqua" — every non-cancelled event on today's NY calendar
/// day, spoken back as a count plus up to the first 3 titles, and returned
/// in full.
struct TodayEventsIntent: AppIntent {
    static let title: LocalizedStringResource = "Today at Chautauqua"

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<[EventEntity]> {
        let now = Date()
        let events = await IntentDataSource.today(now: now)
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
