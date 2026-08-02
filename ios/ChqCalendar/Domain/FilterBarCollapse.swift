import CoreGraphics

/// One reading of the event list's scroll geometry, in the only two terms
/// the collapse decision needs: where the list is scrolled to, and how far
/// it can legitimately be scrolled.
///
/// Kept as its own type — rather than the view reading `ScrollGeometry`
/// fields inline — so the whole decision pipeline can be replayed in tests
/// from geometry actually captured off a running app.
///
/// **`contentOffset` and `insetTop` are stored separately on purpose.**
/// SwiftUI reports the same physical layout in two different conventions
/// depending on whether the list's top inset is mid-animation, and only the
/// *sum* is comparable across them:
/// - settled: `insetTop` carries the bar's height and `contentOffset` is
///   negative while the list rests against it (`-330` / `330`);
/// - while the inset animates: `insetTop` is reported as `0`, the inset is
///   folded into `containerHeight` instead, and `contentOffset` is already
///   inset-relative (`53.3` / `0`).
///
/// See `FilterBarCollapseDriver` for why even the sum cannot be trusted
/// during an inset animation.
nonisolated struct ScrollGeometrySample: Equatable, Sendable {
    /// `ScrollGeometry.contentOffset.y`.
    var contentOffset: CGFloat
    /// `ScrollGeometry.contentInsets.top`.
    var insetTop: CGFloat
    /// `ScrollGeometry.contentInsets.bottom`.
    var insetBottom: CGFloat
    /// `ScrollGeometry.containerSize.height`.
    var containerHeight: CGFloat
    /// `ScrollGeometry.contentSize.height`.
    var contentHeight: CGFloat

    init(
        contentOffset: CGFloat,
        insetTop: CGFloat,
        insetBottom: CGFloat,
        containerHeight: CGFloat,
        contentHeight: CGFloat
    ) {
        self.contentOffset = contentOffset
        self.insetTop = insetTop
        self.insetBottom = insetBottom
        self.containerHeight = containerHeight
        self.contentHeight = contentHeight
    }

    /// How far the list has scrolled down from its top, in points — 0 at the
    /// top, growing positive as content moves up, negative only while
    /// rubber-banding above the top.
    var offset: CGFloat { contentOffset + insetTop }

    /// The largest `offset` reachable without rubber-banding past the end —
    /// the list resting exactly at its true bottom.
    ///
    /// `contentHeight - containerHeight` is the raw overflow; the insets are
    /// added because `offset` is measured from the top *inset* edge, and a
    /// scroll view's bottom limit sits `insetBottom` below the content's
    /// last point.
    var validMax: CGFloat {
        max(0, contentHeight - containerHeight + insetTop + insetBottom)
    }

    /// Whether `other` describes the same viewport as this sample — same
    /// insets, same container — so any difference between the two is pure
    /// scrolling rather than a layout change.
    ///
    /// The 1pt tolerance absorbs the sub-point jitter a real device reports
    /// in `insetBottom` (86.0 / 85.8 / 86.0 within a single drag). Every
    /// layout change this needs to catch moves the viewport by ~100–140pt
    /// over a fifth of a second — tens of points per frame — so no genuine
    /// inset animation can hide inside the tolerance.
    func describesSameViewport(as other: ScrollGeometrySample) -> Bool {
        abs(insetTop - other.insetTop) <= 1
            && abs(insetBottom - other.insetBottom) <= 1
            && abs(containerHeight - other.containerHeight) <= 1
    }
}

/// Decides whether the filter bar's secondary rows (venues, categories,
/// reset) are hidden, from the event list's scroll offset.
///
/// The `threshold` hysteresis is the whole point: a ~100pt layout change
/// must not fire on a few points of finger jitter. `pivot` records where
/// the current direction began, and the state flips only once the offset
/// has travelled `threshold` points away from it.
///
/// Two mechanisms beyond that hysteresis, each from a bug reproduced on a
/// physical device:
///
/// 1. **Rubber-band overscroll, at either end.** Overscrolling past a limit
///    and bouncing back is UIKit physics, not the user asking for anything.
///    At the top that has always been excluded by `clamped`'s `max(offset,
///    0)` floor; `validMax` is the matching ceiling at the bottom, without
///    which a bounce reads as `threshold`+ points of "scroll up" (expand)
///    followed by `threshold`+ points of settling back down (collapse).
/// 2. **Collapsing into content that cannot absorb it.** Hiding the
///    secondary rows hands their height back to the list, which *shortens*
///    the scrollable range by the same amount. If the list is already within
///    that distance of its bottom, the scroll view has to clamp
///    `contentOffset` to stay in range — a real, if self-inflicted, scroll
///    upward, which then reads as the user scrolling up and expands the bar
///    again, which lengthens the range again, forever.
///    `minimumHeadroomToCollapse` refuses the collapse in exactly the
///    situations where that clamp would happen, so **a collapse never moves
///    the content — as long as the caller's figure is at least what the
///    collapse really gives back**. That is not a constant: it is 100pt with
///    no reset row, 150pt with one, ~140pt more again with a facet panel
///    open (collapsing closes it too), and it scales with Dynamic Type. See
///    `FilterBarCollapseDriver`, which measures it rather than assuming it.
///    This covers the reported short-filtered-list oscillation and, as the
///    same condition, the bottom of any list.
nonisolated enum FilterBarCollapse {
    /// - Parameters:
    ///   - offset: `ScrollGeometrySample.offset` — 0 at the top, growing
    ///     positive as content moves up.
    ///   - pivot: where the current scroll direction began; carried between
    ///     calls by the caller.
    ///   - validMax: `ScrollGeometrySample.validMax` — the largest `offset`
    ///     reachable without overscrolling. Defaults to `.infinity`, which
    ///     makes the clamp's ceiling and the headroom check no-ops for
    ///     callers reasoning purely about offsets.
    ///   - minimumHeadroomToCollapse: how much room must remain between
    ///     `offset` and `validMax` for a collapse to be allowed — set it to
    ///     at least the height the collapse gives back (case 2 above).
    ///     Checked only on the expanded → collapsed transition: once
    ///     collapsed, shrinking headroom must not force a re-expand, or the
    ///     flip it prevents would come straight back.
    static func next(
        isCollapsed: Bool,
        offset: CGFloat,
        pivot: CGFloat,
        validMax: CGFloat = .infinity,
        minimumHeadroomToCollapse: CGFloat = 0,
        threshold: CGFloat = 40
    ) -> (isCollapsed: Bool, pivot: CGFloat) {
        let clamped = min(max(offset, 0), max(validMax, 0))

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
            guard validMax - clamped >= minimumHeadroomToCollapse else { return (false, pivot) }
            return (true, clamped)
        }
    }
}

/// Sequences `FilterBarCollapse.next` over a stream of scroll-geometry
/// samples, and — the part that stops the bar flickering — decides which
/// samples are even admissible.
///
/// ## Why admissibility is the whole problem
///
/// The bar is a `.safeAreaInset(edge: .top)` on the list, so collapsing it
/// animates the list's own top inset. Animating the inset changes the
/// geometry, the geometry drives this decision, and the decision animates
/// the inset: a closed loop in which the bar's own transition is
/// indistinguishable, frame by frame, from the user scrolling.
///
/// Logging real geometry off a device during that transition shows why no
/// arithmetic on a single sample can break the loop. Settled, SwiftUI
/// reports `contentOffset=-303.3, insetTop=330, containerHeight=874`; four
/// frames into the collapse it reports `contentOffset=53.3, insetTop=0,
/// containerHeight=544` — the same physical layout, in a different
/// convention, where the inset has moved out of `contentInsets` and into
/// `containerSize`. Worse, the frame *between* those two is
/// `contentOffset=0, insetTop=0, containerHeight=874`, which is consistent
/// with neither: read under either convention it says the list is back at
/// the very top, and "at the top" force-expands the bar. That one frame is
/// the flicker. It cannot be filtered by a threshold (it is a full
/// 53pt lie), by a normalised metric (both terms are wrong at once), or by
/// comparing against the previous sample (the difference looks exactly like
/// a fast upward fling).
///
/// So this driver does not try to interpret geometry mid-transition. It
/// ignores it:
///
/// - **Settling.** A flip marks the driver as settling; every sample is
///   dropped until the caller reports the animation finished (from
///   `withAnimation`'s completion handler, i.e. from the animation itself
///   rather than from a timer that guesses how long it takes). Because the
///   suppression window *is* the animation, the bar flips exactly once per
///   genuine threshold crossing — the loop cannot run at all, as opposed to
///   running at a rate limit.
/// - **Viewport stability.** A sample is admissible only when it describes
///   the same viewport as the sample before it. This costs one frame after
///   any layout change and covers inset animations the driver did *not*
///   start — chiefly a facet panel opening, which grows the inset ~140pt
///   underneath a list nobody scrolled.
///
/// ## Why the head­room requirement is measured rather than configured
///
/// The gate above needs one number: how much height a collapse hands back.
/// That number is not a property of the code, it is a property of what the
/// bar is currently rendering — a reset row adds ~50pt, an open facet panel
/// (which a collapse also closes) adds ~140pt more, and Dynamic Type scales
/// every row. A constant measured once at one text size on one filter state
/// is wrong for every other combination, and wrong in the unsafe direction
/// for the taller ones.
///
/// So the driver reads it off the geometry it is already being handed: the
/// top inset carries the bar's height, so the difference between the inset
/// last seen while expanded and the inset last seen while collapsed *is*
/// the give-back, in whatever state the bar is actually in. Only trustworthy
/// samples (viewport-stable, non-zero inset) contribute, and until both
/// states have been seen — i.e. before the first flip of a session — the
/// caller's estimate stands in.
@MainActor
final class FilterBarCollapseDriver {
    /// The bar's current state. The view mirrors this into `@State` when
    /// `received` reports a flip; it is not observed directly, so the
    /// per-frame `pivot` bookkeeping below cannot invalidate a view body
    /// (which would rerun the whole filter/group pipeline on every frame of
    /// every drag).
    private(set) var isCollapsed = false

    private var pivot: CGFloat = 0
    private var isSettling = false
    private var previous: ScrollGeometrySample?

    private let estimatedGiveBack: CGFloat
    private let headroomMargin: CGFloat

    /// The top inset most recently observed from a trustworthy sample in
    /// each state. Survives `reset()`: they describe the *bar*, which
    /// outlives any one `List`.
    private var insetTopWhileExpanded: CGFloat?
    private var insetTopWhileCollapsed: CGFloat?

    /// How much height collapsing hands back, as actually observed — `nil`
    /// until the bar has been seen settled in both states.
    var measuredGiveBack: CGFloat? {
        guard let expanded = insetTopWhileExpanded,
              let collapsed = insetTopWhileCollapsed,
              expanded > collapsed
        else { return nil }
        return expanded - collapsed
    }

    /// The `minimumHeadroomToCollapse` this driver passes to
    /// `FilterBarCollapse.next` — the measured give-back once known, the
    /// caller's estimate until then, plus a margin either way.
    var requiredHeadroom: CGFloat {
        (measuredGiveBack ?? estimatedGiveBack) + headroomMargin
    }

    /// - Parameters:
    ///   - estimatedGiveBack: what to assume collapsing gives back until the
    ///     first flip makes it measurable. Err high: an over-estimate only
    ///     refuses a collapse slightly nearer the bottom of a list, while an
    ///     under-estimate is the oscillation this gate exists to prevent.
    ///   - headroomMargin: added on top of the give-back, so a collapse
    ///     leaves slack rather than landing exactly on the limit.
    init(estimatedGiveBack: CGFloat, headroomMargin: CGFloat = 40) {
        self.estimatedGiveBack = estimatedGiveBack
        self.headroomMargin = headroomMargin
    }

    /// Feeds one geometry sample in.
    ///
    /// - Returns: the bar's new collapsed state when this sample flipped it
    ///   — the caller should animate to it and call `settled()` when that
    ///   animation completes — or `nil` when nothing should change, which
    ///   is the overwhelming majority of samples.
    func received(_ sample: ScrollGeometrySample) -> Bool? {
        // Recorded even for inadmissible samples: "same viewport as the
        // frame before" is only meaningful against the immediately
        // preceding frame.
        defer { previous = sample }

        guard !isSettling else { return nil }
        guard let previous, previous.describesSameViewport(as: sample) else { return nil }

        // Past both admissibility guards, so this sample's insets are the
        // settled ones rather than a mid-transition reading. `> 0` rejects
        // the `insetTop: 0` convention SwiftUI switches to while *any* inset
        // animates — there is always a navigation bar, so a real top inset
        // is never zero. Recorded before the offset check: a stationary list
        // still teaches the driver what the bar currently costs.
        if sample.insetTop > 0 {
            if isCollapsed {
                insetTopWhileCollapsed = sample.insetTop
            } else {
                insetTopWhileExpanded = sample.insetTop
            }
        }

        guard sample.offset != previous.offset else { return nil }

        let next = FilterBarCollapse.next(
            isCollapsed: isCollapsed,
            offset: sample.offset,
            pivot: pivot,
            validMax: sample.validMax,
            minimumHeadroomToCollapse: requiredHeadroom)
        pivot = next.pivot

        guard next.isCollapsed != isCollapsed else { return nil }
        isCollapsed = next.isCollapsed
        isSettling = true
        return isCollapsed
    }

    /// Reports that the animation started for the last flip has finished,
    /// re-admitting geometry samples.
    func settled() {
        isSettling = false
    }

    /// Drops everything tied to the `List` that produced it, for when that
    /// list goes away — a filter that empties the results, a year switch, a
    /// snapshot cleared mid-transition.
    ///
    /// Two distinct jobs, both of which the caller gets wrong by omission:
    ///
    /// 1. **Un-wedging.** `isSettling` is otherwise cleared only by the
    ///    animation's own completion handler. If the animating view is torn
    ///    down inside that window — `AppModel.select(year:)` clears the
    ///    snapshot, and the filter bar is gated on the snapshot being
    ///    non-nil — a completion that never runs would leave the driver
    ///    dropping every sample for the rest of its life, silently disabling
    ///    collapse for the session. This is a state-based escape rather than
    ///    a watchdog timer on purpose: the absence of tuned durations is the
    ///    point of the settle gate.
    /// 2. **Not comparing two different lists.** `previous` is the whole
    ///    basis of the viewport-stability rule, and a new list's first
    ///    sample has nothing to do with the old list's last one.
    ///
    /// The give-back measurements deliberately survive: they describe the
    /// filter bar, which is the same bar before and after.
    func reset() {
        isCollapsed = false
        pivot = 0
        isSettling = false
        previous = nil
    }
}
