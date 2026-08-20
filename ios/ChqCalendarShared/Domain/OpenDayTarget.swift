import Foundation

/// `OpenDayIntent`'s decision, separated from the AppIntents runtime that
/// delivers it — the same split `IntentDataSource.selectMatching` uses, and for
/// the same reason: the rule is what can be wrong, and a rule in a `perform()`
/// body can only be tested by booting Shortcuts.
///
/// The reachability check lives here rather than in the app because an intent
/// that cannot navigate should *say so*. `AppModel.goToDay` already refuses an
/// out-of-bounds day, but it refuses silently — the user would watch the app
/// open and do nothing. Both sides ask
/// `ViewWindow.navigableBounds(year:events:starredDays: [])`, so the two
/// answers cannot drift.
nonisolated enum OpenDayTarget: Equatable, Sendable {
    case navigate(dayKey: String)
    case refuse(dialog: String)

    static func resolve(
        timeframe: IntentTimeframe?, now: Date, year: Int, events: [Event]
    ) -> OpenDayTarget {
        guard !events.isEmpty else { return .refuse(dialog: IntentDialogText.coldCache()) }

        let key = (timeframe ?? .today).targetDayKey(now: now, year: year)
        let bounds = ViewWindow.navigableBounds(year: year, events: events, starredDays: [])
        guard bounds.contains(key) else {
            let status = SeasonStatus.make(now: now, year: year)
            return .refuse(
                dialog: IntentDialogText.offSeason(status, year: year)
                    ?? IntentDialogText.unreachableDay(year: year))
        }
        return .navigate(dayKey: key)
    }
}
