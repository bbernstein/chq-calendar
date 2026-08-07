import CoreGraphics

/// Pure reduction logic for `WeekRangeStrip`'s single drag gesture, kept
/// out of the view so issue #162's selection rules are unit-testable:
/// tap replaces the selection with one week (rule 1), a drag selects the
/// anchor-to-finger range (rule 2), and retreating mid-drag shrinks it
/// (rule 3 — the range always tracks the *current* finger position).
nonisolated enum WeekStripDrag {
    /// The 1-based segment under x, clamped so drags that wander outside
    /// the strip's bounds stick to the nearest edge segment.
    static func segment(atX x: CGFloat, width: CGFloat, count: Int) -> Int {
        guard width > 0, count > 0 else { return 1 }
        let raw = Int(x / (width / CGFloat(count))) + 1
        return min(max(raw, 1), count)
    }

    static func range(anchor: Int, current: Int) -> ClosedRange<Int> {
        min(anchor, current)...max(anchor, current)
    }

    /// The selection to store on touch-up. A tap (anchor == current) on the
    /// week that is already the *entire* selection toggles it off; any other
    /// gesture replaces the selection with the dragged range.
    static func commit(anchor: Int, current: Int, existing: Set<Int>) -> Set<Int> {
        if anchor == current, existing == [anchor] { return [] }
        return Set(range(anchor: anchor, current: current))
    }

    /// VoiceOver's "extend selection" action: one contiguous run covering
    /// the existing selection and `n`. From nothing, plain selection.
    static func extended(from existing: Set<Int>, to n: Int) -> Set<Int> {
        guard let lo = existing.min(), let hi = existing.max() else { return [n] }
        return Set(min(lo, n)...max(hi, n))
    }
}
