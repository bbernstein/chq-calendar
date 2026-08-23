import SwiftUI
import Testing
import UIKit
@testable import ChqCalendar

/// Both end controls are the same chrome around a different glyph since they
/// were unified into `DayRailEndControlLabel`, so measuring that chrome with
/// each real symbol covers `EventListView.nowButton` and both directions of
/// `MyDayExpandControl`.
///
/// `nonisolated`, at file scope rather than on the test type:
/// `@Test(arguments:)` evaluates its argument list outside the actor, so
/// neither a `@MainActor` type nor this module's default main-actor isolation
/// can hold it.
private nonisolated let endControlSymbols = ["arrow.clockwise", "chevron.left", "chevron.right"]

/// Pins the day rail's Dynamic Type behaviour by *measuring the real views*
/// instead of by `performAccessibilityAudit` (#261) — the same move
/// `DayChipContrastTests` made for contrast, for the same reason, and against
/// the same wall.
///
/// **Why the audit could not do this job.** `DayRailAccessibilityUITests` ran
/// `.dynamicType` over the rail and, on every attempt of every run, reported
/// only issues whose element carried an empty `identifier` — all of which its
/// own filter then dropped as unattributable. Three defects injected into app
/// code (a chip narrowed to a fixed width, `day-rail-now`'s minimum
/// frame made fixed, its font made non-scaling) all passed. The reason is
/// structural, and it covers the whole rail rather than just the chips:
///
/// - A **chip**'s three `Text` runs sit inside a `Button` (`DayChip.body` —
///   the alternative, a hidden visual layer under a `Color.clear` tap target,
///   was tried and reverted because it broke tap delivery after a drag), which
///   collapses them into one accessibility node. The audit cannot attribute a
///   finding to an individual run.
/// - A **week-band segment** collapses the same way, via
///   `WeekBandSegmentView`'s `.accessibilityElement()`.
/// - The **end controls** present *no text at all*: both are icon-only
///   (`Label(…).labelStyle(.iconOnly)` on the Events tab,
///   `Image(systemName:)` on My Day). A Dynamic Type audit measures text, so
///   there is nothing on either control for it to look at.
///
/// That last point is what the audit's own doc comment used to get wrong: it
/// justified keeping `.dynamicType` by saying the check still covered "the end
/// controls, whose single-`Text` buttons don't collapse multiple runs." There
/// are no `Text`s on those buttons. `.dynamicType` therefore had no addressable
/// text anywhere on the rail, which is why it could not fail.
///
/// **What replaces it.** A hosted measurement has none of that ambiguity: a
/// `UIHostingController` renders the actual view at an actual
/// `dynamicTypeSize` and reports the size it actually takes. Every assertion
/// below is a property the app's own comments already claim, and none of them
/// was verified anywhere until now.
///
/// **What this does NOT gate, stated plainly** so the file is not read as
/// wider coverage than it is: the text style chosen for an individual `Text`
/// *inside* the chip. SwiftUI's `Font` is opaque — it cannot be inspected —
/// and `chipVisual`/`countLine` are private, so there is no seam at which to
/// measure one line on its own. A change from `.font(.subheadline)` to
/// `.font(.system(size: 15))` on the middle line would shrink the chip's
/// growth without stopping it, and nothing here would fail. The chip's
/// *container* behaviour — that it grows, and that it widens to hold longer
/// text rather than clipping it — is what is gated, and that is where every
/// defect this rail has actually shipped has lived (see `DayChip.body` and
/// `DayRailEndControlLabel`'s comments, all of them frame or fill decisions).
@MainActor
struct DayRailDynamicTypeTests {

    // MARK: - Measurement

    /// The size the view actually takes when rendered at `size`, from a real
    /// hosting controller — not a computation over the fonts the view is
    /// *believed* to use. That distinction is the whole point: the audit's
    /// failure here was that it inspected a description of the view, and this
    /// measures the view.
    private func measure(_ view: some View, at size: DynamicTypeSize) -> CGSize {
        let host = UIHostingController(rootView: view.dynamicTypeSize(size))
        return host.sizeThatFits(
            in: CGSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude))
    }

    /// A chip with real content, built through `MyDayChipContent`'s own
    /// initializer so the lines measured are the lines the rail renders.
    private func chip(dateLine: String = "Jul 15", count: Int = 3) -> DayChip {
        DayChip(
            dayKey: "2026-07-15",
            content: MyDayChipContent(
                topLine: "Wed",
                dateLine: dateLine,
                count: count,
                symbol: nil,
                isToday: false,
                accessibilityLabel: "Wednesday, July 15, \(count) events"),
            isSelected: false,
            isDisabled: false,
            action: {})
    }

    private func endControl(_ symbol: String) -> some View {
        DayRailEndControlLabel { Image(systemName: symbol) }
    }

    /// The bare glyph the chrome has to hold, drawn in the chrome's own font
    /// (`DayRailEndControl.iconFont`, not a copy of it).
    private func endControlGlyph(_ symbol: String) -> some View {
        Image(systemName: symbol).font(DayRailEndControl.iconFont)
    }

    // MARK: - The chip grows with Dynamic Type

    /// The chip must be strictly larger at the largest text size than at the
    /// smallest, in both axes.
    ///
    /// End-to-end rather than step-by-step for width, because width genuinely
    /// does not move for most of the ladder: `.frame(minWidth: 58)` plus 10pt
    /// of horizontal padding pins it at 78pt all the way to `.accessibility1`,
    /// and only past there does the text outgrow the minimum. A per-step
    /// "strictly wider" assertion would be false on today's correct code.
    @Test func theChipIsLargerAtTheLargestTextSizeThanTheSmallest() {
        let smallest = measure(chip(), at: .xSmall)
        let largest = measure(chip(), at: .accessibility5)

        #expect(
            largest.width > smallest.width,
            "chip width did not grow: \(smallest.width) → \(largest.width)")
        #expect(
            largest.height > smallest.height,
            "chip height did not grow: \(smallest.height) → \(largest.height)")
    }

    /// …and it must never *shrink* on the way there. A frame that grows and
    /// then caps out mid-ladder still passes the end-to-end check above if the
    /// cap sits above the smallest size; this is what notices it.
    @Test func theChipNeverShrinksAsTheTextSizeRises() {
        var previous = measure(chip(), at: DynamicTypeSize.allCases[0])
        for size in DynamicTypeSize.allCases.dropFirst() {
            let current = measure(chip(), at: size)
            #expect(
                current.width >= previous.width,
                "chip width shrank at \(size): \(previous.width) → \(current.width)")
            #expect(
                current.height >= previous.height,
                "chip height shrank at \(size): \(previous.height) → \(current.height)")
            previous = current
        }
    }

    /// Falsification: the check above must actually catch a fixed frame, which
    /// is the defect shape every one of this rail's real Dynamic Type bugs has
    /// had. Constraining the *real* chip from outside reproduces it exactly —
    /// and this is the injection #261 proved the accessibility audit passes.
    @Test func aFixedFrameStopsTheChipGrowingAndIsCaught() {
        let pinned = chip().frame(width: 78, height: 66)
        let smallest = measure(pinned, at: .xSmall)
        let largest = measure(pinned, at: .accessibility5)

        #expect(
            largest.width == smallest.width && largest.height == smallest.height,
            "a fixed frame must not grow, or this self-check proves nothing")
    }

    // MARK: - The chip holds its text rather than clipping it

    /// A longer date line must make the chip wider — at *every* text size.
    ///
    /// This is the clipping guard, and it needs no access to `chipVisual`'s
    /// internals: a chip that widens to fit its content is a chip that is not
    /// truncating it. A fixed width collapses the two measurements onto each
    /// other, which is what the falsification below relies on.
    @Test func theChipWidensToHoldALongerDateLineAtEveryTextSize() {
        for size in DynamicTypeSize.allCases {
            let short = measure(chip(dateLine: "Jul 1"), at: size)
            let long = measure(chip(dateLine: "September 30"), at: size)
            #expect(
                long.width > short.width,
                "chip did not widen for longer text at \(size): \(short.width) vs \(long.width)")
        }
    }

    /// Falsification for the check above, using the same fixed-width defect
    /// that made `.textClipped` fire in the UI audit (#261's probe) — proving
    /// this measurement sees it too, without needing a simulator app launch.
    @Test func aFixedWidthHidesLongerTextAndIsCaught() {
        let short = measure(chip(dateLine: "Jul 1").frame(width: 32), at: .large)
        let long = measure(chip(dateLine: "September 30").frame(width: 32), at: .large)

        #expect(
            long.width == short.width,
            "a fixed-width chip must not widen for longer text, or this self-check proves nothing")
    }

    // MARK: - The empty count line keeps pace with a populated one

    /// `DayChip.countLine` reserves the empty case's height with a
    /// `@ScaledMetric(relativeTo: .caption2)`, and its doc comment claims that
    /// keeps an empty chip the same height as a populated one "at every text
    /// size, not just the default." Nothing verified that claim until now, and
    /// it is exactly the kind a plain `14` would silently break: the two
    /// heights would still match at the default size and drift apart only for
    /// the readers who need the scaling.
    ///
    /// A band rather than equality, because the two are never exactly equal:
    /// the empty line reserves a whole scaled line box while a populated one is
    /// sized by its glyphs, so an empty chip runs consistently taller. The gap
    /// is not uniform across the ladder either — it is about 1% for the
    /// non-accessibility sizes up to `.large`, jumps to a peak of 5.0% at
    /// `.xLarge`, then falls back toward 2% through `.accessibility5` as the
    /// chip's total height grows faster than the gap does. 8% clears that peak
    /// with room to spare; `theBandIsNarrowerThanTheDefectItGuardsAgainst`
    /// below is what keeps it from being merely permissive.
    private static let countLineHeightBand = 0.08

    @Test func anEmptyChipTracksAPopulatedOnesHeightAtEveryTextSize() {
        for size in DynamicTypeSize.allCases {
            let empty = measure(chip(count: 0), at: size).height
            let populated = measure(chip(count: 3), at: size).height
            #expect(
                abs(empty - populated) / populated < Self.countLineHeightBand,
                "empty and populated chip heights diverged at \(size): \(empty) vs \(populated)")
        }
    }

    /// Falsification: the band must be narrower than the divergence the real
    /// defect produces, or it proves nothing.
    ///
    /// The defect is specific — `countLineHeight` written as a plain `14`
    /// instead of `@ScaledMetric(relativeTo: .caption2)` — so rather than
    /// standing in a proxy mismatch, this reconstructs it. `@ScaledMetric` is
    /// `UIFontMetrics.scaledValue(for:)` under the environment's content size
    /// category, so subtracting the scaled reservation the empty chip really
    /// used and adding back the unscaled 14 gives the height that chip would
    /// have had with the defect in place. That height must fall outside the
    /// band at the largest text size, where it matters most.
    @Test func theBandIsNarrowerThanTheDefectItGuardsAgainst() {
        let traits = UITraitCollection(preferredContentSizeCategory: .accessibilityExtraExtraExtraLarge)
        let scaledReservation = UIFontMetrics(forTextStyle: .caption2)
            .scaledValue(for: 14, compatibleWith: traits)

        let empty = measure(chip(count: 0), at: .accessibility5).height
        let populated = measure(chip(count: 3), at: .accessibility5).height
        let withDefect = empty - scaledReservation + 14

        #expect(
            scaledReservation > 14,
            "caption2 must scale at accessibility5, or this reconstruction is not the defect")
        #expect(
            abs(withDefect - populated) / populated >= Self.countLineHeightBand,
            "an unscaled 14pt reservation must fall outside the band (would be \(withDefect) against \(populated)), or the band proves nothing")
    }

    // MARK: - The end controls never clip their glyph

    /// The property `DayRailEndControlLabel`'s comment actually claims — "a
    /// fixed frame clipped the glyph at large Dynamic Type sizes" — is that the
    /// chrome is always at least as big as the glyph inside it. Not that it
    /// *grows*: it does not. The 62pt height minimum is never exceeded by any
    /// of these symbols, and the 44pt width minimum is only exceeded by
    /// `arrow.clockwise`, at `.accessibility4` and above. A growth assertion
    /// would be false on correct code; this one is the real invariant.
    ///
    /// It is also live rather than vacuous: at `.accessibility5` the
    /// `arrow.clockwise` glyph measures ≈52.3×61.7 inside a 44×62 minimum — it
    /// has already outgrown the width minimum outright, and clears the height
    /// minimum by about a third of a point.
    @Test(arguments: endControlSymbols)
    func theEndControlChromeAlwaysHoldsItsGlyph(symbol: String) {
        for size in DynamicTypeSize.allCases {
            let chrome = measure(endControl(symbol), at: size)
            let glyph = measure(endControlGlyph(symbol), at: size)
            #expect(
                chrome.width >= glyph.width,
                "\(symbol) chrome is narrower than its glyph at \(size): \(chrome.width) < \(glyph.width)")
            #expect(
                chrome.height >= glyph.height,
                "\(symbol) chrome is shorter than its glyph at \(size): \(chrome.height) < \(glyph.height)")
        }
    }

    /// Falsification, and the one that matters most here: this is defect #2
    /// from #261 — `day-rail-now`'s `.frame(minWidth: 44, minHeight: 62)` made
    /// fixed, the exact defect the code comment says an on-device audit once
    /// caught, and which the automated audit was proven to pass. Pinned to
    /// 44×62, the chrome is narrower than the `arrow.clockwise` glyph at
    /// `.accessibility5`, and the check above fails.
    @Test func aFixedEndControlFrameClipsTheGlyphAndIsCaught() {
        let pinned = endControlGlyph("arrow.clockwise").frame(width: 44, height: 62)
        let chrome = measure(pinned, at: .accessibility5)
        let glyph = measure(endControlGlyph("arrow.clockwise"), at: .accessibility5)

        #expect(
            chrome.width < glyph.width,
            "a fixed 44pt width must clip the Now glyph at accessibility5 (glyph \(glyph.width) vs frame \(chrome.width)), or this self-check proves nothing")
    }

    /// The default-size rendering `DayRailEndControlLabel`'s comment states as
    /// fact — "at the default text size these render at exactly 44x62" — and
    /// which nothing checked. It is load-bearing for layout: 62pt is chosen to
    /// match `DayChip`'s own height so the strip's ends line up with its chips.
    @Test(arguments: endControlSymbols)
    func theEndControlIsFortyFourBySixtyTwoAtTheDefaultTextSize(symbol: String) {
        let size = measure(endControl(symbol), at: .large)

        #expect(size.width == 44, "expected 44pt wide at the default text size, measured \(size.width)")
        #expect(size.height == 62, "expected 62pt tall at the default text size, measured \(size.height)")
    }
}
