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

/// Extracts the NY wall-clock year/month/day/hour/minute from `date`.
///
/// A `UNCalendarNotificationTrigger` fires by matching these components
/// against the *device's* calendar, not by comparing an absolute instant —
/// so building them from `ChqTime.calendar` (America/New_York) rather than
/// the device's own calendar is what keeps "7:30 PM" meaning NY 7:30 PM
/// regardless of which time zone the phone is set to. Pulled out as a free
/// function (rather than inlined into the `UNUserNotificationCenter`
/// conformance below) so it has a seam to pin directly in tests without
/// going through `UNCalendarNotificationTrigger` itself.
func triggerDateComponents(for date: Date) -> DateComponents {
    ChqTime.calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
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
    /// **Reentrancy.** `ReminderCenter` is `@MainActor`, so two overlapping
    /// `sync` calls (e.g. `toggleFavorite` firing one, then `refresh`
    /// completing and firing another before the first finishes) never run
    /// their bodies concurrently — the actor interleaves them only at each
    /// individual `await` on `scheduler`. Because each call already
    /// captured its own `plan` before starting, the two calls' remove+add
    /// sequences can still interleave turn-by-turn (call A's `removeAll`,
    /// then call B's `removeAll`, then A's adds, then B's adds, in any
    /// order the scheduler happens to suspend at). That's still safe here
    /// specifically because the *last* `add` sequence to finish is the one
    /// whose notifications remain pending — no `add` deletes another call's
    /// `add`, only a `removeAll` does, and both calls' `removeAll`s run
    /// before either call's `add`s (each call does `removeAll` then
    /// `add`s, never the reverse) — so whichever call's `add`s land last
    /// wins outright, without any of its notifications being clobbered by
    /// a later `removeAll` from the other call. Callers (`AppModel`) always
    /// pass the then-current plan computed from the latest state, so "the
    /// last one to finish wins" is also "the most up-to-date state wins" —
    /// the correct outcome.
    func sync(plan: [ReminderPlanner.PlannedReminder]) async {
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
