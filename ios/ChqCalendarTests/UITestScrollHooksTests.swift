import Foundation
import Testing
@testable import ChqCalendar

/// `UITestScrollHooks.parse` is DEBUG-only production code (it compiles out
/// of Release along with `CalendarView.applyUITestHooks`), so the whole
/// suite is too — a Release-configuration test build would not see the type.
#if DEBUG
struct UITestScrollHooksTests {
    // MARK: - Single-hook and no-hook launches are unchanged

    @Test func noFlagsLeavesBothHooksInert() throws {
        let hooks = try UITestScrollHooks.parse(["ChqCalendar", "-uitest-show-filters"])
        #expect(hooks.delay == 0)
        #expect(hooks.dropCount == 0)
    }

    @Test func delayFlagAloneParsesToThreeSeconds() throws {
        let hooks = try UITestScrollHooks.parse(["ChqCalendar", "-uitest-delay-pending-scroll"])
        #expect(hooks.delay == 3)
        #expect(hooks.dropCount == 0)
    }

    /// The exact shape `DayRailUITests.testADayDeepLinkSurvivesADroppedScroll`
    /// launches with — this pair of assertions is what pins that that test's
    /// single-flag path is untouched by the mutual-exclusion check.
    @Test func dropFlagAloneParsesItsCount() throws {
        let hooks = try UITestScrollHooks.parse(["ChqCalendar", "-uitest-drop-scrolls", "3"])
        #expect(hooks.delay == 0)
        #expect(hooks.dropCount == 3)
    }

    /// A non-positive or unparseable count is ignored rather than rejected,
    /// matching the `count > 0` guard this parsing was extracted from — the
    /// hook stays inert instead of the app refusing to launch.
    @Test func dropFlagWithANonPositiveOrNonNumericCountStaysInert() throws {
        #expect(try UITestScrollHooks.parse(["ChqCalendar", "-uitest-drop-scrolls", "0"]).dropCount == 0)
        #expect(try UITestScrollHooks.parse(["ChqCalendar", "-uitest-drop-scrolls", "-2"]).dropCount == 0)
        #expect(try UITestScrollHooks.parse(["ChqCalendar", "-uitest-drop-scrolls", "many"]).dropCount == 0)
        #expect(try UITestScrollHooks.parse(["ChqCalendar", "-uitest-drop-scrolls"]).dropCount == 0)
    }

    // MARK: - The two hooks are mutually exclusive (#252)

    @Test func bothFlagsTogetherThrow() {
        #expect(throws: UITestScrollHooks.HookConflict.self) {
            try UITestScrollHooks.parse([
                "ChqCalendar", "-uitest-delay-pending-scroll", "-uitest-drop-scrolls", "3",
            ])
        }
    }

    /// The whole point of #252 is that the failure names the incompatibility
    /// rather than looking like a bug in the code under test, so the message
    /// itself is part of the contract.
    @Test func theConflictMessageNamesBothFlags() {
        var message = ""
        #expect(throws: (any Error).self) {
            do {
                _ = try UITestScrollHooks.parse([
                    "ChqCalendar", "-uitest-drop-scrolls", "2", "-uitest-delay-pending-scroll",
                ])
            } catch {
                message = String(describing: error)
                throw error
            }
        }
        #expect(message.contains("-uitest-delay-pending-scroll"))
        #expect(message.contains("-uitest-drop-scrolls"))
        #expect(message.contains("#252"))
    }

    /// Order-independent, and independent of whether the drop count would
    /// itself have been inert: it is the *pair of flags* that is rejected,
    /// so a launch can never half-arm one hook while silently dropping the
    /// other.
    @Test func bothFlagsThrowInEitherOrderAndEvenWithAnInertDropCount() {
        #expect(throws: UITestScrollHooks.HookConflict.self) {
            try UITestScrollHooks.parse([
                "ChqCalendar", "-uitest-delay-pending-scroll", "-uitest-drop-scrolls", "0",
            ])
        }
        #expect(throws: UITestScrollHooks.HookConflict.self) {
            try UITestScrollHooks.parse([
                "ChqCalendar", "-uitest-drop-scrolls", "nope", "-uitest-delay-pending-scroll",
            ])
        }
    }
}
#endif
