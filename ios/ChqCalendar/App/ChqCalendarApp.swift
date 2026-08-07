import SwiftUI
import UserNotifications

@main
struct ChqCalendarApp: App {
    @State private var model: AppModel

    /// Retained for the process lifetime as the sole
    /// `UNUserNotificationCenterDelegate` — see that type's doc comment.
    private let notificationDelegate = NotificationDelegate()

    // `now:` defaults to `AppModel.launchNow()` rather than the type's own
    // `{ Date() }` default so a DEBUG build can honor `-uitest-freeze-now`
    // (off-season landing screenshots, #177) — see that function's doc
    // comment for why the seam has to be here, at construction, rather than
    // a later mutation.
    //
    // Built inside `init()` rather than as `model`'s own default-value
    // expression (as before task 8) because wiring the notification
    // delegate's `onOpenEvent` needs a concrete `AppModel` reference to
    // capture — `_model = State(initialValue:)` is the standard way to seed
    // a `@State` from a locally-built value inside a custom `init()`, and
    // capturing the same local `model` right after (rather than reading
    // back through `self.model`) sidesteps ever needing `self` to be fully
    // initialized before the delegate is wired.
    init() {
        let now = AppModel.launchNow()
        let reminderCenter = ReminderCenter(scheduler: UNUserNotificationCenter.current(), now: now)
        let model = AppModel(
            repository: EventRepository(api: LiveCalendarAPI(), cache: DiskCache.standard()),
            store: UserStateStore(),
            now: now,
            reminderCenter: reminderCenter,
            widgetReloader: LiveWidgetReloading()
        )
        _model = State(initialValue: model)

        notificationDelegate.onOpenEvent = { eventID in
            model.pendingDeepLink = .event(id: eventID)
        }
        UNUserNotificationCenter.current().delegate = notificationDelegate
    }

    var body: some Scene {
        WindowGroup {
            CalendarView(model: model)
        }
    }
}
