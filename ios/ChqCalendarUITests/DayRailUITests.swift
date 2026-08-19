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
                leftward.press(forDuration: 0.05, thenDragTo: rightward)
            } else if x < visibleMinX {
                rightward.press(forDuration: 0.05, thenDragTo: leftward)
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
    func testAnEmptyDaysChipIsNotTappable() {
        let app = launchFixtureApp(now: "2026-07-01 10:00:00")
        XCTAssertTrue(app.scrollViews["day-rail"].waitForExistence(timeout: 20))

        // UITestFixture leaves every third day empty; 2026-06-29 is index 2.
        XCTAssertFalse(app.buttons["day-chip-2026-06-29"].isEnabled)
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
}
