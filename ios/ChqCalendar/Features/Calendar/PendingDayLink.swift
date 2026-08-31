import Foundation

/// Consumes a pending `chqcal://day/<key>` deep link for `EventListView`, in
/// the one order that is safe once navigating a day can cross a season.
///
/// Pulled out of `EventListView.consumePendingDayLinkIfPossible` for the same
/// reason as `DayRailAutoExpand` and `WeekBands.navigationTarget`: the rule is
/// what can be wrong. This rule is worse than those two, because it is an
/// *ordering* rather than a value — invisible in the finished code, breakable
/// by an edit that reads as a tidy-up, and silent when broken. Here it has a
/// name, a reason, and `PendingDayLinkTests` to go red on that edit.
///
/// **The take is synchronous, before the `Task` exists.**
/// `AppModel.resolvePendingDayDeepLinkIfPossible()` is a take-once: it nils
/// `pendingDeepLink` as it hands the key back. Navigation became `async` when
/// it started routing through `AppModel.goToDay(crossingYears:)` (#253), which
/// may select — and fetch — another season, and `AppModel.select(year:)`
/// replaces `snapshot`. That re-fires `EventListView`'s
/// `.onChange(of: model.snapshot?.fetchedAt)` *while the navigation is
/// suspended*, calling straight back in here. Because the take already
/// happened, that re-entrant call finds nothing pending and no-ops, which is
/// what we want.
///
/// Folding the take into the `Task` — the obvious simplification, one line
/// shorter — opens a window between "a trigger asked" and "the key was taken"
/// in which `pendingDeepLink` is still set. Every trigger that fires inside
/// that window (there are three, and two of them can fire in the same commit)
/// takes the same key again, and the reader is navigated once per trigger.
/// Nothing in `EventListView` would fail; the take-once in `AppModel` still
/// holds, it just stops being reached in time. `theKeyIsTakenBeforeTheTaskIsQueued`
/// is the test that fails instead.
///
/// **One navigation at a time, by chaining rather than dropping.** Two links
/// can be genuinely distinct — "Hey Siri, show me tomorrow", then a second
/// day named before the first has finished switching years. The synchronous
/// take does not help there: both keys are real, both were asked for. Running
/// them concurrently is the bug, because `EventListView.selectDay` reads
/// `model.selectedYear`/`model.filter` *after* its own await to stamp
/// `PendingDayScroll.Target` — two interleaved navigations stamp each other's
/// state and arm a target that is stale the moment it exists.
///
/// So the new work waits on the old (`after:`) instead of running beside it,
/// and both links are honoured in the order they were asked for, the later one
/// winning the screen because it lands last. The rejected alternatives:
/// dropping the second link loses a key the take has already consumed and
/// cannot put back; cancelling the first does nothing, because
/// `AppModel.select(year:)` has no cancellation checks and would run to
/// completion anyway.
@MainActor
enum PendingDayLink {
    /// Takes any pending day link and queues `navigate` for it behind
    /// `previous`.
    ///
    /// - Parameters:
    ///   - model: the model holding `pendingDeepLink`. Taken from *here*,
    ///     synchronously, before this function returns — see the type doc.
    ///   - previous: the navigation already in flight (`nil` if none). The
    ///     returned task does not begin until it has finished.
    ///   - navigate: what to do with the key. `async` because a day in
    ///     another season has to be fetched before it can be scrolled to.
    /// - Returns: the task to hold as the new `previous` — `previous` itself
    ///   when there was nothing pending, so a caller that assigns the result
    ///   unconditionally never drops a navigation still in flight. Not
    ///   `@discardableResult`, deliberately: dropping it silently unchains the
    ///   next link, and a compiler warning is a cheaper way to say so than a
    ///   test.
    static func consume(
        from model: AppModel,
        after previous: Task<Void, Never>?,
        navigate: @escaping @MainActor (String) async -> Void
    ) -> Task<Void, Never>? {
        guard let dayKey = model.resolvePendingDayDeepLinkIfPossible() else { return previous }
        return Task { @MainActor in
            await previous?.value
            await navigate(dayKey)
        }
    }
}
