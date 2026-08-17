import { usePublishedElementHeight } from '@/hooks/usePublishedElementHeight';

const PROPERTY = '--filter-card-h';

/**
 * The rail's offset from the top of the card — which is exactly how far the
 * sticky header has to ride up for the card to be gone and the rail to land
 * flush at the viewport top.
 *
 * Measured as one distance rather than reconstructed from parts. An earlier
 * version added `scrollHeight` to the card's computed `margin-bottom`, and
 * that decomposition has a blind spot: `ResizeObserver` reports an element's
 * own content and border boxes, never its margin, so a breakpoint that
 * changed only `mb-4 sm:mb-6` would publish a stale offset until some
 * unrelated resize happened to fire the observer. It was masked only by the
 * card's padding changing at the same breakpoint. Measuring card-top to
 * rail-top asks the layout for the answer instead of assembling it, so it
 * cannot drift out of agreement with the box it describes.
 *
 * The rail is found by `[data-day-rail]` inside the same sticky header. If
 * it is absent — an archived year with no navigable days, or a first paint
 * before the rail mounts — the card's own border box is the honest answer:
 * there is nothing below it to hold clear of.
 *
 * `getBoundingClientRect` on both, so the difference is correct whether or
 * not the header is currently pinned, and correct while the panel is capped
 * at `max-h-[70vh]`: the rail sits below whatever height the card is
 * actually occupying, which is the distance that has to ride up.
 */
const railOffsetFromCardTop = (el: HTMLElement) => {
  const cardTop = el.getBoundingClientRect().top;
  // The rail is a sibling further down the same sticky header, so it is
  // reachable from the card's parent rather than from the card itself.
  const rail = el.parentElement?.querySelector('[data-day-rail]');
  if (!rail) return el.getBoundingClientRect().height;
  return rail.getBoundingClientRect().top - cardTop;
};

/**
 * Publishes the filter card's collapsed-header offset as `--filter-card-h`.
 *
 * `page.tsx` gives the sticky header `top: calc(-1 * var(--filter-card-h))`
 * whenever the panel is not overlaying the list, which parks the card just
 * above the viewport and leaves the rail flush against its top edge. That
 * negative offset is what lets the card scroll away under its own steam
 * instead of being removed from flow — see `filterHeaderLayout.ts` for why
 * removing it from flow was a bug rather than a style choice.
 */
export function useFilterCardHeight() {
  return usePublishedElementHeight(PROPERTY, railOffsetFromCardTop);
}
