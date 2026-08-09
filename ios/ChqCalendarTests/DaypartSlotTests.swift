import Foundation
import Testing
@testable import ChqCalendar

/// Pins #193's "evening show" / "morning lecture" slot rules: flagship
/// Amphitheater events, split by NY-time start hour.
struct DaypartSlotTests {
    @Test func eveningShowIsAnAmpEventAtOrAfterSixPM() {
        let show = makeEvent(id: "a", start: ChqTime.parse("2026-07-15 20:15:00")!, location: "Amphitheater")
        let morning = makeEvent(id: "b", start: ChqTime.parse("2026-07-15 10:45:00")!, location: "Amphitheater")
        let elsewhere = makeEvent(id: "c", start: ChqTime.parse("2026-07-15 20:15:00")!, location: "Bratton Theater")
        #expect(DaypartSlot.eveningShow.matches(show))
        #expect(!DaypartSlot.eveningShow.matches(morning))
        #expect(!DaypartSlot.eveningShow.matches(elsewhere))
    }

    @Test func morningLectureIsAMorningAmpLecture() {
        let lecture = makeEvent(id: "a", start: ChqTime.parse("2026-07-15 10:45:00")!,
                                location: "Amphitheater", tags: ["chautauqua-lecture-series"])
        let worship = makeEvent(id: "b", start: ChqTime.parse("2026-07-15 09:15:00")!,
                                location: "Amphitheater", tags: ["service"])
        let evening = makeEvent(id: "c", start: ChqTime.parse("2026-07-15 20:15:00")!,
                                location: "Amphitheater", tags: ["chautauqua-lecture-series"])
        #expect(DaypartSlot.morningLecture.matches(lecture))
        #expect(!DaypartSlot.morningLecture.matches(worship))
        #expect(!DaypartSlot.morningLecture.matches(evening))
    }
}
