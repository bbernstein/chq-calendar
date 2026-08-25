/**
 * Whether a given piece of input will scroll the PAGE.
 *
 * Every consumer of this module is asking one question — "did the reader just
 * scroll the document?" — and the answer is never the event type alone.
 * Space scrolls from the document, types in a field and activates a button;
 * a wheel scrolls the page, or the panel it happens to be over, or the day
 * rail sideways. Only the target and the deltas separate those.
 *
 * Named for gestures rather than for keys because it stopped being only keys:
 * a name that undersells what a module answers is how the wrong caller ends
 * up asking the easy half of the question.
 */

/**
 * The keys the reader deliberately scrolls with.
 *
 * Deliberately narrow: a bare letter or a Tab must not count as scrolling.
 * Both consumers listen on `window` with `capture: true`, so every keystroke
 * on the page reaches them — including the ones going into a search field,
 * which is the case that makes the distinction load-bearing rather than tidy.
 *
 * `useDismissOnScrollGesture` needs it so that typing into the filter panel's
 * own search box does not dismiss the panel out from under the reader.
 * `useSiteHeaderReveal` needs it because search re-filtering changes the
 * list's height by thousands of pixels above the reader, the browser corrects
 * for that on its own, and an unfiltered `keydown` would hand each of those
 * corrections the authority of a gesture — type three letters, watch the site
 * header appear.
 *
 * Shared rather than reasoned out twice: the second copy is where the two
 * would drift apart, and both are answering the same question.
 *
 * `ArrowLeft`/`ArrowRight` are absent on purpose. They scroll horizontally,
 * which no page-level surface here cares about, and on the day rail they are
 * chip-to-chip focus movement that must not be mistaken for either.
 */
export const SCROLL_KEYS: ReadonlySet<string> = new Set([
  'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar',
]);

/**
 * Anything that takes the keypress for itself instead of scrolling.
 *
 * A field consumes all of these — Space inserts a character, the arrows and
 * Home/End move the caret. Space additionally activates a focused control
 * rather than scrolling, which is why buttons and links are here too.
 *
 * Note what is NOT in the second list: a bare `[tabindex]`. Focusable is not
 * the same as activated-by-Space. `Modal`'s container is the real example —
 * `role="dialog"`, `tabIndex={-1}`, and an `onKeyDown` that handles only
 * Escape and Tab — so Space there does scroll the page, and excluding it would
 * be claiming something about the platform that is not true.
 *
 * `WeekBadge` is NOT such an example, though it looks like one: it sets
 * `role="button"` in the same breath as `tabIndex={0}` and calls
 * `preventDefault()` on Space, so the `[role="button"]` match already covers
 * it, correctly.
 */
const CONSUMES_THE_KEY =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const ACTIVATED_BY_SPACE = 'button, a[href], summary, [role="button"]';

/**
 * Whether a `keydown` will actually scroll the page.
 *
 * The key alone settles almost nothing. Space scrolls the page from the
 * document, types a character in a search field, and activates a focused
 * button — three different things behind one `e.key`, and only the target
 * separates them. A caller that armed on the key alone would treat typing
 * "brass band" as two scroll gestures.
 *
 * That matters because of what tends to follow such a keystroke: search
 * re-filtering is the largest layout change above the reader this app makes,
 * the browser corrects for it on its own, and a correction that inherits a
 * gesture's authority is read as the reader scrolling.
 *
 * Errs toward "this did not scroll". The cost of a false negative is one
 * missed header toggle that the reader's next real scroll puts right; the cost
 * of a false positive is the header moving when nobody asked.
 */
export function keyScrollsPage(event: KeyboardEvent): boolean {
  if (!SCROLL_KEYS.has(event.key)) return false;
  const target = event.target;
  if (!(target instanceof Element)) return true;
  if (target.closest(CONSUMES_THE_KEY)) return false;
  const isSpace = event.key === ' ' || event.key === 'Spacebar';
  return !(isSpace && target.closest(ACTIVATED_BY_SPACE));
}

/** Overflow values that make an element its own scroll container. */
const SCROLLS = new Set(['auto', 'scroll', 'overlay']);

/**
 * Whether this element takes vertical scrolling for itself.
 *
 * The document's own scrollers are excluded by name: they ARE the page, so a
 * gesture over them is a page scroll rather than a nested one.
 */
function scrollsVertically(el: Element): boolean {
  if (el === document.documentElement || el === document.body) return false;
  if (el.scrollHeight <= el.clientHeight) return false;
  return SCROLLS.has(getComputedStyle(el).overflowY);
}

/**
 * Whether a pointer gesture will scroll the page, rather than something in it.
 *
 * The filter panel is `max-h-[70vh] overflow-y-auto` whenever it overlays the
 * list, so a wheel or a drag inside it moves the panel and leaves `window`
 * exactly where it was. Treating that as a page scroll matters because of what
 * usually comes next: the reader picks a venue, the list reflows, and the
 * correction for that reflow inherits an authority the gesture never had.
 * `useFilterPanel` already exempts gestures inside the panel, for the
 * mirror-image reason.
 *
 * A wheel with no vertical component is out for the same reason: the day rail
 * scrolls sideways, and moving it is not moving the page up or down.
 *
 * Errs toward "this did not scroll the page". A nested scroller at its own
 * boundary really does chain to the document, so this returns false for the
 * last few pixels of such a gesture — a missed toggle the reader's next scroll
 * puts right, which is the cheaper of the two mistakes.
 */
export function gestureScrollsPage(event: Event): boolean {
  if (event.type === 'wheel' && (event as WheelEvent).deltaY === 0) return false;
  const target = event.target;
  if (!(target instanceof Element)) return true;
  for (let el: Element | null = target; el; el = el.parentElement) {
    if (scrollsVertically(el)) return false;
  }
  return true;
}
