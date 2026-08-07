import Foundation
import UserNotifications

/// The seam between `ReminderCenter`'s scheduling logic and the real
/// `UNUserNotificationCenter`, so that logic can be driven in tests against
/// an in-memory recorder (`MockScheduler`) instead of the actual
/// notification center — which requires a live authorization prompt and
/// doesn't behave deterministically (or even safely) inside a unit test
/// process.
///
/// Lives in the app target (not `ChqCalendarShared`): it imports
/// `UserNotifications`, and the widget extension must never link that or
/// gain the ability to schedule notifications on the app's behalf.
@MainActor
protocol NotificationScheduling {
    /// The app's current notification authorization state.
    func authorizationStatus() async -> UNAuthorizationStatus

    /// Prompts the user for authorization. Returns whether it was granted.
    func requestAuthorization() async -> Bool

    /// The identifiers of currently-pending requests whose identifier
    /// starts with `prefix`.
    func pending(withPrefix prefix: String) async -> [String]

    /// Cancels every currently-pending request whose identifier starts with
    /// `prefix`.
    func removeAll(withPrefix prefix: String) async

    /// Schedules a one-shot calendar-triggered notification.
    func add(
        identifier: String,
        title: String,
        body: String,
        triggerDate: Date,
        userInfo: [String: String]
    ) async throws
}

/// Extracts the NY wall-clock year/month/day/hour/minute from `date`, with
/// `timeZone` pinned explicitly to `ChqTime.zone`.
///
/// A `UNCalendarNotificationTrigger` fires by matching these components
/// against the *device's* calendar — and, critically, `DateComponents` on
/// its own carries no time zone unless `.timeZone` is both requested *and*
/// explicitly assigned: `Calendar.dateComponents(_:from:)` does not
/// populate `.timeZone` on the result merely because the calendar it was
/// asked on has one. Without the explicit assignment below, the returned
/// components have `timeZone == nil`, and `UNCalendarNotificationTrigger`
/// (like `Calendar.date(from:)`) then interprets a nil-timezone
/// `DateComponents` in the *device's* current zone — so "7:30 PM" would
/// silently fire at 7:30 PM device-local time for any user not on Eastern,
/// defeating the entire point of NY-pinning `ReminderPreset.triggerDate`.
/// Setting `components.timeZone` explicitly is what makes the same
/// year/month/day/hour/minute values resolve to the correct NY instant
/// regardless of which calendar or time zone later reads them back.
/// Pulled out as a free function (rather than inlined into the
/// `UNUserNotificationCenter` conformance below) so it has a seam to pin
/// directly in tests without going through `UNCalendarNotificationTrigger`
/// itself.
func triggerDateComponents(for date: Date) -> DateComponents {
    var components = ChqTime.calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
    components.timeZone = ChqTime.zone
    return components
}

/// Thin, untested conformance: every decision (whether to schedule at all,
/// what to schedule) is made by `ReminderCenter` before it ever calls
/// through to here. This layer only translates that decision into
/// `UNUserNotificationCenter` calls.
extension UNUserNotificationCenter: NotificationScheduling {
    func authorizationStatus() async -> UNAuthorizationStatus {
        await notificationSettings().authorizationStatus
    }

    func requestAuthorization() async -> Bool {
        (try? await requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    func pending(withPrefix prefix: String) async -> [String] {
        await pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(prefix) }
    }

    func removeAll(withPrefix prefix: String) async {
        let identifiers = await pending(withPrefix: prefix)
        removePendingNotificationRequests(withIdentifiers: identifiers)
    }

    func add(
        identifier: String,
        title: String,
        body: String,
        triggerDate: Date,
        userInfo: [String: String]
    ) async throws {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.userInfo = userInfo

        let trigger = UNCalendarNotificationTrigger(
            dateMatching: triggerDateComponents(for: triggerDate),
            repeats: false
        )
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
        try await add(request)
    }
}

/// Schedules event reminders as local notifications, reconciled by
/// **declarative full resync** rather than incremental diffing: every
/// `sync(plan:)` call throws away every previously-pending "event-"
/// notification and re-adds exactly `plan` from scratch. This is the whole
/// reconciliation strategy — a moved start time, a retracted favorite, or a
/// changed preset are all handled automatically by construction (the stale
/// state simply isn't re-added), so there is no separate diff/patch path
/// that could drift from what `ReminderPlanner` decides should be pending.
/// The cost is a `removeAll` + up to `ReminderPlanner.maxPending` `add`
/// calls on every sync, which is cheap enough at that ceiling to not need
/// optimizing.
@MainActor
final class ReminderCenter {
    /// Every identifier this class schedules is prefixed with this, both to
    /// namespace it away from any other local notification the app might
    /// one day schedule, and so `removeAll(withPrefix:)` can cancel exactly
    /// (and only) this class's own notifications.
    private static let identifierPrefix = "event-"

    private let scheduler: NotificationScheduling

    /// The injected clock, matching the app-wide convention of a single
    /// `now()` seam (see `AppModel.now`) rather than reading `Date()`
    /// directly anywhere in the codebase. `sync`/`ensureAuthorization`
    /// don't currently need "now" for any decision of their own — the plan
    /// they're handed has already been filtered against `now` by
    /// `ReminderPlanner` — but it's captured here so this type stays
    /// consistent with that convention and has a seam ready if a future
    /// change (e.g. logging when a sync ran) needs one.
    private let now: @Sendable () -> Date

    /// The tail of a serial chain of `sync` invocations. Every call to
    /// `sync(plan:)` links itself onto this chain **synchronously**, before
    /// its first `await`, so link order always matches real call order —
    /// see `sync(plan:)`'s own doc comment for why this is what actually
    /// prevents two overlapping calls' effects from interleaving.
    private var syncChain: Task<Void, Never>?

    init(scheduler: NotificationScheduling, now: @escaping @Sendable () -> Date) {
        self.scheduler = scheduler
        self.now = now
    }

    /// Reconciles pending reminders to exactly `plan`.
    ///
    /// No-ops entirely — not even `removeAll` — unless authorization is
    /// currently `.authorized`: without permission there is nothing to
    /// schedule, and clearing out notifications the user never gets shown
    /// anyway would just be pointless work (and would misbehave if
    /// permission is later granted mid-session and this were the only
    /// signal that ever ran `removeAll`).
    ///
    /// **Reentrancy is enforced, not merely argued for.** An earlier version
    /// of this method reasoned in prose that two overlapping calls were
    /// safe because each does `removeAll` before its own `add`s — but that
    /// reasoning was wrong: `@MainActor` only guarantees the two calls'
    /// *bodies* never run simultaneously, not that they run in any
    /// particular order relative to each other once each has its own
    /// pending `await`s on `scheduler`. Call A's `removeAll` → call B's
    /// `removeAll` → call B's `add`s → call A's *remaining* `add`s is a
    /// legal interleaving under that old code, and it leaves call A's
    /// stale items pending after call B's fresh ones — "started last" is
    /// not "finishes last".
    ///
    /// This version instead links every call onto `syncChain`
    /// **synchronously**, before any `await`: `let previous = syncChain`
    /// captures whatever was already chained, a new `Task` is created whose
    /// body first `await`s that `previous` task to completion and only then
    /// runs this call's own `removeAll`+`add`s, and `syncChain` is updated
    /// to point at that new `Task` — all before this function's own first
    /// `await`. Because linking happens synchronously, link order is
    /// exactly call order, regardless of how the Swift concurrency runtime
    /// later schedules each task's actual execution. And because each
    /// task's `removeAll`+`add`s only run after the previous one has fully
    /// finished, two overlapping calls' effects can never interleave —
    /// whichever call was made *last* is guaranteed to both start and
    /// finish last, and its plan is what's left pending.
    func sync(plan: [ReminderPlanner.PlannedReminder]) async {
        let previous = syncChain
        let chained = Task { [weak self] in
            await previous?.value
            await self?.performSync(plan: plan)
        }
        syncChain = chained
        await chained.value
    }

    private func performSync(plan: [ReminderPlanner.PlannedReminder]) async {
        guard await scheduler.authorizationStatus() == .authorized else { return }

        await scheduler.removeAll(withPrefix: Self.identifierPrefix)
        for reminder in plan {
            try? await scheduler.add(
                identifier: "\(Self.identifierPrefix)\(reminder.eventID)",
                title: reminder.title,
                body: reminder.body,
                triggerDate: reminder.triggerDate,
                userInfo: ["eventID": reminder.eventID]
            )
        }
    }

    /// Requests notification authorization only when it hasn't been decided
    /// yet (`.notDetermined`); never re-prompts a user who already denied
    /// it. Returns whether the app is authorized after the call.
    func ensureAuthorization() async -> Bool {
        switch await scheduler.authorizationStatus() {
        case .authorized:
            return true
        case .notDetermined:
            return await scheduler.requestAuthorization()
        default:
            return false
        }
    }
}
