import CoreGraphics

/// Whether the floating filter bar shows full labels or shrinks to icons.
nonisolated enum BarState: Equatable, Sendable {
    case expanded
    case compact
}

/// Turns a stream of scroll offsets into `BarState` changes.
///
/// Compare with the `FilterBarCollapseDriver` this replaces, which had to
/// distrust its own input: that bar was a `safeAreaInset`, so collapsing it
/// changed the list's height, which changed the geometry it was reading,
/// which could re-trigger a collapse. Hence its settle window, its measured
/// give-back, and its refusal to act on lists that barely overflow.
///
/// None of that applies here. The bar is an overlay over a list whose bottom
/// content margin is a constant, so **no state this type returns can change
/// the geometry it reads**. Direction plus a threshold is genuinely the whole
/// algorithm. If this ever seems to need a settling flag, the bar has stopped
/// being an overlay and the fix belongs upstream, not here.
nonisolated struct BarPresentation: Equatable, Sendable {
    /// How far the user must travel in one direction before the bar reacts.
    /// Small enough to feel responsive, large enough that a finger tremor or
    /// a bounce at the end of a fling does not toggle it.
    static let threshold: CGFloat = 40

    private(set) var state: BarState = .expanded

    /// `nil` until the first sample — the first offset establishes a
    /// reference point and can produce no delta.
    private var lastOffset: CGFloat?

    /// Signed distance travelled since the last direction change. Positive
    /// is scrolling further into the content.
    private var accumulated: CGFloat = 0

    init() {}

    /// Feeds one scroll sample. Returns the new state if it changed, `nil`
    /// otherwise, so callers only animate on an actual transition.
    ///
    /// `insetTop` is the list's top content inset: a `List` at rest under a
    /// navigation bar reports `contentOffset.y == -insetTop`, not `0`, so
    /// "at the top" has to be measured against the inset rather than zero.
    mutating func received(offset: CGFloat, insetTop: CGFloat) -> BarState? {
        defer { lastOffset = offset }

        // At (or rubber-banded above) the top, the bar is always whole —
        // immediately, without waiting for `threshold` points of travel, so
        // that a scroll-to-top tap lands with the bar already expanded.
        if offset <= -insetTop {
            accumulated = 0
            return transition(to: .expanded)
        }

        guard let lastOffset else { return nil }

        let delta = offset - lastOffset
        guard delta != 0 else { return nil }

        // A reversal restarts the measurement from here, so 30pt down then
        // 30pt down again with a pause between them does not silently add up
        // to a collapse the user never asked for.
        if (delta > 0) != (accumulated > 0) {
            accumulated = 0
        }
        accumulated += delta

        if accumulated >= Self.threshold {
            return transition(to: .compact)
        }
        if accumulated <= -Self.threshold {
            return transition(to: .expanded)
        }
        return nil
    }

    private mutating func transition(to next: BarState) -> BarState? {
        guard state != next else { return nil }
        state = next
        accumulated = 0
        return next
    }
}
