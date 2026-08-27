import { useEffect, useRef } from 'react';
import { daySectionElement } from '@/lib/utils/daySections';
import {
  dragScrollsPage, gestureScrollsPage, keyScrollsPage, pressIsOnScrollbar,
} from '@/lib/scrollGestures';
import type { DayKey } from '@/lib/utils/dayWindow';

/**
 * Puts the reader in front of `targetDay`, once per year, on load.
 *
 * Guarded on `window.scrollY === 0` as well as on the once-per-year ref: the
 * event feed refreshes in the background, and a refresh that changed
 * `targetDay` while the reader was 40,000px down the list must not teleport
 * them back to today.
 *
 * ## Why the scroll guard is scoped to `landedFor.current === null`
 *
 * Task 6 fix round 1: a reader scrolled 30,000px into one year, then picked a
 * different year from the header. Nothing in the app resets `window.scrollY`
 * on a year change, so the stale offset was still there when this hook's
 * effect ran for the new year — and an unscoped `window.scrollY > 0` guard
 * read that as "the reader already scrolled *this* list" and latched without
 * ever scrolling, silently breaking the task's own stated contract ("the
 * season start on an archived year") for what is arguably the most common
 * way to reach one.
 *
 * `landedFor.current` distinguishes the two cases for free: `null` means this
 * hook has never landed for ANY year yet — a genuine first load, where a
 * nonzero `scrollY` is a real signal (browser scroll restoration, a slow
 * mount the reader scrolled through) worth respecting. Any other value means
 * it landed for a *different* year already, so `year` just changed — a
 * deliberate navigation, and the inherited `scrollY` describes a position
 * measured against a document that no longer exists. Only the first case
 * withholds the scroll.
 *
 * The scroll goes through `useDayAnchor.scrollToDay`, which computes a
 * *relative* delta from the target's own rect and then holds it there while
 * the page settles. That is load-bearing under `content-visibility: auto`:
 * sections above the target are sized by estimate until they render, so any
 * absolute offset computed by summing them would land near the day rather
 * than on it. Measured in the spec's addendum.
 */
export function useInitialLanding({ targetDay, year, listMounted, scrollToDay, explicit = false }: {
  targetDay: DayKey | null;
  year: number;
  /**
   * Whether the day list is on screen at all — `!showLanding && !loading &&
   * groupedEvents.length > 0` at the call site.
   *
   * A parameter rather than something this hook infers, and load-bearing:
   * without it the effect's dependencies never change between "the landing is
   * showing" and "the reader pressed Browse this season", so the list would
   * mount at January and stay there. The same gap swallows the first render,
   * where the feed has not arrived yet.
   */
  listMounted: boolean;
  scrollToDay: (key: DayKey) => void;
  /**
   * True when `targetDay` is a reader's own request — a rail control (a day
   * chip, `⟳ Now`, a week-band cell) tapped while the landing was still
   * covering the list — rather than this hook's automatic GUESS at where to
   * put the reader on load.
   *
   * Named for what the two guards below actually distinguish (an automatic
   * guess vs. a reader's request), not for what it does to them (task 6 fix
   * round 2 renamed this from `force`: "bypasses two of the three guards" is
   * a comment `force` needed and `explicit` does not — the next person
   * adding a guard to this hook can ask "does an explicit request skip
   * this one" without first learning what the current guards happen to be).
   *
   * Task 6 fix round 1: without this, `goToDay`'s landing-dismiss path (see
   * `page.tsx`) handed its target to this same hook and got silently
   * swallowed by guards written for the *automatic* case. Two separate,
   * independently reachable routes did this, neither needing the other:
   *
   * - The reader had merely scrolled the (`min-h-screen`, sticky-rail,
   *   footer-bearing) landing page itself — trivially possible on any phone —
   *   before tapping a chip. `window.scrollY > 0` latched the hook without
   *   scrolling, and nothing else ever moves the reader: the landing vanished,
   *   the list appeared, and the reader stayed exactly where they were,
   *   nowhere near the day they asked for.
   * - The reader had toggled a filter on and back off first. Turning a filter
   *   on mounts the list (`showLanding` false because `hasFilters` true) and
   *   lets the *automatic* landing consume its once-per-year latch on some
   *   unrelated default day; turning the filter back off brings the landing
   *   back (`browsingArchive` is untouched by a filter change); the next rail
   *   tap then hit `landedFor.current === year` and returned having done
   *   nothing.
   *
   * `explicit` bypasses both guards — a reader's own "take me to that day" is
   * a request, not a suggestion they might already have acted on or scrolled
   * past — while still requiring `targetDay`/`listMounted` and the target's
   * own section to exist, and still latching `landedFor` on success so the
   * automatic landing cannot ALSO fire in the same commit. Exactly one
   * `scrollToDay` call per commit either way; no ordering between two hook
   * instances to depend on.
   *
   * If the target's section never mounts at all — `⟳ Now` can point at a day
   * with no events, since `reachableTodayKey` checks only the navigable
   * bounds, not whether today has any — `explicit` stays true for the rest
   * of that year (nothing here clears it; `page.tsx`'s caller does, only on
   * success). The reader will be scrolled there the instant that day ever
   * does gain a section, however far they have since scrolled on their own.
   * Narrow, and they did ask for that specific day — a documented
   * consequence of `explicit` having no expiry, not a bug to fix here.
   *
   * A stricter alternative was considered and declined: folding this into
   * `targetDay` as a single `{ day, source: 'rail' | 'auto' }` makes an
   * explicit call with the automatic landing day unrepresentable at the type
   * level. Better typing, but it reshapes this hook's signature and all
   * eleven of its own tests for an illegal state that is currently unwritten
   * and has exactly one caller — declined for now, not overlooked.
   */
  explicit?: boolean;
}): void {
  const landedFor = useRef<number | null>(null);
  // Whether the READER has taken over, as distinct from the page merely
  // sitting at a non-zero offset.
  //
  // This guard used to test `window.scrollY > 0`. `history.scrollRestoration`
  // defaults to `auto`, so a browser restores an offset from the previous
  // visit — and on a document whose height is entirely data-dependent, and
  // which is barely a screen tall while the year is still arriving, that
  // restore is applied against the wrong height and clamped to something
  // arbitrary. The effect then read a non-zero `scrollY`, concluded the reader
  // had deliberately gone somewhere, latched, and never landed. A browser
  // restoring scroll is not a reader choosing a day.
  //
  // A real gesture is — but only a gesture that actually SCROLLS. This comment
  // used to claim the event set below was "the four `useSiteHeaderReveal`
  // already treats as the reader driving". It was not: that hook listens for
  // `mousemove`, never `mousedown`, and puts every event through
  // `scrollGestures` before believing it. This hook listened for a bare
  // `mousedown` and believed it outright.
  //
  // A press scrolls nothing. Pressing the off-season landing's own
  // "Browse the N season" button is a `mousedown` milliseconds before the list
  // it asks for mounts — so the press armed this guard, the guard latched, and
  // the reader was left sitting on January 3 of a season they had just asked
  // to be shown. Reproduced in a browser at `scrollY 0`; found by Copilot on
  // PR #282. The same held for Enter or Space on that button.
  //
  // So the question is `scrollGestures`', not this hook's: a wheel over a
  // nested scroller, a horizontal rail pan, a keystroke into a search field and
  // a drag that began on a control all fail to scroll the page, and none of
  // them is the reader asking to be somewhere else.
  //
  // Landing on today is this app's primary function — it exists to answer
  // "what is on today, and what is on next" — so the bar for suppressing it
  // has to be evidence the reader asked for something else.
  const readerTookOver = useRef(false);

  useEffect(() => {
    // This app decides where a load lands, not the browser. Restoration cannot
    // be right on a ~160,000px document that is a fraction of that height when
    // the offset is applied, and it actively fights the landing below.
    const previous = history.scrollRestoration;
    try { history.scrollRestoration = 'manual'; } catch { /* older Safari */ }

    // The element a mouse drag began on, and the previous touch position —
    // both are things `scrollGestures` needs and neither is readable from the
    // event in hand. Mirrors `useSiteHeaderReveal`'s wiring, deliberately: two
    // hooks asking "did the reader scroll?" must not answer it differently.
    let dragOrigin: Element | null = null;
    let lastTouchY: number | null = null;

    const takeOver = () => { readerTookOver.current = true; };

    const onPress = (e: Event) => {
      dragOrigin = e.target instanceof Element ? e.target : null;
      if (e.type === 'touchstart') {
        lastTouchY = (e as TouchEvent).touches?.[0]?.clientY ?? null;
        return;
      }
      // A press in the scrollbar track pages the view and fires nothing else —
      // no wheel, no key, no touch, no move. It is the one press that IS a
      // scroll. Every other press, the CTA above included, is not.
      if (pressIsOnScrollbar(e as MouseEvent)) takeOver();
    };
    const onRelease = () => { dragOrigin = null; lastTouchY = null; };

    const onGesture = (e: Event) => {
      if (e.type === 'keydown') {
        if (keyScrollsPage(e as KeyboardEvent)) takeOver();
        return;
      }
      if (e.type === 'mousemove') {
        if (dragScrollsPage(e as MouseEvent, dragOrigin)) takeOver();
        return;
      }
      // A single `touchmove` carries no direction; it has to be reconstructed
      // from the previous position, or `gestureScrollsPage` cannot tell a pan
      // that chains to the page from one a nested scroller keeps.
      let delta = 0;
      if (e.type === 'touchmove') {
        const y = (e as TouchEvent).touches?.[0]?.clientY ?? null;
        if (y !== null && lastTouchY !== null) delta = lastTouchY - y;
        lastTouchY = y;
        if (delta === 0) return;
      }
      if (gestureScrollsPage(e, delta)) takeOver();
    };

    const gestures = ['wheel', 'touchmove', 'keydown', 'mousemove'] as const;
    const presses = ['mousedown', 'touchstart'] as const;
    const releases = ['mouseup', 'touchend'] as const;
    for (const type of gestures) {
      window.addEventListener(type, onGesture, { passive: true, capture: true });
    }
    for (const type of presses) {
      window.addEventListener(type, onPress, { passive: true, capture: true });
    }
    for (const type of releases) {
      window.addEventListener(type, onRelease, { passive: true, capture: true });
    }
    return () => {
      try { history.scrollRestoration = previous; } catch { /* older Safari */ }
      for (const type of gestures) {
        window.removeEventListener(type, onGesture, { capture: true });
      }
      for (const type of presses) {
        window.removeEventListener(type, onPress, { capture: true });
      }
      for (const type of releases) {
        window.removeEventListener(type, onRelease, { capture: true });
      }
    };
  }, []);

  useEffect(() => {
    if (!targetDay || !listMounted) return;
    if (!explicit) {
      if (landedFor.current === year) return;
      if (landedFor.current === null && readerTookOver.current) {
        landedFor.current = year;
        return;
      }
    }
    if (!daySectionElement(targetDay)) return;
    landedFor.current = year;
    scrollToDay(targetDay);
  }, [targetDay, year, listMounted, scrollToDay, explicit]);
}
