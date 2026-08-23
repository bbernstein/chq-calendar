import Foundation

#if DEBUG
/// Launch-argument parsing for the two DEBUG-only scroll hooks
/// `CalendarView.applyUITestHooks` arms — `-uitest-delay-pending-scroll`
/// (`AppModel.uiTestPendingScrollDelay`) and `-uitest-drop-scrolls <n>`
/// (`AppModel.uiTestScrollsToDrop`).
///
/// Extracted from `CalendarView` for one reason (#252): the two hooks do
/// **not** compose, and until now a launch that passed both produced a
/// plausible-looking red that pointed at the code under test rather than at
/// the harness. A deferred `resolvePendingScroll` and the drop-retry chain
/// interfere — a 2 s delay sits well inside the 5 s retry window, so the
/// resulting failure is never about the deadline such a test was written to
/// probe. Bisecting that cost real time during #250. The fix is not to make
/// them compose (that would mean redesigning DEBUG harness code nobody needs
/// composed) but to reject the pair at launch, by name, before either hook
/// is armed.
///
/// Pure and `nonisolated` so the rejection is unit-testable without booting
/// the app: `CalendarView` is the only caller and turns a thrown
/// `HookConflict` into an immediate `preconditionFailure`.
///
/// Compiles out of Release builds along with its only call site.
nonisolated enum UITestScrollHooks {
    /// Defers the *next* pending scroll's resolution by this many seconds.
    static let delayFlag = "-uitest-delay-pending-scroll"

    /// Swallows the next `n` `proxy.scrollTo` calls. Takes a value.
    static let dropFlag = "-uitest-drop-scrolls"

    /// Seconds `-uitest-delay-pending-scroll` arms, comfortably longer than
    /// opening the date sheet and tapping a scope chip takes.
    static let delaySeconds: TimeInterval = 3

    /// Thrown when a launch passes both hooks. Its description is the whole
    /// point of #252 — the failure has to name the incompatibility rather
    /// than look like a bug in the code under test.
    struct HookConflict: Error, CustomStringConvertible {
        var description: String {
            """
            \(UITestScrollHooks.delayFlag) and \(UITestScrollHooks.dropFlag) \
            cannot be used together: the deferred pending-scroll resolution and \
            the drop-retry chain interfere, so the combination fails for reasons \
            unrelated to whatever the test is probing (a delay shorter than the \
            retry window is swallowed by it). See issue #252. Pass one hook or \
            the other, not both.
            """
        }
    }

    /// The hook values a launch with these `arguments` should arm.
    ///
    /// - Returns: `delay` in seconds (`0` when the flag is absent, and in
    ///   every real launch) and `dropCount` (`0` when the flag is absent, has
    ///   no value, or its value does not parse as a positive `Int` — an
    ///   inert hook, matching the `count > 0` guard this was extracted from).
    /// - Throws: `HookConflict` when *both* flags are present, regardless of
    ///   order and regardless of whether the drop count would itself have
    ///   been inert. It is the pair that is rejected, so a launch can never
    ///   half-arm one hook while quietly discarding the other.
    static func parse(_ arguments: [String]) throws -> (delay: TimeInterval, dropCount: Int) {
        let hasDelay = arguments.contains(delayFlag)
        let hasDrop = arguments.contains(dropFlag)
        guard !(hasDelay && hasDrop) else { throw HookConflict() }

        var dropCount = 0
        if let flagIndex = arguments.firstIndex(of: dropFlag),
           arguments.index(after: flagIndex) < arguments.endIndex,
           let count = Int(arguments[arguments.index(after: flagIndex)]), count > 0 {
            dropCount = count
        }

        return (delay: hasDelay ? delaySeconds : 0, dropCount: dropCount)
    }
}
#endif
