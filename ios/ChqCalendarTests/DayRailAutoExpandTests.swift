import Foundation
import Testing
@testable import ChqCalendar

/// The cascade guard behind `EventListView`'s auto-expand trigger, extracted
/// so it is checkable without a view host. The property under test — one
/// expansion per newly-reached last day, never a chain — regresses silently:
/// a wrong guard still renders a list, it just walks to the end of the
/// season on the first scroll.
struct DayRailAutoExpandTests {
    @Test func firesForTheFinalRowOfTheFinalDay() {
        #expect(DayRailAutoExpand.shouldFire(
            day: "2026-07-20", event: "e3",
            lastDay: "2026-07-20", lastEventInDay: "e3",
            alreadyExpandedThrough: nil))
    }

    @Test func doesNotFireForANonFinalRowOfTheFinalDay() {
        #expect(!DayRailAutoExpand.shouldFire(
            day: "2026-07-20", event: "e1",
            lastDay: "2026-07-20", lastEventInDay: "e3",
            alreadyExpandedThrough: nil))
    }

    @Test func doesNotFireForTheFinalRowOfANonFinalDay() {
        #expect(!DayRailAutoExpand.shouldFire(
            day: "2026-07-19", event: "e3",
            lastDay: "2026-07-20", lastEventInDay: "e3",
            alreadyExpandedThrough: nil))
    }

    /// The cascade guard itself: expansion appends a new final day, whose
    /// own final row appears immediately — this is the re-entry that must
    /// be refused, or one gesture walks to the end of the season.
    @Test func doesNotReFireWhenTheSameLastDayIsReachedAgain() {
        #expect(!DayRailAutoExpand.shouldFire(
            day: "2026-07-20", event: "e3",
            lastDay: "2026-07-20", lastEventInDay: "e3",
            alreadyExpandedThrough: "2026-07-20"))
    }

    /// The other half of the guard: a *different*, newly-reached last day
    /// must still fire even though the trigger already fired once for an
    /// earlier day — `alreadyExpandedThrough` names the day, not "ever".
    @Test func firesOnceANewlyReachedLastDayBecomesFinal() {
        #expect(DayRailAutoExpand.shouldFire(
            day: "2026-07-21", event: "e3",
            lastDay: "2026-07-21", lastEventInDay: "e3",
            alreadyExpandedThrough: "2026-07-20"))
    }

    /// A day with no events cannot supply a last-event id to match against —
    /// `lastEventInDay` is `nil`, and no real event id equals `nil`, so this
    /// can never accidentally fire for an empty section.
    @Test func neverFiresWhenTheFinalDayHasNoEvents() {
        #expect(!DayRailAutoExpand.shouldFire(
            day: "2026-07-20", event: "e1",
            lastDay: "2026-07-20", lastEventInDay: nil,
            alreadyExpandedThrough: nil))
    }
}
