import CoreGraphics

/// Decides whether the filter bar's secondary rows (venues, categories,
/// reset) are hidden, from the event list's scroll offset.
///
/// The `threshold` hysteresis is the whole point: a ~100pt layout change
/// must not fire on a few points of finger jitter. `pivot` records where
/// the current direction began, and the state flips only once the offset
/// has travelled `threshold` points away from it.
nonisolated enum FilterBarCollapse {
    /// `offset` is how far the list has scrolled down from its top, in
    /// points — 0 at the top, growing positive as content moves up.
    /// Negative values (rubber-band overscroll) are treated as 0.
    static func next(
        isCollapsed: Bool,
        offset: CGFloat,
        pivot: CGFloat,
        threshold: CGFloat = 40
    ) -> (isCollapsed: Bool, pivot: CGFloat) {
        let clamped = max(offset, 0)

        // At the top the bar is always whole, whatever the pivot was.
        if clamped <= 0 {
            return (false, 0)
        }

        if isCollapsed {
            // Track the deepest point reached so an upward swipe is measured
            // from there, not from wherever the collapse happened to fire.
            if clamped > pivot { return (true, clamped) }
            return clamped <= pivot - threshold ? (false, clamped) : (true, pivot)
        } else {
            if clamped < pivot { return (false, clamped) }
            return clamped >= pivot + threshold ? (true, clamped) : (false, pivot)
        }
    }
}
