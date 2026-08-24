import Foundation

/// One calendar day's worth of events, ready for display.
nonisolated struct DayGroup: Identifiable, Sendable {
    var id: String { dayKey }
    let dayKey: String
    let title: String
    let weekNumbers: [Int]
    let events: [Event]
}

/// What one render of the event list is built from: the grouped days and
/// the window they were filtered by, computed together in one pass
/// (`AppModel.renderedDays`) so no caller can pair a day list from one
/// render pass with a window from another. That pairing — a live window
/// read against a render-captured `days` array — is the defect class
/// behind #254's four scroll bugs: they disagree exactly once, on the
/// update that mounts the list and consumes a day deep link in the same
/// pass, when the window has already grown while the captured days are
/// still pre-growth.
///
/// `window` is `nil` when no snapshot has loaded or the scope resolves to
/// no window at all; `days` is empty in both of those states too, though
/// it can also be empty under a non-nil window when the filters simply
/// match nothing.
nonisolated struct RenderedDays: Sendable {
    let days: [DayGroup]
    let window: ViewWindow?
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
