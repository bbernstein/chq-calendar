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

/**
 * How far down the viewport the site header has pushed everything, in px.
 *
 * `0px` while the header is hidden, its measured height while it is revealed
 * on scroll up (#272), and animated between the two — see
 * `useSiteHeaderReveal` and the `@property` registration in `globals.css`.
 * Both values below are offset by it, which is what makes the rail ride down
 * to sit *below* the revealed header rather than be covered by it.
 *
 * It appears here as a variable rather than as a parameter deliberately. The
 * reveal fires on an ordinary scroll gesture; routing it through React state
 * would re-render the whole calendar page on every flick. As a CSS variable
 * the reveal touches only `Header`, and the rail follows it without the page
 * re-rendering at all.
 *
 * Note that nothing here transitions `top`. The animation lives entirely in
 * the variable, so the header and the rail hold the same offset every frame;
 * a `transition: top` would additionally animate the values below flipping
 * between parked and pinned, which is the filter panel's own reveal and is
 * choreographed separately.
 *
 * Fallback `0px` so a first paint, or a browser that drops the registration,
 * parks exactly as it did before this existed.
 */
const SITE_HEADER_OFFSET = 'var(--site-header-offset, 0px)';

/**
 * The site header's own `top`.
 *
 * Parked and revealed are the same expression evaluated at the two ends of
 * `--site-header-offset`: at `0px` it is `-headerH`, which pins the header
 * just above the viewport; at the header's own height it is `0`, flush
 * against the top edge. One expression rather than two states means the ends
 * cannot drift apart, and it means the reveal animates a single value —
 * shared with `filterHeaderTop`, so the header and the rail below it hold the
 * same offset on every frame.
 *
 * Sticky rather than fixed, and that is the load-bearing choice. `fixed`
 * would need a spacer to replace the height it takes out of flow, and a
 * spacer sized from a JS measurement is exactly the "document height above
 * the reader changes" hazard described at the top of this file. A sticky
 * header never leaves flow at all, so document height is constant by
 * construction, there is nothing for scroll anchoring to correct, and there
 * is no first-paint window where the measurement has not landed yet.
 *
 * Both fallbacks are `0px`, which evaluates to `top: 0` — a shown header.
 * That is the safe default: a header parked out of reach before anything has
 * been measured would have no way to come back.
 */
export function siteHeaderTop(): string {
  return `calc(${SITE_HEADER_OFFSET} - var(--site-header-h, 0px))`;
}

/**
 * Where a day section's own sticky title comes to rest.
 *
 * Third in the sticky stack — below the site header (`z-40`) and the
 * filter/rail container (`z-30`) at `z-10` — so it is the one that has to give
 * way, and it can only do that if it knows how tall everything above it is.
 * That grew by the site header's height when #272 made the header reachable
 * from anywhere: while it is revealed the rail sits a header lower, and a day
 * title still pinned at the bare rail height slides underneath a rail that
 * outranks it and disappears.
 *
 * Measured by `verify-rail`'s check 12 at 320px and at 200% text zoom: rail
 * bottom 112, day header top 64.
 */
export function dayHeaderTop(): string {
  return `calc(${SITE_HEADER_OFFSET} + var(--day-rail-h, 0px))`;
}

/** Fallback `0px` so a missing measurement degrades to an ordinary
 *  `top: 0` sticky header rather than a broken `calc()`. */
const PARKED_TOP = `calc(${SITE_HEADER_OFFSET} - var(--filter-card-h, 0px))`;

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
  return overlaying ? SITE_HEADER_OFFSET : PARKED_TOP;
}

/**
 * Whether the filter card is currently parked out of view, and so must not
 * be reachable by keyboard or announced by a screen reader.
 *
 * This is not cosmetic. A parked card is still in the DOM and still in flow;
 * without `inert` a keyboard reader tabbing down the page would land in it,
 * and the browser would try to scroll the header back into view to show them
 * the focused control — which it cannot do for a pinned sticky element, so it
 * chases the position instead of revealing it. `display: none` used to give
 * this for free, which is exactly why removing it has to restore it
 * explicitly.
 *
 * `outOfView` is the card's own visibility, measured against the viewport
 * (`useElementOutOfView`), NOT the page's `scrolledPast` sentinel. The
 * sentinel sits below the whole sticky header, so it turns true a
 * rail-height after the card has actually left — and for that window the
 * card was pinned out of sight and still Tab-reachable.
 */
export function filterCardParked(
  { outOfView, open, exitingVisible }:
  { outOfView: boolean; open: boolean; exitingVisible: boolean },
): boolean {
  return outOfView && !open && !exitingVisible;
}
