import Foundation

/// How far ahead of an event's start a reminder notification should fire.
///
/// `.none` is a real case (not the absence of a preset) so that
/// `ReminderSettings.defaultPreset` can be `.none` while a specific event
/// still carries an override that schedules a reminder — see
/// `ReminderSettings.preset(for:)`.
nonisolated enum ReminderPreset: String, Codable, CaseIterable, Sendable, Equatable, Hashable {
    case thirtyMinutesBefore
    case oneHourBefore
    case nightBefore
    case none

    var label: String {
        switch self {
        case .thirtyMinutesBefore: return "30 minutes before"
        case .oneHourBefore: return "1 hour before"
        case .nightBefore: return "Night before (8 PM)"
        case .none: return "Off"
        }
    }

    /// The instant a reminder for this preset should fire, given an event's
    /// `start`. `nil` for `.none` (nothing to schedule).
    ///
    /// All arithmetic goes through `ChqTime.calendar` (NY-pinned) rather than
    /// fixed-second offsets, so it stays correct across DST transitions:
    /// "30 minutes before" and "1 hour before" mean 30/60 *wall-clock*
    /// minutes, and "night before" means 20:00 *wall-clock* on the previous
    /// NY calendar day — never a fixed 1800/3600/86400-second subtraction.
    func triggerDate(for start: Date) -> Date? {
        let calendar = ChqTime.calendar
        switch self {
        case .thirtyMinutesBefore:
            return calendar.date(byAdding: .minute, value: -30, to: start)
        case .oneHourBefore:
            return calendar.date(byAdding: .hour, value: -1, to: start)
        case .nightBefore:
            guard let previousDay = calendar.date(byAdding: .day, value: -1, to: start) else {
                return nil
            }
            var components = calendar.dateComponents([.year, .month, .day], from: previousDay)
            components.hour = 20
            components.minute = 0
            components.second = 0
            return calendar.date(from: components)
        case .none:
            return nil
        }
    }
}

/// The user's reminder preferences: a season-wide default preset, plus
/// per-event overrides keyed by `Event.id`.
///
/// Persisted verbatim (no expiry — see `UserStateStore.loadReminderSettings`)
/// so a reminder a user set up doesn't silently disappear if they don't open
/// the app for a while.
nonisolated struct ReminderSettings: Codable, Equatable, Sendable {
    var defaultPreset: ReminderPreset = .thirtyMinutesBefore
    var overrides: [String: ReminderPreset] = [:]

    /// The effective preset for `eventID`: its override if one exists,
    /// otherwise `defaultPreset`. An override of `.none` is a real "off for
    /// this event" choice, distinct from having no override at all.
    func preset(for eventID: String) -> ReminderPreset {
        overrides[eventID] ?? defaultPreset
    }

    /// Sets (or, when `preset` is `nil`, clears) the override for `eventID`.
    /// Clearing reverts that event to `defaultPreset`.
    mutating func setOverride(_ preset: ReminderPreset?, for eventID: String) {
        if let preset {
            overrides[eventID] = preset
        } else {
            overrides.removeValue(forKey: eventID)
        }
    }
}
