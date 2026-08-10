import Foundation

/// Turns favorites + reminder settings into a concrete, capped list of
/// notifications to schedule. Pure domain logic — no `UNUserNotificationCenter`
/// here; that lives in the layer that actually schedules `PlannedReminder`s.
nonisolated enum ReminderPlanner {
    struct PlannedReminder: Equatable, Sendable {
        let eventID: String
        let title: String
        let body: String
        let triggerDate: Date
        let eventStart: Date
    }

    /// iOS caps an app to 64 pending local notifications; this is kept a
    /// few under that ceiling so other, non-reminder local notifications
    /// the app might schedule always have headroom.
    static let maxPending = 60

    /// Formats an event's start time as `"7:30 PM"` in `ChqTime.zone`,
    /// independent of the device's locale/region settings.
    private static let timeStyle = Date.FormatStyle(locale: Locale(identifier: "en_US_POSIX"), timeZone: ChqTime.zone)
        .hour(.defaultDigits(amPM: .abbreviated))
        .minute(.twoDigits)

    /// Builds the list of reminders that should be pending right now.
    ///
    /// Rules (see task brief #178 for the full rationale):
    /// - Only favorited, non-`.cancelled` events are considered.
    /// - The event's *effective* preset (`settings.preset(for:)`) must not
    ///   be `.none`.
    /// - The computed `triggerDate` must be strictly after `now` — a
    ///   favorited event whose reminder moment already passed (e.g. the
    ///   30-minute mark) is silently skipped rather than firing immediately.
    /// - Results are sorted by `triggerDate` ascending, ties broken by
    ///   `eventID` for deterministic output.
    /// - If more than `maxPending` qualify, only the `maxPending` with the
    ///   earliest `triggerDate` are kept (the sort-then-truncate below keeps
    ///   the nearest reminders, which is what a user cares most about).
    static func plan(
        favorites: Set<String>,
        events: [Event],
        settings: ReminderSettings,
        now: Date
    ) -> [PlannedReminder] {
        var planned: [PlannedReminder] = []
        for event in events {
            guard favorites.contains(event.id), event.status != .cancelled else { continue }

            let preset = settings.preset(for: event.id)
            guard preset != .none, let triggerDate = preset.triggerDate(for: event.start), triggerDate > now else {
                continue
            }

            planned.append(
                PlannedReminder(
                    eventID: event.id,
                    title: event.title,
                    body: body(for: event),
                    triggerDate: triggerDate,
                    eventStart: event.start
                )
            )
        }

        planned.sort { lhs, rhs in
            if lhs.triggerDate != rhs.triggerDate {
                return lhs.triggerDate < rhs.triggerDate
            }
            return lhs.eventID < rhs.eventID
        }

        if planned.count > maxPending {
            planned.removeLast(planned.count - maxPending)
        }
        return planned
    }

    /// `"Starts at 7:30 PM · Amphitheater"`, or `"Starts at 7:30 PM"` when
    /// the event has no venue.
    ///
    /// `Date.FormatStyle` renders the time/AM-PM gap with a narrow no-break
    /// space (U+202F, per CLDR) rather than a plain space — invisible in a
    /// rendered notification, but worth normalizing to a regular space so
    /// the body text is a plain, predictable ASCII-space string.
    private static func body(for event: Event) -> String {
        let time = event.start.formatted(timeStyle).replacingOccurrences(of: "\u{202F}", with: " ")
        guard let location = event.displayLocation else {
            return "Starts at \(time)"
        }
        return "Starts at \(time) \u{00B7} \(location)"
    }
}
