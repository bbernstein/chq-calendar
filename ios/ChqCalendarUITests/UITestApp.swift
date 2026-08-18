import XCTest

/// Launches the app in its deterministic fixture world.
///
/// Every UI test in this target goes through here. Two arguments are
/// non-negotiable and are why this helper exists rather than each test
/// building its own argument list:
///
/// - `-uitest-fixture` replaces CloudFront with a generated payload
///   (`UITestFixture`), so assertions name days that will still exist next
///   season.
/// - `-uitest-freeze-now` pins the clock. CI runs UTC and this app treats the
///   device clock as Chautauqua event-time; two of the web e2e checks
///   silently depended on the wall-clock hour and were red on `main` for
///   weeks before anyone noticed. A UI test that reads "Today" must be told
///   what today is.
func launchFixtureApp(
    now: String = "2026-07-15 10:00:00",
    extraArgs: [String] = []
) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-uitest-fixture", "-uitest-freeze-now", now] + extraArgs
    app.launch()
    return app
}
