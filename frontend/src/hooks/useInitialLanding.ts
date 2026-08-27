import { useEffect, useRef } from 'react';
import { daySectionElement } from '@/lib/utils/daySections';
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
  // A real gesture is. These are the four `useSiteHeaderReveal` already treats
  // as "the reader is driving", and the same principle `useDayAnchor` uses to
  // drop its settle hold: a gesture is intent, a scroll offset is a number.
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

    const takeOver = () => { readerTookOver.current = true; };
    const gestures = ['wheel', 'touchmove', 'keydown', 'mousedown'] as const;
    for (const type of gestures) {
      window.addEventListener(type, takeOver, { passive: true, capture: true });
    }
    return () => {
      try { history.scrollRestoration = previous; } catch { /* older Safari */ }
      for (const type of gestures) {
        window.removeEventListener(type, takeOver, { capture: true });
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
