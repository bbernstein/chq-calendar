import XCTest

/// The magnifier button, and the one thing about it no unit test can reach
/// (#256 review fix).
///
/// `.always` used to keep the search field on screen at all times; #256
/// relaxed it to `.automatic` so the field scrolls away, and the toolbar
/// magnifier is the entire replacement for that discoverability. The wiring
/// it depends on crosses two view boundaries: `searchFocus` is a
/// `FocusState<Bool>.Binding` declared in `CalendarView`, passed into
/// `EventListView` through a `NavigationStack`, written by a button in that
/// child's toolbar — while `.searchFocused` is applied to the *container*.
/// If that write does not reach the field, search silently regresses to
/// pull-down-only, which is exactly the state `.always` existed to prevent
/// and which every other test on this branch would stay green through.
final class SearchToolbarUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// Tapping the magnifier must leave the *search field* holding keyboard
    /// focus.
    ///
    /// Typing is the assertion rather than a check for the software keyboard:
    /// `app.typeText` goes to whatever holds focus and fails outright when
    /// nothing does, so a field that took focus reads back the term and a
    /// binding that never arrived fails here — without depending on whether
    /// the simulator happens to have a hardware keyboard attached, which
    /// decides whether `app.keyboards` exists at all and has nothing to do
    /// with the behaviour under test.
    func testTheMagnifierFocusesTheSearchField() {
        let app = launchFixtureApp()

        let magnifier = app.buttons["search-toolbar-button"]
        XCTAssertTrue(
            magnifier.waitForExistence(timeout: 30),
            "The toolbar magnifier never appeared; search has no discoverable entry point")
        magnifier.tap()

        let field = app.searchFields.firstMatch
        XCTAssertTrue(
            field.waitForExistence(timeout: 10),
            "Tapping the magnifier did not bring up the search field")

        app.typeText("med")
        XCTAssertEqual(
            field.value as? String, "med",
            "The search field did not take keyboard focus from the magnifier — "
                + "the `searchFocus` binding is not reaching `.searchFocused`")
    }

    /// Focus must survive `searchFieldDisplayMode` flipping under the field
    /// mid-word.
    ///
    /// `CalendarView` debounces 200 ms before committing `searchDraft` into
    /// `model.filter.searchText`, and the `.searchable` `displayMode`
    /// argument is derived from that *committed* value — so roughly 200 ms
    /// after the first keystroke the field's own presentation changes from
    /// `.automatic` to `.always` while the reader is still typing, and back
    /// again on delete-to-empty. Whether SwiftUI rebuilds the search
    /// presentation there, dropping focus and the keyboard mid-word, is not
    /// something a screenshot answers and not something the other tests can
    /// see: every one of them sets the term through `-uitest-search`, which
    /// writes the committed value directly and skips the transition
    /// entirely.
    ///
    /// The half-second between characters is the whole point — it is longer
    /// than the debounce, so each keystroke lands on the far side of a
    /// commit. Typing is again the assertion: `app.typeText` fails outright
    /// if focus has gone, and `field.value` shows the term accumulating if
    /// it has not.
    ///
    /// The wait itself (`waitForSearchDebounceWindow` below) has no better
    /// alternative than a fixed span: `field.value` already reads back the
    /// freshly typed character the instant `app.typeText` returns, well
    /// before `searchDraft`'s 200 ms `.task(id:)` debounce commits to
    /// `model.filter.searchText` and `searchFieldDisplayMode` recomputes —
    /// so a predicate that just waits for `field.value == expected` would
    /// resolve immediately and never actually observe the flip this test
    /// exists to catch. There is no accessibility-visible signal for "the
    /// debounce fired and displayMode finished recomputing"; that happens
    /// entirely on the model side. The fixed wait is unavoidable — what
    /// changed is *how* it waits: a run-loop-pumped expectation instead of
    /// `Thread.sleep`, so the test process's own async plumbing (the thing
    /// `waitForExistence` etc. rely on) keeps running while we wait, rather
    /// than being blocked out for the span.
    func testFocusSurvivesTheDisplayModeFlipWhileTyping() {
        let app = launchFixtureApp()

        let magnifier = app.buttons["search-toolbar-button"]
        XCTAssertTrue(magnifier.waitForExistence(timeout: 30))
        magnifier.tap()

        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))

        let term = "med"
        for (index, character) in term.enumerated() {
            app.typeText(String(character))
            waitForSearchDebounceWindow()
            XCTAssertEqual(
                field.value as? String, String(term.prefix(index + 1)),
                "Typing \"\(character)\" past the 200 ms debounce lost the field: "
                    + "the displayMode flip is rebuilding the search presentation")
        }

        // And back the other way. Deleting to empty flips `displayMode` from
        // `.always` to `.automatic`, which is the same transition in reverse
        // and the one that would strand a reader mid-correction.
        for remaining in stride(from: term.count - 1, through: 0, by: -1) {
            app.typeText(XCUIKeyboardKey.delete.rawValue)
            waitForSearchDebounceWindow()
            let expected = remaining == 0 ? "Search events" : String(term.prefix(remaining))
            XCTAssertEqual(
                field.value as? String, expected,
                "Deleting back to \(remaining) characters lost the field")
        }
    }

    /// Waits out a fixed span via the run loop, rather than blocking the
    /// test thread the way `Thread.sleep` would.
    ///
    /// This is a genuine fixed-duration wait, not a disguised one: there is
    /// no observable proxy for "the 200 ms `searchDraft` debounce fired and
    /// `searchFieldDisplayMode` finished recomputing" short of waiting out
    /// (a margin past) the debounce itself and then reading `field.value` —
    /// which the caller does immediately after this returns. Fulfilling the
    /// expectation from a timer (rather than leaving it unfulfilled and
    /// relying on `XCTWaiter` timeout) means the run loop keeps servicing
    /// the test process's own asynchronous work — the accessibility
    /// notifications `waitForExistence` and friends depend on — for the
    /// full span, instead of that plumbing sitting idle behind a hard sleep.
    private func waitForSearchDebounceWindow(seconds: TimeInterval = 0.5) {
        let settled = expectation(description: "search debounce window elapsed")
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { settled.fulfill() }
        wait(for: [settled], timeout: seconds + 5)
    }

    /// `Clear Filters` zeroes `searchText` while the sheet is open, which
    /// flips `displayMode` back to `.automatic` underneath it — the third
    /// place the same transition fires, and the only one where the reader is
    /// not touching the field at all.
    func testClearFiltersWithATermActiveLeavesTheScreenUsable() {
        let app = launchFixtureApp(extraArgs: ["-uitest-search", "meditation"])

        let filters = app.buttons["filters-toolbar-button"]
        XCTAssertTrue(filters.waitForExistence(timeout: 30))
        XCTAssertTrue(filters.label.contains("1 active"))
        filters.tap()

        let clear = app.buttons["Clear Filters"]
        XCTAssertTrue(clear.waitForExistence(timeout: 10))
        clear.tap()

        // The sheet stays up — its footer is still answering — and dismisses
        // normally afterwards. If the flip had taken the search presentation
        // down with the screen, neither would still be true.
        let dismiss = app.buttons.matching(
            NSPredicate(format: "label BEGINSWITH 'Show '")).firstMatch
        XCTAssertTrue(
            dismiss.waitForExistence(timeout: 10),
            "The filter sheet did not survive Clear Filters flipping displayMode")
        dismiss.tap()

        let rail = app.scrollViews["day-rail"]
        XCTAssertTrue(
            rail.waitForExistence(timeout: 10),
            "The day rail did not survive Clear Filters flipping displayMode")
        XCTAssertTrue(
            filters.label.contains("none active"),
            "Clear Filters left the toolbar button still reporting a filter")
    }
}
