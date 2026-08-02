import CoreGraphics
import Testing
@testable import ChqCalendar

struct FilterBarCollapseTests {
    @Test func staysExpandedForJitterBelowTheThreshold() {
        let result = FilterBarCollapse.next(isCollapsed: false, offset: 30, pivot: 0)
        #expect(result.isCollapsed == false)
        #expect(result.pivot == 0)
    }

    @Test func collapsesOnceTheThresholdIsReached() {
        let result = FilterBarCollapse.next(isCollapsed: false, offset: 40, pivot: 0)
        #expect(result.isCollapsed)
        #expect(result.pivot == 40)
    }

    @Test func whileCollapsedThePivotTracksTheDeepestPoint() {
        let result = FilterBarCollapse.next(isCollapsed: true, offset: 300, pivot: 40)
        #expect(result.isCollapsed)
        #expect(result.pivot == 300)
    }

    @Test func aShortScrollBackUpDoesNotExpand() {
        let result = FilterBarCollapse.next(isCollapsed: true, offset: 270, pivot: 300)
        #expect(result.isCollapsed)
        #expect(result.pivot == 300)
    }

    @Test func scrollingBackUpPastTheThresholdExpands() {
        let result = FilterBarCollapse.next(isCollapsed: true, offset: 260, pivot: 300)
        #expect(result.isCollapsed == false)
        #expect(result.pivot == 260)
    }

    @Test func reachingTheTopAlwaysExpands() {
        let result = FilterBarCollapse.next(isCollapsed: true, offset: 0, pivot: 900)
        #expect(result.isCollapsed == false)
        #expect(result.pivot == 0)
    }

    @Test func rubberBandOverscrollIsTreatedAsTheTop() {
        let result = FilterBarCollapse.next(isCollapsed: true, offset: -80, pivot: 900)
        #expect(result.isCollapsed == false)
        #expect(result.pivot == 0)
    }

    @Test func expandedPivotFollowsUpwardScrollSoTheNextCollapseIsMeasuredFresh() {
        // Expanded at 260 after scrolling up; continuing up to 100 must move
        // the pivot down, or a later 140pt downward scroll would not collapse.
        let result = FilterBarCollapse.next(isCollapsed: false, offset: 100, pivot: 260)
        #expect(result.isCollapsed == false)
        #expect(result.pivot == 100)
    }

    @Test func customThresholdOverridesTheDefault() {
        // With threshold: 10 (not the default 40), 8pt of travel stays under
        // it and 10pt reaches it — values that would both stay expanded
        // under the default 40pt threshold, pinning that the parameter is
        // actually honored rather than a `next(...)` call site always
        // implicitly using 40.
        let underThreshold = FilterBarCollapse.next(isCollapsed: false, offset: 8, pivot: 0, threshold: 10)
        #expect(underThreshold.isCollapsed == false)
        #expect(underThreshold.pivot == 0)

        let atThreshold = FilterBarCollapse.next(isCollapsed: false, offset: 10, pivot: 0, threshold: 10)
        #expect(atThreshold.isCollapsed)
        #expect(atThreshold.pivot == 10)
    }
}
