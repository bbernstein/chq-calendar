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
/// agree *within a year* — but only within one: this intent resolves `year`
/// from `IntentDataSource.defaultYear()`, while `AppModel.goToDay` bounds
/// against `AppModel.selectedYear`. A reader parked on an archived year who
/// asks Siri for "tomorrow" gets a dialog resolved against the current
/// season, not the year on screen — a known gap, not a guarantee this type
/// closes. Fixing that is a design change (year-switching) outside this
/// intent's scope.
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
