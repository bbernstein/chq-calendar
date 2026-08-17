import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { topmostVisibleDaySection } from '@/lib/utils/daySections';
import { useDismissOnScrollGesture } from '@/hooks/useDismissOnScrollGesture';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"]):not([disabled])',
].join(', ');

/**
 * Open/close state and accessibility wiring for the filter panel the sticky
 * rail's "Filters" toggle reveals.
 *
 * Three things live here together because they are one operation, not
 * three: toggling the panel, keeping the reader's scroll position exactly
 * where it was, and moving keyboard focus in and back out.
 *
 * ## Scroll preservation
 *
 * "Scroll position never changes" means the reader's position, not the raw
 * `scrollY` number — those are only the same thing when nothing above the
 * reader changes height, which is exactly what does NOT hold here: the
 * revealed panel adds real in-flow content above the list. A first version
 * of this hook captured `scrollY` before toggling and forced it back
 * afterward, which is wrong for that reason — verified against a real
 * Chromium build (Playwright): the browser's own scroll-anchoring correctly
 * compensated for the panel's height (`scrollY` moved to keep the reader's
 * content in place), and forcing `scrollY` back to its pre-toggle value
 * *undid that correct compensation*, dropping the reader by the panel's
 * height instead of holding them still.
 *
 * The fix follows this branch's own established pattern for the same
 * failure class — `EventList`'s upward-prepend correction and
 * `useDayAnchor`'s settle hold, both of which track a day section's
 * `getBoundingClientRect().top` and `scrollBy` the delta, never `scrollTo` a
 * saved number. `topmostVisibleDaySection` (in `daySections.ts`) picks the
 * first day section still clear of the sticky rail as the reference; its
 * `top` is captured the instant the reader asks to open or close, and
 * re-measured plus corrected via `window.scrollBy` in a `useLayoutEffect`,
 * which runs synchronously after the DOM mutation commits but before the
 * browser paints — late enough that `getBoundingClientRect()` reflects the
 * panel's new layout (and any scroll-anchoring the browser already applied
 * for it), early enough that no frame paints the uncorrected position.
 *
 * This composes with native scroll-anchoring rather than fighting it, and
 * was verified both ways against a real Chromium build: when anchoring is
 * live, the reference section's re-measured `top` already matches its
 * captured value (anchoring did the right thing), so the computed delta is
 * `0` and this is a no-op; with `overflow-anchor: none` forcing anchoring
 * off, the delta the browser doesn't supply is exactly what this computes
 * and corrects by hand. Either way the reference section's viewport
 * position lands unchanged — that's the real, browser-verified invariant;
 * jsdom cannot express it (no layout, no scroll-anchoring), so the hook
 * tests instead pin the mechanism: a day section's `top` is read before the
 * toggle and `scrollBy` (never `scrollTo`) is called with the delta after.
 *
 * ## Focus
 *
 * Opening moves focus to the first focusable control inside the panel.
 * Closing via `Escape` returns it to the toggle button — closing by
 * clicking the toggle again already leaves focus there, so no extra step is
 * needed on that path. `{ preventScroll: true }` on every focus call here is
 * deliberate: a browser's default focus-scroll would fight the exact scroll
 * position this hook exists to hold steady.
 */
export function useFilterPanel(): {
  open: boolean;
  toggle: () => void;
  panelId: string;
  panelRef: (el: HTMLElement | null) => void;
  toggleRef: (el: HTMLButtonElement | null) => void;
} {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const panelElRef = useRef<HTMLElement | null>(null);
  const toggleElRef = useRef<HTMLButtonElement | null>(null);

  // Set immediately before every call to `setOpen`, consumed by the layout
  // effect below the very next commit. A ref, not a plain variable — it has
  // to survive from the event handler (this render) to the effect (after
  // the next one). Holds the reference day section's element and its
  // pre-toggle `top`, not a `scrollY` number — see the hook doc for why.
  const pendingScrollCorrectionRef = useRef<{ el: HTMLElement; top: number } | null>(null);

  const panelRef = useCallback((el: HTMLElement | null) => { panelElRef.current = el; }, []);
  const toggleRef = useCallback((el: HTMLButtonElement | null) => { toggleElRef.current = el; }, []);

  // Captures the reference day section's current position, to be
  // re-measured and corrected for by the layout effect below after this
  // same toggle's DOM mutation commits. No section (a short or empty list)
  // means nothing to correct against — the ref is left `null` and the
  // layout effect no-ops, same as before this feature existed.
  const captureScrollReference = () => {
    const el = topmostVisibleDaySection();
    pendingScrollCorrectionRef.current = el ? { el, top: el.getBoundingClientRect().top } : null;
  };

  // The only way `open` changes. Functional update, so this stays stable
  // across renders (empty deps) without closing over a stale `open`.
  const toggle = useCallback(() => {
    captureScrollReference();
    setOpen((o) => !o);
  }, []);

  // Escape is the other closer, and it needs a concrete `false` (not a
  // toggle) plus the focus-return step `toggle()` doesn't need.
  const closeViaEscape = useCallback(() => {
    captureScrollReference();
    setOpen(false);
    toggleElRef.current?.focus({ preventScroll: true });
  }, []);

  // Closing by gesture takes the same scroll-correction capture as every
  // other close — the panel leaving shrinks content above the reader, and
  // holding them still is exactly as necessary here as on the other paths.
  // No focus return: a gesture means the reader's attention has already left
  // the panel, and yanking focus to the toggle would be its own surprise.
  // The one exception is focus that is still INSIDE the panel, which would
  // otherwise be stranded on a detached element.
  const closeViaGesture = useCallback(() => {
    captureScrollReference();
    setOpen(false);
    const panel = panelElRef.current;
    if (panel && document.activeElement && panel.contains(document.activeElement)) {
      toggleElRef.current?.focus({ preventScroll: true });
    }
  }, []);

  // A gesture that starts inside the panel is the reader scrolling the
  // panel's own overflow, not the list. A gesture on the toggle is the
  // reader closing it deliberately — dismissing here too would close on
  // `mousedown` and reopen on the following `click`.
  const isExempt = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Node)) return false;
    return !!panelElRef.current?.contains(target)
      || !!toggleElRef.current?.contains(target);
  }, []);

  useDismissOnScrollGesture({ active: open, onDismiss: closeViaGesture, isExempt });

  // Correct scroll position synchronously after the DOM has already
  // reflected the open/close change, before the browser paints. See the
  // hook doc for why this has to be a layout effect (not a passive one) and
  // why it measures a day section rather than restoring a saved `scrollY`.
  useLayoutEffect(() => {
    const pending = pendingScrollCorrectionRef.current;
    pendingScrollCorrectionRef.current = null;
    if (!pending) return;
    // Forces a synchronous layout, which is also what surfaces any
    // scroll-anchoring correction the browser already applied for this same
    // mutation — see the hook doc for why that makes this safe to run
    // unconditionally rather than fight what the browser already got right.
    const delta = pending.el.getBoundingClientRect().top - pending.top;
    if (delta !== 0) window.scrollBy(0, delta);
  }, [open]);

  // Move focus into the panel on open. Not on close — Escape already
  // handles its own focus return, and the toggle-click close path leaves
  // focus exactly where a click puts it.
  useEffect(() => {
    if (!open) return;
    const panel = panelElRef.current;
    if (!panel) return;
    const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (first ?? panel).focus({ preventScroll: true });
  }, [open]);

  // Escape closes, only while there is something to close — the listener is
  // attached and torn down with `open` rather than living for the
  // component's whole lifetime.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeViaEscape();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, closeViaEscape]);

  return { open, toggle, panelId, panelRef, toggleRef };
}
