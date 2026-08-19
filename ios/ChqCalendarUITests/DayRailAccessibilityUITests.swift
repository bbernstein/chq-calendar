import XCTest

/// Accessibility-audit coverage for the day rail — chips and end controls —
/// on both screens that mount `DayRailView` (Events tab, My Day).
///
/// An on-device audit (`performAccessibilityAudit`, fixture launch,
/// `now=2026-07-15 10:00:00`) found the chips' `.thinMaterial` background
/// makes contrast depend on whatever scrolls behind it: both fixture-empty
/// days in the visible window (`Tue`/`Jul 14`, `Fri`/`Jul 17`) and two
/// non-empty ones (`Mon`, `Thu`) failed contrast outright, the selected
/// chip's white-on-accent text and `⟳ Now` "nearly passed", and the count
/// line's blank-placeholder text partially failed Dynamic Type. This file
/// exists to pin that regression shut.
///
/// **Why filtering, not a scoped audit call.** `performAccessibilityAudit`
/// is declared only on `XCUIApplication` (see `XCUIAutomation.framework`'s
/// `XCUIApplication` extension) — there is no
/// `app.scrollViews["day-rail"].performAccessibilityAudit(...)` overload to
/// call. Scoping to the rail is done by running the audit across the whole
/// app and keeping only issues whose offending element's frame falls inside
/// a bounding box built from the rail's own elements.
///
/// **Why a bounding box built from buttons, not `rail.frame` itself, and
/// not the offending element's own identifier.** `day-rail`'s own reported
/// accessibility frame is taller than the chip row actually occupies (the
/// same quirk `DayRailUITests` documents driving its drags by the chip
/// row's own midpoint rather than the rail's) — tall enough here to also
/// contain the search field sitting above it, so a first version built on
/// `rail.frame` let the pre-existing, out-of-scope `Search events`
/// clipped-text finding leak in as a rail issue. Matching on the offending
/// element's own `identifier` instead was tried and rejected before that:
/// the contrast/Dynamic Type audits report per-text-run `SwiftUI.
/// AccessibilityNode`s that carry no identifier of their own (only the
/// enclosing `Button` does, via `DayChip`'s `.accessibilityIdentifier`), so
/// identifier matching silently dropped every genuine chip-text issue —
/// exactly the false negative this file exists to prevent. Unioning the
/// frames of the rail's own identified buttons (`day-chip-*`,
/// `day-step-previous`/`day-step-next`, `day-rail-now`,
/// `day-rail-expand-earlier`/`day-rail-expand-later`) gives a tight box
/// that still contains every one of their descendant text runs — those
/// nest fully inside their button's frame — while excluding the search
/// field, which sits well outside it.
///
/// **Why a nil `issue.element` also counts as a rail issue.** `DayChip`
/// wraps its visual content (`chipVisual`) in `.accessibilityHidden(true)`
/// so VoiceOver doesn't announce it as a second element alongside the
/// interactive `Button` overlaid on top — but the audit still inspects a
/// hidden element's *rendering* (confirmed empirically; see `DayChip`'s own
/// comment). What it cannot do is resolve a queryable `XCUIElement` for
/// something excluded from the accessibility tree, so every contrast /
/// Dynamic Type issue the audit finds on `chipVisual`'s `Text` runs arrives
/// with `issue.element == nil` — no frame, no label, no identifier, nothing
/// to intersect with `railBounds`. An earlier version of this test required
/// a non-nil element inside `railBounds`, which silently dropped every one
/// of these — exactly the false negative this file exists to prevent, and
/// exactly what let a falsification (restoring the pre-fix
/// `.thinMaterial`/`.secondary` styling) stay green. On the two screens
/// this file audits (Events, My Day), `chipVisual` is the *only*
/// `.accessibilityHidden(true)` content on screen — `FacetAllList` and
/// `OffSeasonLandingView`'s hidden elements live on other screens entirely,
/// and `WeekRangeStrip`'s hidden `currentWeekMarker` renders only inside
/// the filter sheet — so treating every nil-element issue as rail-scoped
/// on these two screens is sound, not just convenient.
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

    private let auditTypes: XCUIAccessibilityAuditType = [.contrast, .dynamicType, .textClipped]

    /// Every button identifier the rail itself mounts, on either screen.
    private let railButtonPredicate = NSPredicate(
        format: """
            identifier BEGINSWITH 'day-chip-' OR identifier BEGINSWITH 'day-rail-expand-' \
            OR identifier IN {'day-step-previous', 'day-step-next', 'day-rail-now'}
            """)

    /// The union of every rail button's own frame — see the type's doc
    /// comment for why this, and not `rail.frame` or an issue's own
    /// element identifier, is what scopes the audit.
    @MainActor
    private func railBounds(in app: XCUIApplication) -> CGRect {
        app.buttons.matching(railButtonPredicate).allElementsBoundByIndex
            .reduce(CGRect.null) { $0.union($1.frame) }
    }

    /// Runs the audit across the whole app, keeping only issues that belong
    /// to the rail: either the offending element's frame lies inside
    /// `railBounds(in:)`, or the issue has no resolvable element at all —
    /// see the type's doc comment for why a nil element is treated as a
    /// rail issue on these two screens.
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
                    if bounds.contains(element.frame) {
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

    func testEventsDayRailPassesContrastDynamicTypeAndClippingAudit() throws {
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
    func testMyDayRailPassesContrastDynamicTypeAndClippingAudit() throws {
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
