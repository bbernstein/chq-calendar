/**
 * Where the sticky filter/rail header parks, and whether the filter card
 * inside it is still reachable.
 *
 * ## Why the card is parked rather than hidden
 *
 * The first version of this feature removed the filter card from flow
 * (`display: none`) the moment the reader scrolled past it. That is a
 * feedback loop, and it made the page impossible to scroll slowly in any
 * browser that implements scroll anchoring — Chromium and WebKit both do:
 *
 *   1. ~64px of scrolling took the sentinel above the viewport, so the card
 *      was hidden;
 *   2. hiding it removed ~290px of in-flow height from ABOVE the reader;
 *   3. scroll anchoring held the reader's event card still by subtracting
 *      that height from `scrollY`, which clamped at the top of the document;
 *   4. back at the top, the sentinel was visible again, so the card
 *      returned — and the reader was exactly where they started.
 *
 * Measured: 40 slow wheel ticks (2400px requested) advanced the page by 0px,
 * returning to the top 20 times. The geometry is the root cause, not the
 * browser: **a ~290px header cannot collapse after 64px of scrolling**,
 * because there is not enough room above the reader to absorb it. The
 * collapse destroyed its own precondition.
 *
 * So the card is never taken out of flow. The header rides up by exactly the
 * card's height (`--filter-card-h`, measured — see `useFilterCardHeight`)
 * and pins there, which parks the card just above the viewport with the rail
 * flush against the top edge. Document height never changes, so scroll
 * anchoring has nothing to correct, and the card scrolls away under its own
 * steam like the page header it looks like — the behaviour readers expected
 * of it all along.
 */

/** Fallback `0px` so a missing measurement degrades to an ordinary
 *  `top: 0` sticky header rather than a broken `calc()`. */
const PARKED_TOP = 'calc(-1 * var(--filter-card-h, 0px))';

/**
 * The sticky header's `top`.
 *
 * `overlaying` is the page's existing "the panel is acting as an overlay
 * over the list" signal — open while scrolled past, or mid-exit. Only then
 * does the header pin fully into view; every other state parks it.
 *
 * Note the exit animation is deliberately included. While the panel is
 * animating away it is `position: fixed` and no longer in the header's
 * flow, so the header is just the rail — and the rail belongs at the
 * viewport top for the whole of that animation, not parked for it and
 * restored after.
 */
export function filterHeaderTop({ overlaying }: { overlaying: boolean }): string {
  return overlaying ? '0px' : PARKED_TOP;
}

/**
 * Whether the filter card is currently parked out of view, and so must not
 * be reachable by keyboard or announced by a screen reader.
 *
 * This is not cosmetic. A parked card is still in the DOM and still in flow;
 * without `inert` a keyboard reader tabbing down the page would land in it,
 * and the browser would scroll the header back into view to show them the
 * focused control — yanking the page to the top mid-read. `display: none`
 * used to give this for free, which is exactly why removing it has to
 * restore it explicitly.
 */
export function filterCardParked(
  { scrolledPast, open, exitingVisible }:
  { scrolledPast: boolean; open: boolean; exitingVisible: boolean },
): boolean {
  return scrolledPast && !open && !exitingVisible;
}
