/**
 * The app's own scrolls, announced.
 *
 * Five places move the document under the reader: the day-anchor's chip-tap
 * scroll and its late reassert, the filter panel's insertion correction, and
 * the two corrections in `EventList`. None of them is the reader scrolling,
 * and anything watching scroll direction has to be able to tell the
 * difference — a rail tap is a jump of tens of thousands of pixels, which
 * read as a gesture would be the largest scroll up a reader could make.
 *
 * `useDayAnchor` already relies on the converse of this — a programmatic
 * `scrollBy` synthesises no pointer event, so listening for `wheel` and
 * `touchstart` distinguishes the reader for free. That trick does not
 * generalise: it cannot see a scrollbar drag, so a direction watcher built on
 * gestures alone would never reveal for a desktop reader dragging the
 * scrollbar up. Watching `scroll` and having our own scrolls say so covers
 * every input modality instead.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * Subscribe to the app's own scrolls. Returns the unsubscribe.
 *
 * Listeners run *after* the scroll has landed, so `window.scrollY` inside one
 * is the new position.
 */
export function onProgrammaticScroll(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Scroll the window vertically by `delta`, announcing it.
 *
 * ## A zero delta still announces
 *
 * This looks like a missing guard and is the opposite of one. Measured in
 * Chromium, opening the filter panel from the rail with the site header
 * revealed: inserting the panel changed layout above the reader, Chromium's
 * own scroll anchoring corrected by +44px BEFORE `useFilterPanel`'s
 * `useLayoutEffect` ran, and our correction consequently computed a delta of
 * zero. The early return then skipped the one announcement that would have
 * told the header that the +44px scroll it was about to be handed was not the
 * reader — and the header hid on a tap nobody scrolled. WebKit does not anchor
 * there, computed the +44 itself, announced it, and behaved correctly.
 *
 * A delta of zero does not mean nothing happened. It means the app laid out
 * again and needed no correction of its own — which is frequently because the
 * browser has already made one. Subscribers want to hear about that; only the
 * `scrollBy` itself is worth skipping.
 *
 * The `delta !== 0` guard lives here rather than at each call site so that
 * five copies of it cannot drift.
 */
export function scrollWindowBy(delta: number): void {
  if (delta !== 0) window.scrollBy(0, delta);
  for (const listener of listeners) listener();
}
