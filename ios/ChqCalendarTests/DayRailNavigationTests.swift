import Foundation
import Testing
@testable import ChqCalendar

/// The Swift half of a rule set the web already ships
/// (`frontend/src/app/dayRailNavigation.ts`). Where the two must agree, the
/// test names say so — a divergence here is a cross-platform behaviour bug,
/// not a local preference.
struct DayRailNavigationTests {
    private let bounds = "2026-06-27"..."2026-08-23"

    private func window(_ start: String, _ end: String) -> ViewWindow {
        let from = ChqTime.parse("\(start) 00:00:00")!
        let through = ChqTime.parse("\(ChqTime.day(end, offsetBy: 1)!) 00:00:00")!
        return ViewWindow(startDay: start, endDay: end, range: from..<through)
    }

    // MARK: - plan

    @Test func aTargetInsideTheWindowIsAScrollAndNothingElse() throws {
        let plan = try #require(DayRailNavigation.plan(
            target: "2026-07-15", window: window("2026-07-10", "2026-07-20"), bounds: bounds))

        #expect(plan.expandStart == nil)
        #expect(plan.expandEnd == nil)
        #expect(plan.scrollTo == "2026-07-15")
    }

    @Test func aTargetBeforeTheWindowGrowsTheStartEdgeToIt() throws {
        let plan = try #require(DayRailNavigation.plan(
            target: "2026-07-01", window: window("2026-07-10", "2026-07-20"), bounds: bounds))

        #expect(plan.expandStart == "2026-07-01")
        #expect(plan.expandEnd == nil)
    }

    @Test func aTargetAfterTheWindowGrowsTheEndEdgeToIt() throws {
        let plan = try #require(DayRailNavigation.plan(
            target: "2026-08-01", window: window("2026-07-10", "2026-07-20"), bounds: bounds))

        #expect(plan.expandStart == nil)
        #expect(plan.expandEnd == "2026-08-01")
    }

    /// The window only ever grows, so one tap never expands both edges. If it
    /// did, the scope button — the thing that shrinks the window back — would
    /// be the only way out of a window the reader widened by accident.
    @Test func noSingleTapEverExpandsBothEdges() throws {
        for target in ["2026-06-27", "2026-07-15", "2026-08-23"] {
            let plan = try #require(DayRailNavigation.plan(
                target: target, window: window("2026-07-10", "2026-07-20"), bounds: bounds))
            #expect(plan.expandStart == nil || plan.expandEnd == nil)
        }
    }

    /// Refusing is honest: clamping would move the window to an edge and then
    /// scroll to a day that is not there.
    @Test func aTargetOutsideTheNavigableBoundsIsRefused() {
        #expect(DayRailNavigation.plan(
            target: "2026-06-01", window: window("2026-07-10", "2026-07-20"), bounds: bounds) == nil)
        #expect(DayRailNavigation.plan(
            target: "2026-09-30", window: window("2026-07-10", "2026-07-20"), bounds: bounds) == nil)
    }

    /// A scope that resolves to no window at all cannot be rescued by
    /// expansion — `ViewWindow.make` returns nil out of `base` before it ever
    /// reads the expansion inputs. Announcing a destination and then doing
    /// nothing is the exact class of defect the web branch spent three
    /// findings removing.
    @Test func aNilWindowRefusesEveryTap() {
        #expect(DayRailNavigation.plan(
            target: "2026-07-15", window: nil, bounds: bounds) == nil)
    }

    // MARK: - shouldAbandonScroll

    @Test func aPendingScrollIsAbandonedOnceTheWindowCoversItsTarget() {
        // The expansion landed and the day still has no section, which means
        // it has no matching events — an ordinary empty day, not a commit
        // still in flight.
        #expect(DayRailNavigation.shouldAbandonScroll(
            target: "2026-07-15", window: window("2026-07-10", "2026-07-20")))
    }

    @Test func aPendingScrollWaitsWhileTheExpansionHasNotLandedYet() {
        #expect(!DayRailNavigation.shouldAbandonScroll(
            target: "2026-08-01", window: window("2026-07-10", "2026-07-20")))
    }

    @Test func aPendingScrollIsAbandonedWhenThereIsNoWindowToLandIn() {
        #expect(DayRailNavigation.shouldAbandonScroll(target: "2026-07-15", window: nil))
    }

    // MARK: - shouldAbandonScroll(rendered:) — #254

    /// The pre-growth render: the update that consumes a day deep link can
    /// run against a day list built before `goToDay` grew the window. With
    /// the window stamped onto that same list, the rule sees the *pre-growth*
    /// window, which does not cover the target — so the scroll keeps
    /// waiting for the grown render instead of being dropped as an "empty
    /// day". This is the exact one-render disagreement #250 guarded around.
    @Test func aRenderBuiltBeforeTheWindowGrewKeepsItsPendingScroll() {
        let preGrowth = RenderedDays(
            days: [
                DayGroup(dayKey: "2026-07-10", title: "Friday, July 10", weekNumbers: [2], events: []),
            ],
            window: window("2026-07-10", "2026-07-20"))

        #expect(!DayRailNavigation.shouldAbandonScroll(
            target: "2026-08-21", rendered: preGrowth))
    }

    /// The post-growth render: the stamped window covers the target and the
    /// list built from that same window still has no section for it — an
    /// ordinary empty day, so the wait ends.
    @Test func aRenderWhoseWindowCoversTheTargetWithNoSectionAbandons() {
        let postGrowth = RenderedDays(
            days: [
                DayGroup(dayKey: "2026-07-10", title: "Friday, July 10", weekNumbers: [2], events: []),
            ],
            window: window("2026-07-10", "2026-08-21"))

        #expect(DayRailNavigation.shouldAbandonScroll(
            target: "2026-08-21", rendered: postGrowth))
    }

    /// Same rule as the window overload: no window to land in ends the wait.
    @Test func aRenderWithNoWindowAbandons() {
        let rendered = RenderedDays(days: [], window: nil)
        #expect(DayRailNavigation.shouldAbandonScroll(target: "2026-07-15", rendered: rendered))
    }

    // MARK: - stepTargets

    /// A chevron steps to the nearest day that has something to show, not the
    /// adjacent calendar day. With Favourites on, or any search that leaves
    /// gaps, the adjacent day usually has no matches: no section mounts, the
    /// pending scroll gives up, and the anchor never moves. Pressing again
    /// recomputes the identical dead target — the initiative's own wall,
    /// rebuilt inside the control meant to escape it.
    @Test func aStepSkipsDaysWithNothingToShow() {
        // A second, farther day above the anchor (07-20) is deliberate: with
        // only one day above the anchor, dropping the stepTargets `next ==
        // nil` guard has nothing to overwrite `next` with and this test
        // cannot tell the nearest day apart from the guard being gone.
        let days = ["2026-07-01", "2026-07-05", "2026-07-09", "2026-07-20"]
        let step = DayRailNavigation.stepTargets(anchor: "2026-07-05", eventDays: days)

        #expect(step.previous == "2026-07-01")
        #expect(step.next == "2026-07-09")
    }

    @Test func aStepFromAnAnchorWithNothingBeyondItReturnsNil() {
        let days = ["2026-07-01", "2026-07-05"]
        let step = DayRailNavigation.stepTargets(anchor: "2026-07-05", eventDays: days)

        #expect(step.previous == "2026-07-01")
        #expect(step.next == nil)
    }

    @Test func aStepWithNoAnchorHasNoTargets() {
        let step = DayRailNavigation.stepTargets(
            anchor: nil, eventDays: ["2026-07-01", "2026-07-05"])

        #expect(step.previous == nil)
        #expect(step.next == nil)
    }

    /// The anchor itself is neither the previous nor the next target, even
    /// though it is in `eventDays`. A step that returns where you already are
    /// is a dead control.
    @Test func theAnchorIsNeverItsOwnStepTarget() {
        let days = ["2026-07-01", "2026-07-05", "2026-07-09"]
        let step = DayRailNavigation.stepTargets(anchor: "2026-07-05", eventDays: days)

        #expect(step.previous != "2026-07-05")
        #expect(step.next != "2026-07-05")
    }

    // MARK: - edgeTargets

    @Test func edgeTargetsNameTheNearestEventDayBeyondEachEdge() {
        let days = ["2026-07-01", "2026-07-05", "2026-07-15", "2026-08-01", "2026-08-10"]
        let edges = DayRailNavigation.edgeTargets(
            eventDays: days, window: window("2026-07-10", "2026-07-20"))

        #expect(edges.earlier == "2026-07-05")
        #expect(edges.later == "2026-08-01")
    }

    @Test func edgeTargetsAreNilWhenTheWindowAlreadyReachesTheEnds() {
        let days = ["2026-07-15"]
        let edges = DayRailNavigation.edgeTargets(
            eventDays: days, window: window("2026-06-27", "2026-08-23"))

        #expect(edges.earlier == nil)
        #expect(edges.later == nil)
    }

    // MARK: - eventDays

    @Test func eventDaysAreSortedUniqueAndInInstitutionTime() throws {
        let events = [
            makeEvent(id: "b", start: try #require(ChqTime.parse("2026-07-15 19:00:00"))),
            makeEvent(id: "a", start: try #require(ChqTime.parse("2026-07-15 09:00:00"))),
            makeEvent(id: "c", start: try #require(ChqTime.parse("2026-07-01 09:00:00"))),
        ]

        #expect(DayRailNavigation.eventDays(events) == ["2026-07-01", "2026-07-15"])
    }

    // MARK: - reachableTodayKey

    /// Off-season, today is outside the navigable bounds for roughly ten
    /// months of the year, and `plan` refuses a target outside them. An
    /// unclamped today would render a "Now" button that is visible, enabled,
    /// and does nothing.
    @Test func todayIsReachableOnlyInsideTheNavigableBounds() {
        #expect(DayRailNavigation.reachableTodayKey("2026-07-15", bounds: bounds) == "2026-07-15")
        #expect(DayRailNavigation.reachableTodayKey("2026-02-01", bounds: bounds) == nil)
        #expect(DayRailNavigation.reachableTodayKey(nil, bounds: bounds) == nil)
    }
}
