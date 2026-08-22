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

    /// CIE L*a*b* and ΔE*ab, for the one question WCAG's ratio cannot
    /// answer: how different two *fills* look.
    ///
    /// WCAG's ratio is a luminance ratio, designed for text on a background,
    /// and it is blind to hue — two colours of the same lightness and wildly
    /// different hue compute ≈1:1 and look nothing alike, which is why a bare
    /// ratio floor is a weak guard between two large adjacent fills. ΔE*ab
    /// (CIE 1976) is the cheap, standard perceptual distance that does
    /// account for hue and chroma. `theDeltaEHelperCatchesTheKnownCollision`
    /// below proves this implementation can fail before anything relies on
    /// it, the same way `DayChipContrastTests` proves `Contrast.ratio`.
    enum Perceptual {
        /// D65 white point, matching the sRGB assets these tests read.
        private static let whitePoint = (x: 0.95047, y: 1.0, z: 1.08883)

        private static func components(_ color: UIColor) -> (Double, Double, Double) {
            var r: CGFloat = 0
            var g: CGFloat = 0
            var b: CGFloat = 0
            var a: CGFloat = 0
            color.getRed(&r, green: &g, blue: &b, alpha: &a)
            func linearize(_ channel: CGFloat) -> Double {
                let c = Double(channel)
                return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
            }
            return (linearize(r), linearize(g), linearize(b))
        }

        static func lab(_ color: UIColor) -> (l: Double, a: Double, b: Double) {
            let (r, g, b) = components(color)
            let x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
            let y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
            let z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b
            func f(_ t: Double) -> Double {
                let delta = 6.0 / 29.0
                return t > pow(delta, 3) ? pow(t, 1.0 / 3.0) : t / (3 * delta * delta) + 4.0 / 29.0
            }
            let fx = f(x / whitePoint.x)
            let fy = f(y / whitePoint.y)
            let fz = f(z / whitePoint.z)
            return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))
        }

        static func deltaE(_ first: UIColor, _ second: UIColor) -> Double {
            let a = lab(first)
            let b = lab(second)
            return ((a.l - b.l) * (a.l - b.l) + (a.a - b.a) * (a.a - b.a)
                + (a.b - b.b) * (a.b - b.b)).squareRoot()
        }

        /// How far apart a colour's most and least intense sRGB channels are,
        /// on 0…255 — a blunt but adequate stand-in for "is this saturated?"
        /// at the lightnesses this rail uses. A neutral grey is near 0; the
        /// accent-derived `DayChipSelected` is far from it.
        static func channelSpread(_ color: UIColor) -> Double {
            var r: CGFloat = 0
            var g: CGFloat = 0
            var b: CGFloat = 0
            var a: CGFloat = 0
            color.getRed(&r, green: &g, blue: &b, alpha: &a)
            let channels = [Double(r), Double(g), Double(b)].map { $0 * 255 }
            return (channels.max() ?? 0) - (channels.min() ?? 0)
        }
    }

    /// Prove the ΔE helper can fail before trusting it, using the one
    /// collision this project has actually seen on a screen: the palette
    /// #256 started from put `WeekBandEnd` at `#5A7794`, and in dark mode the
    /// week-9 band and the `DayChipSelected` chip below it read as a single
    /// shape — the chip appeared to have grown a flag.
    @Test func theDeltaEHelperCatchesTheKnownCollision() throws {
        let selected = try resolvedAssetColor(named: "DayChipSelected", style: .dark)
        let historicalBandEnd = UIColor(red: 0x5A / 255.0, green: 0x77 / 255.0,
                                        blue: 0x94 / 255.0, alpha: 1)
        #expect(Perceptual.deltaE(historicalBandEnd, selected) < Self.minimumSeparation)
        #expect(Perceptual.deltaE(historicalBandEnd, selected) > 0)
    }

    /// The perceptual floor between any band fill and `DayChipSelected`.
    ///
    /// **Measured at both ends, not picked off a standard.** WCAG's 3:1
    /// non-text guidance is a *luminance* ratio and there is no room for one
    /// here: in dark mode the ramp is boxed between `DayChipSelected`'s own
    /// lightness above it (L 0.138) and near-black below, because a fill any
    /// lighter would fail AA against the white `WEEK n` label on it (the
    /// ceiling is L 0.183) and a fill any darker would vanish into the rail.
    /// The most the current palette holds on the luminance ratio is 1.211:1,
    /// so raising *that* number is not available — the strengthening went
    /// into this ΔE floor and `theBandIsNeutralAndOnlyTheSelectedChipIsNot`
    /// instead, both of which fail the historical collision that 1.2:1 only
    /// barely caught.
    ///
    /// 10 sits between what is known to fail (ΔE 7.70, the `#5A7794` above)
    /// and what the palette holds (ΔE 11.54 at its worst, `WeekBandEnd`
    /// dark). It is a tight gate on purpose: this is the one pair of colours
    /// on this rail that has already merged once.
    private static let minimumSeparation = 10.0

    /// The band's fill must not be mistakable for the selected chip's, which
    /// is the only saturated fill on the rail and the only thing that means
    /// "you are here." A band segment sits directly above its own chip, so
    /// two fills of the same tone merge into one shape and the selected chip
    /// grows a flag.
    @Test(arguments: [UIUserInterfaceStyle.light, .dark])
    func theRampNeverCollidesWithTheSelectedChipsFill(style: UIUserInterfaceStyle) throws {
        let selected = try resolvedAssetColor(named: "DayChipSelected", style: style)
        let selectedLuminance = Contrast.relativeLuminance(of: selected)
        // Whichever side of the accent's lightness the ramp starts on, it
        // must stay there. A ramp that straddled it would put some week at
        // the accent's exact lightness, where the two fills differ in hue
        // alone — invisible in greyscale, and to a reader with the matching
        // colour-vision deficiency.
        let startIsLighter = Contrast.relativeLuminance(
            of: try resolvedAssetColor(named: "WeekBandStart", style: style)) > selectedLuminance

        for name in ["WeekBandStart", "WeekBandEnd"] {
            let fill = try resolvedAssetColor(named: name, style: style)
            let separation = Perceptual.deltaE(fill, selected)
            #expect(
                separation >= Self.minimumSeparation,
                "\(name) and DayChipSelected are only ΔE \(separation) apart in \(style)")
            #expect(
                (Contrast.relativeLuminance(of: fill) > selectedLuminance) == startIsLighter,
                "\(name) crosses DayChipSelected's lightness in \(style)")
            // Kept as a cheap backstop on the ΔE floor above, at the only
            // value the palette can hold — see `minimumSeparation`.
            let ratio = Contrast.ratio(fill, selected)
            #expect(ratio > 1.2, "\(name) and DayChipSelected are only \(ratio):1 apart in \(style)")
        }
    }

    /// The design rule the ramp's whole colour choice rests on, stated as an
    /// assertion rather than left in a comment: `DayChipSelected` is the only
    /// saturated fill on the rail, and the band is neutral. That is what lets
    /// a band segment and a selected chip sit 2pt apart at similar lightness
    /// without merging — and re-tinting the ramp back toward the accent is
    /// the exact change that caused #256's one real collision.
    @Test(arguments: [UIUserInterfaceStyle.light, .dark])
    func theBandIsNeutralAndOnlyTheSelectedChipIsNot(style: UIUserInterfaceStyle) throws {
        let selectedSpread = Perceptual.channelSpread(
            try resolvedAssetColor(named: "DayChipSelected", style: style))
        #expect(
            selectedSpread >= 40,
            "DayChipSelected is no longer a saturated fill in \(style) (spread \(selectedSpread))")
        for name in ["WeekBandStart", "WeekBandEnd"] {
            let spread = Perceptual.channelSpread(
                try resolvedAssetColor(named: name, style: style))
            #expect(
                spread <= 24,
                "\(name) is not a neutral fill in \(style) (channel spread \(spread))")
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
