import CoreGraphics

/// Decides whether the filter bar's secondary rows (venues, categories,
/// reset) are hidden, from the event list's scroll offset.
///
/// The `threshold` hysteresis is the whole point: a ~100pt layout change
/// must not fire on a few points of finger jitter. `pivot` records where
/// the current direction began, and the state flips only once the offset
/// has travelled `threshold` points away from it.
///
/// Three real-device bugs, all one root cause seen from different angles —
/// scroll-view geometry that isn't legitimate user scroll intent reaching
/// this decision unfiltered — are handled by two mechanisms below:
///
/// 1. **Top rubber-band.** Overscrolling above the top and bouncing back is
///    UIKit physics, not the user asking to expand the bar. `clamped`'s
///    `max(offset, 0)` floor has always excluded this.
/// 2. **Bottom rubber-band.** The same physics at the other end: overscroll
///    past the true bottom and bounce back reads as `threshold`+ points of
///    "scroll up," which expands the bar; the settle back down re-crosses
///    the threshold and collapses it again — a show/hide/show/hide flicker
///    driven entirely by the bounce. `clamped`'s new ceiling at `validMax`
///    (the same coordinate space's reading of "scrolled exactly to the true
///    bottom, no overscroll") excludes this the same way the top floor
///    always excluded the top case.
/// 3. **Short, heavily-filtered content.** Collapsing grows the viewport by
///    giving back the bar's secondary rows; if the content barely
///    overflowed to begin with (narrow filters are the point of this app,
///    so this is an ordinary state, not an edge case), the taller viewport
///    can swallow the overflow entirely, `List` clamps `contentOffset` back
///    toward the top, and that clamp — a *real* offset change — force-
///    expands the bar via the top-clamp branch. Collapse, clamp, expand,
///    repeat, forever, and the last row is unreachable. This one isn't a
///    matter of excluding illegitimate geometry (the clamp-back is a real,
///    if self-inflicted, offset change) — it has to be prevented one step
///    earlier, by refusing to *enter* collapse when there isn't enough
///    spare overflow to sustain it. That's `minimumOverflowToCollapse`.
nonisolated enum FilterBarCollapse {
    /// `offset` is how far the list has scrolled down from its top, in
    /// points — 0 at the top, growing positive as content moves up.
    ///
    /// `overflow` is how much taller the scrollable content is than the
    /// list's current viewport (`contentSize.height - containerSize
    /// .height`), and `insetTop` is the list's current top content inset
    /// (`contentInsets.top`) — the same value already folded into `offset`
    /// by the caller, needed again here to express `validMax` (the
    /// legitimate top-of-range-to-true-bottom span) in that same
    /// coordinate space. `minimumOverflowToCollapse` is how much of
    /// `overflow` must remain *after* collapsing for the collapse to be
    /// worthwhile (case 3 above).
    ///
    /// The defaults (`.infinity` / `0` / `0`) make both the clamp's ceiling
    /// and the gate no-ops, since most callers — and every pre-existing
    /// test of the offset/pivot/threshold behavior — have no reason to
    /// think about viewport geometry at all.
    ///
    /// `minimumOverflowToCollapse` only gates the expanded → collapsed
    /// transition; once collapsed, a shrinking `overflow` does not by
    /// itself force a re-expand — only scrolling up / reaching the top (or
    /// the bottom clamp correcting a now-invalid deep scroll position, see
    /// case 3) does. Re-checking the gate on every frame while collapsed
    /// would reintroduce exactly the flip it exists to prevent.
    static func next(
        isCollapsed: Bool,
        offset: CGFloat,
        pivot: CGFloat,
        overflow: CGFloat = .infinity,
        insetTop: CGFloat = 0,
        minimumOverflowToCollapse: CGFloat = 0,
        threshold: CGFloat = 40
    ) -> (isCollapsed: Bool, pivot: CGFloat) {
        let validMax = max(0, overflow) + insetTop
        let clamped = min(max(offset, 0), validMax)

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
            guard clamped >= pivot + threshold else { return (false, pivot) }
            guard overflow > minimumOverflowToCollapse else { return (false, pivot) }
            return (true, clamped)
        }
    }
}
