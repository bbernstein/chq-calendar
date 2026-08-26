/**
 * Where the site chrome sits: the header, the day rail beneath it, the filter
 * panel that hangs off it, and the day titles that have to give way to all
 * three.
 *
 * ## The invariant: the filter panel is never in flow
 *
 * It is `position: fixed` when open, `display: none` when closed, and never
 * anything else. This is load bearing, and it is the whole reason phase 3 of
 * #274 is a deletion rather than an addition — so it is stated here, in code,
 * rather than left to be inferred from `page.tsx`'s markup.
 *
 * The first version of this feature made the filter card ordinary in-flow
 * content and removed it from flow (`display: none`) once the reader scrolled
 * past it. That is a feedback loop, and it made the page impossible to scroll
 * slowly in any browser that implements scroll anchoring — Chromium and WebKit
 * both do:
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
 * The intermediate fix parked the card instead — kept it in flow and rode the
 * sticky header up by exactly the card's measured height — which worked, and
 * cost a height measurement, a parking offset, an `inert` treatment for a card
 * pinned out of sight, a sentinel to notice it had gone, and a frozen rect to
 * choreograph the switch out of flow on the way out.
 *
 * A panel that is `position: fixed` in **both** states contributes nothing to
 * document height ever, so there is nothing for scroll anchoring to correct
 * and nothing to collapse. Mounting and unmounting it is free, and all of the
 * above is deleted. The failure is now unreachable by construction rather than
 * survived by choreography.
 *
 * **A future change that puts the panel back in flow "just at the top of the
 * page" reintroduces exactly the toggle described above.** The browser check
 * that guards this asserts `document.documentElement.scrollHeight` is
 * identical with the panel open and closed; the two that guard its symptom are
 * `verify-filter-reveal`'s "slow scrolling actually advances the page" and
 * "never snaps the reader backwards".
 */

/**
 * How far down the viewport the site header has pushed everything, in px.
 *
 * `0px` while the header is hidden, its measured height while it is revealed
 * on scroll up (#272), and animated between the two — see
 * `useSiteHeaderReveal` and the `@property` registration in `globals.css`.
 * Every value below is offset by it, which is what makes the rail ride down to
 * sit *below* the revealed header rather than be covered by it.
 *
 * It appears here as a variable rather than as a parameter deliberately. The
 * reveal fires on an ordinary scroll gesture; routing it through React state
 * would re-render the whole calendar page on every flick. As a CSS variable
 * the reveal touches only `Header`, and the rail follows it without the page
 * re-rendering at all.
 *
 * Note that nothing here transitions `top`. The animation lives entirely in
 * the variable, so every surface holds the same offset on every frame.
 *
 * Fallback `0px` so a first paint, or a browser that drops the registration,
 * lands exactly where it did before this existed.
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
 * shared with everything below, so the header and the chrome under it hold the
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
 * The top edge of everything that hangs directly off the site header: the
 * sticky day rail, and the filter panel that overlays it.
 *
 * One function for both, and that is the point — the panel's top edge IS the
 * header's bottom edge, and the rail sticks at the same line. Writing that
 * once, in the same file as `siteHeaderTop`, is what stops the three being
 * changed apart.
 *
 * The panel covering the rail rather than displacing it is deliberate. The
 * rail's height is what every day header and every scroll target is computed
 * against (`dayHeaderTop`), and an open panel that moved the rail would change
 * all of them. An overlay changes nothing underneath it, which is what makes
 * "never in flow" a property of the whole page and not just of document
 * height.
 */
export function belowHeaderTop(): string {
  return SITE_HEADER_OFFSET;
}

/**
 * How tall the filter panel is allowed to get before it scrolls internally.
 *
 * On a 390x844 phone the panel's contents — search, four scopes, a nine-week
 * strip, venues, categories, active chips — exceed the viewport, and uncapped
 * its bottom controls are unreachable. That is the same class of bug this
 * whole feature exists to fix, one level down.
 *
 * `dvh`, not `vh`, and that is not a stylistic preference. `vh` on a phone
 * resolves against the LARGEST viewport — the one with the browser's own
 * bottom chrome retracted — so a panel capped in `vh` extends under that
 * chrome whenever it is showing, and its last control is unreachable. The unit
 * is the bug.
 *
 * The `1rem` is breathing room at the bottom edge, so the panel reads as a
 * sheet with an end rather than as content clipped by the viewport.
 */
export function filterPanelMaxHeight(): string {
  return `calc(100dvh - ${SITE_HEADER_OFFSET} - 1rem)`;
}

/**
 * Where a day section's own sticky title comes to rest.
 *
 * Third in the sticky stack — below the site header (`z-40`) and the day rail
 * (`z-20`) at `z-10` — so it is the one that has to give way, and it can only
 * do that if it knows how tall everything above it is. That grew by the site
 * header's height when #272 made the header reachable from anywhere: while it
 * is revealed the rail sits a header lower, and a day title still pinned at
 * the bare rail height slides underneath a rail that outranks it and
 * disappears.
 *
 * Measured by `verify-rail`'s check 12 at 320px and at 200% text zoom: rail
 * bottom 112, day header top 64.
 */
export function dayHeaderTop(): string {
  return `calc(${SITE_HEADER_OFFSET} + var(--day-rail-h, 0px))`;
}
