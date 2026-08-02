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

    // MARK: - overflow gate (short, heavily-filtered result sets)
    //
    // Reproduces the oscillation a human partner found on a physical
    // device: filtering to ~6 events left the content barely taller than
    // the viewport. Collapsing gave back more height than the content
    // actually needed, `List` clamped `contentOffset` back toward the top,
    // that clamp read as a genuine scroll-up to offset 0, and the
    // `clamped <= 0` branch force-expanded again — collapse, clamp,
    // expand, forever, with the last event unreachable.

    @Test func insufficientOverflowNeverCollapses() {
        // Content is only 60pt taller than the viewport; collapsing gives
        // back 100pt (the `minimumOverflowToCollapse: 100` used here),
        // which would swallow the overflow entirely. The offset alone
        // clears the threshold, but the bar must stay expanded anyway.
        let result = FilterBarCollapse.next(
            isCollapsed: false, offset: 40, pivot: 0, overflow: 60, minimumOverflowToCollapse: 100)
        #expect(result.isCollapsed == false)
        #expect(result.pivot == 0)
    }

    @Test func overflowExactlyAtTheMinimumDoesNotCollapse() {
        // The comparison is strict (`>`, not `>=`): overflow precisely
        // equal to the minimum would leave zero spare room, still enough
        // to sit right at the clamp edge.
        let result = FilterBarCollapse.next(
            isCollapsed: false, offset: 40, pivot: 0, overflow: 100, minimumOverflowToCollapse: 100)
        #expect(result.isCollapsed == false)
        #expect(result.pivot == 0)
    }

    @Test func sufficientOverflowCollapsesAsBefore() {
        // Comfortably more overflow than the minimum — the ordinary case,
        // behaving exactly as it did before this parameter existed.
        let result = FilterBarCollapse.next(
            isCollapsed: false, offset: 40, pivot: 0, overflow: 500, minimumOverflowToCollapse: 100)
        #expect(result.isCollapsed)
        #expect(result.pivot == 40)
    }

    @Test func alreadyCollapsedDoesNotReExpandWhenOverflowShrinks() {
        // Asymmetric by design: the overflow gate only guards the
        // expanded-to-collapsed transition. Once collapsed, a shrunk
        // overflow (well under the minimum) must not force a re-expand —
        // only scrolling up / reaching the top does, same as before this
        // parameter existed. Re-checking every frame while collapsed would
        // reintroduce the exact flip this parameter exists to prevent.
        //
        // offset/pivot are kept small (well inside the ~10pt of overflow
        // this scenario has) so the *bottom clamp* added below can't also
        // explain a "stays collapsed" result — an offset/pivot of, say,
        // 300 with only 10pt of overflow isn't a physically reachable
        // scroll position to begin with, and would rightly get corrected
        // by the clamp instead. This test isolates the gate alone.
        let result = FilterBarCollapse.next(
            isCollapsed: true, offset: 5, pivot: 5, overflow: 10, minimumOverflowToCollapse: 100)
        #expect(result.isCollapsed)
        #expect(result.pivot == 5)
    }

    @Test func defaultOverflowParametersNeverBlockCollapse() {
        // Callers that don't pass overflow/minimumOverflowToCollapse at
        // all (every pre-existing test above) must see the exact old
        // behavior — the gate defaults to a no-op.
        let result = FilterBarCollapse.next(isCollapsed: false, offset: 40, pivot: 0)
        #expect(result.isCollapsed)
        #expect(result.pivot == 40)
    }

    // MARK: - bottom clamp (rubber-band overscroll at the end of the list)
    //
    // A second human-partner repro, same root cause family: a list that
    // genuinely overflows (no short-content gate involved) still flickers
    // show/hide/show/hide right at the bottom. Overscrolling past the true
    // end and bouncing back is `threshold`+ points of *apparent* scroll-up,
    // which expands the bar; settling back down re-crosses the threshold
    // and collapses it again. The existing top clamp (`max(offset, 0)`)
    // already excludes the equivalent top-of-list case; these tests cover
    // the equivalent ceiling at the bottom (`validMax = max(0, overflow) +
    // insetTop`).

    @Test func offsetBeyondValidMaxClampsToValidMax() {
        // overflow: 200, insetTop: 0 -> validMax = 200. 60pt of bottom
        // overscroll (260) must produce the exact same result as resting
        // right at the true end (200) with no overscroll at all.
        let overscrolled = FilterBarCollapse.next(
            isCollapsed: false, offset: 260, pivot: 0, overflow: 200, insetTop: 0)
        let atValidMax = FilterBarCollapse.next(
            isCollapsed: false, offset: 200, pivot: 0, overflow: 200, insetTop: 0)
        #expect(overscrolled.isCollapsed == atValidMax.isCollapsed)
        #expect(overscrolled.pivot == atValidMax.pivot)
    }

    @Test func bottomBounceDoesNotFlipAnAlreadyCollapsedBar() {
        // The exact sequence a human partner reproduced on a physical
        // device: already collapsed and scrolled to the true end of a
        // long, genuinely-overflowing list, overscroll 80pt past it, then
        // bounce back down to exactly the true end. `isCollapsed` must
        // hold `true` across all three steps -- without the clamp, step 3
        // reads as scrolling up from the inflated peak the overscroll left
        // in `pivot`, which crosses the un-collapse threshold and expands.
        let overflow: CGFloat = 2000

        var state = FilterBarCollapse.next(
            isCollapsed: true, offset: 2000, pivot: 2000, overflow: overflow, insetTop: 0)
        #expect(state.isCollapsed)

        state = FilterBarCollapse.next(
            isCollapsed: state.isCollapsed, offset: 2080, pivot: state.pivot,
            overflow: overflow, insetTop: 0)
        #expect(state.isCollapsed)

        state = FilterBarCollapse.next(
            isCollapsed: state.isCollapsed, offset: 2000, pivot: state.pivot,
            overflow: overflow, insetTop: 0)
        #expect(state.isCollapsed)
    }
}
