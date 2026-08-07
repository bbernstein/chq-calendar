import Foundation
import UserNotifications

/// Bridges system notification callbacks into the app's own deep-link
/// pipeline (#178). Retained for the process lifetime by `ChqCalendarApp` as
/// the sole `UNUserNotificationCenter.current().delegate` — the framework
/// holds that property weakly, so nothing else keeps this instance alive.
/// `onOpenEvent` is wired exactly once, in `ChqCalendarApp.init`, to
/// `{ model.pendingDeepLink = .event(id: $0) }`; tapping a reminder
/// notification (foreground, background, or not-running) is what drives
/// `onOpenEvent`, and `CalendarView`'s existing `pendingDeepLink` routing
/// (task 3) takes it from there.
///
/// Implements the `async` overloads of the two delegate callbacks (iOS 15+)
/// rather than the completion-handler ones. This type is `@MainActor` — the
/// whole app target defaults every type to `@MainActor`
/// (`SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`), written explicitly here to
/// match `ReminderCenter`'s convention — and an `async` protocol requirement
/// can be satisfied directly by an actor-isolated implementation (the
/// compiler inserts the hop at the call site, since callers of an async
/// function must already `await` it). The synchronous completion-handler
/// overloads don't get that for free: satisfying them would need an
/// explicit `nonisolated` shim plus a manual `Task { @MainActor in … }` hop
/// just to touch `onOpenEvent` safely.
@MainActor
final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    var onOpenEvent: ((String) -> Void)?

    /// Lets a reminder still show while the app is already in the
    /// foreground. Without this, `UNUserNotificationCenterDelegate`'s
    /// default behavior silently swallows a notification whose app is
    /// frontmost — which would make a reminder for an event starting soon,
    /// fired while the user happens to already be in the app, invisible.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard let eventID = Self.eventID(from: response.notification.request.content.userInfo) else { return }
        onOpenEvent?(eventID)
    }

    /// Extracts the target event's id from a notification's `userInfo` —
    /// pulled out as a standalone `static func` (rather than inlined into
    /// `didReceive` above) so it has a seam to unit test directly.
    /// Constructing a real `UNNotificationResponse` in a test process is
    /// impractical (it has no public initializer), so
    /// `NotificationDelegateTests` calls this with a plain
    /// `[AnyHashable: Any]` dictionary instead of a real response, leaving
    /// `didReceive` itself an untested one-line shim — a deliberate choice,
    /// not an oversight.
    static func eventID(from userInfo: [AnyHashable: Any]) -> String? {
        userInfo["eventID"] as? String
    }
}
