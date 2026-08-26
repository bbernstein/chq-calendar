import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SeasonWeek } from '@/lib/types';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';
import type { WeekBandDestination } from '@/lib/utils/weekBands';
import { useFloatingCoords } from '@/hooks/useViewportClamp';
import { weekChooserTriggerLabel, weekGridColumns, weekGridRows } from '@/lib/utils/weekChooser';
import { WeekChooserIcon } from '@/components/calendar/WeekChooserIcon';
import { WeekGrid } from '@/components/calendar/WeekGrid';

export interface WeekChooserProps {
  seasonWeeks: SeasonWeek[];
  /** The same map the band reads — see `WeekGrid`. */
  destinations: Map<number, WeekBandDestination>;
  currentWeek: number | null;
  themes?: Record<number, WeekTheme>;
  onSelectWeek: (week: number) => void;
}

/**
 * The week chooser: a 3x3 icon at the right end of the rail, opening a 3x3 grid.
 *
 * The cheapest control on the strip — ~44px square — and a literal miniature of
 * what it opens. It is what makes any week of the season reachable in **two**
 * interactions from anywhere in the list: the rail is sticky, so one tap opens
 * the grid and one picks the week. No trip to the top of a document that can be
 * ~31,000px away, and no reveal of the site header needed.
 *
 * Navigation, never a filter. Choosing a week calls the caller's `onSelectWeek`,
 * which is `page.tsx`'s `goToWeek` — `weekDestinations.get(week)` then
 * `goToDay` — and touches no scope, week, category or search.
 *
 * `memo`'d: this renders unconditionally inside `DayRail`'s row, which
 * re-renders on every rail-relevant state change — including the filter
 * panel opening and closing, which does not touch any prop here. Without
 * this, every one of those commits redoes `weekGridRows`/`weekGridColumns`
 * and rebuilds the icon's cell tree for no visible difference. `DayRail`
 * already passes `seasonWeeks` and `destinations` as the stable references
 * `page.tsx` memoizes them as; the one prop that was NOT stable —
 * `onSelectWeek` — is fixed alongside this, in `DayRail`, so the memo
 * actually has something to compare.
 */
export const WeekChooser = memo(function WeekChooser({
  seasonWeeks, destinations, currentWeek, themes, onSelectWeek,
}: WeekChooserProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  // Whether `WeekGrid`'s theme popover is open. It portals to `document.body`
  // — outside both refs above — so the outside-press handler below has to
  // learn about it some other way. A ref rather than state: the handler only
  // needs the current value at press time, and state here would re-run the
  // effect below on every theme open/close for no benefit.
  const themeOpenRef = useRef(false);
  const handleThemeOpenChange = useCallback((isOpen: boolean) => {
    themeOpenRef.current = isOpen;
  }, []);

  const coords = useFloatingCoords(open, triggerRef, popoverRef, { mode: 'center' });

  const weekNumbers = seasonWeeks.map(w => w.number);
  const rows = weekGridRows(weekNumbers, weekGridColumns(weekNumbers.length));
  const denominator = Math.max(weekNumbers.length - 1, 1);

  function close() {
    setOpen(false);
    // Back to the trigger, always. The list is about to scroll a long way when
    // a week was chosen, and focus left inside a node that is being removed is
    // focus lost to the document body.
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDownOutside(e: Event) {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      // Also defer to an open theme popover, the same way `WeekGrid`'s own
      // Escape handler does (`themePopover.isOpen`) — it portals to
      // `document.body`, outside both refs above, so without this a press on
      // its "View on chq.org" link or its description text would tear the
      // whole chooser down (and the theme popover with it) before the press
      // could ever finish.
      if (themeOpenRef.current) return;
      // Not `close()`: a press outside is not a request to move focus back into
      // the rail, and stealing it from whatever the reader pressed would be
      // worse than leaving it where they put it.
      setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDownOutside);
    document.addEventListener('touchstart', onPointerDownOutside);
    return () => {
      document.removeEventListener('mousedown', onPointerDownOutside);
      document.removeEventListener('touchstart', onPointerDownOutside);
    };
  }, [open]);

  // A season with no weeks can open nothing, so it shows nothing — chrome that
  // costs rail width and means nothing is worse than an absence.
  if (weekNumbers.length === 0) return null;

  const label = weekChooserTriggerLabel(currentWeek, weekNumbers.length);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        data-week-chooser-trigger
        // The icon is decorative in every part, so this explicit name is what a
        // screen reader announces — the same contract `FiltersIcon` has.
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        // Deliberately does NOT defer to an open theme popover, unlike the
        // outside-press handler below and `WeekGrid`'s Escape. Those two
        // defer because they are ambiguous: a press somewhere else on the
        // page, or an Escape while a second popover is up, is far more likely
        // to mean "close the thing I just opened" than "close everything". A
        // click on this trigger is neither — the reader aimed at the
        // chooser's own control, which means the chooser, so it closes and
        // takes the theme popover with it. Stated rather than left implicit:
        // the asymmetry is the kind a later reader would otherwise "fix" into
        // consistency and change the behaviour.
        onClick={() => (open ? close() : setOpen(true))}
        // 44px square, the platform minimum, on a phone-first app's primary
        // navigation surface. `inline-flex` + centring because a `min-h` on a
        // plain inline-block button would leave the icon top-aligned.
        className="shrink-0 inline-flex min-h-11 min-w-11 items-center justify-center px-2 py-1 rounded-md text-gray-600 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-gray-700"
      >
        <WeekChooserIcon rows={rows} currentWeek={currentWeek} denominator={denominator} />
      </button>

      {open && createPortal(
        <div
          ref={popoverRef}
          data-week-chooser-popover
          role="dialog"
          aria-label="Choose a week"
          className="fixed z-50 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-2 shadow-lg"
          style={{
            // Rendered off-screen until measured, exactly as the week theme
            // popover is: `useFloatingCoords` needs the popover's own box
            // to clamp it, so the first paint has to happen somewhere.
            top: coords ? `${coords.top}px` : '-9999px',
            left: coords ? `${coords.left}px` : '0px',
            visibility: coords ? 'visible' : 'hidden',
          }}
        >
          <WeekGrid
            seasonWeeks={seasonWeeks}
            destinations={destinations}
            currentWeek={currentWeek}
            themes={themes}
            onSelectWeek={onSelectWeek}
            onDismiss={close}
            onThemeOpenChange={handleThemeOpenChange}
          />
        </div>,
        document.body,
      )}
    </>
  );
});
