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
/// agree *within a year*.
///
/// **Across years, the app follows this type rather than the other way
/// round** (#253). This intent still resolves `year` from
/// `IntentDataSource.defaultYear()` — it runs out of process against the
/// shared cache and cannot see which season the app happens to be parked on,
/// so it answers for the current one, which is also what a reader asking for
/// "tomorrow" means. The key it emits is year-qualified (`yyyy-MM-dd`), so
/// nothing about the reader's on-screen year has to cross the process
/// boundary: `EventListView` consumes the link through
/// `AppModel.goToDay(crossingYears:)`, which selects the key's own year
/// before navigating within it. A reader parked on an archived season who
/// asks for "tomorrow" is therefore taken to tomorrow, in the current
/// season, matching the dialog they were just spoken.
///
/// This used to be documented here as a known gap left open on purpose. It
/// is closed; if you are reading this because you are changing how the app
/// consumes a day link, `PendingDayLink` and `AppModel.goToDay(crossingYears:)`
/// are the two places that make the sentence above true.
nonisolated enum OpenDayTarget: Equatable, Sendable {
    case navigate(dayKey: String)
    case refuse(dialog: String)

    /// `timeframe` is non-optional on purpose. `OpenDayIntent`'s parameter is
    /// optional (an unspoken "show me a day" is legal), but the intent
    /// resolves that `nil` to `.today` once, up front, and speaks the same
    /// resolved value back in its dialog — so a `?? .today` here would be a
    /// second, unreachable copy of the same default, free to drift from the
    /// one the user is actually told about.
    static func resolve(
        timeframe: IntentTimeframe, now: Date, year: Int, events: [Event]
    ) -> OpenDayTarget {
        guard !events.isEmpty else { return .refuse(dialog: IntentDialogText.coldCache()) }

        let key = timeframe.targetDayKey(now: now, year: year)
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
