import { useEffect } from 'react';
// Deliberately narrow — a bare letter or a Tab must not dismiss anything,
// since typing into the panel's own search field would otherwise close it.
import { SCROLL_KEYS } from '@/lib/scrollGestures';

/**
 * Calls `onDismiss` the first time the reader makes a gesture that scrolls
 * the page.
 *
 * **This listens for input events and never for `scroll`, and that is the
 * whole point of the hook.** Two things fire `scroll` that are emphatically
 * not the reader scrolling:
 *
 * - The filter panel's own opening correction used to call `scrollWindowBy`
 *   to hold the reader's position while the panel was inserted above them,
 *   and a `scroll` listener would have dismissed the panel in the same frame
 *   it opened. #274 phase 3 made the panel a fixed overlay, so it displaces
 *   nothing and no longer corrects — but the rule stands, because the second
 *   reason has not gone anywhere and a future correction would land right
 *   back in this trap.
 * - Changing a filter reflows the list, which can move `scrollY` on its own. A
 *   `scroll` listener would close the panel on the reader's first tick of a
 *   venue — contradicting the deliberate rule that picking a venue and a
 *   category is one intent.
 *
 * `isExempt` receives the whole event so the caller can spare gestures that
 * start inside the thing being dismissed (scrolling the panel's own overflow)
 * or on the control that toggles it (which would otherwise dismiss and reopen
 * in one tap).
 *
 * The event rather than just its target, because exemption is not always a
 * property of where the gesture landed: a key another component has already
 * claimed for its own focus movement is not a scroll, however page-scrolling
 * that key normally is. Deciding that needs the key as well as the target.
 *
 * ## `mousedown` is broader than "a scrollbar drag"
 *
 * The design authorises `mousedown` as the way a desktop reader drags the
 * scrollbar, but there is no event that means "the scrollbar specifically" —
 * a scrollbar drag is an ordinary `mousedown` whose target is the scrolling
 * element. So as implemented, **any** desktop press outside the panel and
 * outside the toggle dismisses: clicking a tag chip on an event card,
 * a favourite star, an article link.
 *
 * That is deliberate rather than tolerated. The panel is an overlay covering
 * roughly 63% of the viewport; a press on the list beneath it is the reader
 * turning their attention back to the results, which is precisely what the
 * dismissal rule exists to serve. It also matches the ordinary
 * light-dismiss behaviour of every drawer-like surface. The one interaction
 * this could plausibly harm — pressing something inside the panel — is
 * exempted by construction, and the one that would double-handle (the
 * toggle: dismiss on `mousedown`, reopen on `click`) is exempted too.
 *
 * Touch is not symmetrical here and does not need to be: `touchstart` fires
 * for a tap as well as a scroll, so the same breadth already applies there,
 * and it is the same judgement.
 *
 * Listeners are attached only while `active`, and are passive: this must never
 * delay a scroll.
 */
export function useDismissOnScrollGesture({ active, onDismiss, isExempt }: {
  active: boolean;
  onDismiss: () => void;
  isExempt: (event: Event) => boolean;
}): void {
  useEffect(() => {
    if (!active) return;

    const handle = (e: Event) => {
      if (e.type === 'keydown' && !SCROLL_KEYS.has((e as KeyboardEvent).key)) return;
      if (isExempt(e)) return;
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
