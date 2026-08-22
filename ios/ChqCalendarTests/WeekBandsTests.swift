import Foundation
import Testing
@testable import ChqCalendar

/// 2026 season: week 1 is Sat Jun 27 12:00 -> Sat Jul 4 12:00, so Jun 27
/// opens week 1 and Jul 4 is the week 1 / week 2 boundary.
struct WeekBandsTests {
    private func segments(_ keys: [String]) -> [WeekBandSegment] {
        WeekBands.segments(dayKeys: keys, year: 2026)
    }

    @Test func aBoundarySaturdayBelongsToBothItsWeeks() {
        let result = segments(["2026-07-04"])
        #expect(result.count == 1)
        #expect(result[0].weekNumbers == [1, 2])
    }

    @Test func aMidweekDayBelongsToOneWeek() {
        let result = segments(["2026-06-30"])
        #expect(result[0].weekNumbers == [1])
    }

    @Test func theOpeningSaturdayBelongsOnlyToWeekOne() {
        // No previous week to share with.
        let result = segments(["2026-06-27"])
        #expect(result[0].weekNumbers == [1])
    }

    @Test func anOutOfSeasonDayHasNoWeek() {
        let result = segments(["2026-01-15"])
        #expect(result[0].weekNumbers.isEmpty)
        #expect(result[0].navigationTarget == nil)
        #expect(result[0].labelledWeek == nil)
    }

    @Test func aSharedSaturdayIsNotATapTarget() {
        // Ambiguous by construction: it opens one week and closes another,
        // so a tap on it cannot mean one week. The six non-shared days
        // carry the week's navigation instead.
        let result = segments(["2026-07-04"])
        #expect(result[0].navigationTarget == nil)
    }

    @Test func aNonSharedDayNavigatesToItsOwnWeek() {
        let result = segments(["2026-06-30"])
        #expect(result[0].navigationTarget == 1)
    }

    @Test func theOpeningSaturdayOfWeekOneIsATapTarget() {
        // Week 1's opening Saturday is shared with nothing, so unlike every
        // other Saturday it is unambiguous.
        let result = segments(["2026-06-27"])
        #expect(result[0].navigationTarget == 1)
    }

    @Test func exactlyOneDayPerWeekCarriesTheLabel() {
        let keys = ChqTime.dayKeys(from: "2026-06-27", through: "2026-07-11")
        let result = segments(keys)
        let labelledForWeekOne = result.filter { $0.labelledWeek == 1 }
        let labelledForWeekTwo = result.filter { $0.labelledWeek == 2 }
        #expect(labelledForWeekOne.count == 1)
        #expect(labelledForWeekTwo.count == 1)
    }

    @Test func theLabelNeverLandsOnASharedSaturday() {
        let keys = ChqTime.dayKeys(from: "2026-06-27", through: "2026-08-29")
        for segment in segments(keys) where segment.labelledWeek != nil {
            #expect(segment.weekNumbers.count == 1)
        }
    }

    @Test func theLabelFollowsTheVisibleRunWhenAWeekIsClipped() {
        // The rail spans navigableBounds, which can start mid-week. The
        // label must land inside what is actually rendered, not at a fixed
        // offset from a week start that may not be on screen at all.
        let keys = ChqTime.dayKeys(from: "2026-07-01", through: "2026-07-03")
        let result = segments(keys)
        let labelled = result.filter { $0.labelledWeek == 1 }
        #expect(labelled.count == 1)
        #expect(keys.contains(labelled[0].dayKey))
        // A fixed "first index" placement would also pass the assertions
        // above (index 0 is inside the visible run) without actually
        // proving the label follows the visible run. With a 3-day run,
        // pin it away from both ends so a naive "always index 0" (or
        // "always last") implementation is caught.
        #expect(labelled[0].dayKey != keys.first)
        #expect(labelled[0].dayKey != keys.last)
    }

    @Test func rampRunsZeroToOneAcrossTheSeason() {
        let first = segments(["2026-06-29"])[0]   // week 1
        #expect(first.rampSteps == [0.0])

        let weeks = SeasonCalendar.weeks(forYear: 2026)
        let lastWeek = weeks[weeks.count - 1]
        let midLastWeek = lastWeek.start.addingTimeInterval(2 * 24 * 60 * 60)
        let last = segments([ChqTime.dayKey(for: midLastWeek)])[0]
        #expect(last.rampSteps == [1.0])
    }

    @Test func aSharedSaturdayCarriesBothRampSteps() {
        let result = segments(["2026-07-04"])
        #expect(result[0].rampSteps.count == 2)
        #expect(result[0].rampSteps[0] < result[0].rampSteps[1])
    }

    @Test func openingDayKeyIsTheSaturdayThatStartsTheWeek() {
        #expect(WeekBands.openingDayKey(ofWeek: 1, year: 2026) == "2026-06-27")
        #expect(WeekBands.openingDayKey(ofWeek: 2, year: 2026) == "2026-07-04")
    }

    @Test func openingDayKeyRefusesAWeekOutsideTheSeason() {
        #expect(WeekBands.openingDayKey(ofWeek: 0, year: 2026) == nil)
        #expect(WeekBands.openingDayKey(ofWeek: 10, year: 2026) == nil)
    }
}

/// Where a band tap lands (#256 review fix).
///
/// These three branches used to live inside a private `EventListView` method
/// and could not be reached from a unit test at all — and because the UI
/// fixture's week-5 opening Saturday has events, only the happy path ever
/// ran. `WeekBands.navigationTarget` is the same decision as a pure
/// function, which is also what gives `WeekBandSegmentView` the reachability
/// signal it needs to dim a week it cannot reach.
///
/// 2026 season: week 5 opens Sat 2026-07-25 and closes Sat 2026-08-01, which
/// it shares with week 6.
struct WeekBandNavigationTargetTests {
    private let season = "2026-06-01"..."2026-09-30"

    private func target(_ week: Int, _ eventDays: [String],
                        bounds: ClosedRange<String>? = nil) -> String? {
        WeekBands.navigationTarget(
            week: week, year: 2026, eventDays: eventDays,
            bounds: bounds ?? season)
    }

    @Test func theOpeningSaturdayWinsWhenItHasEvents() {
        #expect(target(5, ["2026-07-25", "2026-07-28"]) == "2026-07-25")
    }

    @Test func anEmptyOpeningSaturdayFallsBackToTheWeeksFirstDayWithEvents() {
        // Fallback 1. The rail never announces a destination it cannot
        // reach, so an empty opening Saturday is not a legal landing.
        #expect(target(5, ["2026-07-28", "2026-07-30"]) == "2026-07-28")
    }

    @Test func theFallbackTakesTheWeeksEarliestDayNotTheListsFirst() {
        // `NavMatching.eventDays` spans the whole rail, not one week, and it
        // is documented as sorted ascending — which is what lets the fallback
        // stop at the first match. What it must not do is stop at the first
        // element: 07-20 is in week 4.
        #expect(target(5, ["2026-07-20", "2026-07-28", "2026-07-30"]) == "2026-07-28")
    }

    @Test func aWeekWithNothingReachableHasNoTarget() {
        // Fallback 2, the one the band renders as disabled. Days on either
        // side of week 5, none inside it.
        #expect(target(5, ["2026-07-20", "2026-08-05"]) == nil)
    }

    @Test func theSharedSaturdayCountsForBothOfItsWeeks() {
        // Day-granular membership: Sat 2026-08-01 closes week 5 and opens
        // week 6, so it is reachable from either band.
        #expect(target(5, ["2026-08-01"]) == "2026-08-01")
        #expect(target(6, ["2026-08-01"]) == "2026-08-01")
    }

    @Test func aWeekOutsideTheSeasonHasNoTarget() {
        #expect(target(0, ["2026-07-25"]) == nil)
        #expect(target(10, ["2026-07-25"]) == nil)
    }

    @Test func daysOutsideTheRailsBoundsAreNotLegalTargets() {
        // `AppModel.goToDay` refuses a day past `navigableBounds`, so a
        // target outside them would be announced and then declined.
        let clamped = "2026-07-28"..."2026-09-30"
        #expect(target(5, ["2026-07-25", "2026-07-29"], bounds: clamped) == "2026-07-29")
    }

    @Test func aWeekEntirelyOutsideTheBoundsIsUnreachable() {
        let clamped = "2026-08-10"..."2026-09-30"
        #expect(target(5, ["2026-07-25"], bounds: clamped) == nil)
    }
}

/// What VoiceOver reads for a week band (#256 review fix).
///
/// Design A4 specified a label naming the *destination* — "Go to Week 6,
/// opens Saturday June 27, 84 events" — never the direction, which is this
/// rail's established convention. The band shipped announcing a bare
/// "Week 6" with no button trait at all.
struct WeekBandDestinationTests {
    private let season = "2026-06-01"..."2026-09-30"

    private func destinations(
        _ eventDays: [String], counts: [String: Int] = [:],
        includingYear: Bool = false
    ) -> [Int: WeekBandDestination] {
        WeekBands.destinations(
            year: 2026, eventDays: eventDays, bounds: season,
            countsByDay: counts, includingYear: includingYear)
    }

    @Test func theOpeningSaturdayIsNamedAsOpeningTheWeek() {
        let result = destinations(["2026-07-25"], counts: ["2026-07-25": 84])
        #expect(result[5]?.dayKey == "2026-07-25")
        #expect(result[5]?.accessibilityLabel
            == "Go to Week 5, opens Saturday, July 25, 84 events")
    }

    @Test func aFallbackDayDoesNotClaimToOpenTheWeek() {
        // Saying "opens" here would be a small lie about where the reader is
        // being put down.
        let result = destinations(["2026-07-28"], counts: ["2026-07-28": 1])
        #expect(result[5]?.accessibilityLabel
            == "Go to Week 5, first events Tuesday, July 28, 1 event")
    }

    @Test func anUnreachableWeekIsAbsentFromTheMap() {
        let result = destinations(["2026-07-28"])
        #expect(result[5] != nil)
        #expect(result[1] == nil)
        #expect(result[9] == nil)
    }

    @Test func anUnreachableWeekIsStatedAsAFactNotOfferedAsADestination() {
        // Mirrors `MyDayChipContent`'s empty chip ("Sunday, August 16, no
        // events"), which also never says "Go to".
        #expect(WeekBands.unreachableLabel(week: 6) == "Week 6, no events")
    }

    @Test func anArchivedSeasonSaysWhichYear() {
        let result = destinations(["2026-07-25"], counts: ["2026-07-25": 3],
                                  includingYear: true)
        #expect(result[5]?.accessibilityLabel.contains("2026") == true)
    }

    @Test func theBatchFormAgreesWithTheSingleWeekForm() {
        // The dimmed band and the refused tap read the batch form; the tap
        // handler reads the single-week form. They must not be able to
        // disagree about which weeks are reachable.
        let eventDays = ["2026-06-30", "2026-07-28", "2026-07-30", "2026-08-20"]
        let batch = destinations(eventDays)
        for week in 1...9 {
            let single = WeekBands.navigationTarget(
                week: week, year: 2026, eventDays: eventDays, bounds: season)
            let message = "week \(week): batch \(String(describing: batch[week]?.dayKey)) "
                + "vs single \(String(describing: single))"
            #expect(batch[week]?.dayKey == single, Comment(rawValue: message))
        }
    }
}

/// Where the band's painted run breaks (#256 review fix).
///
/// The rule the *look* of the band rests on: every chip is the same distance
/// from the next, so a band drawn strictly chip-by-chip is a row of identical
/// bars with identical gaps and a week's extent is invisible. Bridging the
/// gutters inside a week makes each week one continuous run, and then the one
/// surviving break — the seam through the Saturday two weeks share — is the
/// only gap in the band. These tests pin *where* the runs break; the
/// screenshot is what proves it reads.
struct WeekBandRunTests {
    private func segments(_ keys: [String]) -> [WeekBandSegment] {
        WeekBands.segments(dayKeys: keys, year: 2026)
    }

    private func bridges(_ keys: [String]) -> [Bool] {
        let all = segments(keys)
        return (0..<max(all.count - 1, 0)).map {
            WeekBandRun.bridgesGutter(after: $0, in: all)
        }
    }

    @Test func everyGutterInsideAWeekIsBridged() {
        // Sun through Fri of week 2 — six days, five gutters, none of them a
        // boundary. If any of these came back false the week would be drawn
        // in pieces and the boundary would stop being the only break.
        let keys = ["2026-07-05", "2026-07-06", "2026-07-07",
                    "2026-07-08", "2026-07-09", "2026-07-10"]
        #expect(bridges(keys) == [true, true, true, true, true])
    }

    @Test func aBoundarySaturdayBridgesBothWays() {
        // Sat Jul 4 closes week 1 and opens week 2, so it joins the run on
        // each side and the break goes *through* it rather than beside it —
        // which is also what makes the split fill read as "this day is in
        // both" instead of as a third colour wedged between two weeks.
        let keys = ["2026-07-03", "2026-07-04", "2026-07-05"]
        #expect(bridges(keys) == [true, true])

        let saturday = segments(["2026-07-04"])[0]
        #expect(saturday.weekNumbers == [1, 2])
        #expect(saturday.rampSteps.count == 2)
    }

    @Test func aRunEndsAtTheSeasonsEdge() {
        // Thu/Fri before the season, then the opening Saturday. Nothing to
        // share, so the run starts flush with week 1's first chip instead of
        // bleeding into empty rail.
        let keys = ["2026-06-25", "2026-06-26", "2026-06-27", "2026-06-28"]
        #expect(bridges(keys) == [false, false, true])
    }

    @Test func twoOutOfSeasonDaysNeverBridge() {
        #expect(bridges(["2026-01-15", "2026-01-16"]) == [false])
    }

    @Test func theEndsOfTheArrayHaveNoGutterToBridge() {
        let all = segments(["2026-07-06", "2026-07-07"])
        #expect(WeekBandRun.bridgesGutter(after: -1, in: all) == false)
        #expect(WeekBandRun.bridgesGutter(after: 1, in: all) == false)
        #expect(WeekBandRun.bridgesGutter(after: 5, in: all) == false)
    }

    /// Hand-built segments, isolated from `WeekBands.segments`, pinning the
    /// exact case a `first == first` comparison would get wrong (#258
    /// review fix): a shared Saturday's second week number, matched against
    /// the *first* (only) entry of its neighbour on that side.
    private func segment(_ key: String, _ weeks: [Int]) -> WeekBandSegment {
        WeekBandSegment(
            dayKey: key, weekNumbers: weeks, rampSteps: weeks.map { Double($0) },
            navigationTarget: nil, labelledWeek: nil)
    }

    @Test func aSharedSaturdaysSecondWeekNumberStillBridges() {
        // Left is the boundary Saturday, [5, 6]; right is plain week 6.
        // `first == first` compares 5 to 6 and misses the match that is
        // actually there in the second slot.
        let left = segment("2026-07-25", [5, 6])
        let right = segment("2026-07-26", [6])
        #expect(WeekBandRun.bridgesGutter(after: 0, in: [left, right]) == true)
    }

    @Test func aSharedSaturdaysFirstWeekNumberStillBridgesOnTheOtherSide() {
        // Mirror of the above: the shared Saturday is now on the right,
        // and the match is in its *first* slot against the plain week
        // before it — `first == first` would get this one right by luck,
        // but only the direct-comparison form gets both sides right.
        let left = segment("2026-07-24", [5])
        let right = segment("2026-07-25", [5, 6])
        #expect(WeekBandRun.bridgesGutter(after: 0, in: [left, right]) == true)
    }

    @Test func disjointWeekNumbersNeverBridgeEvenWithTwoEntries() {
        // No shared entry at all — the negative case a same-cardinality
        // comparison must still get right.
        let left = segment("2026-07-25", [5, 6])
        let right = segment("2026-08-01", [7, 8])
        #expect(WeekBandRun.bridgesGutter(after: 0, in: [left, right]) == false)
    }
}
