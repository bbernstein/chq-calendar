import { usePublishedElementHeight } from '@/hooks/usePublishedElementHeight';

const PROPERTY = '--filter-card-h';

/**
 * How far the sticky header has to ride up for the filter card to be gone
 * and the rail to land exactly at the viewport top: the card's full content
 * height plus the gap it holds above the rail.
 *
 * `scrollHeight`, not `getBoundingClientRect().height`, and the difference is
 * load-bearing rather than stylistic. While the panel is open over the list
 * it carries `max-h-[70vh] overflow-y-auto`, so a tall card's *rendered* box
 * is the cap, not its content. Parking by the capped number would leave the
 * rail sitting the overflowed remainder too low the moment the panel closed
 * — and only for readers whose filter card exceeds 70vh, which is the subset
 * least likely to be tested. `scrollHeight` reports the content height
 * whether or not the cap is applied, so the value is the same in both states
 * and the close needs no re-measure to be correct.
 *
 * The bottom margin is the card's own `mb-4 sm:mb-6`, which sits between it
 * and the rail and therefore has to ride up too; it is not part of
 * `scrollHeight`.
 */
const collapsedOffset = (el: HTMLElement) => {
  const marginBottom = parseFloat(getComputedStyle(el).marginBottom);
  return el.scrollHeight + (Number.isFinite(marginBottom) ? marginBottom : 0);
};

/**
 * Publishes the filter card's collapsed-header offset as `--filter-card-h`.
 *
 * `page.tsx` gives the sticky header `top: calc(-1 * var(--filter-card-h))`
 * whenever the panel is not overlaying the list, which parks the card just
 * above the viewport and leaves the rail flush against its top edge. That
 * negative offset is what lets the card scroll away under its own steam
 * instead of being removed from flow — see the comment on the sticky
 * container in `page.tsx` for why removing it from flow was a bug rather
 * than a style choice.
 */
export function useFilterCardHeight() {
  return usePublishedElementHeight(PROPERTY, collapsedOffset);
}
