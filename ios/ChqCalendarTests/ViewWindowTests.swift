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

    @Test func expansionNeverNarrowsTheStartOfTheBaseWindow() throws {
        // The mirror of expansionNeverNarrowsTheBaseWindow, for the start
        // side: a windowStartDayKey that names a LATER day than the base's
        // own start is not a widening, so it's ignored rather than applied.
        let now = try Self.at("2026-07-15 15:00:00")
        var sel = FilterSelection(dateScope: .today)
        sel.windowStartDayKey = "2026-07-20"
        let w = try #require(window(sel, now: now))
        #expect(w.startDay == "2026-07-15")
    }

    @Test func expansionClampsToNavigableBounds() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        var sel = FilterSelection(dateScope: .today)
        sel.windowEndDayKey = "2030-01-01"
        let w = try #require(window(sel, now: now))
        #expect(w.endDay == bounds().upperBound)
    }

    @Test func expansionClampsStartToNavigableBounds() throws {
        // The mirror of expansionClampsToNavigableBounds, for the start side.
        let now = try Self.at("2026-07-15 15:00:00")
        var sel = FilterSelection(dateScope: .today)
        sel.windowStartDayKey = "2000-01-01"
        let w = try #require(window(sel, now: now))
        #expect(w.startDay == bounds().lowerBound)
    }

    @Test func expandingTheStartPreservesTheOriginalEndExclusive() throws {
        // The mirror of expansionGrowsTheEndAndUsesWholeDays' check that
        // expanding the end leaves `start` untouched: expanding the start
        // must not perturb the end by so much as an instant.
        let now = try Self.at("2026-07-15 15:00:00")
        let base = try #require(window(FilterSelection(dateScope: .today), now: now))
        var sel = FilterSelection(dateScope: .today)
        sel.windowStartDayKey = "2026-07-13"
        let w = try #require(window(sel, now: now))
        #expect(w.endDay == base.endDay)
        #expect(w.endExclusive == base.endExclusive)
    }

    // The clamp on the expansion inputs (not on the merged startDay/endDay)
    // only diverges from the rejected "clamp the merged result" design when
    // `base` itself sits outside `bounds` — the off-season `.today` case,
    // which is where the app spends most of the year. In-season, both
    // designs agree, so a test built from an in-season `.today` cannot tell
    // them apart (see the mutation proof recorded in
    // .superpowers/sdd/2026-08-15-date-navigation-phase-1b-ios-window-model/task-3-report.md).
    // With the rejected design these two produce an inverted window
    // (`startDay > endDay`), which crashes when `range: start..<endExclusive`
    // is constructed.

    @Test func offSeasonTodayIgnoresAnOutOfBoundsEndExpansion() throws {
        let now = try Self.at("2026-12-15 12:00:00")
        var sel = FilterSelection(dateScope: .today)
        sel.windowEndDayKey = "2026-12-20"
        let w = try #require(window(sel, now: now))
        #expect(w.startDay <= w.endDay)
        #expect(w.start < w.endExclusive)
        // The expansion target is entirely past `bounds`, so once clamped to
        // `bounds.upperBound` it is still earlier than the base window's own
        // (also out-of-season) day, and is ignored rather than applied.
        #expect(w.startDay == "2026-12-15")
        #expect(w.endDay == "2026-12-15")
    }

    @Test func offSeasonTodayIgnoresAnOutOfBoundsStartExpansion() throws {
        let now = try Self.at("2026-01-01 12:00:00")
        var sel = FilterSelection(dateScope: .today)
        sel.windowStartDayKey = "2020-01-01"
        let w = try #require(window(sel, now: now))
        #expect(w.startDay <= w.endDay)
        #expect(w.start < w.endExclusive)
        // Symmetric to the end-side case above: clamped to `bounds.lowerBound`,
        // still later than the base window's own (also out-of-season) day.
        #expect(w.startDay == "2026-01-01")
        #expect(w.endDay == "2026-01-01")
    }

    // MARK: - robustness

    @Test func allUsesTheFullDateDomainNotAYear1To3000Range() throws {
        // `.all`'s bounds are `Date.distantPast`/`distantFuture` — genuinely
        // unbounded, matching the web's `.all`, not an arbitrary wide range.
        let now = try Self.at("2026-07-15 15:00:00")
        let w = try #require(window(FilterSelection(dateScope: .all), now: now))
        #expect(w.start == Date.distantPast)
        #expect(w.endExclusive == Date.distantFuture)
    }

    @Test func anUnparseableStartExpansionIsIgnoredEntirelyRatherThanDesyncingFromRange() throws {
        // If an expansion key survives the bounds clamp but fails
        // `ChqTime.parse`, `startDay` must not name a day that `range`
        // disagrees with. "2026-07-00" sorts before the base window's own
        // "2026-07-15" (so it would widen if it parsed) and sorts after
        // the season's lower bound (so it survives the clamp), but day 00
        // does not exist and `ChqTime.parse` rejects it.
        let now = try Self.at("2026-07-15 15:00:00")
        var sel = FilterSelection(dateScope: .today)
        sel.windowStartDayKey = "2026-07-00"
        let w = try #require(window(sel, now: now))
        #expect(w.startDay == "2026-07-15")
        #expect(w.start == ChqTime.calendar.startOfDay(for: now))
    }

    @Test func anUnparseableEndExpansionIsIgnoredEntirelyRatherThanDesyncingFromRange() throws {
        // Mirror of the start-side case: "2026-07-32" sorts after the base
        // window's own "2026-07-15" (so it would widen if it parsed) and
        // sorts before the season's upper bound (so it survives the clamp),
        // but July has no 32nd day.
        let now = try Self.at("2026-07-15 15:00:00")
        var sel = FilterSelection(dateScope: .today)
        sel.windowEndDayKey = "2026-07-32"
        let w = try #require(window(sel, now: now))
        #expect(w.endDay == "2026-07-15")
        #expect(w.endExclusive == (try Self.at("2026-07-16 00:00:00")))
    }

    @Test func dayWindowFailsOpenToAllWhenTheKeyIsNil() throws {
        // `.day` with no key is unreachable through `ViewWindow.make` — a
        // nil key resolves to `.all` before `base` ever sees `.day` — so
        // this exercises `dayWindow(forDayScope:bounds:)` directly, pinning
        // that the fallback is `.all` (show everything), not `nil` (show
        // nothing), if that guarantee were ever weakened.
        let w = try #require(ViewWindow.dayWindow(forDayScope: nil, bounds: bounds()))
        #expect(w.start == Date.distantPast)
        #expect(w.endExclusive == Date.distantFuture)
        #expect(w.startDay == bounds().lowerBound)
        #expect(w.endDay == bounds().upperBound)
    }

    @Test func dayWindowStillSpansTheNamedDayWhenAKeyIsPresent() throws {
        let w = try #require(ViewWindow.dayWindow(forDayScope: "2026-07-15", bounds: bounds()))
        #expect(w.startDay == "2026-07-15")
        #expect(w.endDay == "2026-07-15")
    }

    // MARK: - nil contract

    @Test func makeReturnsNilForADayScopeWithAnUnparseableSelectedDayKey() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        let sel = FilterSelection(dateScope: .day, selectedDayKey: "not-a-day")
        #expect(window(sel, now: now) == nil)
    }
}

struct EventFilterWindowTests {

    private static func at(_ s: String) throws -> Date {
        try #require(ChqTime.parse(s))
    }

    @Test func expandingTheWindowEndAddsThatDaysEvents() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        let today = makeEvent(id: "today", start: try Self.at("2026-07-15 18:00:00"))
        let tomorrow = makeEvent(id: "tomorrow", start: try Self.at("2026-07-16 18:00:00"))

        var sel = FilterSelection(dateScope: .today)
        let before = EventFilter.apply(
            sel, to: [today, tomorrow], favorites: [], now: now, year: 2026, isCurrentYear: true)
        #expect(before.map(\.id) == ["today"])

        sel.windowEndDayKey = "2026-07-16"
        let after = EventFilter.apply(
            sel, to: [today, tomorrow], favorites: [], now: now, year: 2026, isCurrentYear: true)
        #expect(after.map(\.id) == ["today", "tomorrow"])
    }

    @Test func expandingTheWindowStartAddsEarlierDays() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        let yesterday = makeEvent(id: "yesterday", start: try Self.at("2026-07-14 18:00:00"))
        let today = makeEvent(id: "today", start: try Self.at("2026-07-15 18:00:00"))

        var sel = FilterSelection(dateScope: .today)
        sel.windowStartDayKey = "2026-07-14"
        let result = EventFilter.apply(
            sel, to: [yesterday, today], favorites: [], now: now, year: 2026, isCurrentYear: true)
        #expect(result.map(\.id) == ["yesterday", "today"])
    }

    @Test func windowExpansionStillRespectsTheWeeksStage() throws {
        // The weeks stage is separate and ANDed. Phase 1 does not change that.
        //
        // `inWeek2` sits a full day past the week 1/2 boundary rather than an
        // hour past it: since #257 the weeks stage is day-granular, so an
        // event on the boundary Saturday itself belongs to weeks 1 AND 2 and
        // would be kept by `selectedWeeks: [1]`. That would make this test
        // pass or fail for reasons having nothing to do with window
        // expansion, which is the only thing it exists to check. The `w2`
        // event has to be on a day only week 2 spans.
        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let now = weeks[0].start.addingTimeInterval(3600)
        let inWeek1 = makeEvent(id: "w1", start: now.addingTimeInterval(600))
        let dayAfterBoundary = weeks[1].start.addingTimeInterval(86400 + 3600)
        let inWeek2 = makeEvent(id: "w2", start: dayAfterBoundary)

        var sel = FilterSelection(dateScope: .today, selectedWeeks: [1])
        sel.windowEndDayKey = ChqTime.dayKey(for: dayAfterBoundary)
        let result = EventFilter.apply(
            sel, to: [inWeek1, inWeek2], favorites: [], now: now, year: 2026, isCurrentYear: true)
        #expect(result.map(\.id) == ["w1"])
    }

    /// `EventFilter.apply` picks a cheap season-only `DayWindow.bounds` when
    /// no expansion key is set, and the pricier event-widened
    /// `ViewWindow.navigableBounds` when one is — safe today only because
    /// `EventFilter` reads `window.contains(_:)` and never `startDay`/
    /// `endDay`, the one field `bounds` actually changes for `.all`. Pins
    /// that contract directly, rather than trusting the comment at
    /// `EventFilter.apply`'s call site: the same selection and events must
    /// filter identically no matter which bounds source computed the
    /// window, so the day someone wires `startDay`/`endDay` into
    /// `EventFilter`'s filtering, this goes red instead of silently
    /// drifting.
    @Test func eventFilterOutputIsIdenticalRegardlessOfWhichBoundsSourceComputedTheWindow() throws {
        let now = try Self.at("2026-07-15 15:00:00")
        let inSeason = makeEvent(id: "in", start: try Self.at("2026-07-15 18:00:00"))
        let outOfSeason = makeEvent(id: "out", start: try Self.at("2026-05-01 09:00:00"))
        let events = [inSeason, outOfSeason]
        let sel = FilterSelection(dateScope: .all)

        let seasonOnlyBounds = DayWindow.bounds(year: 2026, starredDays: [])
        let eventWidenedBounds = ViewWindow.navigableBounds(year: 2026, events: events, starredDays: [])
        // If these happened to be equal, the test below couldn't tell the
        // two bounds sources apart.
        #expect(seasonOnlyBounds != eventWidenedBounds)

        let seasonOnlyWindow = try #require(ViewWindow.make(
            selection: sel, events: events, now: now, year: 2026, isCurrentYear: true,
            bounds: seasonOnlyBounds))
        let eventWidenedWindow = try #require(ViewWindow.make(
            selection: sel, events: events, now: now, year: 2026, isCurrentYear: true,
            bounds: eventWidenedBounds))

        // The day projection genuinely differs between the two bounds
        // sources...
        #expect(seasonOnlyWindow.startDay != eventWidenedWindow.startDay)
        // ...but `.all`'s instant range does not, so `contains(_:)` — the
        // only thing `EventFilter` reads — agrees regardless of which
        // bounds source computed the window.
        #expect(seasonOnlyWindow.range == eventWidenedWindow.range)

        let viaApply = EventFilter.apply(
            sel, to: events, favorites: [], now: now, year: 2026, isCurrentYear: true)
        let viaEventWidenedWindow = events.filter { eventWidenedWindow.contains($0.start) }
        #expect(viaApply.map(\.id) == viaEventWidenedWindow.map(\.id))
    }
}
