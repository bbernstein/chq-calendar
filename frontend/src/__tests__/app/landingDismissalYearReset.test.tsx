import { useCallback, useState } from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/preact';
import { describe, it, expect, vi } from 'vitest';
import { useInitialLanding } from '@/hooks/useInitialLanding';
import { useLandingDismissal } from '@/hooks/useLandingDismissal';

/**
 * Task 6 fix round 1, "Important 1". `useLandingDismissal`'s year-change
 * effect resets BOTH `browsingArchive` and `dismissedLandingTarget` to their
 * defaults:
 *
 * ```
 * useEffect(() => {
 *   setBrowsingArchive(false);
 *   setDismissedLandingTarget(null);
 * }, [year]);
 * ```
 *
 * `browsingArchive`'s half is already covered end-to-end by
 * `offSeasonLanding.test.tsx`'s "a year change brings the landing back".
 * `dismissedLandingTarget`'s half was not: `page.tsx`'s own
 * `scrollToDayForLanding` wrapper (`clearDismissedTarget`) clears it the
 * moment a rail-tap override resolves, so on the app's only
 * currently-reachable route (tap a real day chip, which `DayRail` only
 * wires for a day that already has events) the override is always already
 * `null` again by the time any year switch could follow it — deleting the
 * reset line fails nothing on that route alone.
 *
 * It is still load-bearing for a target that never resolves at all — `⟳ Now`
 * targets `reachableTodayKey`, which checks only the navigable BOUNDS, not
 * whether today actually has an event, so a tap on a dark "today" inside the
 * season is a real, reachable way to leave `dismissedLandingTarget` stuck.
 *
 * Fix round 2: this Harness previously reimplemented `browsingArchive` /
 * `dismissedLandingTarget` / the reset effect itself, as local state — so a
 * falsification against it proved the MECHANISM works, but bound to nothing
 * in production; deleting the real `page.tsx:196`-era reset line still
 * passed the whole suite. The Harness now imports `useLandingDismissal`
 * directly, so the falsification below (and `useLandingDismissal.test.ts`'s
 * own, more direct one) both land on the actual hook `page.tsx` uses.
 *
 * The stuck target itself is still modelled rather than reproduced through a
 * literal dark-day calendar fixture (a section that never mounts, in either
 * year) — the property under test is the reset's own contract, not the
 * calendar, and constructing a real "landing shows AND `⟳ Now` is enabled
 * AND today has zero events" combination would depend on incidental season
 * dates unrelated to what's being verified.
 */
function Harness({ scrollToDay }: { scrollToDay: (key: string) => void }) {
  const [year, setYear] = useState(2026);
  const { browsingArchive, dismissedLandingTarget, browseArchiveSeason, dismissForDay, clearDismissedTarget } =
    useLandingDismissal(year);

  const showLanding = !browsingArchive;
  const listMounted = !showLanding;
  // Each year's own normal landing day — what `landingDayKey` would resolve
  // to, standing in for it here since the calendar itself isn't under test.
  const landingDay = year === 2026 ? '2026-07-04' : '2025-07-04';

  const scrollToDayForLanding = useCallback((key: string) => {
    scrollToDay(key);
    clearDismissedTarget();
  }, [scrollToDay, clearDismissedTarget]);

  useInitialLanding({
    targetDay: dismissedLandingTarget ?? landingDay,
    year,
    listMounted,
    scrollToDay: scrollToDayForLanding,
    explicit: dismissedLandingTarget !== null,
  });

  const goToDay = useCallback((target: string) => {
    if (showLanding) {
      dismissForDay(target);
      return;
    }
    scrollToDayForLanding(target);
  }, [showLanding, dismissForDay, scrollToDayForLanding]);

  return (
    <div>
      {/* A day with no section, ever — modelling `⟳ Now` on a dark day. */}
      <button type="button" onClick={() => goToDay('2026-07-11')}>Tap dark day</button>
      <button type="button" onClick={browseArchiveSeason}>Browse this season</button>
      <button type="button" onClick={() => setYear(2025)}>Switch to 2025</button>
      {listMounted && <div data-day-key={landingDay} />}
    </div>
  );
}

describe('the year-change reset of a pending rail-tap override', () => {
  it('a fresh year lands on its OWN season start, not a stale prior-year target', async () => {
    const scrollToDay = vi.fn();
    render(<Harness scrollToDay={scrollToDay} />);

    // Tap a day whose section never resolves — the override sticks.
    fireEvent.click(screen.getByRole('button', { name: 'Tap dark day' }));
    await waitFor(() => {}); // let the (no-op) effect settle
    expect(scrollToDay).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Switch to 2025' }));
    fireEvent.click(screen.getByRole('button', { name: 'Browse this season' }));

    await waitFor(() => expect(scrollToDay).toHaveBeenCalledExactlyOnceWith('2025-07-04'));
  });
});
