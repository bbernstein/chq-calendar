import Foundation

/// The "what time is the evening show / morning lecture" slot (#193):
/// the two flagship daily Amphitheater programs, identified by venue +
/// NY-time start hour (the feed has no "flagship" flag).
nonisolated enum DaypartSlot: String, CaseIterable, Sendable {
    case eveningShow
    case morningLecture

    var spokenLabel: String {
        switch self {
        case .eveningShow: return "evening show"
        case .morningLecture: return "morning lecture"
        }
    }

    func matches(_ event: Event) -> Bool {
        guard event.displayLocation?.lowercased() == "amphitheater" else { return false }
        let hour = ChqTime.calendar.component(.hour, from: event.start)
        switch self {
        case .eveningShow: return hour >= 18
        case .morningLecture: return EventKind.lectures.matches(event) && (9...12).contains(hour)
        }
    }
}
