import { useCallback, useEffect, useRef, useState } from 'react';
import { daySectionElement } from '@/lib/utils/daySections';

/**
 * How far below the viewport top a day header counts as "the one I'm reading".
 *
 * Read from `--day-rail-h` rather than hardcoded: the rail's height changes
 * with browser text zoom, and a hardcoded offset would put the highlight one
 * day out of step for anyone who zooms — the same reason the sticky offset
 * itself is a custom property.
 */
function stickyOffset(): number {
  if (typeof document === 'undefined') return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--day-rail-h');
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The day the reader is currently looking at, and a way to go to another one.
 *
 * Pure view state. The anchor is derived from scroll position, is never
 * persisted, and never participates in filtering — a navigation control that
 * mutated a filter would put the reader back in the walled-garden this whole
 * initiative exists to escape.
 *
 * Driven by a rAF-throttled `scroll` listener rather than an
 * `IntersectionObserver`. "The last section whose top has passed the sticky
 * chrome" is a question about position; IO answers a question about
 * visibility, and reports only *changes* in it. Phase 2 already paid for
 * that distinction once.
 */
export function useDayAnchor(windowDayKeys: string[]): {
  anchorDay: string | null;
  scrollToDay: (key: string) => void;
  cancelHold: () => void;
} {
  const [anchorDay, setAnchorDay] = useState<string | null>(null);

  // Serialized so the effect below re-runs when the *contents* change, not on
  // every render that hands down a new array identity.
  const keysId = windowDayKeys.join(',');

  useEffect(() => {
    if (windowDayKeys.length === 0) { setAnchorDay(null); return; }

    let frame = 0;
    const measure = () => {
      frame = 0;
      const limit = stickyOffset() + 1;
      // Walk forward and keep the last one that has passed the chrome. The
      // first day in the window is the fallback: before any scroll, nothing
      // has passed, and the reader is plainly looking at the top of the list.
      // `windowDayKeys` is the view window's full day list, not the render
      // window's mounted subset — a day this loop reaches may have no
      // section yet, which is exactly what `daySectionElement` returning
      // null below is for.
      let next = windowDayKeys[0];
      for (const key of windowDayKeys) {
        const el = daySectionElement(key);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= limit) next = key;
        else break;
      }
      setAnchorDay(next);
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    // Measure once immediately: a prepend or an auto-expand moves content
    // past the reader without producing any scroll event, and an anchor that
    // waited for a gesture would sit on a day that is no longer on screen.
    measure();
    // Passive: this listener must never delay a scroll.
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
    // NOTE for humans, not a real eslint-disable: this repo has no
    // eslint-plugin-react-hooks, so a literal `eslint-disable-next-line
    // react-hooks/exhaustive-deps` comment here is a hard ESLint 9 error
    // ("Definition for rule ... was not found"), not a silenced warning.
    // The dependency array is intentionally just [keysId] — a serialized
    // form of windowDayKeys — so the effect re-runs when the *contents*
    // change rather than on every render that hands down a new array
    // identity.
  }, [keysId]);

  // What `scrollToDay` last targeted, held at the sticky offset until the
  // day stops moving or the reader takes over. See the effect below for why
  // this exists and why it is instant, not smooth.
  const settleRef = useRef<{ key: string; top: number } | null>(null);

  const scrollToDay = useCallback((key: string) => {
    const el = daySectionElement(key);
    if (!el) return;
    // Computed here, not left to `scrollIntoView`'s `block: 'start'`:
    // `scrollIntoView` is not used on this path at all, so the section's own
    // `scroll-margin-top: var(--day-rail-h)` (set in `EventListView.tsx`) is
    // never consulted here — that property is read only by a native
    // `scrollIntoView`/anchor scroll or CSS scroll-snap, neither of which is
    // live on this path. Computing the delta against `stickyOffset()`
    // directly targets the same `--day-rail-h` value the CSS does, so the
    // two stay in agreement; the CSS itself remains correct and load-bearing
    // for any future native scroll to a day section (an anchor jump, a
    // `focus()`-driven scroll).
    //
    // Instant, not smooth: a ~2s smooth animation leaves a ~2s window in
    // which mounted content can keep changing height for reasons this
    // codebase already documents as real but unexplained (see the identical
    // "~104px of growth with no DOM mutation" note on the upward-prepend
    // correction below in EventList) — a smooth scroll does not re-target
    // mid-flight, so it finishes exactly as far short as the content grew
    // above the target. Browser-measured: a chip 6 days past the render
    // window landed the target ~1058px short after ~2s of smooth animation,
    // during which the document grew ~1020px. Instant collapses the
    // vulnerable window from that whole animation down to about one frame,
    // and it is what the proven settle pattern below already assumes:
    // reasserting a `scrollBy` correction *while a native smooth animation
    // is still running* would fight that animation rather than replace it.
    const delta = el.getBoundingClientRect().top - stickyOffset();
    if (delta !== 0) window.scrollBy(0, delta);
    settleRef.current = { key, top: stickyOffset() };
  }, []);

  /**
   * Drop the hold because the reader has asked for something else.
   *
   * The other direction of the arbitration `EventList`'s `revealDay` effect
   * already performs: that effect clears `EventList`'s prepend hold whenever a
   * rail navigation starts, but nothing cleared THIS hold when a prepend
   * started, so "Show earlier" could arm its own correction while this one was
   * still armed on a different day. The prepend changes document height, which
   * fires the `ResizeObserver` below, whose reassert yanks the old rail target
   * back and cancels the prepend correction. A mouse click on "Show earlier"
   * fires none of the `wheel`/`touchstart`/`keydown` gestures that would
   * otherwise end the hold, so it has to be ended explicitly.
   */
  const cancelHold = useCallback(() => { settleRef.current = null; }, []);

  // Holds the day `scrollToDay` last targeted at the sticky offset until it
  // stops moving or the reader takes over.
  //
  // This is the exact settle pattern `EventList` uses for its upward-prepend
  // correction, reused here for the identical failure class: a scroll
  // decision invalidated by content changing height *after* it was made.
  // Lives here, not in `page.tsx`'s pending-scroll effect, because holding a
  // position requires knowing the target day's element and the sticky
  // offset — both already private to this hook (`daySectionElement`,
  // `stickyOffset()`) — and because "scroll to a day, then hold it there" is
  // one operation, not two split across a hook and its caller.
  //
  // A `ResizeObserver` on `document.documentElement` is the broadest
  // reasonable proxy for "the page's content changed height": this hook has
  // no reference to the list's own scroll container the way `EventList` does,
  // and a false-positive callback is harmless — `delta` resolves to 0 and
  // nothing happens.
  //
  // Keyed on `keysId`, and the hold is dropped in the cleanup, so it lives no
  // longer than the day list it was armed against. `EventList`'s equivalent
  // hold is commit-scoped — nulled on any commit that produces no fresh
  // correction — while this one was set up in a `useEffect(..., [])` and
  // cleared ONLY by `wheel`/`touchstart`/`keydown` or its target leaving the
  // DOM. It therefore survived filter changes, scope changes and arbitrary
  // elapsed time, and neither a scrollbar-thumb drag nor a mouse click fires
  // any of those cancel gestures: a hold armed minutes ago could still
  // arbitrate against a resize now. `keysId` is the closest equivalent bound
  // available here — it changes on every filter change, scope change and
  // window expansion, i.e. whenever the list this correction was computed
  // against has become a different list. A cap on the number of reasserts
  // was the alternative and is worse: the late growth this hold exists to
  // absorb arrives in an unknown number of resize callbacks (that is the
  // whole reason it is observed rather than scheduled), so any cap is a
  // guess that would silently stop correcting mid-settle.
  useEffect(() => {
    const reassert = () => {
      const settle = settleRef.current;
      if (!settle) return;
      const el = daySectionElement(settle.key);
      // The target left the DOM (background refresh, filter change) —
      // nothing left to hold.
      if (!el) { settleRef.current = null; return; }
      const delta = el.getBoundingClientRect().top - settle.top;
      if (delta !== 0) window.scrollBy(0, delta);
    };
    // Any deliberate scroll gesture ends the hold. Deliberately NOT the
    // `scroll` event: our own `scrollBy` above fires that, so listening to
    // it would cancel the hold with the very correction that's supposed to
    // maintain it.
    //
    // `mousedown` is in this set because `keysId` bounds the hold by list
    // identity but not by time, and a scrollbar-thumb drag changes no day key
    // and fires none of wheel/touchstart/keydown. Reachable with no filter
    // change at all: tap a chip, drag the scrollbar down five days, expand an
    // event description — that resizes the document while leaving
    // `groupedEvents` untouched — and the page yanks back to the tapped day.
    //
    // This is deliberately coarse. `mousedown` cancels the hold no matter
    // what it lands on — including UI that causes no scroll at all, like
    // opening a dropdown or ticking a checkbox — so some holds get dropped
    // for no real reason. That is an accepted cost, not an oversight:
    // dropping a hold early only loses a late correction the reader may
    // never have noticed was pending, while keeping one too long risks
    // yanking the page out from under them mid-interaction. The first is
    // recoverable; the second is not. A cancel gesture set narrow enough to
    // avoid the false positives would risk missing a genuine takeover, which
    // is the worse failure of the two.
    //
    // It cannot cancel the hold the same interaction is about to arm: DOM
    // event order is mousedown → mouseup → click, every rail control arms via
    // `onClick`, and the arming itself happens later still, in the
    // pending-scroll effect one commit after that click. And unlike `scroll`,
    // a programmatic `window.scrollBy` synthesises no pointer event, so our
    // own correction cannot trip this.
    const stop = () => { settleRef.current = null; };

    // `ResizeObserver` is absent in some older browsers and in jsdom without
    // a stub. Skipping it here is still correct — only the late-growth
    // reassert is lost, which is strictly better than throwing on mount (see
    // the identical guard in `useDayRailHeight`). The cancel listeners below
    // stay attached either way: they don't depend on the observer existing.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reassert);
    observer?.observe(document.documentElement);
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('mousedown', stop, { passive: true });
    window.addEventListener('keydown', stop);
    return () => {
      // The day list this hold was computed against is gone.
      settleRef.current = null;
      observer?.disconnect();
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('mousedown', stop);
      window.removeEventListener('keydown', stop);
    };
    // NOTE for humans, not a real eslint-disable — see the identical note on
    // the measuring effect above for why a literal disable comment is an
    // ESLint 9 error in this repo. `keysId` is the serialized form of
    // `windowDayKeys`; the effect re-runs when the contents change rather
    // than on every render that hands down a new array identity.
  }, [keysId]);

  return { anchorDay, scrollToDay, cancelHold };
}
