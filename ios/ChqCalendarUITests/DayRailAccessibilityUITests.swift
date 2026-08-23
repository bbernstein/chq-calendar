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
/// This file exists to pin that regression shut — but only `.textClipped` is
/// still gated here. Contrast and Dynamic Type are both structurally
/// unreportable on this rail and are gated by exact unit tests instead
/// (`DayChipContrastTests`, `WeekBandContrastTests`,
/// `DayRailDynamicTypeTests`); see `auditTypes` below for what that means and
/// how each was verified.
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
/// the audits report per-text-run `SwiftUI.AccessibilityNode`s — clipping
/// included, which is the one type still run here — that carry no identifier
/// of their own (only the
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
/// **Why every element type, not `app.buttons`.** A chip is a `Button` when
/// tappable, but `DayChip`'s `isDisabled` branch (an empty day on the Events
/// rail, `disablesEmptyDays: true`) mounts the identical `day-chip-*`
/// identifier on a plain, non-button view instead — see `DayChip.body`. A
/// `railBounds(in:)` built from `app.buttons` alone silently excludes every
/// disabled chip from the audit's scope, which is exactly backwards: an
/// empty chip is where the original, real defect lived (`.disabled()`
/// dimming text to ~3.7:1, see `DayChip.body`'s own comment on why there is
/// no `.disabled()` left to do that now). Matching by identifier against
/// every node in the hierarchy, whatever its type, closes that gap.
///
/// **Why a nil `issue.element` still counts as a rail issue.** `DayChip`
/// wraps its visual content (`chipVisual`) directly in a `Button` (no hidden
/// layer underneath — see `DayChip.body`'s own comment for why that was tried
/// and reverted). A truly hidden node (`DayChip.countLine`'s empty-count
/// placeholder, `.accessibilityHidden(true)`) is invisible to the audit's
/// element *resolution* even though its *rendering* is still inspected — an
/// issue found there arrives with `issue.element == nil`: no frame, no label,
/// no identifier, nothing to intersect with `railBounds`. An earlier version
/// of this test required a non-nil element inside `railBounds` and so
/// silently dropped every one of these, which is exactly what let a
/// falsification (restoring the pre-fix `.thinMaterial`/`.secondary` styling)
/// stay green. Nil-element issues are counted for that reason.
///
/// On the two screens this file audits (Events, My Day), the count-line
/// placeholder is the only `.accessibilityHidden(true)` content left on
/// screen — `FacetAllList` and `OffSeasonLandingView`'s hidden elements live
/// on other screens entirely, and `WeekRangeStrip`'s hidden
/// `currentWeekMarker` renders only inside the filter sheet — so treating a
/// nil-element issue as rail-scoped on these two screens is sound, not just
/// convenient.
///
/// **An anonymous, non-nil element is counted too, and that is load-bearing
/// for the one audit type left here.** A `Text` run that is merely *visible
/// but unnamed* — not hidden, just lacking its own identifier because only
/// the enclosing `Button` carries one — comes back with a real
/// `XCUIElement`: a genuine frame inside `railBounds`, an empty
/// `identifier`. Every clipping finding on this rail is of that shape.
/// Verified directly (#261): narrowing a chip to a fixed 32pt with
/// `.lineLimit(1)` made the Events audit report five `Text clipped` issues,
/// all with `id=`, and fail the test. A filter that dropped anonymous
/// elements would drop all five.
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

    /// `.textClipped` alone. Both other audit types are gated by exact unit
    /// tests instead, because both are structurally unreportable on this rail
    /// — the audit cannot see them, rather than seeing them and finding
    /// nothing.
    ///
    /// **`.contrast`** was removed first. `performAccessibilityAudit` cannot
    /// sample an individual `Text` run once a container has collapsed it into
    /// one accessibility node with the rest of the label, which `DayChip`'s
    /// `Button` and `WeekBandSegmentView`'s `.accessibilityElement()` both do.
    /// Run with `.contrast` included, it reports failures against chip text
    /// whose real, on-screen pixels measure roughly 18.8:1 (light, unselected)
    /// and 17.0:1 (dark, unselected) — false positives produced by the audit's
    /// own blind spot, not a regression. `DayChipContrastTests` and
    /// `WeekBandContrastTests` compute the WCAG ratio between the actual
    /// colours instead, which is exact where this is blind.
    ///
    /// **`.dynamicType`** followed it, for a reason that turned out to be
    /// wider than the chips (#261). A previous version of this comment kept it
    /// on the grounds that it still covered "the end controls, whose
    /// single-`Text` buttons don't collapse multiple runs." Those buttons have
    /// no `Text` at all: both end controls are icon-only —
    /// `Label(…).labelStyle(.iconOnly)` on the Events tab,
    /// `Image(systemName:)` on My Day — and a Dynamic Type audit measures
    /// text. With the chips and the week band collapsing, and the end controls
    /// presenting nothing to measure, `.dynamicType` had no addressable text
    /// anywhere on the rail. It reported 8 anonymous issues on every attempt
    /// of every run, all of which the filter here dropped, so the in-scope
    /// count was 0 unconditionally and three defects injected into app code
    /// all passed. `DayRailDynamicTypeTests` measures the real views in a
    /// hosting controller instead, and catches all three.
    ///
    /// **`.textClipped` stays because it demonstrably works.** It is the one
    /// type whose findings survive the collapse: they arrive anonymous, and
    /// `railIssues` counts anonymous findings. Falsified directly rather than
    /// assumed — see the type's doc comment for the injection and its five
    /// reported issues.
    ///
    /// Note the earlier attempt that made this look toothless: narrowing the
    /// chip *without* `.lineLimit(1)` makes SwiftUI **wrap** the text rather
    /// than truncate it, so nothing is clipped and the audit is right to stay
    /// silent. A clipping falsification has to actually clip.
    private let auditTypes: XCUIAccessibilityAuditType = [.textClipped]

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
    ///
    /// `day-band-` joins the list with #256's week band. The band row sits
    /// *above* the chips inside the same scroll view, so a box built from
    /// the chips alone stops at the chips' own top edge and puts every band
    /// finding out of scope — the audit would run and report nothing, which
    /// is the shape of a green test that checks nothing. Only a *labelled*
    /// segment is exposed at all (`WeekBandSegmentView`), so this
    /// matches the nine `WEEK n` segments, whose frames sit at the band
    /// row's own y and together span it.
    ///
    /// A plain function rather than the `NSPredicate` this used to be:
    /// `railBounds(in:)` now walks an `XCUIElementSnapshot` tree (see its
    /// doc comment for why), whose nodes are not the KVC-compliant objects
    /// an `NSPredicate` needs. The match itself is unchanged, prefix for
    /// prefix.
    private func isRailElement(_ identifier: String) -> Bool {
        identifier.hasPrefix("day-chip-")
            || identifier.hasPrefix("day-rail-expand-")
            || identifier.hasPrefix("day-band-")
            || identifier == "day-rail-now"
    }

    /// The union of every rail element's own frame — see the type's doc
    /// comment for why this, and not `rail.frame` or an issue's own element
    /// identifier, is what scopes the audit. Every node type is considered,
    /// not just buttons, so a disabled (non-button) empty chip is included —
    /// see `isRailElement(_:)`.
    ///
    /// **Why one snapshot, and not `descendants(matching:).matching(_:)`.**
    /// This was the single most expensive thing in the iOS UI suite (#259).
    /// The query form returns live `XCUIElement`s, and *each* `.frame` access
    /// re-resolves its element against the app — a fresh whole-hierarchy
    /// traversal per element, visible in the test log as a run of `Find the
    /// Any (Element at index n)` lines. The Events rail mounts its chips
    /// eagerly across the whole navigable span, so that was 99 elements and
    /// therefore 99 sequential traversals. Measured on an iPhone 17 Pro
    /// simulator, one `railBounds` call cost **30.4s**, against **10.3s** for
    /// the `performAccessibilityAudit` it exists to scope: three quarters of
    /// the work was spent deciding where to look, on a screen deliberately
    /// held still.
    ///
    /// `snapshot()` takes the entire hierarchy in one round trip and returns
    /// plain values whose `frame` is already resolved, so walking it is
    /// local work. The set of matched frames is identical — same identifiers,
    /// same hierarchy, same frames — because the query form was resolving
    /// against this very tree, once per element, instead of once.
    ///
    /// A snapshot failure throws rather than degrading to `.null`. `.null`
    /// answers `false` to `CGRect.contains` for every element, so swallowing
    /// the error would drop every bounds-matched issue and let the audit pass
    /// having checked nothing — the precise "green test that checks nothing"
    /// shape this file exists to prevent. `snapshot()` and
    /// `performAccessibilityAudit` are independent calls, so an earlier draft's
    /// reasoning that "the audit's own throw would surface first" did not hold:
    /// nothing guarantees the audit fails just because the snapshot did.
    @MainActor
    private func railBounds(in app: XCUIApplication) throws -> CGRect {
        let root = try app.snapshot()
        var box = CGRect.null
        var pending = [root]
        while let node = pending.popLast() {
            if isRailElement(node.identifier) { box = box.union(node.frame) }
            pending.append(contentsOf: node.children)
        }
        return box
    }

    /// Runs the audit across the whole app, keeping only issues that belong
    /// to the rail: either the offending element's frame lies inside
    /// `railBounds(in:)`, or the issue has no resolvable element at all —
    /// see the type's doc comment for why a nil element is still treated as
    /// a rail issue on these two screens, and why an anonymous one is kept
    /// rather than filtered out.
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
    ///
    /// **Sampling stops as soon as the verdict is settled empty.** Once
    /// enough samples have come back clean that the remaining ones could not
    /// form a majority even if every one of them found something, the result
    /// is already `[]` and further audits cannot change it — so the loop
    /// returns. With the default five attempts that means a clean screen
    /// costs three audits, not five. This is a pure cost cut, not a weaker
    /// check: it can only fire on a verdict of `[]`, which carries no
    /// diagnostic content, and the majority threshold itself is untouched.
    /// The reporting case is deliberately *not* short-circuited — a run that
    /// has already reached a majority keeps sampling so the richest sample is
    /// still available for the failure message. `AuditSampleTally` holds the
    /// arithmetic, and `AuditSampleTallyTests` proves over every possible
    /// sample sequence that the early exit returns what the full run would.
    /// **A timed-out audit is retried, never recorded.** The audit itself can
    /// fail with `com.apple.xcode.xctest.accessibilityAudit` code -56, "Audit
    /// failed to complete in time" — which happened on `main` right after
    /// #260 on a runner where *every* test was slow, including pure in-memory
    /// ones (a 511-iteration arithmetic loop went from 0.5s to 8.9s). That is
    /// infrastructure, not a verdict, and it must not be either kind of
    /// answer: failing the test on it makes a red build out of a slow runner,
    /// and recording it as a clean sample would let a degraded run vote for
    /// "found nothing."
    ///
    /// It cannot simply consume the attempt either, because `AuditSampleTally`
    /// takes its majority over the number of samples the caller *intends*.
    /// With five intended attempts, three timeouts and two samples that both
    /// found real issues, `nonEmpty * 2 > attempts` is `4 > 5` — silent, on
    /// two independent confirmations of a genuine defect. So a timeout is
    /// retried instead: the tally always receives its full `attempts` samples
    /// and its contract is untouched. Only when timeouts exceed `attempts` —
    /// a runner too degraded to audit at all — does this give up, and it does
    /// so as a skip rather than a failure.
    @MainActor
    private func railIssues(in app: XCUIApplication, attempts: Int = 5) throws -> [XCUIAccessibilityAuditIssue] {
        var samples: [[XCUIAccessibilityAuditIssue]] = []
        var tally = AuditSampleTally(attempts: attempts)
        var timeouts = 0
        var isFirstTry = true
        while tally.taken < attempts {
            if !isFirstTry { settleRailAnimation() }
            isFirstTry = false
            let bounds = try railBounds(in: app)
            var found: [XCUIAccessibilityAuditIssue] = []
            do {
                try app.performAccessibilityAudit(for: auditTypes) { issue in
                    if let element = issue.element {
                        if bounds.contains(element.frame) { found.append(issue) }
                    } else {
                        found.append(issue)
                    }
                    // Always "handled": the raw audit call must never throw
                    // for a *finding* — the test's own assertions below are
                    // what report failure, with a message naming exactly
                    // which issues matched the rail. The `catch` below is
                    // therefore only ever an audit-machinery error, never a
                    // finding.
                    return true
                }
            } catch {
                guard Self.isAuditTimeout(error) else { throw error }
                timeouts += 1
                guard timeouts <= attempts else {
                    throw XCTSkip(
                        "The accessibility audit timed out \(timeouts) times "
                            + "(\(Self.auditTimeoutDomain) code \(Self.auditTimeoutCode)). "
                            + "This is a degraded runner, not a finding — see railIssues' doc comment.")
                }
                continue
            }
            samples.append(found)
            tally.record(foundIssues: !found.isEmpty)
            if tally.isSettledEmpty { return [] }
        }
        // Reachable only when `attempts == 0` (the loop never runs, so nothing
        // is ever tallied). For every `attempts >= 1` this is an invariant, not
        // live logic: leaving the loop means the final sample found
        // `isSettledEmpty == false` with no samples remaining, which — with
        // `remaining == 0` — is exactly `foundMajority`. Kept rather than
        // dropped so the degenerate case still returns `[]` instead of reading
        // a majority off an empty tally.
        guard tally.foundMajority else { return [] }
        // Report the richest sample so a failure message is as complete as
        // possible.
        return samples.filter { !$0.isEmpty }.max(by: { $0.count < $1.count }) ?? []
    }

    private static let auditTimeoutDomain = "com.apple.xcode.xctest.accessibilityAudit"
    /// `XCTestErrorCode.timeoutWhileWaiting`, which the audit reports when it
    /// cannot finish rather than when it finds something.
    private static let auditTimeoutCode = -56

    private static func isAuditTimeout(_ error: any Error) -> Bool {
        let error = error as NSError
        return error.domain == auditTimeoutDomain && error.code == auditTimeoutCode
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

    func testEventsDayRailPassesTextClippingAudit() throws {
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
    /// Week 1 and week 9 specifically, because a ramp that reads fine
    /// mid-season and fails at its extremes is the expected failure mode
    /// (#256) and a mid-season spot check sails straight past it. Both ends
    /// are also the only steps that need checking: `WeekBands.segments`
    /// maps week 1 to ramp step 0 and week 9 to step 1, and the mix between
    /// the two endpoint assets is monotonic, so every intermediate week
    /// sits between the two colours audited here.
    ///
    /// `2026-06-29` and `2026-08-24` are chosen so the week's *labelled*
    /// segment is on screen: `WeekBands` puts each label on the middle of
    /// its visible solo days, which is `2026-06-30` for week 1 and
    /// `2026-08-26` for week 9 — one and two chips from the selection, so
    /// both land inside the rail's visible window. Without a labelled
    /// segment on screen there is no `day-band-*` element for
    /// `railBounds(in:)` to include, and the band's whole row would fall
    /// outside the audit's scope.
    ///
    /// Contrast is *not* what this gates — see `auditTypes` for why the
    /// audit is structurally blind to it on this rail.
    /// `WeekBandContrastTests` computes the WCAG ratio between each ramp
    /// endpoint and the label drawn on it directly instead, which is exact
    /// where this is blind.
    func testWeekBandPassesAuditAtBothEndsOfTheRamp() throws {
        for dayKey in ["2026-06-29", "2026-08-24"] {
            let app = launchFixtureApp(extraArgs: ["-uitest-go-to-day", dayKey])
            let rail = app.scrollViews["day-rail"]
            XCTAssertTrue(rail.waitForExistence(timeout: 20), "no rail on \(dayKey)")
            settleRailAnimation()

            // Proves a band segment is actually visible on screen before
            // asserting the audit is clean, or the audit below could pass by
            // examining nothing.
            //
            // Existence alone (`count > 0` on this same query) does not
            // prove that: `DayRailView` renders `entries` eagerly, in a
            // plain `HStack`/`ForEach` over the rail's *whole* navigable
            // span (`WeekBands.segments(dayKeys:year:)`'s own doc comment —
            // `dayKeys` is "a superset of the season" ), not just the
            // scrolled-to window. All nine labelled `day-band-*` segments —
            // one per season week — are mounted as descendants at all
            // times, so a plain existence count is ~9 regardless of scroll
            // position and would have stayed green even if this test never
            // scrolled the rail to `dayKey`'s week at all. `isHittable`
            // requires a resolvable on-screen frame that is not occluded
            // and not scrolled past either edge of the rail's visible
            // viewport, which existence does not.
            let visibleBandSegments = app.descendants(matching: .any)
                .matching(NSPredicate(format: "identifier BEGINSWITH 'day-band-'"))
                .allElementsBoundByIndex
                .filter(\.isHittable)
            XCTAssertFalse(
                visibleBandSegments.isEmpty, "no week-band segment is visible on screen for \(dayKey)")

            let issues = try railIssues(in: app)
            XCTAssertTrue(
                issues.isEmpty,
                "Week band audit at \(dayKey) found \(issues.count) issue(s):\n\(describe(issues))"
            )
            app.terminate()
        }
    }

    func testMyDayRailPassesTextClippingAudit() throws {
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
