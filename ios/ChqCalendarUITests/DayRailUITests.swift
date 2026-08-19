import XCTest

/// The seams. Every assertion here is one that a green unit suite cannot
/// make: phase 3a shipped a rail past eleven clean task reviews that was not
/// pinned, dragged the page on every tap, and landed a thousand points short
/// of a distant target. All three needed a running app to see.
final class DayRailUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// The rail's `HStack` is not lazy, so every chip — including one dozens
    /// of days beyond the visible edge — is already in the accessibility
    /// tree and reports `exists == true`. `tap()` still fails on one that
    /// is genuinely off-screen, and so does `isHittable` itself: for an
    /// element whose frame lies entirely outside the window, XCUITest
    /// raises "Activation point invalid" rather than answering `false` —
    /// so a loop that *checks* `isHittable` between swipes aborts the test
    /// on its first iteration (`continueAfterFailure = false`).
    ///
    /// A plain `scrollView.swipeLeft()` (and `rail.coordinate(withNormalizedOffset:)`
    /// at `dy: 0.5`) is a no-op here: `"day-rail"` reports a taller
    /// accessibility frame than the chip row actually occupies within it
    /// (confirmed by dumping chip frames against a running build — the row
    /// sits in the lower ~30% of the reported height), so a gesture aimed at
    /// its vertical center lands above the chips, in dead space that
    /// doesn't belong to the scrollable content, and nothing moves. Driving
    /// the drag at the chip row's own vertical midpoint — read once, before
    /// scrolling starts, since every chip shares one row and stays at that
    /// same height throughout — is what actually reaches it.
    ///
    /// Reveals a chip that is off to the right (`frame.origin.x` beyond the
    /// rail's own visible span) *or* off to the left (negative
    /// `frame.origin.x` — the case a `selectedDay` centered on a *later*
    /// day than the target produces, since `DayRailView` auto-scrolls to
    /// center on selection). Each direction just swaps which coordinate is
    /// the drag's start vs. end.
    ///
    /// The drag's X coordinates and the "is it visible yet" threshold are
    /// both derived from `rail.frame` — never a hardcoded pixel offset, so
    /// this survives a differently-sized device rather than staying pinned
    /// to the ~402pt-wide simulator this was written against. `margin`
    /// insets both ends slightly so the touch points land inside the rail's
    /// own bounds rather than exactly on its edge.
    ///
    /// **`withVelocity: .slow, thenHoldForDuration: 0.1` matters.** A plain
    /// `press(forDuration:thenDragTo:)` releases with a fling: the scroll
    /// view keeps decelerating well past the touch's own endpoints, and that
    /// extra momentum is *larger* than the visible target zone
    /// (`visibleMaxX - visibleMinX`). Confirmed empirically for a target
    /// only ~1.6 screens away (`day-chip-2026-07-09` from a launch centered
    /// on `2026-07-01`): every fling landed on one of exactly two fixed
    /// absolute x-positions, one on each side of the zone, and reversing
    /// direction from either one flings straight back to the other — a
    /// stable two-state cycle that revisits the same two points forever and
    /// never lands inside the zone, exhausting `maxSwipes` while `chip.tap()`
    /// or `header.isHittable` later fails with "Activation point invalid".
    /// Holding at the end of the drag before lifting kills the fling, so
    /// each swipe's effect is close to the literal touch distance — smaller
    /// than the target zone — which forecloses that resonance and still
    /// clears the distant targets (~10 swipes for `2026-08-21`, previously
    /// ~9 flinging swipes) well inside the existing budget.
    private func revealByScrolling(
        _ element: XCUIElement, in app: XCUIApplication, rail: XCUIElement, rowMidY: CGFloat,
        margin: CGFloat = 40, maxSwipes: Int = 40
    ) {
        let visibleMinX = rail.frame.minX + margin
        let visibleMaxX = rail.frame.maxX - margin
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let leftward = origin.withOffset(CGVector(dx: visibleMaxX, dy: rowMidY))
        let rightward = origin.withOffset(CGVector(dx: visibleMinX, dy: rowMidY))
        var attempts = 0
        while attempts < maxSwipes {
            let x = element.frame.origin.x
            if x > visibleMaxX {
                leftward.press(
                    forDuration: 0.05, thenDragTo: rightward,
                    withVelocity: .slow, thenHoldForDuration: 0.1)
            } else if x < visibleMinX {
                rightward.press(
                    forDuration: 0.05, thenDragTo: leftward,
                    withVelocity: .slow, thenHoldForDuration: 0.1)
            } else {
                break
            }
            attempts += 1
        }
    }

    /// Seam 1: the rail is chrome, not content. If it scrolls away, the
    /// reader loses the only control that gets them back — which is the
    /// filter-access bug this initiative already fixed once on the web.
    ///
    /// The rail's container is a horizontal `ScrollView`, so — per the
    /// brief's guidance to adjust the query rather than fight the
    /// accessibility tree — it resolves as `app.scrollViews["day-rail"]`,
    /// not `otherElements`. Confirmed by dumping `app.debugDescription`
    /// against a running build: `ScrollView, ... identifier: 'day-rail'`.
    func testTheRailStaysPutWhileTheListScrolls() {
        let app = launchFixtureApp()
        let rail = app.scrollViews["day-rail"]
        XCTAssertTrue(rail.waitForExistence(timeout: 20))

        let before = rail.frame.origin.y
        app.swipeUp(velocity: .fast)
        app.swipeUp(velocity: .fast)

        XCTAssertEqual(
            rail.frame.origin.y, before, accuracy: 1,
            "The rail moved with the list — check that it is mounted via .safeAreaInset on `content`, not inside the List")
    }

    /// The rail spans the navigable season, not the current window: a chip
    /// for a day far outside a `.next` window must exist, or the rail is a
    /// readout of the filter it exists to navigate past.
    func testTheRailSpansTheWholeSeasonNotTheCurrentWindow() {
        let app = launchFixtureApp(now: "2026-07-15 10:00:00")
        XCTAssertTrue(app.scrollViews["day-rail"].waitForExistence(timeout: 20))

        // Chips are real `Button`s (verified against the accessibility
        // tree), so `app.buttons[...]` is correct here.
        XCTAssertTrue(app.buttons["day-chip-2026-06-27"].exists)
        XCTAssertTrue(app.buttons["day-chip-2026-08-23"].exists)
    }

    /// Seam 2: the tap that phase 3a got wrong. The target is far outside the
    /// current window, so the window has to grow, the day has to mount, and
    /// only then can the list move — and the move must land, not merely
    /// start.
    func testADistantChipTapLandsOnThatDay() {
        let app = launchFixtureApp(now: "2026-07-01 10:00:00")
        let rail = app.scrollViews["day-rail"]
        XCTAssertTrue(rail.waitForExistence(timeout: 20))

        // The target chip is dozens of days beyond the rail's leading edge
        // at launch — genuinely off-screen, not merely clipped — so it must
        // be scrolled into view before it can be tapped. See
        // `revealByScrolling`'s doc for why this isn't `tap()`'s job.
        let chip = app.buttons["day-chip-2026-08-21"]
        let rowMidY = app.buttons["day-chip-2026-06-27"].frame.midY
        revealByScrolling(chip, in: app, rail: rail, rowMidY: rowMidY)
        chip.tap()

        // The fixture titles every day header through ChqTime.dayTitle, so
        // this is the section header for the tapped day. Confirmed against
        // ChqTime.dayTitle's "EEEE, MMMM d" format (en_US_POSIX, no year):
        // 2026-08-21 is a Friday.
        let header = app.staticTexts["Friday, August 21"]
        XCTAssertTrue(
            header.waitForExistence(timeout: 10),
            "The tapped day never mounted — the window did not grow, or the pending scroll was abandoned too early")
        XCTAssertTrue(
            header.isHittable,
            "The day mounted but the list never scrolled to it — check that the scroll is retried after the expansion commits")
    }

    /// Finding 1 (final whole-branch review of phase 3b). Every positive-path
    /// tap test above targets 2026-08-21, which lies *outside* the initial
    /// `.next` window and so grows it — that growth is what changes `days`
    /// and fires `list(days:)`'s `.onChange(of: days.map(\.id))`. A tap for a
    /// day already *inside* the window changes nothing that either trigger
    /// watches, so before the fix the list never moved at all.
    ///
    /// 2026-07-09 is eight days out from `now`; the fixture's 3-events/day
    /// rate means `.next`'s adaptive window (`minCount: 50`) already reaches
    /// past it without any expansion — unlike 2026-08-21, fifty-one days out.
    /// It's still off-screen on the *rail* at launch (the rail centers on
    /// 07-01), so it needs the same reveal-by-scrolling every distant chip
    /// in this file does; what's different is the *list* never has to grow
    /// to show it.
    func testTappingADayAlreadyInsideTheWindowScrollsToIt() {
        let app = launchFixtureApp(now: "2026-07-01 10:00:00")
        let rail = app.scrollViews["day-rail"]
        XCTAssertTrue(rail.waitForExistence(timeout: 20))

        let chip = app.buttons["day-chip-2026-07-09"]
        let rowMidY = app.buttons["day-chip-2026-07-01"].frame.midY
        revealByScrolling(chip, in: app, rail: rail, rowMidY: rowMidY)
        chip.tap()

        let header = app.staticTexts["Thursday, July 9"]
        XCTAssertTrue(
            header.waitForExistence(timeout: 10),
            "Tapping a day already inside the window never scrolled the list to it — "
                + "check that list(days:) resolves pendingScroll even when days.map(\\.id) doesn't change")
        XCTAssertTrue(
            header.isHittable,
            "The day's section exists but was never actually scrolled into view")
    }

    /// Finding 1's second consequence: `selectDay` unconditionally sets
    /// `anchorDay = dayKey`, so the tapped chip is highlighted immediately
    /// regardless of whether the fix above landed — that much always worked.
    /// What the bug broke is what happens *next*: with `pendingScroll` left
    /// permanently armed, `pendingScroll?.day ?? scrollAnchor ?? anchorDay`
    /// keeps reading the stale target forever, so the highlight never goes
    /// back to tracking scroll position the way `testTheHighlightFollowsThe-
    /// ReaderDownTheList` proves it normally does.
    ///
    /// This does **not** assert "the tapped chip is the highlight right
    /// after the tap" (or once the scroll settles) — measured directly (a
    /// throwaway `Logger` probe on `anchor`/`scrollAnchor`/`visibleDays`,
    /// not committed), `scrollAnchor` never becomes `2026-07-09` at all: the
    /// List's row buffer keeps an off-screen *earlier* header's `onAppear`
    /// counted in `visibleDays` after a `.top`-anchored `scrollTo`, so
    /// `visibleDays.min()` lands one day short (`2026-07-07` in that trace)
    /// and stays there indefinitely — a real, pre-existing precision limit
    /// of `visibleDays` under a programmatic jump (only ever validated
    /// against drag gestures, per the doc above that property), not
    /// something this fix wave touches or should paper over with a wait.
    ///
    /// What the fix wave *does* change, and what this test exists to pin,
    /// is that `pendingScroll` actually clears for an in-window tap instead
    /// of hijacking every later `anchor` read forever. Proof this still
    /// catches that: revert `EventListView.list(days:)`'s `.onChange(of:
    /// pendingScroll)` and `pendingScroll` never clears for an in-window tap
    /// at all (`days` itself never changes, so the other trigger never fires
    /// either) — `anchor` reads `pendingScroll?.day` (the tapped chip)
    /// forever, so `chip.isSelected` would still read true after the swipes
    /// below and the first assertion fails.
    func testHighlightResumesTrackingAfterTappingADayAlreadyInsideTheWindow() {
        let app = launchFixtureApp(now: "2026-07-01 10:00:00")
        let rail = app.scrollViews["day-rail"]
        XCTAssertTrue(rail.waitForExistence(timeout: 20))

        let chip = app.buttons["day-chip-2026-07-09"]
        let rowMidY = app.buttons["day-chip-2026-07-01"].frame.midY
        revealByScrolling(chip, in: app, rail: rail, rowMidY: rowMidY)
        chip.tap()
        XCTAssertTrue(app.staticTexts["Thursday, July 9"].waitForExistence(timeout: 10))

        for _ in 0..<4 { app.swipeUp(velocity: .fast) }

        XCTAssertFalse(
            chip.isSelected,
            "The highlight stayed frozen on the tapped chip after scrolling — pendingScroll was "
                + "never cleared, so it kept outranking the scroll-derived anchor")
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'day-chip-'"))
                .allElementsBoundByIndex.contains { $0.isSelected },
            "Nothing is highlighted at all — the anchor was cleared rather than moved")
    }

    /// The pending-scroll retry must not outlive its usefulness: a target set
    /// under one scope and never cleared hijacks a later commit and teleports
    /// a reader who has moved on.
    func testTappingAnAlreadyVisibleDayDoesNotQueueALingeringScroll() {
        let app = launchFixtureApp(now: "2026-07-01 10:00:00")
        XCTAssertTrue(app.scrollViews["day-rail"].waitForExistence(timeout: 20))

        app.buttons["day-chip-2026-07-01"].tap()
        app.swipeUp(velocity: .fast)
        app.swipeUp(velocity: .fast)
        let afterScrolling = app.staticTexts["Wednesday, July 1"].exists

        // Give any lingering pending scroll a commit to hijack.
        app.swipeUp(velocity: .fast)

        XCTAssertEqual(
            app.staticTexts["Wednesday, July 1"].exists, afterScrolling,
            "Something scrolled the reader back to a day they tapped before scrolling away")
    }

    /// Important 1 (task 9 review): a pending scroll can survive a scope
    /// change and hijack a later commit. `DayRailNavigation.shouldAbandonScroll`
    /// only ends the wait once the window *covers* the target — a scope
    /// change can move the window *away* from it without ever covering it,
    /// leaving the target armed. `PendingDayScroll.isStale` closes that by
    /// stamping the tap with the filter identity it was made under.
    ///
    /// **Why the delay hook.** A real device resolves a pending scroll
    /// within the same commit that arms it, so no ordinary sequence of
    /// `XCUIElement` actions can act "before it lands": every action first
    /// waits for the app to go idle, and by the time a second one is even
    /// sent, the first commit has always already resolved — confirmed
    /// empirically while building this test, where the tapped day was
    /// already `isHittable` behind a still-presenting sheet, before any
    /// second action could run at all. `-uitest-delay-pending-scroll` defers
    /// *when* the very next pending scroll resolves (via
    /// `DispatchQueue.main.asyncAfter`, which registers no app activity, so
    /// XCUITest still sees the app as idle) without changing *what* it
    /// decides — see `AppModel.uiTestPendingScrollDelay`.
    ///
    /// **Why "All Year", not another distant tap or more scrolling.** `.all`
    /// is the one scope whose window is the *entire* navigable range
    /// unconditionally (`ViewWindow.allWindow`) — switching to it makes
    /// `2026-08-21` a member of `days` on the very commit that applies the
    /// scope change, with no auto-expand swiping needed to reach it. (An
    /// earlier attempt used "Today", which turned out to ignore window-
    /// expansion fields entirely — it is always exactly one day by
    /// construction — so auto-expand could never grow it back toward the
    /// target at all, and the scenario never arose.)
    func testChangingScopeAfterADistantTapDoesNotLaterHijackTheList() {
        let app = launchFixtureApp(
            now: "2026-07-01 10:00:00", extraArgs: ["-uitest-delay-pending-scroll"])
        let rail = app.scrollViews["day-rail"]
        XCTAssertTrue(rail.waitForExistence(timeout: 20))

        // Open the date sheet first — `.presentationBackgroundInteraction`
        // keeps the rail reachable behind it — so the distant tap below and
        // the scope change that follows are only one `.tap()`'s worth of
        // settle apart, the fastest sequencing two discrete UI actions can
        // achieve here.
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Date range:'")).firstMatch.tap()

        let chip = app.buttons["day-chip-2026-08-21"]
        let rowMidY = app.buttons["day-chip-2026-06-27"].frame.midY
        revealByScrolling(chip, in: app, rail: rail, rowMidY: rowMidY)
        chip.tap()

        // Still under `.next` (the scope the tap armed its target under),
        // and the delay hook is holding the scroll off — the target has not
        // landed yet.
        XCTAssertFalse(
            app.staticTexts["Friday, August 21"].exists,
            "Test setup assumption broken: the tap already landed before the scope change below, so this run cannot prove anything")

        app.buttons["All Year"].tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Show '")).firstMatch.tap()

        let header = app.staticTexts["Friday, August 21"]
        XCTAssertFalse(
            header.exists && header.isHittable,
            "The reader was scrolled to a day they tapped under a scope they have since left")
    }

    /// An empty day is named as a fact, not offered as a destination — the
    /// rule the web rail arrived at after three review findings. A control
    /// that says 'Go to' while going nowhere is what this prevents.
    ///
    /// Pins the *current* contract: `DayChip` no longer renders an empty
    /// Events-rail day as a disabled `Button` (that shape dimmed its own
    /// text via SwiftUI's outside-in `.disabled()` compositing, and the
    /// workaround for that broke tap delivery — see `DayChip.body`'s
    /// comment). It is now a plain, non-interactive view instead: still on
    /// screen and still labelled — so `exists` must stay true, or this test
    /// would also pass for a chip that silently vanished — but it is not a
    /// button at all. If this ever starts matching `app.buttons[...]`
    /// again, that means the chip regained button/tap affordance, which is
    /// exactly what "not tappable" must keep failing.
    func testAnEmptyDaysChipIsNotTappable() {
        let app = launchFixtureApp(now: "2026-07-01 10:00:00")
        XCTAssertTrue(app.scrollViews["day-rail"].waitForExistence(timeout: 20))

        // UITestFixture leaves every third day empty; 2026-06-29 is index 2.
        let identifier = "day-chip-2026-06-29"
        XCTAssertFalse(
            app.buttons[identifier].exists,
            "An empty Events-rail chip must not be exposed as a button at all")
        XCTAssertTrue(
            app.descendants(matching: .any)[identifier].exists,
            "The empty chip must still exist on screen, just not as a control")
    }

    /// Important 2 (task 9 review): the asymmetry — Events disables empty
    /// chips, My Day does not — is deliberate (#192: selecting an empty day
    /// is how the reader reaches its "Browse …" action) but was, before this
    /// test, protected only by the absence of a `disablesEmptyDays: true`
    /// argument at `MyDayView`'s call site. One leaked argument would
    /// silently remove the feature with nothing to catch it.
    ///
    /// `-uitest-seed-favorites` on 2026-07-15 (a non-empty fixture day, per
    /// the task-7 visual-check convention) is what gets My Day past its
    /// empty state at all; `DayWindow.make`'s default `today-7...today+14`
    /// slice then includes 2026-07-08, which is empty (fixture day-index 11,
    /// `11 % 3 == 2`) and sits right at that slice's lower edge — visible
    /// without needing the "earlier" chevron.
    func testMyDaysEmptyChipIsTappable() {
        let app = launchFixtureApp(
            now: "2026-07-15 10:00:00",
            extraArgs: [
                "-uitest-seed-favorites", "2026-07-15-0,2026-07-15-1,2026-07-15-2",
                "-uitest-tab", "my-day",
            ])

        let rail = app.scrollViews["day-rail"]
        let chip = app.buttons["day-chip-2026-07-08"]
        XCTAssertTrue(chip.waitForExistence(timeout: 20))
        XCTAssertTrue(chip.isEnabled, "My Day's empty chips must stay tappable — selecting one is how the reader reaches Browse")

        // The rail auto-scrolls to center on the seeded favorite's day
        // (2026-07-15), so the target — 7 days earlier — starts off-screen
        // to the left.
        let rowMidY = app.buttons["day-chip-2026-07-15"].frame.midY
        revealByScrolling(chip, in: app, rail: rail, rowMidY: rowMidY)
        chip.tap()

        XCTAssertTrue(
            app.staticTexts["Wednesday, July 8"].waitForExistence(timeout: 10),
            "Tapping the empty chip never selected its day")
        XCTAssertTrue(
            app.buttons["Browse Jul 8 events"].exists,
            "The empty-day Browse action never appeared — selecting an empty day must still reach it")
    }

    /// The highlight answers "where am I?", so scrolling must move it. A
    /// highlight that only follows taps is a highlight that lies as soon as
    /// the reader uses the list.
    func testTheHighlightFollowsTheReaderDownTheList() {
        let app = launchFixtureApp(now: "2026-07-01 10:00:00")
        let firstChip = app.buttons["day-chip-2026-07-01"]
        XCTAssertTrue(firstChip.waitForExistence(timeout: 20))
        XCTAssertTrue(firstChip.isSelected, "The rail did not start on the day at the top of the list")

        for _ in 0..<4 { app.swipeUp(velocity: .fast) }

        XCTAssertFalse(
            firstChip.isSelected,
            "The highlight stayed on the first day while the reader scrolled past it")
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'day-chip-'"))
                .allElementsBoundByIndex.contains { $0.isSelected },
            "Nothing is highlighted at all — the anchor was cleared rather than moved")
    }

    /// Named by target, never by direction — and the target is the nearest
    /// day that HAS events, so pressing it always changes what is on screen.
    /// UITestFixture leaves 2026-07-02 empty (day-index 5, `5 % 3 == 2`), so
    /// a correct control skips it and lands on 2026-07-03 instead — a Friday
    /// carrying the fixture's usual three events, per `MyDayChipContentTests`'
    /// "Go to Sunday, August 16, 4 events" wording.
    func testTheForwardStepIsNamedForTheDayItGoesTo() {
        let app = launchFixtureApp(now: "2026-07-01 10:00:00")
        XCTAssertTrue(app.scrollViews["day-rail"].waitForExistence(timeout: 20))

        let step = app.buttons["day-step-next"]
        XCTAssertTrue(step.exists)
        XCTAssertEqual(step.label, "Go to Friday, July 3, 3 events")
    }

    /// The 2026 season starts 2026-06-27 at *noon*, so launching that
    /// morning can render `OffSeasonLandingView` with no rail at all.
    /// Launching at the standard time and tapping the earliest chip instead
    /// puts the anchor on the earliest reachable day without racing the
    /// season's own start.
    func testTheBackwardStepIsDisabledAtTheEarliestReachableDay() {
        let app = launchFixtureApp(now: "2026-07-15 10:00:00")
        let rail = app.scrollViews["day-rail"]
        XCTAssertTrue(rail.waitForExistence(timeout: 20))

        let chip = app.buttons["day-chip-2026-06-27"]
        let rowMidY = app.buttons["day-chip-2026-07-15"].frame.midY
        revealByScrolling(chip, in: app, rail: rail, rowMidY: rowMidY)
        chip.tap()

        XCTAssertFalse(app.buttons["day-step-previous"].isEnabled)
    }

    func testNowReturnsToTodayAfterNavigatingAway() {
        let app = launchFixtureApp(now: "2026-07-01 10:00:00")
        let rail = app.scrollViews["day-rail"]
        XCTAssertTrue(rail.waitForExistence(timeout: 20))

        // Genuinely off-screen at launch (rail centers on 2026-07-01), same
        // as every other distant-chip tap in this file — see
        // `revealByScrolling`'s doc for why a plain `.tap()` fails here.
        let chip = app.buttons["day-chip-2026-08-21"]
        let rowMidY = app.buttons["day-chip-2026-07-01"].frame.midY
        revealByScrolling(chip, in: app, rail: rail, rowMidY: rowMidY)
        chip.tap()
        XCTAssertTrue(app.staticTexts["Friday, August 21"].waitForExistence(timeout: 10))

        // `Now` sits at the leading end of the rail's own scrollable content
        // (not pinned to the screen edge), and the rail just re-centered on
        // 2026-08-21 — so `Now` is off-screen to the left and needs the same
        // reveal as any other distant control.
        let now = app.buttons["day-rail-now"]
        revealByScrolling(now, in: app, rail: rail, rowMidY: rowMidY)
        now.tap()

        XCTAssertTrue(
            app.staticTexts["Wednesday, July 1"].waitForExistence(timeout: 10),
            "⟳ Now did not return the reader to today")
    }

    /// Off-season, today is outside the navigable bounds, and a target
    /// outside them is refused — so a Now button there would be visible,
    /// enabled, and inert.
    func testNowIsAbsentOutsideTheSeason() {
        let app = launchFixtureApp(now: "2026-02-01 10:00:00")
        // The rail may not exist at all off-season; either way, no Now button.
        XCTAssertFalse(app.buttons["day-rail-now"].waitForExistence(timeout: 10))
    }
}
