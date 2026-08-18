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
}
