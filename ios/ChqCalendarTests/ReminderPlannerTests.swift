import Foundation
import Testing
@testable import ChqCalendar

struct ReminderPresetTests {
    @Test func labels() {
        #expect(ReminderPreset.thirtyMinutesBefore.label == "30 minutes before")
        #expect(ReminderPreset.oneHourBefore.label == "1 hour before")
        #expect(ReminderPreset.nightBefore.label == "Night before (8 PM)")
        #expect(ReminderPreset.none.label == "Off")
    }

    @Test func noneHasNoTriggerDate() throws {
        let start = try #require(ChqTime.parse("2026-07-15 19:30:00"))
        #expect(ReminderPreset.none.triggerDate(for: start) == nil)
    }

    @Test func thirtyMinutesBeforeSubtractsThirtyMinutes() throws {
        let start = try #require(ChqTime.parse("2026-07-15 19:30:00"))
        let expected = try #require(ChqTime.parse("2026-07-15 19:00:00"))
        #expect(ReminderPreset.thirtyMinutesBefore.triggerDate(for: start) == expected)
    }

    @Test func oneHourBeforeSubtractsOneHour() throws {
        let start = try #require(ChqTime.parse("2026-07-15 19:30:00"))
        let expected = try #require(ChqTime.parse("2026-07-15 18:30:00"))
        #expect(ReminderPreset.oneHourBefore.triggerDate(for: start) == expected)
    }

    @Test func nightBeforeIsEightPMThePreviousDay() throws {
        let start = try #require(ChqTime.parse("2026-07-15 19:30:00"))
        let expected = try #require(ChqTime.parse("2026-07-14 20:00:00"))
        #expect(ReminderPreset.nightBefore.triggerDate(for: start) == expected)
    }

    /// An event starting just after midnight: "the previous day" must still
    /// resolve to the NY calendar day before the event's day, not a
    /// same-day 20:00 computed by naively truncating a fixed offset.
    @Test func nightBeforeCrossesMidnightCorrectly() throws {
        let start = try #require(ChqTime.parse("2026-07-15 00:15:00"))
        let expected = try #require(ChqTime.parse("2026-07-14 20:00:00"))
        #expect(ReminderPreset.nightBefore.triggerDate(for: start) == expected)
    }

    /// US DST ended 2026-11-01 at 2 AM (clocks fell back to 1 AM), making
    /// that calendar day 25 real hours long. This start time is chosen to be
    /// genuinely adversarial against a naive `start.addingTimeInterval(-86400)`
    /// implementation, not merely different from it by an hour:
    ///
    /// A naive implementation subtracts a fixed 24 real hours from `start`,
    /// then reads off the Y/M/D of *that* instant. Because 2026-11-01
    /// contains 25 real hours, subtracting only 24 from a `start` late in
    /// the *next* day (23:30 on 2026-11-01 itself, so the "previous day" is
    /// 2026-10-31) doesn't reach far enough back — it lands at
    /// 2026-11-01 ~00:30, i.e. rolls forward onto the **wrong calendar day
    /// entirely** (2026-11-01 instead of 2026-10-31). Verified empirically:
    /// naive gives `2026-11-01 20:00`, a full day late. The correct,
    /// calendar-based implementation must still produce `2026-10-31 20:00`.
    @Test func nightBeforeIsDSTSafeAcrossFallBack() throws {
        let start = try #require(ChqTime.parse("2026-11-01 23:30:00"))
        let trigger = try #require(ReminderPreset.nightBefore.triggerDate(for: start))

        let components = ChqTime.calendar.dateComponents([.year, .month, .day, .hour, .minute], from: trigger)
        #expect(components.year == 2026)
        #expect(components.month == 10)
        #expect(components.day == 31)
        #expect(components.hour == 20)
        #expect(components.minute == 0)
    }

    /// US DST began 2026-03-08 at 2 AM (clocks sprang forward to 3 AM),
    /// making that calendar day only 23 real hours long. This start time is
    /// genuinely adversarial against a naive `start.addingTimeInterval(-86400)`
    /// implementation:
    ///
    /// A naive implementation subtracts a fixed 24 real hours from `start`
    /// (2026-03-09 00:15), then reads off the Y/M/D of that instant. Because
    /// 2026-03-08 contains only 23 real hours, subtracting a full 24
    /// overshoots *past* it entirely, landing on 2026-03-07 ~23:15 — the
    /// **wrong calendar day** (2026-03-07 instead of 2026-03-08). Verified
    /// empirically: naive gives `2026-03-07 20:00`, a full day early. The
    /// correct, calendar-based implementation must still produce
    /// `2026-03-08 20:00`.
    @Test func nightBeforeIsDSTSafeAcrossSpringForward() throws {
        let start = try #require(ChqTime.parse("2026-03-09 00:15:00"))
        let trigger = try #require(ReminderPreset.nightBefore.triggerDate(for: start))

        let components = ChqTime.calendar.dateComponents([.year, .month, .day, .hour, .minute], from: trigger)
        #expect(components.year == 2026)
        #expect(components.month == 3)
        #expect(components.day == 8)
        #expect(components.hour == 20)
        #expect(components.minute == 0)
    }
}

struct ReminderSettingsTests {
    @Test func defaultsToThirtyMinutesBeforeWithNoOverrides() {
        let settings = ReminderSettings()
        #expect(settings.defaultPreset == .thirtyMinutesBefore)
        #expect(settings.overrides.isEmpty)
    }

    @Test func presetForEventFallsBackToDefaultWhenNoOverride() {
        var settings = ReminderSettings()
        settings.defaultPreset = .oneHourBefore
        #expect(settings.preset(for: "evt-1") == .oneHourBefore)
    }

    @Test func overrideBeatsDefault() {
        var settings = ReminderSettings()
        settings.defaultPreset = .oneHourBefore
        settings.setOverride(.nightBefore, for: "evt-1")
        #expect(settings.preset(for: "evt-1") == .nightBefore)
        #expect(settings.preset(for: "evt-2") == .oneHourBefore)
    }

    /// A default of `.none` (reminders off season-wide) doesn't prevent a
    /// specific event from carrying its own override that turns them back
    /// on — `.none` is a real, storable per-event choice too, not a sentinel
    /// for "no override".
    @Test func perEventOverrideStillSchedulesWhenDefaultIsNone() {
        var settings = ReminderSettings()
        settings.defaultPreset = .none
        settings.setOverride(.thirtyMinutesBefore, for: "evt-1")
        #expect(settings.preset(for: "evt-1") == .thirtyMinutesBefore)
        #expect(settings.preset(for: "evt-2") == .none)
    }

    @Test func settingOverrideToNilClearsItAndRevertsToDefault() {
        var settings = ReminderSettings()
        settings.defaultPreset = .oneHourBefore
        settings.setOverride(.nightBefore, for: "evt-1")
        settings.setOverride(nil, for: "evt-1")
        #expect(settings.preset(for: "evt-1") == .oneHourBefore)
        #expect(settings.overrides.isEmpty)
    }
}

struct ReminderPlannerTests {
    private func makeStart(_ dateString: String) -> Date {
        // swiftlint:disable:next force_unwrapping
        ChqTime.parse(dateString)!
    }

    @Test func onlyFavoritedEventsAreScheduled() {
        let now = makeStart("2026-07-15 12:00:00")
        let favorited = makeEvent(id: "evt-1", start: makeStart("2026-07-15 19:30:00"))
        let notFavorited = makeEvent(id: "evt-2", start: makeStart("2026-07-15 19:30:00"))

        let planned = ReminderPlanner.plan(
            favorites: ["evt-1"],
            events: [favorited, notFavorited],
            settings: ReminderSettings(),
            now: now
        )

        #expect(planned.map(\.eventID) == ["evt-1"])
    }

    @Test func cancelledEventsAreExcludedEvenIfFavorited() {
        let now = makeStart("2026-07-15 12:00:00")
        let cancelled = makeEvent(id: "evt-1", start: makeStart("2026-07-15 19:30:00"), status: .cancelled)

        let planned = ReminderPlanner.plan(
            favorites: ["evt-1"],
            events: [cancelled],
            settings: ReminderSettings(),
            now: now
        )

        #expect(planned.isEmpty)
    }

    @Test func eventsWithEffectivePresetNoneAreExcluded() {
        let now = makeStart("2026-07-15 12:00:00")
        let event = makeEvent(id: "evt-1", start: makeStart("2026-07-15 19:30:00"))
        var settings = ReminderSettings()
        settings.defaultPreset = .none

        let planned = ReminderPlanner.plan(
            favorites: ["evt-1"],
            events: [event],
            settings: settings,
            now: now
        )

        #expect(planned.isEmpty)
    }

    /// A starred event whose reminder moment has already passed must never
    /// fire immediately — it's simply dropped, not clamped to `now`.
    @Test func pastTriggerDateIsExcluded() {
        // Event starts in 10 minutes; the 30-minute-before mark is 20
        // minutes in the past.
        let now = makeStart("2026-07-15 19:00:00")
        let event = makeEvent(id: "evt-1", start: makeStart("2026-07-15 19:10:00"))

        let planned = ReminderPlanner.plan(
            favorites: ["evt-1"],
            events: [event],
            settings: ReminderSettings(),
            now: now
        )

        #expect(planned.isEmpty)
    }

    /// Same event/time as `pastTriggerDateIsExcluded`, but the event's
    /// override shortens the offset from the (already-past) default to one
    /// whose trigger is still ahead of `now` — it must be kept.
    @Test func futureTriggerIsKeptWhenOverridePresetIsShorter() {
        // Event starts in 40 minutes.
        let now = makeStart("2026-07-15 19:00:00")
        let event = makeEvent(id: "evt-1", start: makeStart("2026-07-15 19:40:00"))
        var settings = ReminderSettings()
        settings.defaultPreset = .oneHourBefore // trigger = 18:40, already past
        settings.setOverride(.thirtyMinutesBefore, for: "evt-1") // trigger = 19:10, still ahead

        let planned = ReminderPlanner.plan(
            favorites: ["evt-1"],
            events: [event],
            settings: settings,
            now: now
        )

        #expect(planned.count == 1)
        #expect(planned.first?.eventID == "evt-1")
        #expect(planned.first?.triggerDate == makeStart("2026-07-15 19:10:00"))
    }

    @Test func bodyIncludesTimeAndLocationSeparatedByMiddot() {
        let now = makeStart("2026-07-15 12:00:00")
        let event = makeEvent(
            id: "evt-1",
            start: makeStart("2026-07-15 19:30:00"),
            location: "Amphitheater"
        )

        let planned = ReminderPlanner.plan(
            favorites: ["evt-1"],
            events: [event],
            settings: ReminderSettings(),
            now: now
        )

        #expect(planned.first?.body == "Starts at 7:30 PM \u{00B7} Amphitheater")
    }

    @Test func bodyOmitsLocationWhenNil() {
        let now = makeStart("2026-07-15 12:00:00")
        let event = makeEvent(id: "evt-1", start: makeStart("2026-07-15 19:30:00"), location: nil)

        let planned = ReminderPlanner.plan(
            favorites: ["evt-1"],
            events: [event],
            settings: ReminderSettings(),
            now: now
        )

        #expect(planned.first?.body == "Starts at 7:30 PM")
    }

    @Test func titleIsEventTitle() {
        let now = makeStart("2026-07-15 12:00:00")
        let event = makeEvent(id: "evt-1", start: makeStart("2026-07-15 19:30:00"), title: "CSO Concert")

        let planned = ReminderPlanner.plan(
            favorites: ["evt-1"],
            events: [event],
            settings: ReminderSettings(),
            now: now
        )

        #expect(planned.first?.title == "CSO Concert")
        #expect(planned.first?.eventStart == makeStart("2026-07-15 19:30:00"))
    }

    @Test func resultsAreSortedByTriggerDateAscending() {
        let now = makeStart("2026-07-15 06:00:00")
        let later = makeEvent(id: "evt-later", start: makeStart("2026-07-15 20:00:00"))
        let earlier = makeEvent(id: "evt-earlier", start: makeStart("2026-07-15 12:00:00"))

        let planned = ReminderPlanner.plan(
            favorites: ["evt-later", "evt-earlier"],
            events: [later, earlier],
            settings: ReminderSettings(),
            now: now
        )

        #expect(planned.map(\.eventID) == ["evt-earlier", "evt-later"])
    }

    /// Two events whose reminders land on the exact same `triggerDate` must
    /// come out in a deterministic order (ties broken by `eventID`) rather
    /// than whatever order `events` happened to be in.
    @Test func tiedTriggerDatesBreakByEventIDForDeterminism() {
        let now = makeStart("2026-07-15 06:00:00")
        let start = makeStart("2026-07-15 19:30:00")
        let zEvent = makeEvent(id: "evt-z", start: start)
        let aEvent = makeEvent(id: "evt-a", start: start)

        let planned = ReminderPlanner.plan(
            favorites: ["evt-z", "evt-a"],
            events: [zEvent, aEvent],
            settings: ReminderSettings(),
            now: now
        )

        #expect(planned.map(\.eventID) == ["evt-a", "evt-z"])
    }

    /// 70 qualifying favorites must be capped to exactly `maxPending` (60),
    /// and the ones kept must be exactly the 60 with the earliest
    /// `triggerDate` — not merely 60 arbitrary survivors.
    @Test func capsAtSixtyKeepingTheEarliestTriggers() {
        let now = makeStart("2026-07-01 00:00:00")
        var events: [Event] = []
        var favorites: Set<String> = []
        for offset in 0..<70 {
            let id = "evt-\(offset)"
            // Spread starts out so every trigger date is distinct and in
            // ascending order of `offset`.
            let start = now.addingTimeInterval(TimeInterval(3600 * (offset + 1)))
            events.append(makeEvent(id: id, start: start))
            favorites.insert(id)
        }

        let planned = ReminderPlanner.plan(
            favorites: favorites,
            events: events,
            settings: ReminderSettings(),
            now: now
        )

        #expect(planned.count == ReminderPlanner.maxPending)
        #expect(planned.count == 60)

        let expectedIDs = Set((0..<60).map { "evt-\($0)" })
        #expect(Set(planned.map(\.eventID)) == expectedIDs)

        // Also confirm the plan is sorted ascending, so "earliest 60" is
        // exactly its first 60 elements (a stronger check than the id set
        // alone: it pins the truncation direction too).
        let triggerDates = planned.map(\.triggerDate)
        #expect(triggerDates == triggerDates.sorted())
    }

    /// Pins the exact boundary: when the 60th and 61st-earliest candidates
    /// are tied on `triggerDate`, the `eventID` tiebreak (not insertion
    /// order) decides which one survives the cap.
    @Test func capBoundaryTieIsBrokenByEventIDNotInsertionOrder() {
        let now = makeStart("2026-07-01 00:00:00")
        var events: [Event] = []
        var favorites: Set<String> = []

        // 59 events with strictly earlier, distinct trigger dates: always
        // kept, occupying ranks 1-59.
        for offset in 0..<59 {
            let id = "evt-\(offset)"
            let start = now.addingTimeInterval(TimeInterval(3600 * (offset + 1)))
            events.append(makeEvent(id: id, start: start))
            favorites.insert(id)
        }

        // Two more events tied on the same (later) triggerDate, contesting
        // the single remaining slot (rank 60). Inserted in "z then a" order
        // so a naive last-write/insertion-order tiebreak would keep "evt-z"
        // — the correct eventID tiebreak must keep "evt-a" instead.
        let tiedStart = now.addingTimeInterval(TimeInterval(3600 * 100))
        events.append(makeEvent(id: "evt-z", start: tiedStart))
        events.append(makeEvent(id: "evt-a", start: tiedStart))
        favorites.insert("evt-z")
        favorites.insert("evt-a")

        let planned = ReminderPlanner.plan(
            favorites: favorites,
            events: events,
            settings: ReminderSettings(),
            now: now
        )

        #expect(planned.count == 60)
        #expect(planned.contains { $0.eventID == "evt-a" })
        #expect(!planned.contains { $0.eventID == "evt-z" })
        #expect(planned.last?.eventID == "evt-a")
    }
}
