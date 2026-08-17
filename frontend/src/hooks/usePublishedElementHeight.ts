import { useCallback, useRef } from 'react';

/**
 * Publishes a measured element height as a CSS custom property on `:root`,
 * re-measuring on every resize.
 *
 * Note the observed element is not always the measured one: the caller
 * decides what `measure` reads. The filter card's offset, for instance,
 * observes the header CONTAINER and measures the distance between two of its
 * children — because `ResizeObserver` reports border and content boxes only,
 * never margins, so an element whose own box never changes can still move.
 *
 * Two unrelated pieces of the sticky header need a height that CSS cannot
 * derive for itself — the rail's own height (`--day-rail-h`) and the filter
 * card's (`--filter-card-h`) — and both are wrong by one text-zoom step the
 * moment either is hardcoded, the gotcha #225 called out by name. This is
 * the shared mechanism; the two callers differ only in what counts as
 * "height", which is why `measure` is a parameter rather than assumed.
 *
 * Returned as a **callback ref** rather than an effect over an object ref so
 * it fires on mount, on unmount, and on any element swap, with no dependency
 * array to get wrong.
 *
 * `property` and `measure` are captured once, on first render. Both callers
 * pass literals, and a ref that reconnected its observer whenever an inline
 * arrow changed identity would tear down and rebuild on every render.
 */
export function usePublishedElementHeight(
  property: string,
  measure: (el: HTMLElement) => number | null,
) {
  const observerRef = useRef<ResizeObserver | null>(null);
  const measureRef = useRef(measure);
  const propertyRef = useRef(property);

  return useCallback((el: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (!el) {
      // No element (a year with no navigable days, a panel not yet mounted,
      // or a render before mount) means no offset — not a stale one left
      // over from the last render.
      document.documentElement.style.setProperty(propertyRef.current, '0px');
      return;
    }

    const publish = () => {
      const value = measureRef.current(el);
      // `null` means "the layout cannot be read meaningfully right now" —
      // keep the last good value rather than publishing a wrong one. The
      // filter card uses this while it is mid-exit and `position: fixed`,
      // where the distance it would measure is momentarily nonsense and
      // publishing it would flash the card back into view as the animation
      // ends.
      if (value === null) return;
      document.documentElement.style.setProperty(propertyRef.current, `${value}px`);
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
