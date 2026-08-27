import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useDismissOnScrollGesture } from '@/hooks/useDismissOnScrollGesture';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"]):not([disabled])',
].join(', ');

// globals.css's `.filter-panel-exit` transition runs 200ms; this is that
// plus a 200ms margin, not a thin one. `transitionend` does not fire if the
// element is never painted (a background tab, or the browser skipping the
// transition on its own under some reduced-motion paths) — without this
// fallback that leaves `exiting` stuck true and a fixed-position panel
// stranded on screen. The two failure modes of the margin's width are not
// symmetric: too short and the fallback can outrace a transition that is
// still genuinely playing but running late (a dropped-frame stretch or a GC
// pause on a low-end phone under real content — the panel carries a
// SearchBar, the favourites toggle, venues and categories — is well
// within a 60ms budget), which unmounts the ghost mid-slide as a visible
// pop instead of a fade; too long only delays cleanup in the one case this
// exists for, where the tab isn't being looked at and the extra time is not
// perceptible. That asymmetry is why this errs wide rather than tight.
const EXIT_FALLBACK_MS = 400;

/**
 * Open/close state and accessibility wiring for the filter panel the site
 * header's "Filters" toggle reveals (#274 phase 3 moved that toggle off the
 * day rail).
 *
 * Two things live here together because they are one operation, not two:
 * toggling the panel, and moving keyboard focus in and back out.
 *
 * ## Why there is no scroll preservation here
 *
 * There used to be, and its deletion is the point of #274 phase 3. The panel
 * was in-flow content: opening it inserted ~290px above the reader and closing
 * it took that back, so the hook captured a day section's
 * `getBoundingClientRect().top` before every toggle and `scrollBy`'d the delta
 * after, in a layout effect. It also had to freeze the panel's rect at the
 * instant an exit began, so the element could switch from in-flow to
 * `position: fixed` at exactly the box it had just occupied.
 *
 * The panel is now `position: fixed` in both states and `display: none` when
 * closed, so opening and closing it changes no layout at all. There is nothing
 * above the reader to move, nothing for scroll anchoring to correct, no rect to
 * freeze, and no in-flow placeholder to keep in step with a fixed ghost. The
 * whole apparatus computes zero on every path, and a correction that is
 * structurally always zero reads as load bearing when it is not — so it is
 * gone rather than left as insurance.
 *
 * Recorded rather than merely deleted, because the need for it is easy to
 * re-derive from first principles and add back: the invariant it depended on
 * is that **the panel is never in flow**, and that lives in
 * `filterHeaderLayout.ts` along with the measured failure that produced it. A
 * unit test here asserts `scrollWindowBy` is never called, and a browser check
 * asserts document height is identical with the panel open and closed. If
 * either of those starts failing, the invariant broke somewhere else and this
 * code is not what should come back.
 *
 * ## Focus
 *
 * Opening moves focus to the first focusable control inside the panel.
 * Closing via `Escape` returns it to the toggle button unconditionally.
 *
 * Every other close returns focus to the toggle **only when focus was still
 * inside the panel** at that moment — otherwise it leaves focus exactly
 * where the reader put it. Both halves matter. A gesture means the reader's
 * attention has already left the panel, and yanking focus to the toggle
 * would be its own surprise; but focus left inside a panel that is about to
 * go `display: none` is stranded on `<body>`, at the top of the document.
 *
 * `toggle()`'s close branch takes the same containment check rather than
 * assuming a click already left focus on the toggle. That assumption held
 * while the Filters button — then on the day rail, now in the site header —
 * was `toggle`'s only caller; the caret (`FilterPanelCaret`, mounted *inside*
 * the panel) is a second caller for which `document.activeElement` is
 * guaranteed to be inside the panel when it fires. One containment check
 * covers both: it is a no-op for the Filters button, whose click already
 * moved focus out of the panel, wherever that button happens to live.
 *
 * `{ preventScroll: true }` on every focus call here is deliberate: a
 * browser's default focus-scroll would move a reader this hook has no other
 * reason to move.
 *
 * ## Exit animation
 *
 * Every close (toggle, `Escape`, or gesture) plays a ~200ms slide-and-fade
 * unless `prefers-reduced-motion: reduce` is set, in which case the panel is
 * removed outright — see `globals.css`'s `.filter-panel-exit`. `exiting` is
 * exposed so `page.tsx` can keep the element mounted, and painted, for as long
 * as the transition runs.
 *
 * That is the whole of it now. On an element that was always `position: fixed`
 * there is no rect to capture, no `position` to switch, and — critically — no
 * first commit rendered `display: none`, which a CSS transition cannot start
 * from (there is no before-change style) and which is what `exitRect` and
 * `exitScrolledPast` were invented to avoid.
 *
 * Reopening while a previous exit is still animating reuses that same
 * element, so the in-flight exit is discarded (`exiting` reset, its fallback
 * timer cancelled) rather than left to finish underneath the reopened panel —
 * the double-dismiss case the hook's tests pin by name. The fallback timer
 * (`EXIT_FALLBACK_MS`) exists because `transitionend` never fires for an
 * element that's never painted (a background tab, or a browser-decided
 * reduced-motion skip); without it a dismissal made while hidden would leave
 * `exiting` stuck `true` forever. Note that has nothing to do with flow, so it
 * survives this deletion untouched.
 */
export function useFilterPanel(): {
  open: boolean;
  toggle: () => void;
  panelId: string;
  panelRef: (el: HTMLElement | null) => void;
  toggleRef: (el: HTMLButtonElement | null) => void;
  exiting: boolean;
} {
  const [open, setOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  const panelId = useId();
  const panelElRef = useRef<HTMLElement | null>(null);
  const toggleElRef = useRef<HTMLButtonElement | null>(null);

  const panelRef = useCallback((el: HTMLElement | null) => { panelElRef.current = el; }, []);
  const toggleRef = useCallback((el: HTMLButtonElement | null) => { toggleElRef.current = el; }, []);

  // The one place `open` is set to `false`. Flips `exiting` and `open`
  // together, so the element stays mounted and painted for the transition
  // while no longer being the open panel.
  //
  // `prefers-reduced-motion: reduce` (or a panel that somehow isn't mounted)
  // skips straight to the no-animation close: just gone, and any exit already
  // in flight is discarded so it doesn't linger after this simpler close ran
  // on top of it.
  const beginExit = useCallback(() => {
    const panel = panelElRef.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!panel || reducedMotion) {
      setExiting(false);
      setOpen(false);
      return;
    }
    setExiting(true);
    setOpen(false);
  }, []);

  // Reopening reuses the very element a previous exit may still be
  // animating, so that exit has to be discarded outright rather than left to
  // finish underneath the reopened panel. Clearing `exiting` here is also what
  // cancels its fallback timer: the effect that owns that timer is scoped to
  // `exiting` and tears itself down the instant this flips it back to `false`.
  const cancelExit = useCallback(() => {
    setExiting(false);
  }, []);

  // Focus left inside a panel that is about to become `display: none` drops
  // to `<body>`, which throws the reader to the top of the document. Focus
  // that the reader deliberately moved elsewhere is left where they put it.
  // Every non-Escape close path takes this; see the hook doc's "Focus"
  // section for why the caret made it mandatory on `toggle` too.
  const returnFocusIfStranded = useCallback(() => {
    const panel = panelElRef.current;
    if (panel && document.activeElement && panel.contains(document.activeElement)) {
      toggleElRef.current?.focus({ preventScroll: true });
    }
  }, []);

  // The only way `open` changes. Reads the current `open` directly (rather
  // than a functional update) because closing now needs `beginExit`'s side
  // effect, not just a flip.
  //
  // Two controls call this: the site header's Filters funnel (outside the
  // panel) and the caret (inside it). The containment check is a no-op for the
  // former and the whole point for the latter — which is why it is about
  // WHERE the caller sits, not which control it is. #274 phase 3 moved that
  // outside caller from the day rail to the header without changing anything
  // here, because "outside" was always the property that mattered.
  const toggle = useCallback(() => {
    if (open) {
      beginExit();
      returnFocusIfStranded();
    } else {
      cancelExit();
      setOpen(true);
    }
  }, [open, beginExit, cancelExit, returnFocusIfStranded]);

  // Escape is the one closer that returns focus unconditionally: the reader
  // pressed a key, so they are keyboarding, and the toggle is where they
  // expect to land whether or not focus had wandered out of the panel.
  const closeViaEscape = useCallback(() => {
    beginExit();
    toggleElRef.current?.focus({ preventScroll: true });
  }, [beginExit]);

  // Closing by gesture takes the same exit animation as every other close. No
  // focus return by default: a gesture means the reader's attention has
  // already left the panel, and yanking focus to the toggle would be its own
  // surprise. The one exception is focus that is still INSIDE the panel — see
  // `returnFocusIfStranded`.
  const closeViaGesture = useCallback(() => {
    beginExit();
    returnFocusIfStranded();
  }, [beginExit, returnFocusIfStranded]);

  // A gesture that starts inside the panel is the reader scrolling the
  // panel's own overflow, not the list. A gesture on the toggle is the
  // reader closing it deliberately — dismissing here too would close on
  // `mousedown` and reopen on the following `click`.
  //
  // `Home` on a day-rail chip is a third case, and a narrower one. The rail
  // sits below the panel, stays keyboard-reachable while the panel is open,
  // and claims `Home` for moving focus to today's chip — the same local job
  // `ArrowLeft`/`ArrowRight` do there, and those are not scroll keys at all.
  // The dismiss listener is capture-phase, so it would fire before the rail's
  // own handler and slide the panel away under a keypress that was never
  // about the page.
  //
  // Deliberately the single key the rail actually consumes, and not the rail
  // as a whole: a chip TAP must still dismiss (the reader has turned back to
  // the results — `dayRailIntegration` pins that composition by name), and
  // `PageDown` with focus parked on a chip really is a page scroll.
  const isExempt = useCallback((event: Event) => {
    const target = event.target;
    if (!(target instanceof Node)) return false;
    if (panelElRef.current?.contains(target) || toggleElRef.current?.contains(target)) return true;
    return event.type === 'keydown'
      && (event as KeyboardEvent).key === 'Home'
      && target instanceof Element
      && !!target.closest('[data-chip]');
  }, []);

  useDismissOnScrollGesture({ active: open, onDismiss: closeViaGesture, isExempt });

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

  // Owns the exit animation's cleanup, scoped to `exiting` so it re-arms on
  // every fresh exit and tears itself down — cancelling both the listener
  // and the fallback timer — the instant `exiting` flips back to `false`,
  // whether that happened here, via a reopen (`cancelExit`), or via the
  // reduced-motion path in `beginExit`. That teardown-on-every-transition is
  // exactly what makes the double-dismiss case safe without any extra
  // bookkeeping: a stale timer from a discarded exit cannot outlive it.
  useEffect(() => {
    if (!exiting) return;
    const panel = panelElRef.current;
    // The panel goes `display: none` and stays exactly where it was. Nothing
    // re-enters flow, so there is nothing to correct for — see the hook doc's
    // "Why there is no scroll preservation here".
    const finish = () => { setExiting(false); };
    // `transitionend` bubbles, and the panel's own subtree is full of
    // Tailwind transitions unrelated to the exit — chip hover colours,
    // chevron rotations. A gesture dismissal typically also produces a
    // hover-out on whatever was under the pointer, so an unfiltered
    // listener would finish the exit on that unrelated ~150ms colour
    // transition instead of the panel's own ~200ms slide, unmounting the
    // ghost partway through. Only a transition that ran on the panel
    // element itself (not a descendant) counts.
    const onTransitionEnd = (e: Event) => {
      if (e.target !== panel) return;
      finish();
    };
    const timeoutId = window.setTimeout(finish, EXIT_FALLBACK_MS);
    panel?.addEventListener('transitionend', onTransitionEnd);
    return () => {
      window.clearTimeout(timeoutId);
      panel?.removeEventListener('transitionend', onTransitionEnd);
    };
  }, [exiting]);

  return { open, toggle, panelId, panelRef, toggleRef, exiting };
}
