import Foundation
import Testing
@testable import ChqCalendar

/// Pins `DayPlan`'s conflict + walking-gap detection over a day's starred
/// events (#181): item ordering, overlap/gap math (including the
/// zero-duration 60-min assumption and the tight/fine boundary), venue
/// resolution via `VenueAtlas`, and the `availableDayKeys` /
/// `defaultDayKey` day-picker helpers. All dates are constructed via
/// `ChqTime.parse` (no `Date()` in the logic under test), matching the rest
/// of the domain layer's testing style.
///
/// Walking times used below are the real `VenueAtlas` haversine estimates,
/// not stand-ins: Amphitheater -> Hall of Philosophy is 4 minutes (pinned
/// in `VenueAtlasTests`); Norton Hall -> Hall of Christ is 12 minutes
/// (computed the same way, used here for a longer-walk tight/fine case).
struct DayPlanTests {
    private static let day = "2026-07-15"

    private func time(_ s: String) throws -> Date {
        try #require(ChqTime.parse("\(Self.day) \(s)"))
    }

    // MARK: - build: filtering + ordering

    @Test func buildIncludesOnlyFavoritedEventsOnTheGivenDay() throws {
        let events = [
            makeEvent(id: "a", start: try time("10:00:00")),
            makeEvent(id: "b", start: try time("11:00:00")), // not favorited
            makeEvent(id: "c", start: try #require(ChqTime.parse("2026-07-16 10:00:00"))), // different day
        ]

        let plan = DayPlan.build(dayKey: Self.day, favorites: ["a", "c"], events: events)

        #expect(plan.items.map(\.event.id) == ["a"])
    }

    @Test func buildSortsByStartAscending() throws {
        let events = [
            makeEvent(id: "b", start: try time("14:00:00")),
            makeEvent(id: "a", start: try time("09:00:00")),
        ]

        let plan = DayPlan.build(dayKey: Self.day, favorites: ["a", "b"], events: events)

        #expect(plan.items.map(\.event.id) == ["a", "b"])
    }

    @Test func buildBreaksSimultaneousStartTiesByID() throws {
        let start = try time("10:00:00")
        let events = [
            makeEvent(id: "z", start: start),
            makeEvent(id: "a", start: start),
        ]

        let plan = DayPlan.build(dayKey: Self.day, favorites: ["z", "a"], events: events)

        #expect(plan.items.map(\.event.id) == ["a", "z"])
    }

    @Test func buildFirstItemHasNoTransition() throws {
        let events = [makeEvent(id: "a", start: try time("10:00:00"))]

        let plan = DayPlan.build(dayKey: Self.day, favorites: ["a"], events: events)

        #expect(plan.items.first?.transitionFromPrevious == nil)
    }

    // MARK: - build: dayKey boundary (NY calendar day)

    @Test func buildIncludesLateNightEventOnItsOwnDay() throws {
        let lateNight = try time("23:30:00")
        let events = [makeEvent(id: "a", start: lateNight)]

        let plan = DayPlan.build(dayKey: Self.day, favorites: ["a"], events: events)

        #expect(plan.items.map(\.event.id) == ["a"])
    }

    @Test func buildExcludesAfterMidnightEventFromThePreviousDay() throws {
        let afterMidnight = try #require(ChqTime.parse("2026-07-16 00:15:00"))
        let events = [makeEvent(id: "a", start: afterMidnight)]

        let plan = DayPlan.build(dayKey: Self.day, favorites: ["a"], events: events)

        #expect(plan.items.isEmpty)
    }

    // MARK: - build: overlap math

    @Test func buildFlagsOverlapWhenNextStartsBeforePreviousEffectiveEnd() throws {
        let events = [
            makeEvent(id: "a", start: try time("10:00:00"), end: try time("11:00:00")),
            makeEvent(id: "b", start: try time("10:30:00"), end: try time("11:30:00")),
        ]

        let plan = DayPlan.build(dayKey: Self.day, favorites: ["a", "b"], events: events)

        #expect(plan.items[1].transitionFromPrevious == .overlap(minutes: 30))
        #expect(plan.conflictCount == 1)
        #expect(plan.tightCount == 0)
    }

    @Test func buildRoundsPartialMinuteOverlapUpAndNeverToZero() throws {
        let events = [
            makeEvent(id: "a", start: try time("10:00:00"), end: try time("11:00:00")),
            makeEvent(id: "b", start: try #require(ChqTime.parse("2026-07-15 10:59:30"))),
        ]

        let plan = DayPlan.build(dayKey: Self.day, favorites: ["a", "b"], events: events)

        // A 30-second overlap rounds up to a full minute rather than to 0.
        #expect(plan.items[1].transitionFromPrevious == .overlap(minutes: 1))
    }

    @Test func buildZeroDurationEventUsesAssumedDurationForOverlapMath() throws {
        // "a" omits an end time (feed convention: end == start), so its
        // effective end is start + 60 min = 11:00, not 10:00.
        let events = [
            makeEvent(id: "a", start: try time("10:00:00")),
            makeEvent(id: "b", start: try time("10:30:00")),
        ]

        let plan = DayPlan.build(dayKey: Self.day, favorites: ["a", "b"], events: events)

        #expect(plan.items[1].transitionFromPrevious == .overlap(minutes: 30))
    }

    // MARK: - build: tight vs fine boundary

    @Test func buildIsFineWhenGapExactlyEqualsWalkingTime() throws {
        // Amphitheater -> Hall of Philosophy is a 4-minute walk.
        let events = [
            makeEvent(id: "a", start: try time("10:00:00"), location: "Amphitheater", end: try time("10:30:00")),
            makeEvent(id: "b", start: try time("10:34:00"), location: "Hall of Philosophy"),
        ]

        let plan = DayPlan.build(dayKey: Self.day, favorites: ["a", "b"], events: events)

        #expect(plan.items[1].transitionFromPrevious == .fine(walkMinutes: 4))
        #expect(plan.tightCount == 0)
    }

    @Test func buildIsTightWhenGapOneMinuteShortOfWalkingTime() throws {
        let events = [
            makeEvent(id: "a", start: try time("10:00:00"), location: "Amphitheater", end: try time("10:30:00")),
            makeEvent(id: "b", start: try time("10:33:00"), location: "Hall of Philosophy"),
        ]

        let plan = DayPlan.build(dayKey: Self.day, favorites: ["a", "b"], events: events)

        #expect(plan.items[1].transitionFromPrevious == .tight(walkMinutes: 4, gapMinutes: 3))
        #expect(plan.tightCount == 1)
        #expect(plan.conflictCount == 0)
    }

    @Test func buildTightAndFineBoundaryHoldsForALongerWalk() throws {
        // Norton Hall -> Hall of Christ is a 12-minute walk.
        let tightEvents = [
            makeEvent(id: "a", start: try time("10:00:00"), location: "Norton Hall", end: try time("10:30:00")),
            makeEvent(id: "b", start: try time("10:41:00"), location: "Hall of Christ: Sanctuary"), // 11-min gap
        ]
        let tightPlan = DayPlan.build(dayKey: Self.day, favorites: ["a", "b"], events: tightEvents)
        #expect(tightPlan.items[1].transitionFromPrevious == .tight(walkMinutes: 12, gapMinutes: 11))

        let fineEvents = [
            makeEvent(id: "a", start: try time("10:00:00"), location: "Norton Hall", end: try time("10:30:00")),
            makeEvent(id: "b", start: try time("10:42:00"), location: "Hall of Christ: Sanctuary"), // 12-min gap
        ]
        let finePlan = DayPlan.build(dayKey: Self.day, favorites: ["a", "b"], events: fineEvents)
        #expect(finePlan.items[1].transitionFromPrevious == .fine(walkMinutes: 12))
    }

    @Test func buildBackToBackSameVenueIsFineWithZeroWalk() throws {
        let events = [
            makeEvent(id: "a", start: try time("10:00:00"), location: "Amphitheater", end: try time("11:00:00")),
            makeEvent(id: "b", start: try time("11:00:00"), location: "Amphitheater"),
        ]

        let plan = DayPlan.build(dayKey: Self.day, favorites: ["a", "b"], events: events)

        #expect(plan.items[1].transitionFromPrevious == .fine(walkMinutes: 0))
    }

    // MARK: - build: unknown venues

    @Test func buildIsFineWithNoWalkTimeWhenNextVenueIsUnresolved() throws {
        let events = [
            makeEvent(id: "a", start: try time("10:00:00"), location: "Amphitheater", end: try time("10:30:00")),
            makeEvent(id: "b", start: try time("10:35:00"), location: "Zoom"),
        ]

        let plan = DayPlan.build(dayKey: Self.day, favorites: ["a", "b"], events: events)

        #expect(plan.items[1].transitionFromPrevious == .fine(walkMinutes: nil))
    }

    @Test func buildIsFineWithNoWalkTimeWhenPreviousVenueIsUnresolved() throws {
        let events = [
            makeEvent(id: "a", start: try time("10:00:00"), location: "Zoom", end: try time("10:30:00")),
            makeEvent(id: "b", start: try time("10:35:00"), location: "Amphitheater"),
        ]

        let plan = DayPlan.build(dayKey: Self.day, favorites: ["a", "b"], events: events)

        #expect(plan.items[1].transitionFromPrevious == .fine(walkMinutes: nil))
    }

    @Test func buildIsFineWithNoWalkTimeWhenLocationIsNil() throws {
        let events = [
            makeEvent(id: "a", start: try time("10:00:00"), location: nil, end: try time("10:30:00")),
            makeEvent(id: "b", start: try time("10:35:00"), location: "Amphitheater"),
        ]

        let plan = DayPlan.build(dayKey: Self.day, favorites: ["a", "b"], events: events)

        #expect(plan.items[1].transitionFromPrevious == .fine(walkMinutes: nil))
    }

    // MARK: - build: cancelled events

    @Test func buildIncludesCancelledEventsInTheTimeline() throws {
        let events = [
            makeEvent(id: "a", start: try time("10:00:00"), location: "Amphitheater", end: try time("11:00:00")),
            makeEvent(
                id: "b", start: try time("10:30:00"), location: "Hall of Philosophy",
                end: try time("11:30:00"), status: .cancelled
            ),
        ]

        let plan = DayPlan.build(dayKey: Self.day, favorites: ["a", "b"], events: events)

        // A cancelled event still occupied the visitor's timeline up until
        // it was pulled, so it stays in the plan and still counts toward
        // conflicts; the UI shows its existing status badge separately.
        #expect(plan.items.map(\.event.id) == ["a", "b"])
        #expect(plan.items[1].event.status == .cancelled)
        #expect(plan.items[1].transitionFromPrevious == .overlap(minutes: 30))
        #expect(plan.conflictCount == 1)
    }

    // MARK: - build: multi-event chains

    @Test func buildComputesTransitionsPairwiseAcrossAChain() throws {
        // A overlaps B; B is tight with C. Each transition is judged only
        // against the item immediately before it.
        let events = [
            makeEvent(id: "a", start: try time("09:00:00"), location: "Amphitheater", end: try time("10:00:00")),
            makeEvent(id: "b", start: try time("09:30:00"), location: "Amphitheater", end: try time("10:00:00")),
            makeEvent(id: "c", start: try time("10:03:00"), location: "Hall of Philosophy"),
        ]

        let plan = DayPlan.build(dayKey: Self.day, favorites: ["a", "b", "c"], events: events)

        #expect(plan.items[0].transitionFromPrevious == nil)
        #expect(plan.items[1].transitionFromPrevious == .overlap(minutes: 30))
        #expect(plan.items[2].transitionFromPrevious == .tight(walkMinutes: 4, gapMinutes: 3))
        #expect(plan.conflictCount == 1)
        #expect(plan.tightCount == 1)
    }

    // MARK: - build: firstStart / lastEnd

    @Test func buildFirstStartAndLastEndSpanTheWholeDay() throws {
        let events = [
            makeEvent(id: "a", start: try time("09:00:00"), location: "Amphitheater", end: try time("18:00:00")),
            makeEvent(id: "b", start: try time("10:00:00"), location: "Amphitheater", end: try time("11:00:00")),
        ]

        let plan = DayPlan.build(dayKey: Self.day, favorites: ["a", "b"], events: events)

        #expect(plan.firstStart == events[0].start)
        // "b" is the last item by start order, but "a" (the day's first
        // item) actually runs later: lastEnd reflects the latest effective
        // end across *all* items, not just the chronologically
        // last-starting one.
        #expect(plan.lastEnd == events[0].end)
    }

    @Test func buildOnEmptyDayHasNilBoundsAndZeroCounts() {
        let plan = DayPlan.build(dayKey: Self.day, favorites: [], events: [])

        #expect(plan.items.isEmpty)
        #expect(plan.firstStart == nil)
        #expect(plan.lastEnd == nil)
        #expect(plan.conflictCount == 0)
        #expect(plan.tightCount == 0)
    }

    // MARK: - availableDayKeys

    @Test func availableDayKeysIsSortedAndDeduped() throws {
        let events = [
            makeEvent(id: "a", start: try #require(ChqTime.parse("2026-07-20 10:00:00"))),
            makeEvent(id: "b", start: try #require(ChqTime.parse("2026-07-15 10:00:00"))),
            makeEvent(id: "c", start: try #require(ChqTime.parse("2026-07-15 18:00:00"))), // same day as "b"
        ]

        let keys = DayPlan.availableDayKeys(favorites: ["a", "b", "c"], events: events, year: 2026)

        #expect(keys == ["2026-07-15", "2026-07-20"])
    }

    @Test func availableDayKeysExcludesNonFavoritedEvents() throws {
        let events = [
            makeEvent(id: "a", start: try time("10:00:00")),
            makeEvent(id: "b", start: try #require(ChqTime.parse("2026-07-20 10:00:00"))),
        ]

        let keys = DayPlan.availableDayKeys(favorites: ["a"], events: events, year: 2026)

        #expect(keys == [Self.day])
    }

    @Test func availableDayKeysIncludesCancelledFavoritedEvents() throws {
        let events = [makeEvent(id: "a", start: try time("10:00:00"), status: .cancelled)]

        let keys = DayPlan.availableDayKeys(favorites: ["a"], events: events, year: 2026)

        #expect(keys == [Self.day])
    }

    // MARK: - defaultDayKey

    @Test func defaultDayKeyReturnsTodayWhenAvailable() throws {
        let now = try time("08:00:00")
        let available = ["2026-07-10", Self.day, "2026-07-20"]

        #expect(DayPlan.defaultDayKey(available: available, now: now) == Self.day)
    }

    @Test func defaultDayKeyReturnsFirstFutureDayWhenTodayIsUnavailable() throws {
        let now = try time("08:00:00")
        let available = ["2026-07-10", "2026-07-18", "2026-07-25"]

        #expect(DayPlan.defaultDayKey(available: available, now: now) == "2026-07-18")
    }

    @Test func defaultDayKeyReturnsLastDayWhenAllAreInThePast() throws {
        let now = try time("08:00:00")
        let available = ["2026-07-01", "2026-07-10"]

        #expect(DayPlan.defaultDayKey(available: available, now: now) == "2026-07-10")
    }

    @Test func defaultDayKeyReturnsNilWhenNoDaysAreAvailable() throws {
        let now = try time("08:00:00")

        #expect(DayPlan.defaultDayKey(available: [], now: now) == nil)
    }

    @Test func defaultDayKeyToleratesUnsortedInput() throws {
        let now = try time("08:00:00")
        let available = ["2026-07-25", "2026-07-10", "2026-07-18"]

        #expect(DayPlan.defaultDayKey(available: available, now: now) == "2026-07-18")
    }
}
