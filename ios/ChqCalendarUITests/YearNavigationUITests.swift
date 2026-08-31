import XCTest

/// The two paths that had never been exercised by a running app, because the
/// fixture served one year: #186 (a reader waiting for a season browses the
/// previous one) and #253 (a day link naming a season the reader is not on).
///
/// Both were built entirely at the model level, and both end in something no
/// unit test can observe. `EventListView.armScroll` writes SwiftUI `@State`,
/// which is inert outside a render host — so the unit suite can prove the
/// *key* a cross-year link stamps is fresh, and cannot prove the reader ends
/// up looking at that day. Likewise `LandingState.preSeason` can carry an
/// `archiveYear` in a test while `OffSeasonLandingView` renders no button at
/// all. That gap is what this file closes.
///
/// Every launch here depends on `UITestFixture`'s three-season manifest —
/// read its type header before changing a year or a date in this file; which
/// state a launch reaches is decided by the interaction of the pinned year,
/// the frozen clock, and whether that year's feed is populated, empty, or
/// absent.
final class YearNavigationUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// #186. A reader on a season that has not started yet is offered the
    /// previous one **by name**, and taking the offer puts them in it with
    /// events on screen.
    ///
    /// **Why this launch reaches `.preSeason` and not something else**, since
    /// getting that wrong is how this test would silently prove nothing:
    /// `-uitest-pin-year 2027` makes 2027 both `selectedYear` and
    /// `defaultYear`; the fixture serves 2027 a valid but *empty* events
    /// payload, so `AppModel.snapshot` is non-nil (its `guard snapshot != nil`
    /// passes) while `LandingState`'s rule 1 finds no event at or after `now`
    /// (its rule 3 needs `now` past the season start, which this clock is
    /// not); and 2027-03-15 is before `SeasonCalendar.seasonStart(year: 2027)`
    /// — 2027-06-26 noon — so rule 2 fires. Every one of those four is
    /// load-bearing.
    ///
    /// **What actually discriminates `.preSeason` from the other off-season
    /// state is the title, and only the title.** `OffSeasonLandingView.title`
    /// is `"See you next season"` when `landingState.isPostSeason` and
    /// `"Almost showtime"` otherwise, and `EventListView.content` builds this
    /// view only when `landingState != .inSeason` — so the string asserted
    /// first below is reachable from `.preSeason` and nothing else. Injection
    /// 6 of the task-5 report is the evidence: serving 2027 a 404 instead of
    /// an empty payload reds precisely that assertion.
    ///
    /// The countdown line asserted after it does **not** discriminate, and an
    /// earlier version of this comment wrongly said it did.
    /// `OffSeasonLandingView.countdown` derives the year on that line from
    /// the `opening` Date it is handed, and `.postSeason` for 2026 carries
    /// `opening = SeasonCalendar.seasonStart(2027)` — so
    /// `testARailTapFromThePostSeasonLandingLandsOnThatDay`'s own launch
    /// renders the byte-identical string — and asserts it, deliberately, so
    /// that this paragraph is enforced by the suite rather than merely
    /// described in it. It is asserted here because a
    /// countdown card that is missing, or naming some third season, would
    /// mean the state carries an `opening` this test has not understood; it
    /// is not what tells `.preSeason` from `.postSeason`.
    ///
    /// The offered year is `LandingState.archiveYear`, computed in
    /// `determine` as the newest manifest year below `selectedYear` — 2026,
    /// not "2027 minus one" (they coincide here; `LandingState`'s own tests
    /// pin the distinction on a manifest with a hole in it).
    func testThePreSeasonLandingBrowsesTheArchivedSeasonItNames() {
        let app = launchFixtureApp(
            now: "2027-03-15 10:00:00", extraArgs: ["-uitest-pin-year", "2027"])

        XCTAssertTrue(
            app.staticTexts["Almost showtime"].waitForExistence(timeout: 20),
            "The launch did not reach the pre-season landing — check that 2027 serves an empty "
                + "events payload (a 404 leaves snapshot nil and reports .inSeason instead)")
        XCTAssertTrue(
            app.staticTexts["The 2027 season begins June 26"].exists,
            "The countdown card is missing, or names a season neither state should be counting "
                + "down to. Note this string is shared with .postSeason for 2026 and does not by "
                + "itself prove which state this is — the title above is what does that")

        // The rail is a `safeAreaInset` on `body`, so it is drawn over the
        // landing too. 2027 has no events, so its chips are plain views
        // rather than Buttons (`DayChip.isDisabled`) — hence the
        // identifier-only query. Asserting one here is what makes the
        // after-the-tap assertion below mean "the year moved", rather than
        // "a chip appeared".
        XCTAssertTrue(
            app.descendants(matching: .any)["day-chip-2027-06-26"].exists,
            "The rail is not showing the pinned 2027 season")

        let browse = app.buttons["Browse the 2026 season"]
        XCTAssertTrue(
            browse.exists,
            "The pre-season landing offers no button naming the archived season — "
                + "LandingState.preSeason is not carrying its archiveYear through to the view")
        browse.tap()

        // Landing *in* the season, not merely switching to it: the day the
        // 2026 fixture season opens, its events, and its chip as a real
        // Button (2026 has events; 2027's chips are not Buttons at all).
        XCTAssertTrue(
            app.staticTexts["Saturday, June 27"].waitForExistence(timeout: 20),
            "Browsing the archived season did not put its days on screen — browsePastSeason "
                + "widened the scope without selecting the year, or the fetch never landed")
        XCTAssertTrue(
            app.staticTexts["Fixture Event 1"].firstMatch.exists,
            "The archived season's days mounted with no events in them")
        XCTAssertTrue(
            app.buttons["day-chip-2026-06-27"].exists,
            "The rail did not move to the archived season")
    }

    /// #253. A day link naming another season switches to it and leaves the
    /// reader looking at that day.
    ///
    /// Driven through `-uitest-go-to-day`, which writes `model.pendingDeepLink`
    /// — the same channel `OpenDayIntent` writes through `PendingIntentLink` —
    /// so this covers the real pipeline (`PendingDayLink.consume` →
    /// `AppModel.goToDay(crossingYears:)` → `select(year:)` → the fetch →
    /// `armScroll` → `resolvePendingScroll`) rather than a shortcut around it.
    ///
    /// The launch is the ordinary in-season 2026 one; only the link crosses.
    /// 2025-07-16 is twenty-five days into the archived season.
    ///
    /// **The two halves are asserted separately and in this order**, because
    /// they fail for different reasons and a single assertion would report
    /// whichever one broke as if it were the other:
    ///
    /// 1. *The season changed.* The rail's chip strip is a plain `HStack`,
    ///    not a lazy one, so every day of the selected year is in the
    ///    accessibility tree regardless of scroll position — a `2025-…` chip
    ///    existing means `selectedYear` moved, and nothing else can produce
    ///    one.
    /// 2. *The reader is looking at the day.* The list is a `List`, which
    ///    materializes sections lazily, so a day twenty-five sections down
    ///    is **absent from the tree** until the list actually scrolls near
    ///    it. That makes `header.exists` the assertion that the armed scroll
    ///    landed — not merely a spelling check on a day title — and
    ///    `isHittable` the narrower one that it landed on screen rather than
    ///    in the row buffer just off it.
    ///
    /// This is the acceptance criterion no unit test can reach: `armScroll`
    /// writes SwiftUI `@State`, inert outside a render host, so the unit
    /// suite proves only that the *key* it would stamp is fresh. Arming
    /// before the year switch has landed stamps the outgoing season's
    /// `PendingDayScroll.Key`, `isStale` discards the target, and the reader
    /// arrives in 2025 at the top of the season — step 1 green, step 2 red,
    /// every unit test still green. Verified by performing exactly that
    /// hoist in `PendingDayLink.navigate`.
    func testACrossYearDayLinkSwitchesSeasonAndLandsOnTheDay() {
        let app = launchFixtureApp(
            now: "2026-07-15 10:00:00", extraArgs: ["-uitest-go-to-day", "2025-07-16"])

        let chip = app.buttons["day-chip-2025-07-16"]
        XCTAssertTrue(
            chip.waitForExistence(timeout: 20),
            "The app never moved to the linked day's season — the link was refused (is 2025 in "
                + "the years manifest?), or its fetch failed")

        // 2025-07-16 is a Wednesday; day headers are `ChqTime.dayTitle`
        // ("EEEE, MMMM d", en_US_POSIX, no year), same as every other day
        // assertion in this target. 2026-07-16 is a Thursday, so this string
        // cannot be satisfied by the season the app launched into.
        let header = app.staticTexts["Wednesday, July 16"]
        XCTAssertTrue(
            header.waitForExistence(timeout: 20),
            "The season changed but the list never scrolled to the linked day — a `List` does "
                + "not materialize a section twenty-five days down until it does. This is what "
                + "an armed target that was stale on arrival looks like")
        XCTAssertTrue(
            header.isHittable,
            "The linked day materialized but sits off screen in the row buffer rather than at "
                + "the top of the list")
        XCTAssertTrue(
            chip.isSelected,
            "The linked day is not the rail's pinned selection")

        // The season really was left, rather than 2025's days being shown
        // alongside 2026's: the day the app launched on has no chip any more.
        XCTAssertFalse(
            app.descendants(matching: .any)["day-chip-2026-07-15"].exists,
            "The rail still carries the outgoing season's days — the year did not switch")
    }

    /// The rail-over-landing path, which
    /// `docs/superpowers/specs/2026-08-24-off-season-landing-269-design.md`
    /// §A3 flagged as never exercised: post-season the list is replaced by
    /// `OffSeasonLandingView`, but the rail is a `safeAreaInset` on `body`
    /// and is drawn anyway. §A3's requirement was to confirm that a chip tap
    /// from there actually lands on that day — and if it does not, to hide
    /// the rail rather than offer taps that do nothing.
    ///
    /// 2026-09-15 is past every 2026 fixture event and past the season start,
    /// so `LandingState` rule 4 gives `.postSeason`. The `nextSeasonYear`
    /// half of that case is itself only reachable now that the manifest has
    /// a year above 2026 in it: the single-year fixture always produced
    /// `.postSeason(_, nil, nil, nil)`, so the "Preview the _ season" button
    /// and the countdown card had never rendered in a UI test either.
    ///
    /// **That button is asserted to exist and never tapped**, so
    /// `AppModel.previewNextSeason()` still has no end-to-end coverage — the
    /// button rendering and the button working are different claims and this
    /// test only makes the first. Tapping it would land on 2027, whose feed
    /// is empty by construction, so the observable would be an empty screen:
    /// covering `previewNextSeason` properly needs a fourth season with a
    /// sparse feed, which is a fixture change with its own blast radius.
    ///
    /// The tap target is the season's opening day, which sits at the rail's
    /// leading edge with nothing selected to scroll it away — so this needs
    /// none of `DayRailUITests`' reveal-by-swiping. `isHittable` is asserted
    /// before the tap rather than assumed, because "the chip is reachable
    /// without scrolling" is a precondition of that, not a conclusion.
    func testARailTapFromThePostSeasonLandingLandsOnThatDay() {
        let app = launchFixtureApp(now: "2026-09-15 10:00:00")

        XCTAssertTrue(
            app.staticTexts["See you next season"].waitForExistence(timeout: 20),
            "The launch did not reach the post-season landing")
        XCTAssertTrue(
            app.buttons["Preview the 2027 season"].exists,
            "The post-season landing offers no next season — the manifest's later year did not reach it")

        // Asserted here to hold a claim made in
        // `testThePreSeasonLandingBrowsesTheArchivedSeasonItNames`'s doc: this
        // countdown line is **shared** with `.preSeason` for 2027, because
        // `OffSeasonLandingView.countdown` reads the year off whichever
        // `opening` Date the state carries and `.postSeason` for 2026 carries
        // `seasonStart(2027)`. If that ever stops being true, the sibling's
        // reasoning about what does and does not discriminate the two states
        // needs rewriting — and this is what fails to say so.
        XCTAssertTrue(
            app.staticTexts["The 2027 season begins June 26"].exists,
            "The post-season countdown no longer renders the same line .preSeason for 2027 does "
                + "— see testThePreSeasonLandingBrowsesTheArchivedSeasonItNames' doc comment")

        let rail = app.scrollViews["day-rail"]
        XCTAssertTrue(
            rail.waitForExistence(timeout: 10),
            "The rail is not drawn over the off-season landing")

        let chip = app.buttons["day-chip-2026-06-27"]
        XCTAssertTrue(
            chip.exists && chip.isHittable,
            "The season's opening chip is not reachable from the landing without scrolling")
        chip.tap()

        XCTAssertTrue(
            app.staticTexts["Saturday, June 27"].waitForExistence(timeout: 20),
            "A rail tap from the off-season landing went nowhere — either goToDay must expand "
                + "the window from here, or the rail must hide over the landing (§A3)")
        XCTAssertTrue(
            app.staticTexts["Fixture Event 1"].firstMatch.exists,
            "The tapped day mounted with no events in it")
    }
}
