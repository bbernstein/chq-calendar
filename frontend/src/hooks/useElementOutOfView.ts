import { useCallback, useRef, useState } from 'react';

/**
 * Whether an element is entirely outside the viewport.
 *
 * The filter card needs this to decide when to go `inert`. It is parked just
 * above the viewport on the sticky header's negative `top`, and while parked
 * it must not be reachable by Tab — a focused control inside a pinned sticky
 * element is one the browser cannot scroll into view, so it chases the
 * position instead of revealing it.
 *
 * Asked of the card directly rather than derived from the page's
 * `scrolledPast` signal, which answers a different question. That sentinel
 * sits below the whole header, so it reports "scrolled past" a rail-height
 * AFTER the card has actually gone — leaving a window in which the card was
 * pinned out of sight and still Tab-reachable. It also cannot be moved up to
 * the card's own bottom edge: inside the sticky header it would pin along
 * with it and never leave the viewport at all, and above the header it stops
 * moving with the height the exit animation temporarily removes.
 *
 * Safe to drive `inert` from, and deliberately not used for anything else:
 * `inert` changes no layout, so unlike the header's `top` this signal cannot
 * feed back into the scroll position that produced it. That feedback loop is
 * the bug documented in `filterHeaderLayout.ts`, and the reason this hook
 * stays out of the header's geometry.
 *
 * Returned as a callback ref, like the height hooks, so it fires on mount,
 * unmount and any element swap with no dependency array to get wrong.
 */
export function useElementOutOfView(): {
  outOfView: boolean;
  ref: (el: HTMLElement | null) => void;
} {
  const [outOfView, setOutOfView] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const ref = useCallback((el: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (!el) {
      // No element means no evidence it is hidden. `false` keeps whatever it
      // guards reachable, which is the safe direction to fail: a briefly
      // Tab-reachable card is a nuisance, a permanently unreachable one is a
      // lockout.
      setOutOfView(false);
      return;
    }

    // Absent from jsdom. Defaulting to "in view" matches what a real browser
    // reports before the observer's first callback fires.
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => setOutOfView(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  return { outOfView, ref };
}
