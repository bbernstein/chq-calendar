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
    private func revealByScrolling(
        _ element: XCUIElement, in app: XCUIApplication, rowMidY: CGFloat,
        visibleMaxX: CGFloat = 350, maxSwipes: Int = 40
    ) {
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let start = origin.withOffset(CGVector(dx: 360, dy: rowMidY))
        let end = origin.withOffset(CGVector(dx: 40, dy: rowMidY))
        var attempts = 0
        while element.frame.origin.x > visibleMaxX, attempts < maxSwipes {
            start.press(forDuration: 0.05, thenDragTo: end)
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
        revealByScrolling(chip, in: app, rowMidY: rowMidY)
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

    /// An empty day is named as a fact, not offered as a destination — the
    /// rule the web rail arrived at after three review findings. A control
    /// that says 'Go to' while going nowhere is what this prevents.
    func testAnEmptyDaysChipIsNotTappable() {
        let app = launchFixtureApp(now: "2026-07-01 10:00:00")
        XCTAssertTrue(app.scrollViews["day-rail"].waitForExistence(timeout: 20))

        // UITestFixture leaves every third day empty; 2026-06-29 is index 2.
        XCTAssertFalse(app.buttons["day-chip-2026-06-29"].isEnabled)
    }
}
