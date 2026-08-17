import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

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
 * Revealing the filter card changes the height of content sitting above the
 * list, and a browser's own scroll-anchoring can silently compensate for
 * that — verified against a real Chromium build (Playwright): toggling a
 * 100px-tall block visible from `hidden` inside an already-stuck
 * `position: sticky` container produced a 100px `scrollY` drift with no
 * script touching `scrollTo` at all, even though the sticky container's own
 * visual position never moved. Left alone, that drift both violates "scroll
 * position never changes" and cancels out the overlay effect the design
 * relies on (the compensation pushes the list down exactly as far as the
 * panel grew, which reads as content being inserted rather than covered).
 *
 * The fix is to control the scroll position ourselves rather than hope the
 * browser's heuristic agrees with us: `scrollY` is captured the instant the
 * reader asks to open or close — before Preact has patched the DOM — and
 * restored via `window.scrollTo` in a `useLayoutEffect`, which runs
 * synchronously after the DOM mutation commits but before the browser
 * paints. That ordering was verified against the same Chromium build: a
 * same-task `scrollTo` issued right after the mutation left `scrollY`
 * exactly where it started, with the sticky container correctly overlaying
 * the list beneath it.
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
  // the next one).
  const pendingScrollRestoreRef = useRef<number | null>(null);

  const panelRef = useCallback((el: HTMLElement | null) => { panelElRef.current = el; }, []);
  const toggleRef = useCallback((el: HTMLButtonElement | null) => { toggleElRef.current = el; }, []);

  // The only way `open` changes. Functional update, so this stays stable
  // across renders (empty deps) without closing over a stale `open`.
  const toggle = useCallback(() => {
    pendingScrollRestoreRef.current = window.scrollY;
    setOpen((o) => !o);
  }, []);

  // Escape is the other closer, and it needs a concrete `false` (not a
  // toggle) plus the focus-return step `toggle()` doesn't need.
  const closeViaEscape = useCallback(() => {
    pendingScrollRestoreRef.current = window.scrollY;
    setOpen(false);
    toggleElRef.current?.focus({ preventScroll: true });
  }, []);

  // Restore scroll position synchronously after the DOM has already
  // reflected the open/close change, before the browser paints. See the
  // hook doc for why this has to be a layout effect and not a passive one.
  useLayoutEffect(() => {
    const saved = pendingScrollRestoreRef.current;
    if (saved === null) return;
    pendingScrollRestoreRef.current = null;
    window.scrollTo(0, saved);
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
