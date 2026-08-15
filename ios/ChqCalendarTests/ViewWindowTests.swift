import Foundation
import Testing
@testable import ChqCalendar

struct ViewWindowTests {

    private static func at(_ s: String) throws -> Date {
        try #require(ChqTime.parse(s))
    }

    private func bounds() -> ClosedRange<String> {
        DayWindow.bounds(year: 2026, starredDays: [])
    }

    private func window(
        _ sel: FilterSelection,
        events: [Event] = [],
        now: Date,
        isCurrentYear: Bool = true
    ) -> ViewWindow? {
        ViewWindow.make(
            selection: sel, events: events, now: now,
            year: 2026, isCurrentYear: isCurrentYear, bounds: bounds())
    }

    // MARK: - day boundaries

    @Test func dayAfterIsTheNextDaysMidnight() throws {
        let bound = try #require(ViewWindow.dayAfter("2026-07-15"))
        #expect(bound == (try Self.at("2026-07-16 00:00:00")))
    }

    @Test func dayAfterHandlesADstDay() throws {
        // 2026-11-01 is 25 hours long in America/New_York. Adding 86_400
        // seconds would land at 23:00 on the 1st, not midnight on the 2nd.
        let bound = try #require(ViewWindow.dayAfter("2026-11-01"))
        #expect(bound == (try Self.at("2026-11-02 00:00:00")))
    }

    @Test func dayAfterRejectsAnUnparseableKey() {
        #expect(ViewWindow.dayAfter("not-a-day") == nil)
    }

    @Test func lastDayCoveredStepsBackOnAnExactDayBoundary() throws {
        // A window ending at midnight does NOT show that day.
        #expect(ViewWindow.lastDayCovered(try Self.at("2026-07-16 00:00:00")) == "2026-07-15")
    }

    @Test func lastDayCoveredKeepsTheDayOnAMidDayBoundary() throws {
        // A week ends at noon Saturday, and that Saturday morning has events,
        // so the Saturday counts as shown.
        #expect(ViewWindow.lastDayCovered(try Self.at("2026-07-18 12:00:00")) == "2026-07-18")
    }

    // MARK: - navigableBounds

    @Test func boundsCoverTheSeasonWhenEveryEventIsInside() throws {
        let inside = makeEvent(id: "in", start: try Self.at("2026-07-15 10:00:00"))
        let range = ViewWindow.navigableBounds(year: 2026, events: [inside], starredDays: [])
        #expect(range == DayWindow.bounds(year: 2026, starredDays: []))
    }

    @Test func boundsWidenToContainOutOfSeasonEvents() throws {
        let early = makeEvent(id: "early", start: try Self.at("2026-05-01 10:00:00"))
        let late = makeEvent(id: "late", start: try Self.at("2026-10-01 10:00:00"))
        let range = ViewWindow.navigableBounds(year: 2026, events: [early, late], starredDays: [])
        #expect(range.lowerBound == "2026-05-01")
        #expect(range.upperBound == "2026-10-01")
    }

    @Test func boundsAlsoWidenForStarredDaysOutsideTheSeason() {
        let range = ViewWindow.navigableBounds(
            year: 2026, events: [], starredDays: ["2026-04-01", "2026-12-25"])
        #expect(range.lowerBound == "2026-04-01")
        #expect(range.upperBound == "2026-12-25")
    }

    // MARK: - base windows, one per scope

    @Test func todaySpansExactlyTheCurrentDay() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        let w = try #require(window(FilterSelection(dateScope: .today), now: now))
        #expect(w.startDay == "2026-07-15")
        #expect(w.endDay == "2026-07-15")
        #expect(w.start == ChqTime.calendar.startOfDay(for: now))
        #expect(w.endExclusive == (try Self.at("2026-07-16 00:00:00")))
    }

    @Test func todayIncludesTheFinalSubSecondAndExcludesTheNextMidnight() throws {
        // Half-open means no epsilon and no precision assumption: anything
        // strictly before the next midnight is in, midnight itself is out.
        // ChqTime.endOfDay (23:59:59.000) would have dropped the first of
        // these, and an `end - 1ms` bound would have dropped it on iOS while
        // keeping it on the web, where Date is integer milliseconds.
        let now = try Self.at("2026-07-15 15:00:00")
        let w = try #require(window(FilterSelection(dateScope: .today), now: now))
        #expect(w.contains(try Self.at("2026-07-15 23:59:59").addingTimeInterval(0.9995)))
        #expect(!w.contains(try Self.at("2026-07-16 00:00:00")))
        #expect(w.contains(try Self.at("2026-07-15 00:00:00")))
    }

    @Test func adjacentDayWindowsTileWithoutGapOrOverlap() throws {
        // The property an inclusive-with-epsilon scheme cannot give you, and
        // the one scroll-stitching depends on.
        let day1 = try #require(window(
            FilterSelection(dateScope: .day, selectedDayKey: "2026-07-15"),
            now: try Self.at("2026-07-15 12:00:00")))
        let day2 = try #require(window(
            FilterSelection(dateScope: .day, selectedDayKey: "2026-07-16"),
            now: try Self.at("2026-07-15 12:00:00")))
        #expect(day1.endExclusive == day2.start)
    }

    @Test func nextStartsOneHourBeforeNow() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        let events = [makeEvent(id: "e", start: try Self.at("2026-07-16 10:00:00"))]
        let w = try #require(window(FilterSelection(dateScope: .next), events: events, now: now))
        #expect(w.start == now.addingTimeInterval(-3600))
        #expect(w.startDay == "2026-07-15")
    }

    @Test func nextUpperBoundAdmitsNoRepresentableEventBeyondTheOldOne() throws {
        // The one deliberate difference from the pre-refactor pipeline:
        // `.next` used `<= adaptiveEndDate`, which is ChqTime.endOfDay =
        // 23:59:59.000. The half-open bound is the next midnight, so it also
        // admits 23:59:59.5 — but event times are parsed from
        // "yyyy-MM-dd HH:mm:ss" and carry no sub-second component, so no
        // representable event can land in that gap. Asserted rather than
        // claimed in a comment: verified against the live formatter (a
        // trailing ".500" is unmatched pattern text and DateFormatter's
        // strict "yyyy-MM-dd HH:mm:ss" parse rejects it outright) before
        // pinning both properties.
        #expect(ChqTime.parse("2026-07-15 23:59:59.500") == nil)
        let onTheSecond = try #require(ChqTime.parse("2026-07-15 23:59:59"))
        #expect(onTheSecond.timeIntervalSince1970 == onTheSecond.timeIntervalSince1970.rounded())
    }

    @Test func nextNearMidnightPutsStartDayOnThePreviousDay() throws {
        let now = try Self.at("2026-07-15 00:30:00")
        let w = try #require(window(FilterSelection(dateScope: .next), now: now))
        #expect(w.startDay == "2026-07-14")
    }

    @Test func seasonCarriesTheWeeksBoundsThroughVerbatim() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let w = try #require(window(FilterSelection(dateScope: .season), now: now))
        #expect(w.start == weeks[0].start)
        #expect(w.endExclusive == weeks[8].end)
    }

    @Test func thisWeekCarriesTheWeeksNoonBoundsThroughVerbatim() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let current = try #require(weeks.first { $0.contains(now) })
        let w = try #require(window(FilterSelection(dateScope: .thisWeek), now: now))
        #expect(w.start == current.start)
        #expect(w.endExclusive == current.end)
    }

    @Test func thisWeekSpansBothBoundarySaturdays() throws {
        // A week runs noon-Saturday to noon-Saturday, so both boundary
        // Saturdays carry events and the window covers eight day keys. This is
        // why the season cannot be paged into disjoint weeks.
        let now = try Self.at("2026-07-15 15:00:00")
        let w = try #require(window(FilterSelection(dateScope: .thisWeek), now: now))
        #expect(ChqTime.dayKeys(from: w.startDay, through: w.endDay).count == 8)
    }

    @Test func dayScopeSpansItsNamedDay() throws {
        let now = try Self.at("2027-01-01 12:00:00")
        let sel = FilterSelection(dateScope: .day, selectedDayKey: "2026-07-15")
        let w = try #require(window(sel, now: now, isCurrentYear: false))
        #expect(w.startDay == "2026-07-15")
        #expect(w.endDay == "2026-07-15")
    }

    @Test func allIsUnboundedInInstantsButBoundedInDays() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        let w = try #require(window(FilterSelection(dateScope: .all), now: now))
        #expect(w.start < (try Self.at("1900-01-01 00:00:00")))
        #expect(w.endExclusive > (try Self.at("2200-01-01 00:00:00")))
        #expect(w.startDay == bounds().lowerBound)
        #expect(w.endDay == bounds().upperBound)
    }

    @Test func aPastSeasonCollapsesRelativeScopesToAll() throws {
        let now = try Self.at("2027-01-01 12:00:00")
        let w = try #require(window(FilterSelection(dateScope: .today), now: now, isCurrentYear: false))
        #expect(w.start < (try Self.at("1900-01-01 00:00:00")))
    }

    // MARK: - expansion

    @Test func expansionGrowsTheEndAndUsesWholeDays() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        var sel = FilterSelection(dateScope: .today)
        sel.windowEndDayKey = "2026-07-17"
        let w = try #require(window(sel, now: now))
        #expect(w.endDay == "2026-07-17")
        #expect(w.endExclusive == (try Self.at("2026-07-18 00:00:00")))
        #expect(w.start == ChqTime.calendar.startOfDay(for: now))
    }

    @Test func expansionGrowsTheStart() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        var sel = FilterSelection(dateScope: .today)
        sel.windowStartDayKey = "2026-07-13"
        let w = try #require(window(sel, now: now))
        #expect(w.startDay == "2026-07-13")
        #expect(w.start == ChqTime.calendar.startOfDay(for: try Self.at("2026-07-13 00:00:00")))
    }

    @Test func expandingEarlierDropsTheIntraDayStartInstant() throws {
        // `.next` starts at now-1h. Once the user reaches back past that day
        // they want the whole earlier day, not a window still beginning at
        // 14:00 on a day they scrolled away from.
        let now = try Self.at("2026-07-15 15:00:00")
        var sel = FilterSelection(dateScope: .next)
        sel.windowStartDayKey = "2026-07-13"
        let w = try #require(window(sel, now: now))
        #expect(w.start == ChqTime.calendar.startOfDay(for: try Self.at("2026-07-13 00:00:00")))
    }

    @Test func expansionNeverNarrowsTheBaseWindow() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        var sel = FilterSelection(dateScope: .today)
        sel.windowEndDayKey = "2026-07-10"
        let w = try #require(window(sel, now: now))
        #expect(w.endDay == "2026-07-15")
    }

    @Test func expansionClampsToNavigableBounds() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        var sel = FilterSelection(dateScope: .today)
        sel.windowEndDayKey = "2030-01-01"
        let w = try #require(window(sel, now: now))
        #expect(w.endDay == bounds().upperBound)
    }
}
