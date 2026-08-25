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

/** Whether a `keydown` is the reader scrolling with the keyboard. */
export const isScrollKey = (key: string): boolean => SCROLL_KEYS.has(key);
