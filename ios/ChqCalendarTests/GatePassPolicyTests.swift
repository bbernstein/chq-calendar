import Foundation
import Testing
@testable import ChqCalendar

struct GatePassPolicyTests {
    /// Aug 14, 2026 8:00 pm NY — in-season (Week 7), the Revivalists shape.
    private var inSeasonEvening: Date {
        date(2026, 8, 14, 20, 0)
    }

    private func date(_ y: Int, _ m: Int, _ d: Int, _ h: Int, _ min: Int) -> Date {
        var c = DateComponents()
        c.year = y; c.month = m; c.day = d; c.hour = h; c.minute = min
        return ChqTime.calendar.date(from: c)!
    }

    @Test func amphitheaterInSeasonIsIncluded() {
        let e = makeEvent(id: "rev", start: inSeasonEvening, location: "Amphitheater")
        #expect(GatePassPolicy.includesGeneralAdmission(e))
    }

    @Test func amphitheaterPostSeasonIsNotIncluded() {
        // Sept 10, 2026 — the Indigo Girls shape: same venue, after the season.
        let e = makeEvent(id: "indigo", start: date(2026, 9, 10, 19, 0), location: "Amphitheater")
        #expect(!GatePassPolicy.includesGeneralAdmission(e))
    }

    @Test func amphitheaterPreSeasonIsNotIncluded() {
        let e = makeEvent(id: "early", start: date(2026, 6, 1, 19, 0), location: "Amphitheater")
        #expect(!GatePassPolicy.includesGeneralAdmission(e))
    }

    @Test func otherVenuesAreNotIncluded() {
        let e = makeEvent(id: "hop", start: inSeasonEvening, location: "Hall of Philosophy")
        #expect(!GatePassPolicy.includesGeneralAdmission(e))
    }

    @Test func missingLocationIsNotIncluded() {
        let e = makeEvent(id: "nowhere", start: inSeasonEvening, location: nil)
        #expect(!GatePassPolicy.includesGeneralAdmission(e))
    }

    @Test func venueComparisonIsCaseInsensitive() {
        let e = makeEvent(id: "lower", start: inSeasonEvening, location: "amphitheater")
        #expect(GatePassPolicy.includesGeneralAdmission(e))
    }

    @Test func seasonBoundariesAreHalfOpen() {
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let first = weeks.first!, last = weeks.last!

        // Exactly at week 1's start (noon Sat): in.
        #expect(GatePassPolicy.includesGeneralAdmission(
            makeEvent(id: "open", start: first.start, location: "Amphitheater")))
        // One second before week 9's end: in.
        #expect(GatePassPolicy.includesGeneralAdmission(
            makeEvent(id: "last", start: last.end.addingTimeInterval(-1), location: "Amphitheater")))
        // Exactly at week 9's end (noon Sat): out — the season is over.
        #expect(!GatePassPolicy.includesGeneralAdmission(
            makeEvent(id: "closed", start: last.end, location: "Amphitheater")))
    }

    @Test func usesTheEventsOwnYear() {
        // An in-season 2025 date must be judged against the 2025 season,
        // not whatever year is current.
        let weeks2025 = SeasonCalendar.weeks(forYear: 2025)
        let e = makeEvent(
            id: "past-season",
            start: weeks2025.first!.start.addingTimeInterval(3600),
            location: "Amphitheater")
        #expect(GatePassPolicy.includesGeneralAdmission(e))
    }
}
