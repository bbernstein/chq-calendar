import { useEffect, useRef, useState } from 'react';
import { usePublishedElementHeight } from '@/hooks/usePublishedElementHeight';
import { onProgrammaticScroll } from '@/lib/programmaticScroll';
import { initialHeaderReveal, nextHeaderReveal, resyncHeaderReveal } from '@/lib/siteHeaderReveal';

const OFFSET = '--site-header-offset';
const HEIGHT = '--site-header-h';


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

  // The top zone is the header's own height: within it the header has not yet
  // reached the position it would stick at, so "hidden" is not a state the
  // DOM can be in, and marking a visible header `inert` is the bug that
  // follows from pretending otherwise.
  const topZoneRef = useRef(0);

  const headerRef = usePublishedElementHeight(HEIGHT, (el) => {
    const measured = el.getBoundingClientRect().height;
    topZoneRef.current = measured;
    return measured;
  });

  useEffect(() => {
    const publish = (shown: boolean) => {
      document.documentElement.style.setProperty(OFFSET, shown ? SHOWN : HIDDEN);
    };

    // A reload part-way down the page restores `scrollY` before this runs, so
    // the baseline is where the reader actually is rather than the top.
    stateRef.current = initialHeaderReveal(window.scrollY);
    publish(true);


    /**
     * Whether the reader has done something that scrolls since the last
     * `scroll` event — the whole test for "is this scroll theirs".
     *
     * A `scroll` with nothing behind it is not the reader. The settle above
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
     * "Since the last scroll" rather than "within the last N milliseconds",
     * and the difference is not tidiness. A time window lends a real gesture's
     * authority to whatever the browser does next inside it — which is exactly
     * the case above, where a wheel, a tap and an anchoring correction all
     * land inside any window worth having. Consuming the gesture closes that:
     * a drag re-arms it on every frame, and a correction that follows a scroll
     * with nothing in between does not.
     *
     * Touch momentum after `touchend` fires no gesture, and that is fine
     * rather than tolerated: a flick long enough to coast is far longer than
     * the threshold, so the decision was already made during the drag. What
     * momentum cannot do is CHANGE it — which is the flicker the threshold
     * exists to prevent.
     */
    let gestureSinceLastScroll = false;

    const onScroll = () => {
      const previous = stateRef.current;
      const readerDriven = gestureSinceLastScroll;
      gestureSinceLastScroll = false;
      if (!readerDriven) {
        stateRef.current = resyncHeaderReveal(previous, window.scrollY);
        return;
      }
      const next = nextHeaderReveal(previous, window.scrollY, { topZone: topZoneRef.current });
      stateRef.current = next;
      if (next.revealed === previous.revealed) return;
      setRevealed(next.revealed);
      publish(next.revealed);
    };

    // The app's own scrolls move the baseline without re-deciding anything.
    // See `programmaticScroll.ts` for why this is a resync rather than a
    // suppression flag.
    const stopListeningForJumps = onProgrammaticScroll(() => {
      stateRef.current = resyncHeaderReveal(stateRef.current, window.scrollY);
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
      if (e.type === 'mousemove' && (e as MouseEvent).buttons === 0) return;
      gestureSinceLastScroll = true;
    };
    const gestures = ['wheel', 'touchmove', 'keydown', 'mousemove'] as const;

    // Passive: none of this must ever delay a scroll.
    window.addEventListener('scroll', onScroll, { passive: true });
    for (const type of gestures) {
      window.addEventListener(type, onGesture, { passive: true, capture: true });
    }
    return () => {
      window.removeEventListener('scroll', onScroll);
      for (const type of gestures) {
        window.removeEventListener(type, onGesture, { capture: true });
      }
      stopListeningForJumps();
      document.documentElement.style.removeProperty(OFFSET);
    };
  }, []);

  return { revealed, headerRef };
}
