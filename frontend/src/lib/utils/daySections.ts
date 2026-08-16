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

export function daySectionElement(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${DAY_SECTION_ATTR}="${key}"]`);
}

/**
 * The viewport-relative top of a mounted day section, or `null`.
 *
 * This is the measurement the prepend correction is built on: it moves by
 * exactly the height inserted above it, whatever inserted it and whatever
 * else on the page changed size at the same time. Total document height
 * cannot make that distinction.
 */
export function daySectionTop(key: string): number | null {
  const el = daySectionElement(key);
  return el ? el.getBoundingClientRect().top : null;
}
