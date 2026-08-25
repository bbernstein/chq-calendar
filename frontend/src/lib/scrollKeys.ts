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
