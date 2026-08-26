/**
 * The DOM contract for a day section.
 *
 * One attribute, declared once, consumed by three unrelated things: the
 * upward-prepend scroll correction, the day rail's scrollspy, and its
 * scroll-to. Keeping the name here rather than inline at each site is what
 * stops a rename in the list from silently disabling navigation — every
 * consumer imports the same constant, so a rename is a compile error.
 *
 * A day key is `yyyy-mm-dd`, or the literal `NaN-NaN-NaN` that
 * `groupEventsByDay` emits for an unparseable `startDate`. Both are made
 * entirely of digits, letters and hyphens, so neither needs escaping inside
 * an attribute selector. `CSS.escape` is deliberately not used: it is absent
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
 * Shared here rather than duplicated: `useDayAnchor`'s scrollspy, the rail's
 * highlight and the filter panel's open/close scroll correction all need the
 * same answer to "is this section still clear of the chrome", and a hardcoded
 * number would drift out of step with the real heights on browser text zoom,
 * same as every other measurement in this file.
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

/**
 * The topmost mounted day section not currently hidden behind the sticky
 * rail — a stable "what the reader is looking at" reference for a scroll
 * correction that has to survive a layout change above the list (the filter
 * panel opening or closing).
 *
 * Deliberately not `useDayAnchor`'s `anchorDay`: that names the day whose
 * header has already scrolled *past* the chrome (its top can sit right at
 * the rail's edge, mostly out of view, or above it). This instead picks the
 * first section still fully clear of the rail, which is what a reader
 * actually sees as "the top of what I'm reading" — and it's a one-shot DOM
 * query, not a subscription, so it carries none of `useDayAnchor`'s
 * scroll-listening or settle-hold machinery.
 */
export function topmostVisibleDaySection(): HTMLElement | null {
  const limit = topChromeHeightPx();
  const sections = document.querySelectorAll<HTMLElement>(`[${DAY_SECTION_ATTR}]`);
  for (const el of Array.from(sections)) {
    if (el.getBoundingClientRect().top >= limit) return el;
  }
  return null;
}
