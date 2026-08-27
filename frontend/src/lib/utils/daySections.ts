/**
 * The DOM contract for a day section.
 *
 * Declared once. The rail's scrollspy resolves against it twice over — the
 * discrete anchor (`useDayAnchor`) and the continuous highlight
 * (`useRailHighlight`), both via this file's own
 * `daySectionTop`/`daySectionMetrics` — and `useDayAnchor.scrollToDay` (plus
 * the settle hold it reasserts) uses it to scroll to a day on demand. An
 * upward-prepend scroll correction in the old `EventList` used to be a third
 * consumer; #274 phase 4 deleted it along with the render window, and then
 * deleted every path that could prepend. Keeping the name here rather than
 * inline at each site is what stops a rename from silently disabling
 * navigation — every consumer imports the same constant, so a rename is a
 * compile error.
 *
 * A day key is `yyyy-mm-dd` — made entirely of digits and hyphens, so it
 * needs no escaping inside an attribute selector. (`groupEventsByDay` used to
 * emit a literal `NaN-NaN-NaN` key for an unparseable `startDate`; it drops
 * such a row outright since #274 phase 4, so that shape no longer reaches the
 * DOM. It needed no escaping either.) `CSS.escape` is deliberately not used: it is absent
 * from some jsdom versions, and adding a dependency on it to defend against
 * a value shape that cannot occur trades a real portability risk for an
 * imaginary safety one.
 */
export const DAY_SECTION_ATTR = 'data-day-key';

/**
 * The sticky title inside a day section.
 *
 * Declared rather than reached for via `firstElementChild` because the rail's
 * highlight ramp is floored at this element's height — the distance the title
 * itself takes to hand over — and a wrapper introduced above the header later
 * would silently re-point that floor at something else. Named, it is a
 * compile-time-visible contract like `DAY_SECTION_ATTR`; positional, it is a
 * bug that only shows up as a ramp that feels wrong.
 */
export const DAY_HEADER_ATTR = 'data-day-header';

export function daySectionElement(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${DAY_SECTION_ATTR}="${key}"]`);
}

/**
 * A day section's own height and the height of its sticky title.
 *
 * Both read through `getBoundingClientRect` rather than `offsetHeight`: it is
 * the measurement the rest of this file already uses, it reports fractional
 * pixels at browser text zoom, and it is the one every test in this repo
 * already knows how to state for a layout-free jsdom.
 */
export function daySectionMetrics(key: string): { height: number; headerHeight: number } | null {
  const el = daySectionElement(key);
  if (!el) return null;
  const header = el.querySelector<HTMLElement>(`[${DAY_HEADER_ATTR}]`);
  return {
    height: el.getBoundingClientRect().height,
    headerHeight: header ? header.getBoundingClientRect().height : 0,
  };
}

/**
 * The viewport-relative top of a mounted day section, or `null`.
 *
 * This is the measurement `resolveAnchor` walks (via `useDayAnchor` and
 * `useRailHighlight`) and the one `useDayAnchor`'s own settle hold reasserts
 * against after `scrollToDay`: it moves by exactly the height inserted above
 * it, whatever inserted it and whatever else on the page changed size at the
 * same time. Total document height cannot make that distinction.
 */
export function daySectionTop(key: string): number | null {
  const el = daySectionElement(key);
  return el ? el.getBoundingClientRect().top : null;
}

/** One custom property as a number, or 0 if it has not been published. */
function lengthPx(property: string): number {
  const parsed = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(property));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * How far below the viewport top counts as "behind the chrome".
 *
 * Shared here rather than duplicated: `useDayAnchor`'s scrollspy and the
 * rail's highlight both need the same answer to "is this section still clear
 * of the chrome", and a hardcoded number would drift out of step with the
 * real heights on browser text zoom, same as every other measurement in this
 * file. The filter panel's open/close scroll correction was the third
 * consumer until #274 phase 3 made the panel an overlay: it is
 * `position: fixed`, changes no layout, and so has no correction to make.
 *
 * The chrome is the rail PLUS the site header whenever that header is
 * revealed (#272) — the offset is `0px` while it is hidden, so this is the
 * rail alone the rest of the time. Named for the chrome rather than for the
 * rail because it stopped being only the rail: a name that undersold what it
 * measured is how the day titles ended up pinned a whole header too high.
 *
 * ## Why the TARGET offset, not the animated one
 *
 * `--site-header-offset` transitions over 200ms, and every caller here samples
 * it on a scroll or a resize. The scroll that triggers a reveal samples near
 * the START of that transition, and nothing fires when it finishes — so an
 * anchor computed then keeps a chrome boundary up to a whole header too short
 * until the reader scrolls again, which next to a day boundary means the wrong
 * chip stays lit.
 *
 * `--site-header-offset-target` is the same value with no transition on it.
 * A logical question — "is this section behind the chrome" — wants where the
 * chrome is going, not where it happens to be mid-flight. The animated
 * property remains what CSS positions against, so nothing about the motion
 * changes.
 */
export function topChromeHeightPx(): number {
  if (typeof document === 'undefined') return 0;
  return lengthPx('--site-header-offset-target') + lengthPx('--day-rail-h');
}

