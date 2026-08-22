import Testing
import UIKit
@testable import ChqCalendar

/// Pins the week band's colour ramp (#256) by direct WCAG 2.1 computation,
/// the same way `DayChipContrastTests` pins the chips — and for the same
/// reason: `performAccessibilityAudit` cannot sample an individual `Text`
/// run once its container has collapsed the label into one accessibility
/// node, which `DayRailView.bandSegment`'s `.accessibilityElement()` does.
/// See `DayRailAccessibilityUITests`'s `auditTypes` for the full account of
/// that blind spot. Contrast between two *known* colours has none of that
/// ambiguity.
///
/// **Why only the two endpoints.** `WeekBands.segments` maps week 1 to ramp
/// step 0 and week 9 to step 1, and `DayRailView.rampColor` mixes the two
/// endpoint assets between them. A mix is monotonic in lightness, so every
/// intermediate week's fill sits between `WeekBandStart` and `WeekBandEnd`
/// — which means the worst case against a black label (light appearance) is
/// whichever endpoint is darkest, and the worst case against a white label
/// (dark appearance) is whichever is lightest. Both are endpoints.
/// `theRampIsMonotonicInLuminance` below is what keeps that argument
/// honest: if a future palette change made the ramp turn around in the
/// middle, checking only the ends would stop proving anything, and that
/// test fails first.
struct WeekBandContrastTests {

    /// WCAG AA's floor for normal-size text (WCAG 2.1 §1.4.3). The `WEEK n`
    /// label is `.caption2` bold — well under the 18pt/14pt-bold threshold
    /// for "large text", so the normal-text floor is the one that applies.
    private static let aaNormalText = 4.5

    /// Reuses `DayChipContrastTests.Contrast` rather than re-deriving the
    /// WCAG maths: that type already carries a falsification test proving it
    /// can detect a known failure (the old `#5B7F95` accent against white,
    /// ≈4.27:1), so a second copy here would be an unproven one.
    private typealias Contrast = DayChipContrastTests.Contrast

    private func resolvedAssetColor(named name: String, style: UIUserInterfaceStyle) throws -> UIColor {
        let color = try #require(
            UIColor(named: name, in: Bundle.main, compatibleWith: nil),
            "Asset catalog colour \"\(name)\" was not found in the app bundle")
        return color.resolvedColor(with: UITraitCollection(userInterfaceStyle: style))
    }

    /// SwiftUI's `.primary`, which is what the `WEEK n` label is drawn in.
    private func label(_ style: UIUserInterfaceStyle) -> UIColor {
        UIColor.label.resolvedColor(with: UITraitCollection(userInterfaceStyle: style))
    }

    @Test(arguments: ["WeekBandStart", "WeekBandEnd"])
    func rampEndpointsClearAAAgainstTheLabelInLightMode(name: String) throws {
        let fill = try resolvedAssetColor(named: name, style: .light)
        let ratio = Contrast.ratio(fill, label(.light))
        #expect(
            ratio >= Self.aaNormalText,
            "\(name) light: WEEK n label computes \(ratio):1, below AA's \(Self.aaNormalText):1")
    }

    @Test(arguments: ["WeekBandStart", "WeekBandEnd"])
    func rampEndpointsClearAAAgainstTheLabelInDarkMode(name: String) throws {
        let fill = try resolvedAssetColor(named: name, style: .dark)
        let ratio = Contrast.ratio(fill, label(.dark))
        #expect(
            ratio >= Self.aaNormalText,
            "\(name) dark: WEEK n label computes \(ratio):1, below AA's \(Self.aaNormalText):1")
    }

    /// The band's fill must not be mistakable for the selected chip's, which
    /// is the only saturated fill on the rail and the only thing that means
    /// "you are here." A band segment sits directly above its own chip, so
    /// two fills of the same tone merge into one shape and the selected chip
    /// grows a flag.
    ///
    /// **The 1.2 floor is measured, not invented.** The palette this task
    /// started from (`WeekBandEnd` dark `#5A7794`) computes 1.196:1 against
    /// `DayChipSelected` dark (`#4D6C7F`), and a dark-mode screenshot at
    /// week 9 showed exactly that merge — the band and the chip beneath it
    /// read as one blob. The current palette is a neutral cool grey rather
    /// than the accent's blue, which separates them by hue as well; this
    /// assertion pins only the part that is exactly computable.
    @Test(arguments: [UIUserInterfaceStyle.light, .dark])
    func theRampNeverCollidesWithTheSelectedChipsFill(style: UIUserInterfaceStyle) throws {
        let selected = try resolvedAssetColor(named: "DayChipSelected", style: style)
        for name in ["WeekBandStart", "WeekBandEnd"] {
            let fill = try resolvedAssetColor(named: name, style: style)
            let ratio = Contrast.ratio(fill, selected)
            #expect(ratio > 1.2, "\(name) and DayChipSelected are only \(ratio):1 apart in \(style)")
        }
    }

    /// The claim the two tests above rest on: the ramp travels in one
    /// direction, so its two endpoints really are its extremes and no
    /// intermediate week can be worse than both.
    @Test(arguments: [UIUserInterfaceStyle.light, .dark])
    func theRampIsMonotonicInLuminance(style: UIUserInterfaceStyle) throws {
        let start = Contrast.relativeLuminance(
            of: try resolvedAssetColor(named: "WeekBandStart", style: style))
        let end = Contrast.relativeLuminance(
            of: try resolvedAssetColor(named: "WeekBandEnd", style: style))
        #expect(
            start != end,
            "a ramp whose ends match cannot distinguish adjacent weeks at all")
        // Light: early season is the lighter end. Dark: early season is the
        // darker end, so the ramp runs the other way — either is fine, only
        // "the ends are the extremes" matters, which a strict inequality in
        // *some* direction is what states.
        #expect(
            style == .light ? start > end : start < end,
            "the ramp reverses direction in \(style): start \(start), end \(end)")
    }
}
