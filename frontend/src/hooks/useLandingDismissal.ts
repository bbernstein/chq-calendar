import { useCallback, useEffect, useState } from 'react';
import type { DayKey } from '@/lib/utils/dayWindow';

/**
 * The two ways a reader dismisses the off-season/archived landing, and the
 * one rule that governs both: a different year is a different question, so
 * neither dismissal carries across one. The dismissal is therefore held as
 * the year it was made for rather than as a boolean — see
 * `browsingArchiveYear` below for why #186 forced that distinction into the
 * open.
 *
 * Extracted out of `page.tsx` (task 6 fix round 2) so the year-reset below
 * is a single, independently testable unit rather than two lines living only
 * inside a page-sized component — a re-review found that lines this shape
 * (a guard with no direct caller-visible effect of its own, only preventing
 * a LATER bug) are exactly the kind this repo has repeatedly shipped
 * unfalsified. A composition-test Harness for it inevitably ends up
 * re-implementing it rather than importing the real thing; this makes
 * importing the real thing possible.
 */
export interface LandingDismissal {
  /**
   * Whether the reader has pressed past the landing with "Browse the N
   * season" (`browseArchiveSeason`) or a rail control (`dismissForDay`).
   */
  browsingArchive: boolean;
  /**
   * Where a rail control (a day chip, `⟳ Now`, a week-band cell) sends the
   * reader when it was tapped while the landing was still covering the
   * list. `null` means no override: the load's own computed landing day is
   * what `useInitialLanding` should use instead.
   */
  dismissedLandingTarget: DayKey | null;
  /**
   * "Browse the N season", for the year named on that button. Does NOT set
   * `dismissedLandingTarget` — browsing via the button is not a request for
   * any particular day, so the normal, automatic landing day still applies.
   *
   * It takes the year because the button now offers one in `pre-season` too
   * (#186), where the offered year is an EARLIER one from the manifest, not
   * the year on screen. `page.tsx` pairs this with `setSelectedYear(year)`;
   * recording the same year here is what lets the dismissal survive the year
   * change that immediately follows it.
   */
  browseArchiveSeason: (year: number) => void;
  /**
   * A rail control tapped while the landing was still up. Sets BOTH
   * `browsingArchive` (so the landing actually goes away) and
   * `dismissedLandingTarget` (so `useInitialLanding` is told to land on
   * this day specifically, `explicit`, rather than its own guess).
   */
  dismissForDay: (target: DayKey) => void;
  /**
   * Consumes a resolved override. The caller is expected to call this only
   * once `dismissedLandingTarget` has actually been acted on — `page.tsx`
   * does it from inside the `scrollToDay` it hands `useInitialLanding`, so
   * it fires exactly when the hook's own `daySectionElement` check has
   * already succeeded.
   */
  clearDismissedTarget: () => void;
}

export function useLandingDismissal(year: number): LandingDismissal {
  // The YEAR the reader pressed past the landing for, not a bare boolean.
  //
  // "A different year is a different question" used to be enforced by an
  // effect that reset a boolean whenever `year` changed. That is exactly
  // backwards for #186's pre-season button, whose whole job is to dismiss the
  // landing FOR A DIFFERENT YEAR than the one on screen: `page.tsx` calls
  // `setSelectedYear(archiveYear)` and `browseArchiveSeason(archiveYear)`
  // together, the effect would then see `year` change and immediately undo
  // the dismissal, and the reader would land on the archive year's own
  // post-season landing — two taps to reach a season the button already
  // named. Scoping the state to a year states the same rule without the race:
  // the dismissal applies to the year it was made for and to no other, and it
  // no longer matters whether the year change is observed before or after it.
  const [browsingArchiveYear, setBrowsingArchiveYear] = useState<number | null>(null);
  const browsingArchive = browsingArchiveYear === year;
  const [dismissedLandingTarget, setDismissedLandingTarget] = useState<DayKey | null>(null);

  // The target has no such cross-year use and keeps its reset. Reset rather
  // than keyed state because `year` also changes underneath the caller when
  // the manifest resolves a `?year=` param.
  //
  // This only matters for an override that never resolved: `page.tsx`'s
  // `clearDismissedTarget` already consumes a successful one the moment it
  // lands, before any subsequent year change could see it. It stays
  // load-bearing for a target whose section never mounts at all — `⟳ Now`
  // can point at a day with no events (`reachableTodayKey` checks only the
  // navigable bounds), and without this reset a stale prior-year day key
  // would silently outlive the year switch and misdirect the hook in the new
  // year, which then never lands at all (the deps go stable with no section
  // to find).
  useEffect(() => {
    setDismissedLandingTarget(null);
  }, [year]);

  const browseArchiveSeason = useCallback((target: number) => {
    setBrowsingArchiveYear(target);
  }, []);

  const dismissForDay = useCallback((target: DayKey) => {
    setDismissedLandingTarget(target);
    // A rail tap is always about the year currently on screen — the rail only
    // ever renders the selected year's days.
    setBrowsingArchiveYear(year);
  }, [year]);

  const clearDismissedTarget = useCallback(() => {
    setDismissedLandingTarget(null);
  }, []);

  return { browsingArchive, dismissedLandingTarget, browseArchiveSeason, dismissForDay, clearDismissedTarget };
}
