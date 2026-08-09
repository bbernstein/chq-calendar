import AppIntents
import Foundation

/// "Who's Speaking" (#193) — "who is speaking tomorrow": the flagship
/// lecture answer, leading with the presenter's name. A dedicated intent
/// because a phrase cannot preset another intent's parameters — this IS
/// `NextEventsIntent(kind: .lectures)` with a presenter-first dialog.
struct WhoIsSpeakingIntent: AppIntent {
    static let title: LocalizedStringResource = "Who's Speaking"

    @Parameter(title: "When")
    var timeframe: IntentTimeframe?

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<[EventEntity]> {
        let now = Date()
        let events = await IntentDataSource.events(now: now)
        guard !events.isEmpty else {
            return .result(value: [], dialog: "\(IntentDialogText.coldCache())")
        }
        let year = await IntentDataSource.defaultYear()
        let scope = timeframe ?? .today
        let results = IntentDataSource.selectMatching(
            events: events, kind: .lectures, timeframe: scope, venue: nil, now: now, year: year)
        guard let featured = IntentDataSource.featured(in: results) else {
            if let offSeason = IntentDialogText.offSeason(SeasonStatus.make(now: now, year: year), year: year) {
                return .result(value: [], dialog: "\(offSeason)")
            }
            let next = IntentDataSource.selectMatching(
                events: events, kind: .lectures, timeframe: nil, venue: nil, now: now, year: year).first
            let text = IntentDialogText.noMatch(
                kindTitle: "lectures", timeframeLabel: scope.spokenLabel, next: next)
            return .result(value: [], dialog: "\(text)")
        }
        let entities = IntentDataSource
            .entityWindow(results: results, featured: featured, limit: 5)
            .map(EventEntity.init(event:))
        return .result(value: entities, dialog: "\(IntentDialogText.whoIsSpeaking(event: featured))")
    }
}

/// "Show Time" (#193) — "what time is the evening show": the next
/// flagship Amphitheater program of the requested daypart.
struct ShowTimeIntent: AppIntent {
    static let title: LocalizedStringResource = "Show Time"

    @Parameter(title: "Show")
    var slot: DaypartSlot

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<[EventEntity]> {
        let now = Date()
        let events = await IntentDataSource.events(now: now)
        guard !events.isEmpty else {
            return .result(value: [], dialog: "\(IntentDialogText.coldCache())")
        }
        let year = await IntentDataSource.defaultYear()
        let upcoming = IntentDataSource.selectMatching(
            events: events, kind: nil, timeframe: nil, venue: nil, now: now, year: year)
        guard let match = upcoming.first(where: { slot.matches($0) }) else {
            if let offSeason = IntentDialogText.offSeason(SeasonStatus.make(now: now, year: year), year: year) {
                return .result(value: [], dialog: "\(offSeason)")
            }
            let text = IntentDialogText.noMatch(kindTitle: nil, timeframeLabel: nil, next: nil)
            return .result(value: [], dialog: "\(text)")
        }
        return .result(value: [EventEntity(event: match)],
                       dialog: "\(IntentDialogText.showTime(slotLabel: slot.spokenLabel, event: match))")
    }
}
