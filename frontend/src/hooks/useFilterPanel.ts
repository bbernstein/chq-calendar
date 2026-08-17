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

// globals.css's `.filter-panel-exit` transition runs 200ms; this is that
// plus a 200ms margin, not a thin one. `transitionend` does not fire if the
// element is never painted (a background tab, or the browser skipping the
// transition on its own under some reduced-motion paths) — without this
// fallback that leaves `exiting` stuck true and a fixed-position panel
// stranded on screen. The two failure modes of the margin's width are not
// symmetric: too short and the fallback can outrace a transition that is
// still genuinely playing but running late (a dropped-frame stretch or a GC
// pause on a low-end phone under real content — the panel carries a
// SearchBar, four scopes, a nine-week strip, venues, categories — is well
// within a 60ms budget), which unmounts the ghost mid-slide as a visible
// pop instead of a fade; too long only delays cleanup in the one case this
// exists for, where the tab isn't being looked at and the extra time is not
// perceptible. That asymmetry is why this errs wide rather than tight.
const EXIT_FALLBACK_MS = 400;

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
 * Closing via `Escape` returns it to the toggle button unconditionally.
 *
 * Every other close returns focus to the toggle **only when focus was still
 * inside the panel** at that moment — otherwise it leaves focus exactly
 * where the reader put it. Both halves matter. A gesture means the reader's
 * attention has already left the panel, and yanking focus to the toggle
 * would be its own surprise; but focus left inside a panel that is about to
 * go `inert` + `aria-hidden` + `display: none` is stranded on `<body>`, at
 * the top of the document.
 *
 * `toggle()`'s close branch takes the same containment check rather than
 * assuming a click already left focus on the toggle. That assumption held
 * while the rail's Filters button was `toggle`'s only caller; the caret
 * (`FilterPanelCaret`, mounted *inside* the panel) is a second caller for
 * which `document.activeElement` is guaranteed to be inside the panel when
 * it fires. One containment check covers both: it is a no-op for the rail
 * toggle, whose click already moved focus out of the panel.
 *
 * `{ preventScroll: true }` on every focus call here is deliberate: a
 * browser's default focus-scroll would fight the exact scroll position this
 * hook exists to hold steady.
 *
 * ## Exit animation
 *
 * Every close (toggle, `Escape`, or gesture) plays a ~200ms slide-and-fade
 * unless `prefers-reduced-motion: reduce` is set, in which case the panel is
 * removed outright — see `globals.css`'s `.filter-panel-exit`. `exiting` and
 * `exitRect` are exposed so `page.tsx` can render the *same* panel element
 * `position: fixed` at the rect it just occupied while the in-flow slot
 * drops empty in the same commit — no DOM clone, no relayout of the list
 * underneath it. The rect is captured here, before `open` flips to `false`,
 * because that is the only moment it can still be read from the panel's
 * in-flow position.
 *
 * `scrolledPast` is the caller's page-level "the panel is currently acting
 * as an overlay over the list" signal, and `exitScrolledPast` is its value
 * frozen for the lifetime of one exit. It is taken here, synchronously
 * inside `beginExit`, so that `exiting`, `exitRect` and it all land in the
 * SAME commit. Deriving it in the consumer from an effect instead — even a
 * layout effect — is one commit late, and one commit late is fatal rather
 * than cosmetic: the consumer renders the panel `display: none` for that
 * first commit, and **a CSS transition cannot start from `display: none`**
 * (there is no before-change style), so the panel jumps straight to its
 * `translateY(-100%); opacity: 0` end state with no slide at all and
 * `transitionend` never fires. That is invisible in jsdom and invisible on
 * every dismissal after the first, because a state latch stays `true` once
 * set — it is only ever wrong on the FIRST dismissal after the reader
 * crosses the sentinel, which is the one every reader sees.
 *
 * Freezing it also settles a genuine race the live signal loses: this
 * exit's own scroll correction (`scrollBy`, run synchronously at the start
 * of the exit) can move the reader back across the sentinel, and the
 * caller's IntersectionObserver reports that a frame or two later — well
 * inside the ~200ms animation. A live read would drop `position: fixed` and
 * the exit class mid-slide, snapping the ghost back into flow at full
 * opacity.
 *
 * Reopening while a previous exit is still animating reuses that same
 * element, so the in-flight exit is discarded (`exiting`/`exitRect` reset,
 * its fallback timer cancelled) rather than left to finish underneath the
 * reopened panel — the double-dismiss case the hook's tests pin by name.
 * The fallback timer (`EXIT_FALLBACK_MS`) exists because `transitionend`
 * never fires for an element that's never painted (a background tab, or a
 * browser-decided reduced-motion skip); without it a dismissal made while
 * hidden would leave `exiting` stuck `true` forever.
 */
export function useFilterPanel({ scrolledPast }: {
  /**
   * Whether the reader has scrolled past the in-flow filter card, i.e.
   * whether an open panel is currently overlaying the list rather than
   * sitting in flow at the top of the page. Owned by the caller
   * (`useScrolledPastFilters`); the hook only needs it at the instant an
   * exit begins — see the "Exit animation" section above.
   */
  scrolledPast: boolean;
}): {
  open: boolean;
  toggle: () => void;
  panelId: string;
  panelRef: (el: HTMLElement | null) => void;
  toggleRef: (el: HTMLButtonElement | null) => void;
  exiting: boolean;
  exitRect: DOMRect | null;
  exitScrolledPast: boolean;
} {
  const [open, setOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [exitRect, setExitRect] = useState<DOMRect | null>(null);
  const [exitScrolledPast, setExitScrolledPast] = useState(false);
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

  // The one place `open` is set to `false`. Measures the panel's rect while
  // it is still in flow (the only moment that's possible), then flips
  // `exiting`/`exitRect`/`exitScrolledPast`/`open` together in the same
  // commit so `page.tsx` can switch the panel to `position: fixed` at that
  // rect the instant its in-flow placeholder disappears — see the hook doc's
  // "Exit animation" section for why all four landing in ONE batch is
  // load-bearing rather than tidy.
  //
  // `prefers-reduced-motion: reduce` (or a panel that somehow isn't mounted)
  // skips straight to the no-animation close: no rect, no fixed ghost, just
  // gone, and any exit already in flight is discarded so it doesn't linger
  // after this simpler close ran on top of it.
  const beginExit = useCallback(() => {
    const panel = panelElRef.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!panel || reducedMotion) {
      setExiting(false);
      setExitRect(null);
      setExitScrolledPast(false);
      setOpen(false);
      return;
    }
    setExitRect(panel.getBoundingClientRect());
    setExitScrolledPast(scrolledPast);
    setExiting(true);
    setOpen(false);
  }, [scrolledPast]);

  // Reopening reuses the very element a previous exit may still be
  // animating (no DOM clone — see the hook doc), so that exit has to be
  // discarded outright rather than left to finish underneath the reopened
  // panel. Clearing `exiting` here is also what cancels its fallback timer:
  // the effect that owns that timer is scoped to `exiting` and tears itself
  // down the instant this flips it back to `false`.
  const cancelExit = useCallback(() => {
    setExiting(false);
    setExitRect(null);
    setExitScrolledPast(false);
  }, []);

  // Focus left inside a panel that is about to become `inert` +
  // `aria-hidden` + `display: none` drops to `<body>` — the reader is thrown
  // to the top of the document. Focus the reader deliberately moved
  // elsewhere is left alone. Every non-Escape close path takes this; see the
  // hook doc's "Focus" section for why the caret made it mandatory on
  // `toggle` too.
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
  // Two controls call this: the rail's Filters button (outside the panel)
  // and the caret (inside it). The containment check is a no-op for the
  // former and the whole point for the latter.
  const toggle = useCallback(() => {
    captureScrollReference();
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
    captureScrollReference();
    beginExit();
    toggleElRef.current?.focus({ preventScroll: true });
  }, [beginExit]);

  // Closing by gesture takes the same scroll-correction capture and exit
  // animation as every other close. No focus return by default: a gesture
  // means the reader's attention has already left the panel, and yanking
  // focus to the toggle would be its own surprise. The one exception is
  // focus that is still INSIDE the panel — see `returnFocusIfStranded`.
  const closeViaGesture = useCallback(() => {
    captureScrollReference();
    beginExit();
    returnFocusIfStranded();
  }, [beginExit, returnFocusIfStranded]);

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
    // `exiting` as well as `open`: the panel enters flow on open and leaves
    // it on close, but it ALSO leaves flow when the exit animation starts
    // (`position: fixed`) and re-enters it when that animation ends. All
    // four are the same height change above the reader and all four need the
    // same correction — see `finish()` for the one that was missing.
  }, [open, exiting]);

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
    const finish = () => {
      // The mirror of the capture every close path already does before the
      // panel LEAVES flow. Ending the exit puts it back: `exiting` false
      // drops `position: fixed`, and the panel becomes in-flow content again
      // — parked above the viewport on the header's negative `top`, but
      // in flow, and its full height re-enters the document ABOVE the
      // reader. Uncorrected, that lands as a measured 285px jump down the
      // list at the exact moment the animation ends.
      //
      // This mirror did not exist before the panel was parked rather than
      // hidden, and did not need to: the panel used to return to
      // `display: none`, so it never re-entered flow at all and there was
      // nothing to correct. See `filterHeaderLayout.ts` for why hiding it
      // was the bug.
      captureScrollReference();
      setExiting(false);
      setExitRect(null);
    };
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

  return { open, toggle, panelId, panelRef, toggleRef, exiting, exitRect, exitScrolledPast };
}
