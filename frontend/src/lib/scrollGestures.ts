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
/**
 * Note the absence of `a[href]`. A native link is activated with **Enter**,
 * not Space — Space on a focused link scrolls the page, so listing links here
 * rejected a real keyboard scroll. An anchor given `role="button"` is covered
 * by the last entry, which is the case where Space really does activate.
 */
const ACTIVATED_BY_SPACE = 'button, summary, [role="button"]';

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
/**
 * Which way a scrolling key moves the page, as a `deltaY` sign.
 *
 * Space is the awkward one: it scrolls DOWN, and with Shift it scrolls UP, so
 * the direction is not readable from `event.key` alone.
 */
function keyDirection(event: KeyboardEvent): number {
  if (event.key === ' ' || event.key === 'Spacebar') return event.shiftKey ? -1 : 1;
  return event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home' ? -1 : 1;
}

export function keyScrollsPage(event: KeyboardEvent): boolean {
  if (!SCROLL_KEYS.has(event.key)) return false;
  const target = event.target;
  if (!(target instanceof Element)) return true;
  if (target.closest(CONSUMES_THE_KEY)) return false;
  // The day rail intercepts `Home`, prevents the default and moves focus to
  // today's chip — it never scrolls. `useFilterPanel`'s own exemption carves
  // out the identical interaction, and two consumers disagreeing about one
  // keypress is worse than either answer.
  //
  // `Home` alone, deliberately: that comment also records that `PageDown` with
  // focus parked on a chip really IS a page scroll, because the rail does not
  // intercept it. Narrowing further than the rail actually consumes would be
  // guessing rather than matching.
  if (event.key === 'Home' && target.closest('[data-chip]')) return false;
  const isSpace = event.key === ' ' || event.key === 'Spacebar';
  if (isSpace && target.closest(ACTIVATED_BY_SPACE)) return false;
  // A key scrolls whatever the focus is inside, exactly as a wheel does. With
  // the filter card acting as an `overflow-y-auto` overlay, PageDown from a
  // focused week button scrolls THAT panel and `window` never moves — and the
  // reflow of the filter change that follows would be admitted as the
  // reader's. Chains at the boundary for the same reason a wheel does.
  const direction = keyDirection(event);
  for (let el: Element | null = target; el; el = el.parentElement) {
    if (scrollsVertically(el) && canScrollBy(el, direction)) return false;
  }
  return true;
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
 * Whether this scroller can still move in `deltaY`'s direction.
 *
 * A scroller at its own boundary does not consume the wheel — it CHAINS, and
 * the page moves instead. Treating "is a scroller" as "consumes the gesture"
 * left a reader wheeling upward over a filter panel already at its top unable
 * to reveal the header at all: every tick moved `window` and every tick was
 * discarded, for as long as the pointer stayed over the panel.
 *
 * `deltaY === 0` never reaches here — `gestureScrollsPage` rejects it first.
 */
function canScrollBy(el: Element, deltaY: number): boolean {
  return deltaY < 0
    ? el.scrollTop > 0
    : el.scrollTop < el.scrollHeight - el.clientHeight;
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
 * An ancestor only counts as consuming the gesture when it can still move the
 * way the gesture is pushing; otherwise the walk continues toward the
 * document, which is what the browser does.
 *
 * `deltaY` is the direction, and the caller supplies it for touch. A wheel
 * carries its own; a single `touchmove` does not, so the caller reconstructs
 * it from the previous touch position. An earlier version skipped that and let
 * any scrollable ancestor claim a swipe, described as "the conservative half
 * of the rule" — on a phone the filter panel covers 70% of the screen, so that
 * conservative half meant the header could not be revealed from the largest
 * target on it.
 */
export function gestureScrollsPage(event: Event, deltaY?: number): boolean {
  const direction = event.type === 'wheel' ? (event as WheelEvent).deltaY : deltaY ?? 0;
  // A wheel with no vertical component is the day rail moving sideways.
  if (event.type === 'wheel' && direction === 0) return false;
  const target = event.target;
  if (!(target instanceof Element)) return true;
  for (let el: Element | null = target; el; el = el.parentElement) {
    if (!scrollsVertically(el)) continue;
    // At its boundary it chains to the page rather than consuming this.
    // Direction 0 means the caller could not tell, so the scroller keeps it.
    if (direction !== 0 && !canScrollBy(el, direction)) continue;
    return false;
  }
  return true;
}

/**
 * Controls a drag can start on without the drag being a scroll.
 *
 * Deliberately broader than `ACTIVATED_BY_SPACE`: this is not about which key
 * a control consumes, it is about a press-and-drag that means something to the
 * control rather than to the page. `[data-chip]` is the day rail; the week
 * strip's buttons are plain `<button>`s.
 */
const DRAGGABLE_CONTROL =
  'button, a[href], input, select, textarea, summary, [role="button"], [data-chip]';

/**
 * Whether a drag beginning here would scroll the page.
 *
 * A scrollbar drag is the one way to scroll that fires no wheel, touch or key,
 * which is why the pointer path exists at all. But "a button is held while the
 * pointer moves" describes far more than that, and one of the other things it
 * describes is the week-range selector: pressing a week and dragging across
 * its neighbours refilters the list on every `mouseenter`, changing the
 * document's height under the reader. The browser's correction for that would
 * then arrive inside a window the drag had armed.
 *
 * Detecting the scrollbar itself was the obvious alternative and is not
 * available: headless Chromium — like macOS by default — uses overlay
 * scrollbars, where `document.documentElement.clientWidth === innerWidth`, so
 * there is no gutter to test a coordinate against and no way to verify such a
 * test here. Asking where the drag STARTED needs no platform knowledge.
 *
 * A drag over ordinary content is left counting, because it is a text
 * selection, and dragging a selection past the viewport edge does scroll.
 *
 * `origin` is the element the drag STARTED on, which the caller has to
 * remember from `mousedown` — it is not `event.target`, and reading the
 * current target instead was this function contradicting its own contract: a
 * week drag begun on a button and pulled off the strip targets ordinary
 * content from that moment on, so it armed on exactly the drag it had just
 * refused.
 */
export function dragScrollsPage(event: MouseEvent, origin: Element | null): boolean {
  // Primary button only. `buttons` is a bitmask, so `!== 0` also matched
  // right- and middle-button drags, neither of which scrolls anything.
  if (event.buttons !== 1) return false;
  // No recorded press means the drag began before this hook was listening, or
  // outside the document. Nothing says it was a control.
  if (!origin) return true;
  return !origin.closest(DRAGGABLE_CONTROL);
}

/**
 * Whether a primary press landed in the document's scrollbar gutter.
 *
 * A press in the scrollbar track pages the view, and it is the one way of
 * scrolling that fires no wheel, no key, no touch and no `mousemove` — so
 * without this it never reaches a scroll-direction watcher at all, and
 * clicking upward in the scrollbar cannot bring a hidden header back.
 *
 * The gutter is the strip between the viewport and the content box: it has
 * width only when a classic scrollbar occupies it, so this cannot mistake a
 * press on the page for one on the scrollbar. Where scrollbars are overlaid —
 * macOS by default, and headless Chromium, measured at `clientWidth` 900 and
 * `innerWidth` 900 — there is no gutter, nothing is ever in one, and this
 * correctly finds nothing. That is also why it is pinned by unit tests rather
 * than by the browser suite, which has no scrollbar to press.
 *
 * A non-primary press opens the scrollbar's context menu instead of paging.
 */
export function pressIsOnScrollbar(event: MouseEvent): boolean {
  if (event.button !== 0) return false;
  const root = document.documentElement;
  // No measurable content box means no measurable gutter. Without this, an
  // unlaid-out document reports `clientWidth: 0` and every press in it is
  // "past the content", which is the whole page — the failure this predicate
  // most needs to avoid, since it arms on a press that scrolls nothing.
  if (root.clientWidth <= 0 || root.clientHeight <= 0) return false;
  // No `innerWidth > clientWidth` test needed: where scrollbars are overlaid
  // the two are equal, so nothing can be at or past the content edge anyway.
  // The overlay case falls out of the comparison rather than needing its own
  // branch — one that could not be made to fail was not worth keeping.
  return event.clientX >= root.clientWidth || event.clientY >= root.clientHeight;
}
