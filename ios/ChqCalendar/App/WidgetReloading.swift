import Foundation
import WidgetKit

/// The seam between `AppModel` and `WidgetCenter`, mirroring
/// `NotificationScheduling`'s role for `ReminderCenter`: the app target can
/// depend on `WidgetKit` here without forcing `AppModel`'s existing unit
/// tests to import — or fight the process/entitlement requirements of —
/// `WidgetCenter` itself.
///
/// `@MainActor`, matching `AppModel` and `NotificationScheduling`: every
/// call site is already on the main actor, and `WidgetCenter.shared` is
/// itself safe to call from there.
@MainActor
protocol WidgetReloading {
    /// Asks WidgetKit to reload every one of this app's widgets' timelines
    /// — called whenever cached data a widget could be showing (events,
    /// favorites) changes, so a Home Screen/Lock Screen widget already
    /// placed doesn't have to wait for its own `.atEnd` policy to notice.
    /// Also refreshes Siri App Shortcut parameter values (e.g., venue vocabulary),
    /// ensuring voice-activated commands resolve against current app state.
    func reloadAll()
}

/// The live conformance, backed by the real `WidgetCenter`. Only
/// `ChqCalendarApp` constructs this — every existing `AppModel` call site
/// (and every test) keeps passing `nil`, which makes `AppModel`'s reload
/// calls no-ops.
struct LiveWidgetReloading: WidgetReloading {
    func reloadAll() {
        WidgetCenter.shared.reloadAllTimelines()
        // Same trigger, same reason: cached data a system surface renders
        // from has changed. Republishing the App Shortcut parameter values
        // keeps Siri's venue vocabulary (`VenueEntity`) in step with the
        // feed — without this, venue-slot phrases resolve against stale or
        // empty values until the next app install.
        ChqShortcuts.updateAppShortcutParameters()
    }
}
