import { usePublishedElementHeight } from '@/hooks/usePublishedElementHeight';

const PROPERTY = '--filter-card-h';

/**
 * How far the sticky header has to ride up for the filter card to be gone and
 * the rail to land flush at the viewport top: the distance from the top of the
 * card to the top of the rail.
 *
 * ## Measured as one distance, and observed on the container
 *
 * Two separate mistakes are avoided here, and they are easy to conflate.
 *
 * **What is measured.** An earlier version added the card's `scrollHeight` to
 * its computed `margin-bottom`. Reconstructing a distance from parts invites
 * the parts to disagree with the layout; asking for `railTop - cardTop` is the
 * distance itself.
 *
 * **When it is re-measured.** Fixing the arithmetic did not fix the trigger.
 * `ResizeObserver` reports border and content boxes, never margins — so with
 * the observer on the CARD, a breakpoint that moved only `mb-4 sm:mb-6` would
 * change neither the card's box nor the rail's, fire nothing, and leave a
 * stale offset that parks the rail off the viewport's top edge by the
 * difference. The header container's height, by contrast, is card + margin +
 * rail: it changes whenever any of the three does. So the observer goes on the
 * container and the measurement reads its children.
 *
 * That is why this hook's ref belongs on `[data-filter-header]` rather than on
 * the card, even though it is the card's offset being published.
 *
 * ## Mid-exit
 *
 * While the panel animates away it is `position: fixed` at a frozen rect and no
 * longer in the header's flow, so `railTop - cardTop` momentarily describes
 * nothing. Publishing it would set the offset to roughly zero, and the instant
 * the animation ended and the header returned to its parked `top`, the card
 * would flash back into view at the top of the page. Returning `null` holds the
 * last good value until the card is back in flow and the observer fires again.
 */
const railOffsetFromCardTop = (container: HTMLElement): number | null => {
  const card = container.querySelector('[data-filter-card]');
  if (!card) return null;

  // Out of flow: mid-exit. Hold the last good value — see above.
  if (getComputedStyle(card).position === 'fixed') return null;

  const rail = container.querySelector('[data-day-rail]');
  // No rail — an archived year with no navigable days, or a first paint
  // before it mounts. The card's own box is the honest answer: there is
  // nothing below it to hold clear of.
  if (!rail) return card.getBoundingClientRect().height;

  return rail.getBoundingClientRect().top - card.getBoundingClientRect().top;
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
 *
 * The returned ref goes on the header container, not the card.
 */
export function useFilterCardHeight() {
  return usePublishedElementHeight(PROPERTY, railOffsetFromCardTop);
}
