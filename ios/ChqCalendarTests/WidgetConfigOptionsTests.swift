import Foundation
import Testing
@testable import ChqCalendar

/// Pins `WidgetConfigOptions.venueOptions`/`.categoryOptions` — the pure
/// frequency-ranking logic that used to live directly in
/// `WidgetDataSource` (widget target, no test target) before being
/// extracted here so it stays unit-testable, matching
/// `WidgetTimelineBuilder`'s pattern. These tests exist to pin the
/// extraction as behavior-preserving, not to re-derive the rules from
/// scratch.
struct WidgetConfigOptionsTests {
    private func date(_ hour: Int) -> Date {
        // Any fixed reference instant works — only relative ordering of
        // events matters for option ranking, never their start time.
        ChqTime.parse("2026-07-01 \(String(format: "%02d", hour)):00:00")!
    }

    // MARK: - venueOptions

    @Test func venueOptionsRanksByFrequencyDescending() {
        let events = [
            makeEvent(id: "1", start: date(9), location: "Amphitheater"),
            makeEvent(id: "2", start: date(10), location: "Hall of Philosophy"),
            makeEvent(id: "3", start: date(11), location: "Amphitheater"),
            makeEvent(id: "4", start: date(12), location: "Amphitheater"),
            makeEvent(id: "5", start: date(13), location: "Hall of Philosophy")
        ]

        #expect(WidgetConfigOptions.venueOptions(events: events) == ["Amphitheater", "Hall of Philosophy"])
    }

    @Test func venueOptionsBreaksFrequencyTiesAlphabetically() {
        let events = [
            makeEvent(id: "1", start: date(9), location: "Smith Wilkes Hall"),
            makeEvent(id: "2", start: date(10), location: "Amphitheater"),
            makeEvent(id: "3", start: date(11), location: "Hall of Philosophy")
        ]

        #expect(
            WidgetConfigOptions.venueOptions(events: events)
                == ["Amphitheater", "Hall of Philosophy", "Smith Wilkes Hall"]
        )
    }

    @Test func venueOptionsCapsAtLimit() {
        let events = (0..<5).map { index in
            makeEvent(id: "\(index)", start: date(9), location: "Venue \(index)")
        }

        #expect(WidgetConfigOptions.venueOptions(events: events, limit: 2).count == 2)
    }

    @Test func venueOptionsIsEmptyForNoEvents() {
        #expect(WidgetConfigOptions.venueOptions(events: []) == [])
    }

    @Test func venueOptionsSkipsNilDisplayLocation() {
        let events = [
            makeEvent(id: "1", start: date(9), location: nil),
            makeEvent(id: "2", start: date(10), location: "Amphitheater")
        ]

        #expect(WidgetConfigOptions.venueOptions(events: events) == ["Amphitheater"])
    }

    // MARK: - categoryOptions

    @Test func categoryOptionsRanksByFrequencyDescending() {
        let events = [
            makeEvent(id: "1", start: date(9), categories: ["Opera"]),
            makeEvent(id: "2", start: date(10), categories: ["Lecture"]),
            makeEvent(id: "3", start: date(11), categories: ["Opera"])
        ]

        #expect(WidgetConfigOptions.categoryOptions(events: events) == ["Opera", "Lecture"])
    }

    @Test func categoryOptionsBreaksFrequencyTiesAlphabetically() {
        let events = [
            makeEvent(id: "1", start: date(9), categories: ["Opera"]),
            makeEvent(id: "2", start: date(10), categories: ["Lecture"])
        ]

        #expect(WidgetConfigOptions.categoryOptions(events: events) == ["Lecture", "Opera"])
    }

    @Test func categoryOptionsExcludesWeekMarkers() {
        let events = [
            makeEvent(id: "1", start: date(9), categories: ["Week 3", "Opera"])
        ]

        #expect(WidgetConfigOptions.categoryOptions(events: events) == ["Opera"])
    }

    @Test func categoryOptionsDedupesAcrossEvents() {
        let events = [
            makeEvent(id: "1", start: date(9), categories: ["Opera", "Lecture"]),
            makeEvent(id: "2", start: date(10), categories: ["Opera"])
        ]

        // "Opera" appears on 2 events, "Lecture" on 1 — frequency counts
        // categories per-event-occurrence, so ranking still favors "Opera",
        // and the result contains each name exactly once.
        let result = WidgetConfigOptions.categoryOptions(events: events)
        #expect(result == ["Opera", "Lecture"])
        #expect(Set(result).count == result.count)
    }

    @Test func categoryOptionsCapsAtLimit() {
        let events = (0..<5).map { index in
            makeEvent(id: "\(index)", start: date(9), categories: ["Category \(index)"])
        }

        #expect(WidgetConfigOptions.categoryOptions(events: events, limit: 2).count == 2)
    }

    @Test func categoryOptionsIsEmptyForNoEvents() {
        #expect(WidgetConfigOptions.categoryOptions(events: []) == [])
    }
}
