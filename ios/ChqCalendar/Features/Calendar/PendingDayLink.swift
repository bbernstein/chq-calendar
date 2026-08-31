import Foundation

/// Consumes a pending `chqcal://day/<key>` deep link for `EventListView`, in
/// the one order that is safe once navigating a day can cross a season.
///
/// Pulled out of `EventListView` for the same reason as `DayRailAutoExpand`
/// and `WeekBands.navigationTarget`: the rule is what can be wrong, and the
/// view stays the thin wrapper that performs the side effects. These rules are
/// worse than either of those two, because they are *orderings* rather than
/// values — invisible in the finished code, breakable by edits that read as
/// tidy-ups, and silent when broken. Here they have names, reasons, and
/// `PendingDayLinkTests` to go red on those edits.
///
/// **1. The take is synchronous, before the `Task` exists** (`consume`).
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
/// in which `pendingDeepLink` is still set, and every trigger that fires
/// inside it (there are three, and two of them can fire in the same commit)
/// takes the same key again.
///
/// Be exact about what that costs *today*, because the honest answer is less
/// than it sounds: rule 2 below would serialize those extra takes, and the
/// second one would find the key already gone — so the reader would not
/// actually be navigated twice. This ordering is the **first of two
/// independent defences**, not the only one. It is guarded anyway, and guarded
/// *directly*: `theKeyIsTakenBeforeTheTaskIsQueued` asserts that
/// `pendingDeepLink` is nil by the time `consume` returns, rather than
/// asserting a downstream double-navigation that only the chaining currently
/// prevents. That is deliberate — it means removing the chaining later cannot
/// silently leave this rule unguarded.
///
/// What performing that edit actually does, as observed rather than as
/// concluded — the conclusion is what keeps drifting here. It reds **three**
/// tests, and only one of them is reacting to the ordering:
///
/// - `theKeyIsTakenBeforeTheTaskIsQueued` — the ordering itself. The only one
///   that reports it.
/// - `nothingPendingHandsBackTheNavigationAlreadyInFlight` — the **return
///   contract**, not the ordering. With the take inside the task, `consume`
///   cannot know at call time whether anything was pending, so it can never
///   hand `previous` back and always returns a new task.
/// - `aSecondLinkWaitsForTheFirstRatherThanRunningBesideIt` — that test's own
///   arrangement, not the ordering either. It writes a second key while the
///   first one, still un-taken, is sitting in `pendingDeepLink`; the second
///   assignment overwrites the first, and the log records the wrong key rather
///   than an interleave.
///
/// None of the three shows a reader navigated twice, which is the whole point.
/// Read three reds as one ordering guard plus two side effects — not as
/// evidence that the ordering is redundantly covered and this rule can go.
///
/// **2. One navigation at a time, by chaining rather than dropping**
/// (`consume`'s `after:`). Two links can be genuinely distinct — "Hey Siri,
/// show me tomorrow", then a second day named before the first has finished
/// switching years. The synchronous take does not help there: both keys are
/// real, both were asked for. Running them concurrently is the bug, because
/// rule 3 stamps `PendingDayScroll.Target` from model state read *after* its
/// own await — two interleaved navigations read each other's half-applied
/// state and arm a target that is stale the moment it exists.
///
/// So the new work waits on the old instead of running beside it, and both
/// links are honoured in the order they were asked for, the later one winning
/// the screen because it lands last. The rejected alternatives: dropping the
/// second link loses a key the take has already consumed and cannot put back;
/// cancelling the first does nothing, because `AppModel.select(year:)` has no
/// cancellation checks and would run to completion anyway.
///
/// **3. The scroll is armed only after the year switch has landed**
/// (`navigate`). See that function's own doc — it is the half of the race that
/// `consume` cannot see.
@MainActor
enum PendingDayLink {
    /// Takes any pending day link and queues `navigate` for it behind
    /// `previous`.
    ///
    /// - Parameters:
    ///   - model: the model holding `pendingDeepLink`. Taken from *here*,
    ///     synchronously, before this function returns — see rule 1 in the
    ///     type doc.
    ///   - previous: the navigation already in flight (`nil` if none). The
    ///     returned task does not begin until it has finished.
    ///   - navigate: what to do with the key. `async` because a day in
    ///     another season has to be fetched before it can be scrolled to. In
    ///     production this is always `navigate(to:in:arm:)` below, one layer
    ///     out, so that this function's two rules can be tested against a spy
    ///     rather than against a real season change.
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

    /// Moves the app to `dayKey` — switching season if the key names another
    /// one — and only then calls `arm`.
    ///
    /// **`arm` must stay on the far side of the `await`, and that is the whole
    /// reason this function exists rather than three lines in the view.**
    /// `EventListView.armScroll` stamps a `PendingDayScroll.Target` with the
    /// filter identity the navigation was made under, and
    /// `EventListView.resolvePendingScroll` drops any target whose identity no
    /// longer matches. A cross-year jump moves two of the fields that identity
    /// is built from: `selectedYear`, and `scopeResetCount` — because
    /// `goToDay(crossingYears:)` clears the outgoing season's scope-local date
    /// state on the way through, which bumps it.
    ///
    /// So a target armed *before* the await carries the old season's key and
    /// reads as stale the instant it exists. `resolvePendingScroll` discards
    /// it, and the scroll the whole deep link exists to perform never happens
    /// — no error, no crash, nothing else out of place, just a Siri "Opening
    /// tomorrow." that leaves the reader where they were.
    /// `theTargetIsArmedOnlyAfterTheYearSwitchHasLanded` performs exactly that
    /// hoist and goes red; `AppModelTests.aCrossYearJumpStalesATargetStampedBeforeIt`
    /// pins the premise underneath it, that the key really does move.
    ///
    /// A refused jump arms nothing, on `goToDay`'s existing contract: there is
    /// no point queueing a scroll to a day that will never arrive.
    ///
    /// - Parameter arm: run with `dayKey` once the model has accepted it, and
    ///   never otherwise. Non-escaping, so it can write the view's `@State`
    ///   directly.
    static func navigate(
        to dayKey: String, in model: AppModel, arm: (String) -> Void
    ) async {
        guard await model.goToDay(crossingYears: dayKey) else { return }
        arm(dayKey)
    }
}
