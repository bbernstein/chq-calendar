import { useEffect } from 'react';

/**
 * Keys the reader deliberately scroll with. Deliberately narrow: a bare
 * letter or a Tab must not dismiss anything, since typing into the panel's
 * own search field would otherwise close it.
 */
const SCROLL_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar',
]);

/**
 * Calls `onDismiss` the first time the reader makes a gesture that scrolls
 * the page.
 *
 * **This listens for input events and never for `scroll`, and that is the
 * whole point of the hook.** Two things fire `scroll` that are emphatically
 * not the reader scrolling:
 *
 * - The filter panel's own opening correction calls `window.scrollBy` to hold
 *   the reader's position while the panel is inserted above them. A `scroll`
 *   listener would dismiss the panel in the same frame it opened.
 * - Changing a filter reflows the list, which can move `scrollY` on its own. A
 *   `scroll` listener would close the panel on the reader's first tick of a
 *   venue — contradicting the deliberate rule that picking a venue, a category
 *   and a week is one intent.
 *
 * `isExempt` receives the event target so the caller can spare gestures that
 * start inside the thing being dismissed (scrolling the panel's own overflow)
 * or on the control that toggles it (which would otherwise dismiss and reopen
 * in one tap).
 *
 * Listeners are attached only while `active`, and are passive: this must never
 * delay a scroll.
 */
export function useDismissOnScrollGesture({ active, onDismiss, isExempt }: {
  active: boolean;
  onDismiss: () => void;
  isExempt: (target: EventTarget | null) => boolean;
}): void {
  useEffect(() => {
    if (!active) return;

    const handle = (e: Event) => {
      if (e.type === 'keydown' && !SCROLL_KEYS.has((e as KeyboardEvent).key)) return;
      if (isExempt(e.target)) return;
      onDismiss();
    };

    const events = ['wheel', 'touchstart', 'touchmove', 'mousedown', 'keydown'] as const;
    for (const type of events) {
      window.addEventListener(type, handle, { passive: true, capture: true });
    }
    return () => {
      for (const type of events) {
        window.removeEventListener(type, handle, { capture: true });
      }
    };
  }, [active, onDismiss, isExempt]);
}
