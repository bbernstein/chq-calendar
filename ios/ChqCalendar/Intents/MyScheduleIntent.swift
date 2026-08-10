import AppIntents
import Foundation

/// "My Schedule" (#193) — "what am I doing tomorrow": the user's starred
/// events (same favorites store the StarredWidget reads) inside the
/// spoken timeframe, defaulting to today.
struct MyScheduleIntent: AppIntent {
    static let title: LocalizedStringResource = "My Schedule"

    @Parameter(title: "When")
    var timeframe: IntentTimeframe?

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<[EventEntity]> {
        let now = Date()
        let events = await IntentDataSource.events(now: now)
        guard !events.isEmpty else {
            return .result(value: [], dialog: "\(IntentDialogText.coldCache())")
        }
        let year = await IntentDataSource.defaultYear()
        let favorites = SharedSnapshotLoader.loadFavorites(defaults: AppGroup.userDefaults(), now: now)
        let scope = timeframe ?? .today
        let results = IntentDataSource.selectSchedule(
            events: events, favoriteIDs: favorites, timeframe: scope, now: now, year: year)
        let text = IntentDialogText.mySchedule(timeframeLabel: scope.spokenLabel, events: results)
        return .result(value: results.map(EventEntity.init(event:)), dialog: "\(text)")
    }
}
