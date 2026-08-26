import { useCallback, useEffect, useState } from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/preact';
import { describe, it, expect, vi } from 'vitest';
import { useInitialLanding } from '@/hooks/useInitialLanding';

/**
 * Task 6 fix round 1, "Important 1". `page.tsx`'s year-change effect resets
 * BOTH `browsingArchive` and `dismissedLandingTarget` to their defaults:
 *
 * ```
 * useEffect(() => {
 *   setBrowsingArchive(false);
 *   setDismissedLandingTarget(null);
 * }, [selectedYear]);
 * ```
 *
 * `browsingArchive`'s half is already covered end-to-end by
 * `offSeasonLanding.test.tsx`'s "a year change brings the landing back".
 * `dismissedLandingTarget`'s half was not: `page.tsx`'s own
 * `scrollToDayForLanding` wrapper clears it the moment a rail-tap override
 * resolves, so on the app's only currently-reachable route (tap a real day
 * chip, which `DayRail` only wires for a day that already has events) the
 * override is always already `null` again by the time any year switch could
 * follow it — deleting the reset line fails nothing there.
 *
 * It is still load-bearing for a target that never resolves at all — `⟳ Now`
 * targets `reachableTodayKey`, which checks only the navigable BOUNDS, not
 * whether today actually has an event, so a tap on a dark "today" inside the
 * season is a real, reachable way to leave `dismissedLandingTarget` stuck.
 * This harness models that stuck state directly (a target whose section
 * never mounts, in either year) rather than fighting the real app's season
 * calendar to reproduce a literal dark day, because the property under test
 * is the reset's own contract, not the calendar.
 */
function Harness({ scrollToDay }: { scrollToDay: (key: string) => void }) {
  const [year, setYear] = useState(2026);
  const [browsingArchive, setBrowsingArchive] = useState(false);
  const [dismissedLandingTarget, setDismissedLandingTarget] = useState<string | null>(null);

  // The line under test. Removed in the falsification below.
  useEffect(() => {
    setBrowsingArchive(false);
    setDismissedLandingTarget(null);
  }, [year]);

  const showLanding = !browsingArchive;
  const listMounted = !showLanding;
  // Each year's own normal landing day — what `landingDayKey` would resolve
  // to, standing in for it here since the calendar itself isn't under test.
  const landingDay = year === 2026 ? '2026-07-04' : '2025-07-04';

  const scrollToDayForLanding = useCallback((key: string) => {
    scrollToDay(key);
    setDismissedLandingTarget(null);
  }, [scrollToDay]);

  useInitialLanding({
    targetDay: dismissedLandingTarget ?? landingDay,
    year,
    listMounted,
    scrollToDay: scrollToDayForLanding,
    force: dismissedLandingTarget !== null,
  });

  const goToDay = useCallback((target: string) => {
    if (showLanding) {
      setDismissedLandingTarget(target);
      setBrowsingArchive(true);
      return;
    }
    scrollToDayForLanding(target);
  }, [showLanding, scrollToDayForLanding]);

  return (
    <div>
      {/* A day with no section, ever — modelling `⟳ Now` on a dark day. */}
      <button type="button" onClick={() => goToDay('2026-07-11')}>Tap dark day</button>
      <button type="button" onClick={() => setBrowsingArchive(true)}>Browse this season</button>
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
