import { useEffect, useRef, useState } from 'react';
import { usePublishedElementHeight } from '@/hooks/usePublishedElementHeight';
import { onProgrammaticScroll } from '@/lib/programmaticScroll';
import { dragScrollsPage, gestureScrollsPage, keyScrollsPage } from '@/lib/scrollGestures';
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
 * Two surfaces have to move together: the header itself, and the sticky
 * filter/rail container that rides down to sit below it. Threading the
 * decision through `page.tsx` would work, and would re-render the whole
 * calendar — 1,470 events and every memo above them — on each direction
 * change. Writing `--site-header-offset` on `:root` instead lets both
 * surfaces read it straight from CSS, so a reveal costs one custom-property
 * write and a re-render of `Header` alone.
 *
 * `revealed` is still returned, because one thing genuinely cannot be done in
 * CSS: a hidden header is parked just above the viewport, still in the DOM
 * and still in flow, so it is Tab-reachable. The caller needs it for `inert`.
 * This is the same trap `filterCardParked` documents — the browser will chase
 * a focused control inside a pinned sticky element it cannot scroll into
 * view.
 *
 * The property is written only when the decision actually flips, not on every
 * `scroll` event.
 */
export function useSiteHeaderReveal() {
  const [revealed, setRevealed] = useState(true);
  const stateRef = useRef(initialHeaderReveal(0));
  /** The current decision, readable from callbacks captured on first render. */
  const revealedRef = useRef(true);

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
     * WebKit: opening the filter panel from the rail found no day section to
     * anchor to, so `useFilterPanel` captured no reference, corrected nothing
     * and announced nothing — and WebKit's scroll anchoring moved the page
     * 44px by itself. The header hid on a tap nobody scrolled. Requiring a
     * gesture holds for layout-changing code nobody has written yet, which
     * making every such site announce does not.
     *
     * A window rather than "consume it on the next scroll", because a gesture
     * is not one scroll event — see `GESTURE_WINDOW_MS`, where consuming it
     * stopped the header hiding at all in WebKit. The window is what bounds
     * how far a gesture's authority reaches; a gesture that scrolls nothing
     * still lends it for that long, which is the cost of the trade.
     *
     * Touch momentum after `touchend` fires no gesture, and that is fine
     * rather than tolerated: a flick long enough to coast is far longer than
     * the threshold, so the decision was already made during the drag. What
     * momentum cannot do is CHANGE it — which is the flicker the threshold
     * exists to prevent.
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

    const decide = () => {
      const previous = stateRef.current;
      const readerDriven = !settling && performance.now() - lastGestureAt <= GESTURE_WINDOW_MS;
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
    const onGesture = (e: Event) => {
      // A pointer merely crossing the page is not a scroll, and neither is
      // every drag: `dragScrollsPage` keeps the scrollbar-drag case — the one
      // way to scroll that fires no wheel, touch or key — while rejecting a
      // drag that began on a control, such as the week strip's drag-select.
      if (e.type === 'mousemove' && !dragScrollsPage(e as MouseEvent)) return;
      // Nor is a gesture the page never sees. The filter panel scrolls itself
      // while it overlays the list, and the day rail scrolls sideways.
      if (e.type !== 'keydown' && !gestureScrollsPage(e)) return;
      // Nor is typing. Every keystroke on the page reaches this listener,
      // search included — and search re-filtering is the largest layout change
      // above the reader the app makes.
      if (e.type === 'keydown' && !keyScrollsPage(e as KeyboardEvent)) return;
      lastGestureAt = performance.now();
      settling = false;
    };
    const gestures = ['wheel', 'touchmove', 'keydown', 'mousemove'] as const;

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
    return () => {
      window.removeEventListener('scroll', decide);
      decideRef.current = null;
      for (const type of gestures) {
        window.removeEventListener(type, onGesture, { capture: true });
      }
      stopListeningForJumps();
      document.documentElement.style.removeProperty(OFFSET);
      document.documentElement.style.removeProperty(OFFSET_TARGET);
      publishRef.current = null;
    };
  }, []);

  return { revealed, headerRef };
}
