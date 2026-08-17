import { useCallback, useRef } from 'react';

const PROPERTY = '--day-rail-h';

/**
 * Publishes the rail's measured height as `--day-rail-h` on `:root`.
 *
 * Three unrelated things need this number: the day headers' own sticky
 * `top`, every day section's `scroll-margin-top`, and `useDayAnchor`'s
 * sticky offset. Hardcoding it would put all three one text-zoom step out of
 * true — the gotcha #225 called out by name — so it is measured rather than
 * declared, and re-measured on every resize.
 *
 * Returned as a **callback ref** rather than an effect over an object ref so
 * it fires on mount, on unmount, and on any element swap, with no dependency
 * array to get wrong.
 */
export function useDayRailHeight() {
  const observerRef = useRef<ResizeObserver | null>(null);

  return useCallback((el: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (!el) {
      // No rail (an archived year with no navigable days, or a render
      // before mount) means no offset — not a stale one from last render.
      document.documentElement.style.setProperty(PROPERTY, '0px');
      return;
    }

    const publish = () => {
      document.documentElement.style.setProperty(
        PROPERTY, `${el.getBoundingClientRect().height}px`
      );
    };
    publish();

    // `ResizeObserver` is absent in some older browsers and in jsdom without
    // a stub. Publishing once is still correct there; only zoom-time updates
    // are lost, which is strictly better than throwing on mount.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    observerRef.current = observer;
  }, []);
}
