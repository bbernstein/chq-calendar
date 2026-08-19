import Testing
import UIKit
@testable import ChqCalendar

/// Pins the day rail's chip contrast by direct WCAG 2.1 computation instead
/// of `performAccessibilityAudit` (accessibility follow-up to #245, third
/// pass — see `DayRailAccessibilityUITests`'s own doc comment for how the
/// audit's coverage was narrowed to make room for this).
///
/// The audit cannot do this job on this screen: `DayChip` wraps its label
/// directly in a `Button` (a hidden visual layer under a separate
/// `Color.clear` tap target was tried instead and reverted — it broke tap
/// delivery after a drag; see `DayChip.body`'s own comment), and once a
/// `Button` collapses its `Text` runs into one accessibility node,
/// `performAccessibilityAudit` can no longer sample them individually. It
/// reports contrast failures against chip text whose real, on-screen pixels
/// measure roughly 18.8:1 (light, unselected) and 17.0:1 (dark, unselected)
/// — false positives produced by the audit's own blind spot, not a real
/// regression.
///
/// Contrast between two *known* colours has none of that ambiguity: it's
/// exactly computable from their asset-catalog values, with no accessibility
/// tree in the way. This test resolves the actual colour pairs the chip
/// renders — `DayChipBackground`/`.label` for an unselected chip's text,
/// `DayChipSelected`/`.white` for a selected chip's text — in both
/// appearances, and checks each against WCAG AA's 4.5:1 floor for
/// normal-size text directly.
struct DayChipContrastTests {

    /// WCAG AA's floor for normal-size text (WCAG 2.1 §1.4.3).
    private static let aaNormalText = 4.5

    // MARK: - WCAG 2.1 contrast maths

    /// WCAG 2.1 relative luminance and contrast ratio, factored out of the
    /// assertions below so the maths itself — not the colours it's applied
    /// to — is what a reader has to check for correctness, and so the same
    /// computation is reused for every pair this file checks rather than
    /// re-derived inline per test.
    enum Contrast {
        /// WCAG 2.1 §1.4.3 relative luminance:
        /// <https://www.w3.org/TR/WCAG21/#dfn-relative-luminance>. Each sRGB
        /// channel is linearized before being weighted — the weights
        /// (0.2126 / 0.7152 / 0.0722) are the formula's own, not a
        /// stand-in, and must not be "simplified" to a plain average.
        static func relativeLuminance(of color: UIColor) -> Double {
            var r: CGFloat = 0
            var g: CGFloat = 0
            var b: CGFloat = 0
            var a: CGFloat = 0
            color.getRed(&r, green: &g, blue: &b, alpha: &a)

            func linearize(_ channel: CGFloat) -> Double {
                let c = Double(channel)
                return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
            }

            return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
        }

        /// WCAG 2.1 §1.4.3 contrast ratio:
        /// <https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio> —
        /// `(L1 + 0.05) / (L2 + 0.05)` with the lighter luminance as `L1`.
        /// Argument order doesn't matter: the lighter of the two is always
        /// picked out here, so a caller never has to know in advance which
        /// of its two colours is lighter.
        static func ratio(_ first: UIColor, _ second: UIColor) -> Double {
            let l1 = relativeLuminance(of: first)
            let l2 = relativeLuminance(of: second)
            let lighter = max(l1, l2)
            let darker = min(l1, l2)
            return (lighter + 0.05) / (darker + 0.05)
        }
    }

    // MARK: - Falsification: prove the helper can actually fail

    /// Before trusting `Contrast.ratio` against the real assets, prove it
    /// can detect a *known* failure: the app's own accent colour
    /// (`#5B7F95`), the exact value `DayChipSelected` was introduced to
    /// replace on the selected chip, computes to ≈4.27:1 against white —
    /// below the 4.5:1 AA floor, which is what an on-device audit
    /// originally reported as "nearly passed." If this assertion can't
    /// fail, none of the assertions below proves anything either.
    @Test func theOldAccentColourAgainstWhiteFailsAAAndTheHelperCatchesIt() {
        let oldAccent = UIColor(red: CGFloat(0x5B) / 255, green: CGFloat(0x7F) / 255, blue: CGFloat(0x95) / 255, alpha: 1)
        let ratio = Contrast.ratio(oldAccent, .white)

        #expect(abs(ratio - 4.27) < 0.05, "expected ≈4.27:1, computed \(ratio)")
        #expect(ratio < Self.aaNormalText, "the old accent must fail AA, or this self-check proves nothing")
    }

    // MARK: - The chip's real colour pairs, both appearances

    private func resolvedAssetColor(named name: String, style: UIUserInterfaceStyle) throws -> UIColor {
        let color = try #require(
            UIColor(named: name, in: Bundle.main, compatibleWith: nil),
            "Asset catalog colour \"\(name)\" was not found in the app bundle")
        return color.resolvedColor(with: UITraitCollection(userInterfaceStyle: style))
    }

    @Test func unselectedChipTextClearsAAInLightMode() throws {
        let background = try resolvedAssetColor(named: "DayChipBackground", style: .light)
        let foreground = UIColor.label.resolvedColor(with: UITraitCollection(userInterfaceStyle: .light))
        let ratio = Contrast.ratio(background, foreground)

        #expect(abs(ratio - 18.8) < 1.0, "expected ≈18.8:1, computed \(ratio)")
        #expect(ratio >= Self.aaNormalText)
    }

    @Test func unselectedChipTextClearsAAInDarkMode() throws {
        let background = try resolvedAssetColor(named: "DayChipBackground", style: .dark)
        let foreground = UIColor.label.resolvedColor(with: UITraitCollection(userInterfaceStyle: .dark))
        let ratio = Contrast.ratio(background, foreground)

        #expect(abs(ratio - 17.0) < 1.0, "expected ≈17.0:1, computed \(ratio)")
        #expect(ratio >= Self.aaNormalText)
    }

    @Test func selectedChipTextClearsAAInLightMode() throws {
        let background = try resolvedAssetColor(named: "DayChipSelected", style: .light)
        let ratio = Contrast.ratio(background, .white)

        #expect(abs(ratio - 7.5) < 0.5, "expected ≈7.5:1, computed \(ratio)")
        #expect(ratio >= Self.aaNormalText)
    }

    @Test func selectedChipTextClearsAAInDarkMode() throws {
        let background = try resolvedAssetColor(named: "DayChipSelected", style: .dark)
        let ratio = Contrast.ratio(background, .white)

        #expect(abs(ratio - 5.57) < 0.5, "expected ≈5.57:1, computed \(ratio)")
        #expect(ratio >= Self.aaNormalText)
    }
}
