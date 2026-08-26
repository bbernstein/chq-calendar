import { useEffect, useRef, useState } from 'react';
import { usePublishedElementHeight } from '@/hooks/usePublishedElementHeight';
import { onProgrammaticScroll } from '@/lib/programmaticScroll';
import { dragScrollsPage, gestureScrollsPage, keyScrollsPage, pressIsOnScrollbar } from '@/lib/scrollGestures';
import { initialHeaderReveal, nextHeaderReveal, resyncHeaderReveal } from '@/lib/siteHeaderReveal';

const OFFSET = '--site-header-offset';
/**
 * The same offset with no transition on it.
 *
 * `OFFSET` animates, so anything that SAMPLES it — the rail's scrollspy, the
 * day anchor — reads a value mid-flight and then never hears that it settled.
 * CSS positions against the animated one; logic asks this one. See
 * `topChromeHeightPx`.
 */
const OFFSET_TARGET = '--site-header-offset-target';
const HEIGHT = '--site-header-h';

/**
 * How long a scroll-driving gesture keeps deciding.
 *
 * A gesture is not one scroll event. WebKit on Linux delivers a single wheel
 * tick as an animation: traced in CI, `115 → 120 → 230` is one tick arriving
 * as +5 and then +110. An earlier rule let a gesture decide only its first
 * scroll and consumed it there, which threw away the rest of the gesture's own
 * movement — the accumulator saw +5 where the reader had asked for +120, never
 * reached the threshold, and the header did not hide at all. Chromium delivers
 * one clean frame per tick and showed none of it.
 *
 * So the gesture stays live for a window instead, refreshed by every further
 * gesture event. Long enough to cover a smooth-scroll animation, short enough
 * that a gesture cannot lend its authority to a browser correction arriving
 * long afterwards — the case the window exists to exclude.
 */
export const GESTURE_WINDOW_MS = 400;

/**
 * The longest gap between scroll events that still counts as one continuous
 * movement of the page.
 *
 * Momentum arrives frame by frame, so consecutive frames stay tens of
 * milliseconds apart even as a flick decays. A longer gap means the page came
 * to rest, and whatever scrolls next is something else's doing.
 */
const MOMENTUM_GAP_MS = 200;


/**
 * The offset while the header is showing.
 *
 * A reference to the measured height rather than the number, so a breakpoint
 * or a text-zoom step that changes the header's size is picked up by the
 * `ResizeObserver` alone — the reveal state does not have to be recomputed,
 * and there is no window in which the two disagree and the rail sits a few
 * pixels under the header or over it.
 */
const SHOWN = `var(${HEIGHT}, 0px)`;
const HIDDEN = '0px';

/**
 * Drives the site header's reveal on scroll up (#272).
 *
 * ## Why the decision is published as a CSS variable, not returned as state
 *
 * Several surfaces have to move together: the header itself, the day rail
 * that rides down to sit below it, and the filter panel that hangs off its
 * bottom edge as a fixed overlay. Threading the
 * decision through `page.tsx` would work, and would re-render the whole
 * calendar — 1,470 events and every memo above them — on each direction
 * change. Writing `--site-header-offset` on `:root` instead lets both
 * surfaces read it straight from CSS, so a reveal costs one custom-property
 * write and a re-render of `Header` alone.
 *
 * `revealed` is still returned, because one thing genuinely cannot be done in
 * CSS: a hidden header is parked just above the viewport, still in the DOM
 * and still in flow, so it is Tab-reachable. The caller needs it for `inert`.
 * The browser will chase a focused control inside a pinned sticky element it
 * cannot scroll into view — see `filterHeaderLayout.ts`, which documents the
 * same trap for the filter card that used to be parked the same way.
 *
 * The property is written only when the decision actually flips, not on every
 * `scroll` event.
 *
 * ## Holding it open
 *
 * `holdRevealed` suspends the rule entirely: the header stays shown however
 * the reader scrolls. It exists for the filter panel (#274 phase 3), which
 * hangs off the header's bottom edge as a fixed overlay — a header that hid
 * underneath an open panel would leave the panel floating against nothing.
 *
 * The hold is one-directional by design. Turning it on reveals a hidden
 * header; turning it off does NOT hide a revealed one, it just hands the rule
 * back. Releasing into a hide would move chrome the reader never asked to
 * move, and the panel's own dismissal already comes from a scroll gesture —
 * so the sequence is: gesture → panel dismisses → header resumes its normal
 * reveal/hide on the reader's NEXT gesture.
 */
export function useSiteHeaderReveal({ holdRevealed = false }: {
  /**
   * Keep the header shown regardless of scrolling, for as long as this is
   * true. See "Holding it open" above.
   */
  holdRevealed?: boolean;
} = {}) {
  const [revealed, setRevealed] = useState(true);
  const stateRef = useRef(initialHeaderReveal(0));
  /** The current decision, readable from callbacks captured on first render. */
  const revealedRef = useRef(true);
  /**
   * Whether something is holding the header open.
   *
   * A ref rather than a closed-over prop for the same reason `revealedRef` is
   * one: every listener below is captured once, on first render, and would
   * read the value `holdRevealed` had then forever.
   */
  const heldRef = useRef(false);

  // The top zone is the header's own height: within it the header has not yet
  // reached the position it would stick at, so "hidden" is not a state the
  // DOM can be in, and marking a visible header `inert` is the bug that
  // follows from pretending otherwise.
  const topZoneRef = useRef(0);

  /**
   * The current decision function, so a re-measure can re-run it.
   *
   * A ref because the measure callback below is captured once, on first
   * render, while the handler it needs is created inside the effect.
   */
  const decideRef = useRef<(() => void) | null>(null);

  /** Re-publishes the offsets; held in a ref for the same reason `decideRef` is. */
  const publishRef = useRef<((shown: boolean) => void) | null>(null);

  const headerRef = usePublishedElementHeight(HEIGHT, (el) => {
    const measured = el.getBoundingClientRect().height;
    topZoneRef.current = measured;
    // The target offset is a literal, so unlike the animated one it does not
    // follow `--site-header-h` on its own and has to be rewritten here.
    publishRef.current?.(revealedRef.current);
    decideRef.current?.();
    return measured;
  });

  useEffect(() => {
    const publish = (shown: boolean) => {
      document.documentElement.style.setProperty(OFFSET, shown ? SHOWN : HIDDEN);
      // The settled value, for anything that measures rather than paints.
      document.documentElement.style.setProperty(
        OFFSET_TARGET, shown ? `${topZoneRef.current}px` : HIDDEN);
    };
    publishRef.current = publish;

    // A reload part-way down the page restores `scrollY` before this runs, so
    // the baseline is where the reader actually is rather than the top.
    stateRef.current = initialHeaderReveal(window.scrollY);
    publish(true);


    /**
     * When the reader last did something that scrolls — the whole test for
     * "is this scroll theirs".
     *
     * A `scroll` with nothing behind it is not the reader. The settle below
     * covers what the browser does in reaction to OUR scrolls, because those
     * announce themselves; it cannot cover what the browser does in reaction
     * to a layout change we made without scrolling at all. Measured in
     * WebKit, back when the filter panel was in-flow content: opening it from
     * the rail found no day section to anchor to, so `useFilterPanel`
     * captured no reference, corrected nothing and announced nothing — and
     * WebKit's scroll anchoring moved the page 44px by itself. The header hid
     * on a tap nobody scrolled. That particular site is gone (#274 phase 3
     * made the panel a fixed overlay, so opening it changes no layout at
     * all), but the rule it bought is kept deliberately: requiring a gesture
     * holds for layout-changing code nobody has written yet, which making
     * every such site announce does not.
     *
     * A window rather than "consume it on the next scroll", because a gesture
     * is not one scroll event — see `GESTURE_WINDOW_MS`, where consuming it
     * stopped the header hiding at all in WebKit. The window is what bounds
     * how far a gesture's authority reaches; a gesture that scrolls nothing
     * still lends it for that long, which is the cost of the trade.
     *
     * Touch momentum after `touchend` fires no gesture at all, and this window
     * alone cannot survive that — see `coasting` below, which is what carries
     * a flick past it. The claim that used to stand here, that "a flick long
     * enough to coast is far longer than the threshold, so the decision was
     * already made during the drag", was false and was the reported iPhone
     * bug: a gentle flick moves the finger about 5px and then coasts 60px over
     * more than a second. Recorded rather than deleted, so that a later change
     * does not remove the momentum handling by re-deriving the premise.
     */
    let lastGestureAt = -Infinity;

    /**
     * Set when the app scrolls the document, cleared by the reader's next
     * gesture — the hole the window opens, closed.
     *
     * A gesture stays live for `GESTURE_WINDOW_MS`, and a reader who scrolls
     * and then taps a rail chip inside that window would otherwise hand the
     * browser's reaction to the tap the authority of their wheel. That is the
     * same 122px WebKit correction this whole mechanism exists for, arriving
     * 200ms after a real gesture instead of in isolation.
     *
     * Cleared by the gesture EVENT rather than by a scroll, so a reader who
     * takes control back waits for nothing; and there is no timer, because
     * nothing but a gesture or another programmatic scroll can move the page
     * anyway, so a settle nobody ends costs nothing.
     */
    let settling = false;

    /**
     * Whether the page is still coasting from the reader's last touch.
     *
     * A wheel fires for as long as the page is moving, so a window refreshed
     * by gesture events covers the whole of a mouse scroll. A touch does not:
     * `touchmove` stops at `touchend` while most of a flick's distance is
     * still to come, and iOS coasts for up to a couple of seconds in silence.
     *
     * The coast IS the reader's scroll - the second half of the gesture they
     * made - so while it runs each frame refreshes the window itself. It ends
     * when the page stops moving, which is why the gap between frames closes
     * it rather than a timer: momentum has no other signal that it finished.
     */
    let coasting = false;
    let lastScrollAt = -Infinity;
    /**
     * Whether the control the touch began on cancelled the page pan, and
     * whether this touch has scrolled the page yet.
     *
     * Asking whether the origin is a CONTROL is the wrong question for touch,
     * and briefly shipped as one: a native button does not stop the page
     * panning, and the event list is made of buttons — the event title is a
     * full-width one — so refusing every touch that began on a control refused
     * most swipes in the list. That is the device bug this branch exists to
     * fix, reintroduced by its own fix for the mouse case.
     *
     * The mouse and touch answers genuinely differ: a DRAG beginning on a
     * button is that button's, while a SWIPE beginning on it still scrolls the
     * page. What actually stops a pan is a control that cancels it — the
     * filter panel's old `WeekSelector` called `preventDefault()` on
     * `touchstart`, which is where this rule came from — and that is what the
     * platform acts on, so it is what this asks.
     */
    let touchPanCancelled = false;
    let touchScrolledPage = false;

    const decide = () => {
      const previous = stateRef.current;
      const now = performance.now();
      // A gap means the page had come to rest, so the coast is over and this
      // scroll belongs to something else.
      if (coasting && now - lastScrollAt > MOMENTUM_GAP_MS) coasting = false;
      lastScrollAt = now;
      // No `&& !settling` here: `readerDriven` below already requires it, and
      // settling only ends at a gesture, which refreshes this anyway.
      if (coasting) lastGestureAt = now;
      // Held open — today, by an open filter panel. Resync rather than a bare
      // return, and that distinction is the whole of the release behaviour: a
      // baseline frozen at wherever the page was when the panel opened would
      // measure the reader's first gesture after it closes against a stale
      // position, so a reader who scrolled 500px with the panel open would
      // find the header deciding on a 500px delta they made minutes ago. The
      // resync keeps the baseline current while deciding nothing.
      if (heldRef.current) {
        stateRef.current = resyncHeaderReveal(previous, window.scrollY);
        return;
      }
      // `coasting` outranks the settle. A settle is closed by a gesture, and a
      // flick has none left to give — so a correction landing before the coast
      // had accumulated its 24px used to discard every remaining frame of the
      // reader's own scroll. The announcement has already taken the app's
      // delta out of the baseline, so those frames measure real movement.
      const readerDriven = (coasting || !settling)
        && performance.now() - lastGestureAt <= GESTURE_WINDOW_MS;
      // The top zone is a fact about where the header IS, not a decision about
      // where it should be — a sticky header cannot be parked above a position
      // the page has not reached, so inside it the header is on screen whoever
      // did the scrolling. Ignoring a gestureless scroll INTO it left a fully
      // visible header `inert` and `aria-hidden`: measured in Chromium after a
      // search emptied the list (document 8,401px → 1,049px) and the viewport
      // then grew, clamping `scrollY` to 0 with no gesture anywhere near it.
      const inTopZone = window.scrollY <= topZoneRef.current;
      if (!readerDriven && !inTopZone) {
        stateRef.current = resyncHeaderReveal(previous, window.scrollY);
        return;
      }
      const next = nextHeaderReveal(previous, window.scrollY, { topZone: topZoneRef.current });
      stateRef.current = next;
      if (next.revealed === previous.revealed) return;
      revealedRef.current = next.revealed;
      setRevealed(next.revealed);
      publish(next.revealed);
    };

    // The app's own scrolls move the baseline without re-deciding anything.
    // See `programmaticScroll.ts` for why this is a resync rather than a
    // suppression flag.
    const stopListeningForJumps = onProgrammaticScroll(() => {
      stateRef.current = resyncHeaderReveal(stateRef.current, window.scrollY);
      settling = true;
    });

    /**
     * The gestures that count as the reader scrolling.
     *
     * `mousedown` and `touchstart` are deliberately absent, and that is the
     * difference from `useDayAnchor`'s otherwise identical cancel set. A press
     * scrolls nothing — and a rail chip tap IS a mousedown, milliseconds
     * before the jump it causes, so admitting it would hand the browser's
     * reaction to that jump the authority of a gesture.
     *
     * A scrollbar drag is the one way to scroll that fires none of wheel,
     * touch or key. It is a `mousemove` with the button still held, which is
     * why the button state is checked rather than the event type: a pointer
     * merely crossing the page is not a scroll either.
     */
    /**
     * The element the current drag began on.
     *
     * Tracked from `mousedown` because a drag's origin is what it means, and
     * the pointer leaves that origin immediately — the week strip's
     * drag-select starts on a button and is pulled across the list. Recorded
     * here rather than armed: a press still scrolls nothing, so this listener
     * deliberately does not touch `lastGestureAt`.
     */
    let dragOrigin: Element | null = null;
    /** Where the finger was, so a `touchmove` can be given a direction. */
    let lastTouchY: number | null = null;
    const onPress = (e: Event) => {
      const target = e.target;
      // A press in the scrollbar track pages the view and fires nothing else —
      // no wheel, no key, no touch, no move. It is the one press that IS a
      // scroll, which is why it arms while every other press does not.
      if (e.type === 'mousedown' && pressIsOnScrollbar(e as MouseEvent)) {
        lastGestureAt = performance.now();
        settling = false;
      }
      // Lifting the finger starts a coast — but only if that touch actually
      // scrolled the page. A tap coasts nothing, and opening a coast for one
      // handed the next correction the authority of a scroll nobody made.
      if (e.type === 'touchstart') {
        touchScrolledPage = false;
        coasting = false;
        // `touchPanCancelled` is NOT reset here: `onTouchStartBubble` assigns
        // it on every touchstart, so a reset would be a line nothing could
        // make fail.
      }
      if (e.type === 'touchend') coasting = touchScrolledPage;
      dragOrigin = e.type === 'mousedown' && target instanceof Element ? target : null;
      if (e.type === 'touchstart' || e.type === 'touchend') {
        const y = (e as TouchEvent).touches?.[0]?.clientY;
        lastTouchY = typeof y === 'number' ? y : null;
      }
    };

    const onGesture = (e: Event) => {
      // A pointer merely crossing the page is not a scroll, and neither is
      // every drag: `dragScrollsPage` keeps the scrollbar-drag case — the one
      // way to scroll that fires no wheel, touch or key — while rejecting a
      // drag that began on a control, such as the week strip's drag-select.
      if (e.type === 'mousemove' && !dragScrollsPage(e as MouseEvent, dragOrigin)) return;
      // Nor is a gesture the page never sees. The filter panel scrolls itself
      // while it overlays the list, and the day rail scrolls sideways.
      //
      // A `touchmove` carries no direction of its own, so it is reconstructed
      // from the previous touch position: a finger moving DOWN the screen
      // pushes the content UP, which is a negative delta.
      let touchDelta = 0;
      if (e.type === 'touchmove') {
        const y = (e as TouchEvent).touches?.[0]?.clientY;
        if (typeof y === 'number') {
          if (lastTouchY !== null) touchDelta = lastTouchY - y;
          lastTouchY = y;
        }
      }
      // A touch whose control cancelled the pan scrolls nothing, whatever it
      // looks like from here.
      if (e.type === 'touchmove' && touchPanCancelled) return;
      // A pinch usually begins as one finger. That first move arms the window
      // and marks the touch as having scrolled, so merely rejecting the
      // multi-touch frames that follow leaves the zoom holding authority the
      // pan earned — and `touchend` would then open a coast for it. The whole
      // touch is withdrawn instead, until a fresh one begins.
      if (e.type === 'touchmove' && ((e as TouchEvent).touches?.length ?? 1) > 1) {
        touchPanCancelled = true;
        touchScrolledPage = false;
        coasting = false;
        lastGestureAt = -Infinity;
        return;
      }
      if (e.type !== 'keydown' && !gestureScrollsPage(e, touchDelta)) return;
      if (e.type === 'touchmove') touchScrolledPage = true;
      // Nor is typing. Every keystroke on the page reaches this listener,
      // search included — and search re-filtering is the largest layout change
      // above the reader the app makes.
      if (e.type === 'keydown' && !keyScrollsPage(e as KeyboardEvent)) return;
      lastGestureAt = performance.now();
      settling = false;
    };
    /**
     * Whether the touch that just started had its default prevented.
     *
     * Read in the BUBBLE phase, deliberately: capture runs before the target's
     * own handler, so `defaultPrevented` there is always false and would say
     * nothing. By the time the event reaches `window` on the way back up, a
     * control that cancelled the pan has already done so.
     */
    const onTouchStartBubble = (e: Event) => { touchPanCancelled = e.defaultPrevented; };

    const gestures = ['wheel', 'touchmove', 'keydown', 'mousemove'] as const;
    const presses = ['mousedown', 'mouseup', 'touchstart', 'touchend'] as const;

    // Re-run the decision when the header's own height changes, not only when
    // something scrolls. Text zoom that grows the header around the reader's
    // position moves them into the top zone without any scroll at all, and
    // nothing else would notice — which is the same visible-but-`inert` header
    // by a different route.
    decideRef.current = decide;

    // Passive: none of this must ever delay a scroll.
    window.addEventListener('scroll', decide, { passive: true });
    for (const type of gestures) {
      window.addEventListener(type, onGesture, { passive: true, capture: true });
    }
    for (const type of presses) {
      window.addEventListener(type, onPress, { passive: true, capture: true });
    }
    window.addEventListener('touchstart', onTouchStartBubble, { passive: true });
    return () => {
      window.removeEventListener('scroll', decide);
      decideRef.current = null;
      for (const type of gestures) {
        window.removeEventListener(type, onGesture, { capture: true });
      }
      for (const type of presses) {
        window.removeEventListener(type, onPress, { capture: true });
      }
      window.removeEventListener('touchstart', onTouchStartBubble);
      stopListeningForJumps();
      document.documentElement.style.removeProperty(OFFSET);
      document.documentElement.style.removeProperty(OFFSET_TARGET);
      publishRef.current = null;
    };
  }, []);

  // Declared after the effect that creates `publish`, so `publishRef` is
  // populated by the time this first runs — effects fire in declaration order.
  useEffect(() => {
    heldRef.current = holdRevealed;
    if (!holdRevealed) return;
    // A fresh baseline AT the current position, revealed. Not
    // `resyncHeaderReveal`, which preserves whatever `revealed` already was:
    // holding a hidden header open has to change that flag, or the rule would
    // resume from "hidden" the moment the hold ends and the first upward
    // gesture would reveal a header that is already shown.
    stateRef.current = initialHeaderReveal(window.scrollY);
    if (revealedRef.current) return;
    revealedRef.current = true;
    setRevealed(true);
    publishRef.current?.(true);
  }, [holdRevealed]);

  return { revealed, headerRef };
}
