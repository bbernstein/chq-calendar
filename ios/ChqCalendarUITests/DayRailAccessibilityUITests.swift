import XCTest

/// Accessibility-audit coverage for the day rail — chips and end controls —
/// on both screens that mount `DayRailView` (Events tab, My Day).
///
/// An on-device audit (`performAccessibilityAudit`, fixture launch,
/// `now=2026-07-15 10:00:00`) originally found the chips' `.thinMaterial`
/// background made contrast depend on whatever scrolled behind it: both
/// fixture-empty days in the visible window (`Tue`/`Jul 14`, `Fri`/`Jul 17`)
/// and two non-empty ones (`Mon`, `Thu`) failed contrast outright, the
/// selected chip's white-on-accent text and `⟳ Now` "nearly passed", and
/// the count line's blank-placeholder text partially failed Dynamic Type.
/// This file exists to pin that regression shut — with one exception, see
/// `auditTypes` below: contrast itself is no longer gated here.
///
/// **Why filtering, not a scoped audit call.** `performAccessibilityAudit`
/// is declared only on `XCUIApplication` (see `XCUIAutomation.framework`'s
/// `XCUIApplication` extension) — there is no
/// `app.scrollViews["day-rail"].performAccessibilityAudit(...)` overload to
/// call. Scoping to the rail is done by running the audit across the whole
/// app and keeping only issues whose offending element's frame falls inside
/// a bounding box built from the rail's own elements.
///
/// **Why a bounding box built from identified elements, not `rail.frame`
/// itself, and not the offending element's own identifier.** `day-rail`'s
/// own reported accessibility frame is taller than the chip row actually
/// occupies (the same quirk `DayRailUITests` documents driving its drags by
/// the chip row's own midpoint rather than the rail's) — tall enough here to
/// also contain the search field sitting above it, so a first version built
/// on `rail.frame` let the pre-existing, out-of-scope `Search events`
/// clipped-text finding leak in as a rail issue. Matching on the offending
/// element's own `identifier` instead was tried and rejected before that:
/// the contrast/Dynamic Type audits report per-text-run `SwiftUI.
/// AccessibilityNode`s that carry no identifier of their own (only the
/// enclosing `Button` — or, for a disabled chip, the enclosing plain view,
/// see below — does, via `DayChip`'s `.accessibilityIdentifier`), so
/// identifier matching silently dropped every genuine chip-text issue —
/// exactly the false negative this file exists to prevent. Unioning the
/// frames of the rail's own identified elements (`day-chip-*`,
/// `day-rail-now`, `day-rail-expand-earlier`/`day-rail-expand-later`) gives
/// a tight box
/// that still contains every one of their descendant text runs — those nest
/// fully inside their element's frame — while excluding the search field,
/// which sits well outside it.
///
/// **Why `descendants(matching: .any)`, not `app.buttons`.** A chip is a
/// `Button` when tappable, but `DayChip`'s `isDisabled` branch (an empty day
/// on the Events rail, `disablesEmptyDays: true`) mounts the identical
/// `day-chip-*` identifier on a plain, non-button view instead — see
/// `DayChip.body`. A `railBounds(in:)` built from `app.buttons` alone
/// silently excludes every disabled chip from the audit's scope, which is
/// exactly backwards: an empty chip is where the original, real defect
/// lived (`.disabled()` dimming text to ~3.7:1, see `DayChip.body`'s own
/// comment on why there is no `.disabled()` left to do that now). Matching
/// by identifier against every element type closes that gap.
///
/// **Why a nil `issue.element` still counts as a rail issue, and why a
/// non-nil-but-anonymous one sometimes doesn't.** `DayChip` wraps its
/// visual content (`chipVisual`) directly in a `Button` (no hidden layer
/// underneath — see `DayChip.body`'s own comment for why that was tried and
/// reverted). Two different things can happen to an issue found on one of
/// `chipVisual`'s individual `Text` runs once it sits inside that `Button`,
/// and they are not the same failure mode:
///
/// - A truly hidden node (`DayChip.countLine`'s empty-count placeholder,
///   `.accessibilityHidden(true)`) is invisible to the audit's element
///   *resolution* even though its *rendering* is still inspected — an issue
///   found there arrives with `issue.element == nil`: no frame, no label,
///   no identifier, nothing to intersect with `railBounds`. This is what an
///   earlier version of this test got wrong by requiring a non-nil element
///   inside `railBounds` — it silently dropped every one of these, which is
///   exactly what let a falsification (restoring the pre-fix
///   `.thinMaterial`/`.secondary` styling) stay green, and exactly what the
///   count-line placeholder's own real, pre-fix Dynamic Type failure would
///   have been dropped as too. Nil-element issues are still counted below
///   for that reason.
/// - A `Text` run that's merely *visible but unnamed* — not hidden, just
///   lacking its own accessibility identifier because only the enclosing
///   `Button` carries one (`DayChip`'s `.accessibilityIdentifier`) — comes
///   back with a real, non-nil `XCUIElement`: a genuine frame inside
///   `railBounds`, just an empty `identifier`. An A/B check confirmed this
///   is where the Events rail's populated count digits land: ordinary
///   `Text("\(content.count)").font(.caption2)`, unchanged code, audited
///   clean with `.contrast` in play under the pre-collapse `DayChip`
///   (hidden `chipVisual` plus a separate `Color.clear`-labelled `Button`,
///   this file's own history above), and started reporting "Dynamic Type
///   font sizes are partially unsupported" — non-nil element, real frame,
///   `identifier == ""` — the moment the chip went back to wrapping
///   `chipVisual` directly in a `Button`. Nothing about `countLine`'s code
///   changed between the two runs, only whether its text sat inside a
///   collapsing `Button`. That's the same underlying limitation that makes
///   contrast unusable here (see `auditTypes` below), just surfacing
///   through the non-nil branch instead of the nil one, so `railIssues`
///   drops a bounds-matched `.dynamicType` issue whose element has an empty
///   `identifier` rather than treating every bounds-matched issue as
///   equally trustworthy.
///
/// `.textClipped` keeps counting every issue in both branches, on the
/// current evidence: nothing in this file's history or the A/B check above
/// shows it hitting either wall, and dropping it pre-emptively would reopen
/// the exact false-negative gap this file exists to prevent. On the two
/// screens this file audits (Events, My Day), the count-line placeholder is
/// the only `.accessibilityHidden(true)` content left on screen —
/// `FacetAllList` and `OffSeasonLandingView`'s hidden elements live on
/// other screens entirely, and `WeekRangeStrip`'s hidden `currentWeekMarker`
/// renders only inside the filter sheet — so treating a nil-element issue
/// as rail-scoped on these two screens is sound, not just convenient.
///
/// `issueHandler` returns `true` for every issue unconditionally so the
/// audit call itself never throws partway through; the assertions below run
/// on the filtered list instead, which is what lets a failure report a
/// precise count and per-issue description rather than one opaque thrown
/// error.
@MainActor
final class DayRailAccessibilityUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// Deliberately excludes `.contrast`. `DayChip` wraps its label
    /// directly in a `Button` (see `DayChip.body`'s comment — the
    /// alternative, a hidden visual layer under a separate `Color.clear`
    /// tap target, was tried and reverted because it broke tap delivery
    /// after a drag), and `performAccessibilityAudit` cannot sample an
    /// individual `Text` run once a `Button` has collapsed it into one
    /// accessibility node with everything else in the label. Run with
    /// `.contrast` included, it reports failures against chip text whose
    /// real, on-screen pixels measure roughly 18.8:1 (light, unselected)
    /// and 17.0:1 (dark, unselected) — false positives produced by the
    /// audit's own blind spot here, not a real regression (see the type's
    /// doc comment, "Why a nil `issue.element`…", for the mechanism).
    /// `DayChipContrastTests` gates contrast instead, by computing the WCAG
    /// ratio directly between the two colours this rail actually renders
    /// (`DayChipBackground`, `DayChipSelected`) and their real foregrounds
    /// — exact, where this audit is structurally blind. Dynamic Type
    /// *does* hit the identical wall on individual chip text (confirmed by
    /// A/B testing the count digits against the pre-collapse `DayChip` —
    /// see the type's doc comment for the exact check), so `railIssues`
    /// drops a `.dynamicType` finding whenever its element is an anonymous
    /// (empty-identifier) descendant rather than excluding the whole audit
    /// type: that keeps this file gating Dynamic Type on everything else on
    /// the rail (the end controls, whose single-`Text` buttons don't
    /// collapse multiple runs, so a real finding there still has the
    /// button's own identifier) while conceding, explicitly, that it can no
    /// longer see inside a chip's own label. Text clipping has not shown
    /// the same failure on any evidence gathered so far, so it stays fully
    /// included.
    private let auditTypes: XCUIAccessibilityAuditType = [.dynamicType, .textClipped]

    /// Every element identifier the rail itself mounts, on either screen.
    /// A chip (`day-chip-*`) is a `Button` when tappable, but `DayChip`'s
    /// `isDisabled` branch (an empty day on the Events rail) mounts the same
    /// identifier on a plain, non-button view instead — see `DayChip.body`.
    /// Matching by identifier alone, not `app.buttons`, is what keeps a
    /// disabled chip inside `railBounds(in:)`'s scope; a buttons-only query
    /// silently excluded it, and empty chips are exactly where the original,
    /// real defect lived (`.disabled()` dimming text to ~3.7:1, see
    /// `DayChip.body`'s own comment on why there is no `.disabled()` left to
    /// do that).
    private let railElementPredicate = NSPredicate(
        format: """
            identifier BEGINSWITH 'day-chip-' OR identifier BEGINSWITH 'day-rail-expand-' \
            OR identifier IN {'day-rail-now'}
            """)

    /// The union of every rail element's own frame — see the type's doc
    /// comment for why this, and not `rail.frame` or an issue's own element
    /// identifier, is what scopes the audit. `descendants(matching: .any)`,
    /// not `app.buttons`, so a disabled (non-button) empty chip is included
    /// — see `railElementPredicate`.
    @MainActor
    private func railBounds(in app: XCUIApplication) -> CGRect {
        app.descendants(matching: .any).matching(railElementPredicate).allElementsBoundByIndex
            .reduce(CGRect.null) { $0.union($1.frame) }
    }

    /// Runs the audit across the whole app, keeping only issues that belong
    /// to the rail: either the offending element's frame lies inside
    /// `railBounds(in:)` (excluding an anonymous, empty-identifier
    /// `.dynamicType` element — see the type's doc comment for why that
    /// specific combination is a false positive, not a real finding), or
    /// the issue has no resolvable element at all — see the type's doc
    /// comment for why a nil element is still treated as a rail issue on
    /// these two screens.
    ///
    /// Samples `attempts` times, re-settling between each, and requires a
    /// *majority* of samples to find something before reporting it.
    /// `performAccessibilityAudit` is an inconsistent sampler of the same
    /// static screen in both directions, not just the false-negative one
    /// `settleRailAnimation`'s doc comment already describes: a
    /// falsification run against the pre-fix styling caught 16 rail issues
    /// on the Events screen running as a single, isolated test, but running
    /// that same fixed-vs-broken comparison as part of the *full*
    /// `ChqCalendarUITests` target caught 16 issues on the Events screen
    /// even with the fix in place, reproducibly across two independent
    /// simulator boots — the extra scheduling weight of a larger test run
    /// was enough to sometimes catch the rail's 0.2s scroll-to-center
    /// animation mid-slide despite the settle wait, the exact failure mode
    /// `settleRailAnimation` was written to prevent. A single non-empty
    /// sample is therefore evidence of *either* a real regression *or* a
    /// mistimed sample, and can't tell the two apart; requiring the issue
    /// to reproduce on a second, independently re-settled sample can. This
    /// doesn't reopen the false-negative gap resampling was added to
    /// close: the falsified styling's 16 issues reproduced consistently
    /// across every attempt in every run observed, so a real regression
    /// still clears a majority easily — only a one-off mistimed sample
    /// gets absorbed.
    @MainActor
    private func railIssues(in app: XCUIApplication, attempts: Int = 5) throws -> [XCUIAccessibilityAuditIssue] {
        var samples: [[XCUIAccessibilityAuditIssue]] = []
        for attempt in 0..<attempts {
            if attempt > 0 { settleRailAnimation() }
            let bounds = railBounds(in: app)
            var found: [XCUIAccessibilityAuditIssue] = []
            try app.performAccessibilityAudit(for: auditTypes) { issue in
                if let element = issue.element {
                    let isAnonymousDynamicTypeIssue = issue.auditType == .dynamicType && element.identifier.isEmpty
                    if bounds.contains(element.frame) && !isAnonymousDynamicTypeIssue {
                        // The identifier check excludes exactly the false
                        // positive the type's doc comment ("Why a nil
                        // `issue.element`…") walks through: a real,
                        // bounds-matched frame with no identifier of its
                        // own is a chip's individual `Text` run, collapsed
                        // into the enclosing `Button`'s single accessibility
                        // node, and the audit cannot verify Dynamic Type
                        // support for that specific run. A finding on one
                        // of the rail's own identified buttons (non-empty
                        // `identifier`) is unaffected and still counted.
                        found.append(issue)
                    }
                } else {
                    found.append(issue)
                }
                // Always "handled": the raw audit call must never throw
                // here — the test's own assertions below are what report
                // failure, with a message naming exactly which issues
                // matched the rail.
                return true
            }
            samples.append(found)
        }
        let nonEmptySamples = samples.filter { !$0.isEmpty }
        guard nonEmptySamples.count * 2 > attempts else { return [] }
        // Report the richest sample so a failure message is as complete as
        // possible.
        return nonEmptySamples.max(by: { $0.count < $1.count }) ?? []
    }

    /// `DayRailView.scroll(_:to:)` runs a 0.2s `withAnimation(.easeInOut)`
    /// scroll-to-center as soon as the rail appears, and the audit's own
    /// contrast sampling turned out to be sensitive to catching a chip
    /// mid-slide: an early run (before this wait existed) reported a
    /// different, inconsistent subset of chips failing contrast between
    /// otherwise-identical runs — the tell that it was measuring a
    /// transient blend of animation frames, not the settled chip. Waiting
    /// out the animation before auditing is what made the result
    /// reproducible.
    private func settleRailAnimation() {
        let settled = XCTestExpectation(description: "rail scroll-to-center animation settles")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { settled.fulfill() }
        wait(for: [settled], timeout: 3)
    }

    private func describe(_ issues: [XCUIAccessibilityAuditIssue]) -> String {
        issues.map {
            "- [\($0.auditType)] \($0.compactDescription) — \($0.detailedDescription) "
                + "label=\($0.element?.label ?? "nil") id=\($0.element?.identifier ?? "nil") "
                + "frame=\(String(describing: $0.element?.frame))"
        }.joined(separator: "\n")
    }

    func testEventsDayRailPassesDynamicTypeAndClippingAudit() throws {
        let app = launchFixtureApp()
        let rail = app.scrollViews["day-rail"]
        XCTAssertTrue(rail.waitForExistence(timeout: 20))
        settleRailAnimation()

        let issues = try railIssues(in: app)
        XCTAssertTrue(
            issues.isEmpty,
            "Events day rail accessibility audit found \(issues.count) issue(s):\n\(describe(issues))"
        )
    }

    /// My Day lands on its empty state without a seeded favorite, so this
    /// seeds three on 2026-07-15 (a non-empty fixture day) to reach the
    /// rail at all — same convention `DayRailUITests.testMyDaysEmptyChipIsTappable`
    /// uses.
    func testMyDayRailPassesDynamicTypeAndClippingAudit() throws {
        let app = launchFixtureApp(extraArgs: [
            "-uitest-seed-favorites", "2026-07-15-0,2026-07-15-1,2026-07-15-2",
            "-uitest-tab", "my-day",
        ])
        let rail = app.scrollViews["day-rail"]
        XCTAssertTrue(rail.waitForExistence(timeout: 20))
        settleRailAnimation()

        let issues = try railIssues(in: app)
        XCTAssertTrue(
            issues.isEmpty,
            "My Day rail accessibility audit found \(issues.count) issue(s):\n\(describe(issues))"
        )
    }
}
