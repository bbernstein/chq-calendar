import { useCallback, useRef } from 'react';

/**
 * Publishes a measured element height as a CSS custom property on `:root`,
 * re-measuring on every resize.
 *
 * Note the observed element is not always the measured one: the caller
 * decides what `measure` reads. `ResizeObserver` reports border and content
 * boxes only, never margins, so an element whose own box never changes can
 * still move — and a caller that needs to notice THAT observes an ancestor
 * and measures something else inside it.
 *
 * Two pieces of the site chrome need a height that CSS cannot derive for
 * itself — the day rail's (`--day-rail-h`) and the site header's
 * (`--site-header-h`) — and both are wrong by one text-zoom step the moment
 * either is hardcoded, the gotcha #225 called out by name. This is the shared
 * mechanism; the callers differ only in what counts as "height", which is why
 * `measure` is a parameter rather than assumed.
 *
 * There used to be a third caller, `useFilterCardHeight` (`--filter-card-h`),
 * which is the margin case above. It is gone with the in-flow filter card
 * itself (#274 phase 3) — see `filterHeaderLayout.ts`.
 *
 * `measure` returned `number | null` for that caller alone: mid-exit the card
 * was `position: fixed`, so the distance it would have measured was
 * momentarily nonsense, and `null` meant "keep the last good value rather than
 * publish a wrong one". Both remaining callers always return a number, so that
 * branch became unreachable and is deleted rather than re-documented — a guard
 * nothing can trigger is a guard nobody can test, and the type now says so. If
 * a future caller needs to decline a measurement, widen this back
 * deliberately.
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
  measure: (el: HTMLElement) => number,
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
      document.documentElement.style.setProperty(
        propertyRef.current, `${measureRef.current(el)}px`);
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
