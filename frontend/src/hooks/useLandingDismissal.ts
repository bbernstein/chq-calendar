import { useCallback, useEffect, useState } from 'react';
import type { DayKey } from '@/lib/utils/dayWindow';

/**
 * The two ways a reader dismisses the off-season/archived landing, and the
 * one rule that governs both: a different year is a different question, so
 * neither dismissal carries across one.
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
   * "Browse the N season". Does NOT set `dismissedLandingTarget` — browsing
   * via the button is not a request for any particular day, so the normal,
   * automatic landing day still applies.
   */
  browseArchiveSeason: () => void;
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
  const [browsingArchive, setBrowsingArchive] = useState(false);
  const [dismissedLandingTarget, setDismissedLandingTarget] = useState<DayKey | null>(null);

  // A different year is a different question, so neither dismissal carries
  // across one. Reset rather than keyed state because `year` also changes
  // underneath the caller when the manifest resolves a `?year=` param.
  //
  // `dismissedLandingTarget`'s half of this only matters for an override
  // that never resolved: `page.tsx`'s `clearDismissedTarget` already
  // consumes a successful one the moment it lands, before any subsequent
  // year change could see it. It stays load-bearing for a target whose
  // section never mounts at all — `⟳ Now` can point at a day with no
  // events (`reachableTodayKey` checks only the navigable bounds), and
  // without this reset a stale prior-year day key would silently outlive
  // the year switch and misdirect the hook in the new year, which then
  // never lands at all (the deps go stable with no section to find).
  useEffect(() => {
    setBrowsingArchive(false);
    setDismissedLandingTarget(null);
  }, [year]);

  const browseArchiveSeason = useCallback(() => {
    setBrowsingArchive(true);
  }, []);

  const dismissForDay = useCallback((target: DayKey) => {
    setDismissedLandingTarget(target);
    setBrowsingArchive(true);
  }, []);

  const clearDismissedTarget = useCallback(() => {
    setDismissedLandingTarget(null);
  }, []);

  return { browsingArchive, dismissedLandingTarget, browseArchiveSeason, dismissForDay, clearDismissedTarget };
}
