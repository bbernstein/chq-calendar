import XCTest

final class LaunchFixtureUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// The whole target's foundation: if the app does not reach a list of
    /// fixture events, nothing else in this target can mean anything.
    func testFixtureLaunchReachesTheEventList() {
        let app = launchFixtureApp()
        let firstEvent = app.staticTexts["Fixture Event 1"].firstMatch

        XCTAssertTrue(
            firstEvent.waitForExistence(timeout: 20),
            "The fixture event list never appeared — check that -uitest-fixture reached UITestFixture.isActive")
    }
}
