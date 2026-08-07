import Foundation

/// One calendar day's worth of events, ready for display.
nonisolated struct DayGroup: Identifiable, Sendable {
    var id: String { dayKey }
    let dayKey: String
    let title: String
    let weekNumbers: [Int]
    let events: [Event]
}

/// Groups events into `DayGroup`s by NY calendar day.
nonisolated enum EventGrouping {
    /// Groups `events` by NY calendar day. Groups are returned in ascending
    /// day order; events within each group are in ascending `start` order.
    /// Each group's `title` comes from `ChqTime.dayTitle` and its
    /// `weekNumbers` from `SeasonCalendar.weekNumbers(spanningDayOf:year:)`
    /// (a day that falls on a week boundary spans two weeks).
    static func byDay(_ events: [Event], year: Int) -> [DayGroup] {
        let sorted = events.sorted { $0.start < $1.start }

        var groups: [DayGroup] = []
        var currentKey: String?
        var currentEvents: [Event] = []

        func flush() {
            guard let key = currentKey, let first = currentEvents.first else { return }
            groups.append(
                DayGroup(
                    dayKey: key,
                    title: ChqTime.dayTitle(for: first.start),
                    weekNumbers: SeasonCalendar.weekNumbers(spanningDayOf: first.start, year: year),
                    events: currentEvents
                )
            )
        }

        for event in sorted {
            let key = ChqTime.dayKey(for: event.start)
            if key != currentKey {
                flush()
                currentKey = key
                currentEvents = []
            }
            currentEvents.append(event)
        }
        flush()

        return groups
    }
}
