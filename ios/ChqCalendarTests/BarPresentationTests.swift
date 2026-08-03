import Testing
import CoreGraphics
@testable import ChqCalendar

struct BarPresentationTests {
    @Test func startsExpanded() {
        let bar = BarPresentation()
        #expect(bar.state == .expanded)
    }

    @Test func smallScrollDownDoesNotCompact() {
        var bar = BarPresentation()
        _ = bar.received(offset: 0, insetTop: 0)
        #expect(bar.received(offset: 20, insetTop: 0) == nil)
        #expect(bar.state == .expanded)
    }

    @Test func accumulatedScrollDownPastThresholdCompacts() {
        var bar = BarPresentation()
        _ = bar.received(offset: 0, insetTop: 0)
        #expect(bar.received(offset: 20, insetTop: 0) == nil)
        #expect(bar.received(offset: 45, insetTop: 0) == .compact)
        #expect(bar.state == .compact)
    }

    @Test func repeatedDownwardSamplesAfterCompactingReturnNil() {
        var bar = BarPresentation()
        _ = bar.received(offset: 0, insetTop: 0)
        _ = bar.received(offset: 100, insetTop: 0)
        #expect(bar.state == .compact)
        #expect(bar.received(offset: 200, insetTop: 0) == nil)
        #expect(bar.received(offset: 300, insetTop: 0) == nil)
    }

    @Test func scrollingBackUpPastThresholdExpands() {
        var bar = BarPresentation()
        _ = bar.received(offset: 0, insetTop: 0)
        _ = bar.received(offset: 400, insetTop: 0)
        #expect(bar.state == .compact)
        #expect(bar.received(offset: 380, insetTop: 0) == nil)
        #expect(bar.received(offset: 355, insetTop: 0) == .expanded)
    }

    @Test func directionChangeResetsAccumulation() {
        var bar = BarPresentation()
        _ = bar.received(offset: 0, insetTop: 0)
        // 30 down — not enough.
        #expect(bar.received(offset: 30, insetTop: 0) == nil)
        // 10 up — resets the downward accumulation.
        #expect(bar.received(offset: 20, insetTop: 0) == nil)
        // 30 down again is only 30 from the reversal point, still not enough.
        #expect(bar.received(offset: 50, insetTop: 0) == nil)
        #expect(bar.state == .expanded)
    }

    @Test func reachingTheTopForcesExpandedRegardlessOfAccumulation() {
        var bar = BarPresentation()
        _ = bar.received(offset: 0, insetTop: 0)
        _ = bar.received(offset: 500, insetTop: 0)
        #expect(bar.state == .compact)
        // A jump straight to the top (scroll-to-top tap) expands immediately,
        // without needing `threshold` points of upward travel first.
        #expect(bar.received(offset: 0, insetTop: 0) == .expanded)
    }

    @Test func rubberBandAboveTheTopIsTreatedAsTheTop() {
        var bar = BarPresentation()
        _ = bar.received(offset: 0, insetTop: 0)
        _ = bar.received(offset: 500, insetTop: 0)
        #expect(bar.received(offset: -60, insetTop: 0) == .expanded)
    }

    @Test func topIsMeasuredAgainstTheContentInsetNotZero() {
        // A List under a nav bar reports a negative resting offset equal to
        // -insetTop; that resting position is "the top", not offset 0.
        var bar = BarPresentation()
        _ = bar.received(offset: -140, insetTop: 140)
        _ = bar.received(offset: 400, insetTop: 140)
        #expect(bar.state == .compact)
        #expect(bar.received(offset: -140, insetTop: 140) == .expanded)
    }

    @Test func firstSampleNeverChangesState() {
        // Nothing to compare against yet, so no delta can be computed.
        var bar = BarPresentation()
        #expect(bar.received(offset: 900, insetTop: 0) == nil)
        #expect(bar.state == .expanded)
    }

    @Test func lastOffsetStaysCorrectAcrossTopOfListPath() {
        // The top-of-list branch returns early via defer { lastOffset = offset },
        // ensuring the reference point updates even on early return. This test
        // verifies that path is load-bearing: if lastOffset assignment moved to
        // the fall-through only, the post-top sample would compute delta against
        // a stale offset, preventing the expected state change.
        var bar = BarPresentation()
        _ = bar.received(offset: 0, insetTop: 0)
        // Scroll down to compact.
        _ = bar.received(offset: 100, insetTop: 0)
        #expect(bar.state == .compact)
        // Return to top.
        _ = bar.received(offset: 0, insetTop: 0)
        #expect(bar.state == .expanded)
        // Scroll down again to compact.
        _ = bar.received(offset: 50, insetTop: 0)
        #expect(bar.state == .compact)
        // Return to top again.
        _ = bar.received(offset: 0, insetTop: 0)
        #expect(bar.state == .expanded)
        // Scroll down 40 points. With correct lastOffset (0), delta is 40,
        // which meets the threshold and compacts. With stale lastOffset (50),
        // delta is -10, which doesn't reach the -40 threshold to re-expand.
        #expect(bar.received(offset: 40, insetTop: 0) == .compact)
        #expect(bar.state == .compact)
    }
}
