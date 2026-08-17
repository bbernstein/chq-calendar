import { useCallback, useRef, useState } from 'react';

/**
 * Whether the reader has scrolled past the point where the filter card
 * naturally sits at the top of the page.
 *
 * Driven by an `IntersectionObserver` on a zero-height sentinel the caller
 * places immediately before the sticky filter/rail container — not by
 * reusing `useDayAnchor`'s scroll listener. That hook answers a different
 * question ("which day header is the reader looking at") and carries its own
 * settle hold; coupling the two would entangle mechanisms this branch has
 * already spent two review rounds separating. Once the sentinel scrolls
 * above the viewport, the sticky container behind it has started sticking,
 * and the filter card — no longer in the reader's natural view — needs a
 * toggle to reach it.
 *
 * Returned as a callback ref, like `useDayRailHeight`, so it fires on mount,
 * unmount and any element swap with no dependency array to get wrong.
 */
export function useScrolledPastFilters(): {
  scrolled: boolean;
  sentinelRef: (el: HTMLElement | null) => void;
} {
  const [scrolled, setScrolled] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const sentinelRef = useCallback((el: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (!el) {
      // No sentinel (unmounted) means no reliable signal — treat as "not
      // scrolled" rather than holding on to a stale `true`, matching
      // `useDayRailHeight`'s "no rail means no offset, not a stale one"
      // default.
      setScrolled(false);
      return;
    }

    // `IntersectionObserver` is absent from jsdom. Tests that need real
    // transitions install `installIntersectionObserverMock()`; everywhere
    // else this defaults to "not scrolled", which is the same value a real
    // browser reports before the observer's first callback fires.
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  return { scrolled, sentinelRef };
}
