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

    // MARK: - headroom gate (a collapse must never move the content)
    //
    // Hiding the secondary rows hands ~100pt back to the list, which
    // shortens its scrollable range by the same ~100pt. If the list sits
    // within that distance of its bottom, the scroll view must clamp
    // `contentOffset` to stay in range — a real upward scroll, which reads
    // as the user scrolling up, expands the bar, lengthens the range, and
    // starts over. A human partner hit this on a physical device with a
    // heavily-filtered ~6-event list. The gate refuses the collapse in
    // exactly the cases where the clamp would happen.

    @Test func refusesToCollapseWhenTheContentCannotAbsorbIt() {
        // Only 60pt of range left below the current position; collapsing
        // gives back 100. The offset alone clears the threshold, but the
        // bar must stay expanded.
        let result = FilterBarCollapse.next(
            isCollapsed: false, offset: 40, pivot: 0, validMax: 100, minimumHeadroomToCollapse: 100)
        #expect(result.isCollapsed == false)
        #expect(result.pivot == 0)
    }

    @Test func headroomExactlyAtTheMinimumStillCollapses() {
        // The comparison is `>=`: headroom exactly equal to what the
        // collapse gives back is precisely enough for the content not to
        // move. Callers pass a margin on top (see `EventListView`).
        let result = FilterBarCollapse.next(
            isCollapsed: false, offset: 40, pivot: 0, validMax: 140, minimumHeadroomToCollapse: 100)
        #expect(result.isCollapsed)
        #expect(result.pivot == 40)
    }

    @Test func aLongListCollapsesAsBefore() {
        let result = FilterBarCollapse.next(
            isCollapsed: false, offset: 40, pivot: 0, validMax: 5000, minimumHeadroomToCollapse: 100)
        #expect(result.isCollapsed)
        #expect(result.pivot == 40)
    }

    @Test func theHeadroomGateFollowsThePositionNotJustTheListLength() {
        // The same long list, but scrolled to within 60pt of its bottom:
        // collapsing there would still clamp, so it is still refused. A
        // gate written against total list length rather than remaining
        // headroom would wrongly allow this one.
        let result = FilterBarCollapse.next(
            isCollapsed: false, offset: 4940, pivot: 4880, validMax: 5000,
            minimumHeadroomToCollapse: 100)
        #expect(result.isCollapsed == false)
        #expect(result.pivot == 4880)
    }

    @Test func alreadyCollapsedDoesNotReExpandWhenHeadroomShrinks() {
        // Asymmetric by design: the gate only guards the expanded ->
        // collapsed transition. Once collapsed, vanishing headroom must not
        // force a re-expand — only scrolling up / reaching the top does.
        // Re-checking it every frame while collapsed would reintroduce the
        // exact flip it exists to prevent.
        let result = FilterBarCollapse.next(
            isCollapsed: true, offset: 10, pivot: 10, validMax: 10, minimumHeadroomToCollapse: 100)
        #expect(result.isCollapsed)
        #expect(result.pivot == 10)
    }

    @Test func defaultGeometryParametersNeverBlockCollapse() {
        // Callers that don't pass validMax/minimumHeadroomToCollapse at all
        // (every test above this section) must see the plain offset/pivot
        // behavior — both default to no-ops.
        let result = FilterBarCollapse.next(isCollapsed: false, offset: 40, pivot: 0)
        #expect(result.isCollapsed)
        #expect(result.pivot == 40)
    }

    // MARK: - bottom clamp (rubber-band overscroll at the end of the list)
    //
    // Overscrolling past the true end and bouncing back is `threshold`+
    // points of apparent scroll-up (expand) followed by `threshold`+ points
    // of settling back down (collapse) — a flicker driven entirely by UIKit
    // physics. The existing `max(offset, 0)` floor has always excluded the
    // equivalent case at the top; `validMax` is the matching ceiling.

    @Test func offsetBeyondValidMaxClampsToValidMax() {
        // 60pt of bottom overscroll must produce the exact same result as
        // resting right at the true end with no overscroll at all.
        let overscrolled = FilterBarCollapse.next(
            isCollapsed: false, offset: 260, pivot: 0, validMax: 200)
        let atValidMax = FilterBarCollapse.next(
            isCollapsed: false, offset: 200, pivot: 0, validMax: 200)
        #expect(overscrolled.isCollapsed == atValidMax.isCollapsed)
        #expect(overscrolled.pivot == atValidMax.pivot)
    }

    @Test func bottomBounceDoesNotFlipAnAlreadyCollapsedBar() {
        // Already collapsed and scrolled to the true end of a long list,
        // overscroll 80pt past it, then bounce back to exactly the end.
        // Without the clamp, step 3 reads as scrolling up from the inflated
        // peak the overscroll left in `pivot` and expands the bar.
        var state = FilterBarCollapse.next(
            isCollapsed: true, offset: 2000, pivot: 2000, validMax: 2000)
        #expect(state.isCollapsed)

        state = FilterBarCollapse.next(
            isCollapsed: state.isCollapsed, offset: 2080, pivot: state.pivot, validMax: 2000)
        #expect(state.isCollapsed)

        state = FilterBarCollapse.next(
            isCollapsed: state.isCollapsed, offset: 2000, pivot: state.pivot, validMax: 2000)
        #expect(state.isCollapsed)
    }
}

// MARK: -

/// Geometry-to-decision behavior: which samples the driver trusts, and how
/// many times the bar is allowed to flip while its own collapse animation
/// is perturbing the very geometry the decision reads.
@MainActor
struct FilterBarCollapseDriverTests {
    /// Terser than the memberwise initializer for the long replay sequences
    /// below. Argument order matches the device log's column order.
    private func sample(
        _ contentOffset: CGFloat,
        _ insetTop: CGFloat,
        _ insetBottom: CGFloat,
        _ containerHeight: CGFloat,
        _ contentHeight: CGFloat
    ) -> ScrollGeometrySample {
        ScrollGeometrySample(
            contentOffset: contentOffset,
            insetTop: insetTop,
            insetBottom: insetBottom,
            containerHeight: containerHeight,
            contentHeight: contentHeight)
    }

    /// A settled, expanded iPhone 17 list scrolled `offset` points down, in
    /// the geometry a device actually reports: 874pt container, 330pt top
    /// inset (nav bar + filter bar), 86pt bottom inset (search field + home
    /// indicator).
    private func settledExpanded(offset: CGFloat, contentHeight: CGFloat = 90_000) -> ScrollGeometrySample {
        sample(offset - 330, 330, 86, 874, contentHeight)
    }

    /// The same list once the bar has collapsed — the top inset is 100pt
    /// smaller, which is the whole transition.
    private func settledCollapsed(offset: CGFloat, contentHeight: CGFloat = 90_000) -> ScrollGeometrySample {
        sample(offset - 230, 230, 86, 874, contentHeight)
    }

    /// The same screen with a filter active, which adds `ResetFilterRow` to
    /// the bar: the settled expanded top inset is 380 rather than 330, so
    /// the collapse gives back 150pt rather than 100. Instrumented runs put
    /// every filtered scenario here (`log-B`, `log-C4`, `log-E`, `log-F`)
    /// and only the unfiltered ones at 330.
    private func filteredExpanded(
        offset: CGFloat, contentHeight: CGFloat = 90_000
    ) -> ScrollGeometrySample {
        sample(offset - 380, 380, 86, 874, contentHeight)
    }

    /// The filtered screen collapsed. The reset row is one of the rows the
    /// collapse hides, so this is the same 230 as the unfiltered case.
    private func filteredCollapsed(
        offset: CGFloat, contentHeight: CGFloat = 90_000
    ) -> ScrollGeometrySample {
        sample(offset - 230, 230, 86, 874, contentHeight)
    }

    /// The 26 geometry samples an iPhone 17 emitted between the frame that
    /// collapsed the bar and the first frame after the transition settled,
    /// copied verbatim from an instrumented run.
    ///
    /// They are the reason this driver exists. Frame 1
    /// (`contentOffset: 0, insetTop: 0, containerHeight: 874`) is
    /// self-inconsistent: the list was 53pt down, but under any reading
    /// this frame says it is at the very top, and being at the top
    /// force-expands the bar. Frames 2 onward switch convention entirely —
    /// the inset moves out of `contentInsets` and into `containerSize`, so
    /// `insetTop` reads 0 while `containerHeight` ramps 544 -> 639 as the
    /// bar animates away.
    private var collapseAnimationFrames: [ScrollGeometrySample] {
        [
            sample(0.0, 0.0, 86.0, 874.0, 89_847.3),
            sample(53.3, 0.0, 86.0, 544.0, 89_847.3),
            sample(160.0, 0.0, 86.0, 544.0, 89_847.3),
            sample(160.0, 0.0, 86.0, 544.0, 89_859.7),
            sample(213.3, 0.0, 86.0, 544.0, 89_859.7),
            sample(213.3, 0.0, 86.0, 544.0, 89_876.3),
            sample(240.0, 0.0, 86.0, 544.0, 89_876.3),
            sample(240.0, 0.0, 85.8, 544.7, 89_876.3),
            sample(240.0, 0.0, 86.0, 544.9, 89_876.3),
            sample(253.3, 0.0, 86.0, 544.9, 89_876.3),
            sample(253.3, 0.0, 86.0, 555.3, 89_876.3),
            sample(253.3, 0.0, 86.0, 555.4, 89_888.7),
            sample(306.7, 0.0, 86.0, 555.4, 89_888.7),
            sample(306.7, 0.0, 86.0, 555.4, 89_905.3),
            sample(333.3, 0.0, 86.0, 555.4, 89_905.3),
            sample(333.3, 0.0, 86.0, 582.3, 89_905.3),
            sample(333.3, 0.0, 86.0, 582.1, 89_905.3),
            sample(346.7, 0.0, 86.0, 582.1, 89_905.3),
            sample(373.3, 0.0, 86.0, 582.1, 89_905.3),
            sample(373.3, 0.0, 86.0, 605.7, 89_905.3),
            sample(373.3, 0.0, 86.0, 605.7, 89_934.3),
            sample(386.7, 0.0, 86.0, 605.7, 89_934.3),
            sample(402.3, 0.0, 85.8, 638.7, 89_934.3),
            sample(402.3, 0.0, 86.0, 638.9, 89_934.3),
            sample(452.0, 230.0, 86.0, 874.0, 89_934.3),
            sample(452.0, 230.0, 86.0, 874.0, 89_992.3),
        ]
    }

    // MARK: - sample admissibility

    @Test func theFirstSampleIsNeverActedOn() {
        // "Same viewport as the previous frame" needs a previous frame.
        let driver = FilterBarCollapseDriver(estimatedGiveBack: 100)
        #expect(driver.received(settledExpanded(offset: 500)) == nil)
        #expect(driver.isCollapsed == false)
    }

    @Test func aSteadyDragCollapsesTheBarExactlyOnce() {
        let driver = FilterBarCollapseDriver(estimatedGiveBack: 100)
        var flips = 0
        for offset in stride(from: CGFloat(0), through: 200, by: 10) {
            if driver.received(settledExpanded(offset: offset)) != nil {
                flips += 1
                driver.settled()
            }
        }
        #expect(flips == 1)
        #expect(driver.isCollapsed)
    }

    @Test func anInsetOnlyChangeIsIgnored() {
        // A facet panel opening grows the top inset ~140pt under a list
        // nobody scrolled. The viewport differs from the previous frame, so
        // the sample is inadmissible and the panel is not closed out from
        // under the user by an auto-collapse.
        let driver = FilterBarCollapseDriver(estimatedGiveBack: 100)
        _ = driver.received(settledExpanded(offset: 0))
        #expect(driver.received(settledExpanded(offset: 0)) == nil)

        let panelOpen = sample(-330, 470, 86, 874, 90_000)
        #expect(driver.received(panelOpen) == nil)
        #expect(driver.isCollapsed == false)
    }

    // MARK: - the feedback loop

    @Test func theInconsistentMidAnimationFrameWouldForceTheBarBackOpen() {
        // The frame a device emitted 66ms into a collapse, while the list
        // was really 53pt down: `contentOffset: 0, insetTop: 0`, but a full
        // 874pt container, matching neither the settled convention nor the
        // mid-animation one. Read as a position it says "at the top", and
        // at the top the bar always reopens. That single frame is the
        // flicker, and no threshold can filter it — it is a 53pt lie in
        // both of its terms at once.
        let frame = collapseAnimationFrames[0]
        #expect(frame.offset == 0)

        let result = FilterBarCollapse.next(
            isCollapsed: true, offset: frame.offset, pivot: 53.3,
            validMax: frame.validMax, minimumHeadroomToCollapse: 140)
        #expect(result.isCollapsed == false)
    }

    @Test func theCapturedCollapseAnimationProducesNoFurtherFlips() {
        // All 26 frames of a real collapse transition, replayed after a
        // genuine collapse with `settled()` called where `EventListView`
        // calls it — from the animation's own completion handler, i.e.
        // after the last frame. Zero further flips, not "fewer": every one
        // of those frames is inadmissible, so the bar cannot flip until the
        // transition it started has finished.
        let driver = FilterBarCollapseDriver(estimatedGiveBack: 100)
        _ = driver.received(settledExpanded(offset: 0, contentHeight: 89_835))
        _ = driver.received(settledExpanded(offset: 26.7, contentHeight: 89_847.3))
        #expect(driver.received(settledExpanded(offset: 53.3, contentHeight: 89_847.3)) == true)

        var extraFlips = 0
        for frame in collapseAnimationFrames where driver.received(frame) != nil {
            extraFlips += 1
        }
        #expect(extraFlips == 0)
        #expect(driver.isCollapsed)

        // And the driver is not wedged: once the animation reports
        // completion, genuine scrolling is acted on again — here, scrolling
        // back up past the threshold reopens the bar.
        driver.settled()
        _ = driver.received(settledCollapsed(offset: 452))
        _ = driver.received(settledCollapsed(offset: 460))
        #expect(driver.received(settledCollapsed(offset: 300)) == false)
        #expect(driver.isCollapsed == false)
    }

    @Test func settlingBlocksFramesTheViewportCheckWouldLetThrough() {
        // Isolates the settle gate from the viewport check, which would
        // otherwise mask it. These two frames share a viewport, so the
        // viewport check admits them — but it is the *garbage* viewport
        // SwiftUI reports mid-transition (`insetTop: 0` with a 544pt
        // container), under which the same list reads 330pt further down
        // and its scrollable range 330pt shorter. Acting on them is exactly
        // what a 300ms cooldown would eventually do; the settle gate never
        // does.
        let midAnimation = { (offset: CGFloat) in self.sample(offset, 0, 86, 544, 90_000) }

        let settling = FilterBarCollapseDriver(estimatedGiveBack: 100)
        _ = settling.received(settledExpanded(offset: 0))
        #expect(settling.received(settledExpanded(offset: 400)) == true)
        _ = settling.received(midAnimation(400))
        #expect(settling.received(midAnimation(100)) == nil)
        #expect(settling.isCollapsed)

        // The identical frames, with the gate defeated the way a lapsed
        // cooldown defeats it, do flip the bar.
        let notSettling = FilterBarCollapseDriver(estimatedGiveBack: 100)
        _ = notSettling.received(settledExpanded(offset: 0))
        #expect(notSettling.received(settledExpanded(offset: 400)) == true)
        notSettling.settled()
        _ = notSettling.received(midAnimation(400))
        #expect(notSettling.received(midAnimation(100)) == false)
    }

    @Test func aBottomBounceProducesNoFlips() {
        // Week 6 + Amphitheater, flung into the end of the list, in the
        // geometry the device reported: 2054.3pt of content, 230pt collapsed
        // top inset, 86pt bottom inset — which puts the true bottom at
        // offset 1496.3. The tail of the run overscrolls 83pt past it and
        // decays back, values taken from the instrumented log.
        func collapsed(at offset: CGFloat) -> ScrollGeometrySample {
            sample(offset - 230, 230, 86, 874, 2054.3)
        }

        let driver = FilterBarCollapseDriver(estimatedGiveBack: 100)
        // Scroll down far enough to collapse, then let the transition settle.
        _ = driver.received(sample(0 - 330, 330, 86, 874, 2054.3))
        #expect(driver.received(sample(200 - 330, 330, 86, 874, 2054.3)) == true)
        driver.settled()

        var flips = 0
        let bounce: [CGFloat] = [
            1400, 1496.3, 1520, 1560, 1579, 1560, 1540, 1517.7, 1508.7,
            1503.3, 1499.7, 1498, 1497.3, 1496.3,
        ]
        for offset in bounce where driver.received(collapsed(at: offset)) != nil {
            flips += 1
        }
        #expect(flips == 0)
        #expect(driver.isCollapsed)
    }

    @Test func aBarelyOverflowingListNeverCollapses() {
        // A list whose whole scrollable range is 120pt — less than the 140
        // a collapse needs to leave behind. Swept top to bottom and back,
        // the bar must never flip at all: every collapse it could reach
        // would immediately clamp the content and undo itself.
        let driver = FilterBarCollapseDriver(estimatedGiveBack: 100)
        let contentHeight: CGFloat = 874 - 330 - 86 + 120
        var offsets = Array(stride(from: CGFloat(0), through: 120, by: 10))
        offsets += offsets.reversed()

        var flips = 0
        for offset in offsets {
            let probe = sample(offset - 330, 330, 86, 874, contentHeight)
            if driver.received(probe) != nil { flips += 1 }
        }
        #expect(flips == 0)
        #expect(driver.isCollapsed == false)
    }

    // MARK: - the give-back is measured, not assumed
    //
    // The headroom gate's whole claim is "a collapse never moves the
    // content", and that claim is only as good as the number it is given.
    // A constant cannot be that number: the bar is 100pt taller collapsed
    // with no reset row, 150 with one, ~140pt more again with a facet panel
    // open, and every row scales with Dynamic Type. The driver reads the
    // real figure off the top inset it is already handed.

    @Test func theGiveBackIsUnknownUntilTheBarHasBeenSeenInBothStates() {
        let driver = FilterBarCollapseDriver(estimatedGiveBack: 150, headroomMargin: 40)
        #expect(driver.measuredGiveBack == nil)
        #expect(driver.requiredHeadroom == 190)
    }

    @Test func theGiveBackIsLearnedFromTheInsetDeltaAcrossAFlip() {
        // Deliberately seeded with the *unfiltered* estimate (100 -> 140
        // required, which is what a previous round hardcoded) against
        // filtered geometry, so only measurement can reach the right answer.
        let driver = FilterBarCollapseDriver(estimatedGiveBack: 100, headroomMargin: 40)
        #expect(driver.requiredHeadroom == 140)

        _ = driver.received(filteredExpanded(offset: 0))
        #expect(driver.received(filteredExpanded(offset: 200)) == true)
        driver.settled()
        // First post-settle sample switches viewport (380 -> 230) so it is
        // inadmissible; the second is the one that teaches the driver.
        _ = driver.received(filteredCollapsed(offset: 200))
        _ = driver.received(filteredCollapsed(offset: 210))

        #expect(driver.measuredGiveBack == 150)
        #expect(driver.requiredHeadroom == 190)
    }

    @Test func theLearnedGiveBackRefusesACollapseTheOldConstantWouldHaveAllowed() {
        // Learn 150 on a long filtered list, then meet a short one: 210pt of
        // scrollable range in total, so a collapse at 40pt down leaves 170pt
        // of headroom. 140 admits that and the content is clamped 10pt up
        // -- benign at the default text size, but at accessibility sizes two
        // facet rows plus the reset row exceed 180 and the clamp exceeds the
        // 40pt threshold, which is the short-content oscillation coming back.
        let driver = FilterBarCollapseDriver(estimatedGiveBack: 100, headroomMargin: 40)
        _ = driver.received(filteredExpanded(offset: 0))
        #expect(driver.received(filteredExpanded(offset: 200)) == true)
        driver.settled()
        _ = driver.received(filteredCollapsed(offset: 200))
        _ = driver.received(filteredCollapsed(offset: 210))
        #expect(driver.requiredHeadroom == 190)

        // The measurement describes the bar, not the list, so it survives
        // the list being replaced.
        driver.reset()
        #expect(driver.measuredGiveBack == 150)

        let contentHeight: CGFloat = 874 - 380 - 86 + 210
        var flips = 0
        for offset in stride(from: CGFloat(0), through: 210, by: 10)
        where driver.received(filteredExpanded(offset: offset, contentHeight: contentHeight)) != nil {
            flips += 1
        }
        #expect(flips == 0)
        #expect(driver.isCollapsed == false)

        // And the same geometry under the superseded constant does collapse
        // -- so the assertion above is about the measured number, not about
        // the list being too short for any gate to allow it.
        let underTheOldConstant = FilterBarCollapse.next(
            isCollapsed: false, offset: 40, pivot: 0, validMax: 210,
            minimumHeadroomToCollapse: 140)
        #expect(underTheOldConstant.isCollapsed)
    }

    @Test func anInsetReadMidAnimationNeverPoisonsTheMeasurement() {
        // SwiftUI reports `insetTop: 0` while any inset animates, folding it
        // into `containerSize` instead. Two such frames in a row share a
        // viewport, so the stability rule alone would admit them -- and a 0
        // recorded as "the expanded inset" would compute a *negative*
        // give-back and disable the gate entirely.
        let driver = FilterBarCollapseDriver(estimatedGiveBack: 150, headroomMargin: 40)
        _ = driver.received(sample(400, 0, 86, 544, 90_000))
        _ = driver.received(sample(440, 0, 86, 544, 90_000))
        #expect(driver.measuredGiveBack == nil)
        #expect(driver.requiredHeadroom == 190)
    }

    // MARK: - reset (the list this driver was reading went away)

    @Test func resetUnwedgesADriverWhoseAnimationCompletionNeverRan() {
        // `isSettling` has exactly one other exit: the completion handler of
        // the `withAnimation` the flip started. `AppModel.select(year:)`
        // clears the snapshot for an uncached year, and the filter bar is
        // gated on the snapshot being non-nil, so the animating view can be
        // torn down inside that 0.2s window. If the completion is lost the
        // driver drops every sample for the life of the view and collapse
        // silently stops working for the session.
        let driver = FilterBarCollapseDriver(estimatedGiveBack: 100)
        _ = driver.received(settledExpanded(offset: 0))
        #expect(driver.received(settledExpanded(offset: 200)) == true)

        // No `settled()`. Scrolling back to the very top would normally
        // force the bar open; wedged, it does nothing.
        _ = driver.received(settledCollapsed(offset: 200))
        _ = driver.received(settledCollapsed(offset: 210))
        #expect(driver.received(settledCollapsed(offset: 0)) == nil)
        #expect(driver.isCollapsed)

        driver.reset()
        #expect(driver.isCollapsed == false)
        _ = driver.received(settledExpanded(offset: 0))
        _ = driver.received(settledExpanded(offset: 10))
        #expect(driver.received(settledExpanded(offset: 200)) == true)
    }

    @Test func resetStopsANewListBeingComparedAgainstTheOldListsLastFrame() {
        // The `List` is recreated whenever `EventListView.content` switches
        // branch -- a filter that empties the results and then refills them,
        // a year switch. Same viewport either side, so without a reset the
        // new list's very first sample is diffed against the old list's last
        // and read as a fling nobody performed.
        let driver = FilterBarCollapseDriver(estimatedGiveBack: 100)
        _ = driver.received(settledExpanded(offset: 0))
        _ = driver.received(settledExpanded(offset: 10))

        driver.reset()
        // Same viewport, different list: 600pt further down and a
        // twentieth of the content. Acted on, that reads as a fling nobody
        // performed, and collapses the bar over a list nobody has touched.
        #expect(driver.received(settledExpanded(offset: 610, contentHeight: 5_000)) == nil)
        #expect(driver.isCollapsed == false)

        // From there the new list is tracked on its own terms, its first
        // 40pt of travel measured from its own starting point.
        _ = driver.received(settledExpanded(offset: 0, contentHeight: 5_000))
        _ = driver.received(settledExpanded(offset: 20, contentHeight: 5_000))
        #expect(driver.received(settledExpanded(offset: 60, contentHeight: 5_000)) == true)
    }
}
