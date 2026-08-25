import { useEffect, useRef, useState } from 'react';
import type { SeasonWeek } from '@/lib/types';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';
import { type WeekBandDestination, weekBandUnreachableLabel } from '@/lib/utils/weekBands';
import { UNREACHABLE_FILL_OPACITY, rampBackground } from '@/lib/utils/railBandPalette';
import { moveGridFocus, weekGridColumns, weekGridRows } from '@/lib/utils/weekChooser';
import { useWeekThemePopover } from '@/hooks/useWeekThemePopover';
import { buildWeekTitle } from '@/components/filters/WeekThemePopover';

export interface WeekGridProps {
  seasonWeeks: SeasonWeek[];
  /**
   * The SAME map the week band reads, passed down from `page.tsx`. A week
   * absent from it is dimmed and inert here exactly as it is on the band —
   * one source of truth, so the two surfaces cannot disagree about which weeks
   * the current filters can reach.
   */
  destinations: Map<number, WeekBandDestination>;
  /** From `anchorWeekNumber`; null off-season or on a pre/post-season day. */
  currentWeek: number | null;
  themes?: Record<number, WeekTheme>;
  onSelectWeek: (week: number) => void;
  /** Escape, or a week having been chosen. The caller closes and refocuses. */
  onDismiss: () => void;
}

/**
 * The chooser's contents: every week of the season as a 44px cell.
 *
 * Repurposed from `WeekSelector`'s job, not from its markup — a cell here means
 * "reachable / not", never "selected / not", and grey means "no matching
 * events", never "in the past". `isWeekInPast` is deliberately not consulted:
 * this is a navigation surface, and a past week that still holds events is
 * perfectly navigable.
 *
 * Every cell carries a border regardless of its tone. The ramp's first step is
 * ~1.03:1 against this surface in dark mode, so a cell drawn in tone alone would
 * have no visible edge — the same reason the chooser's icon rings its lit cell.
 */
export function WeekGrid({
  seasonWeeks, destinations, currentWeek, themes, onSelectWeek, onDismiss,
}: WeekGridProps) {
  const weekNumbers = seasonWeeks.map(w => w.number);
  const columns = weekGridColumns(weekNumbers.length);
  const rows = weekGridRows(weekNumbers, columns);
  // `getChautauquaSeasonWeeks` always returns nine, so a one-week season is
  // unreachable — but the ramp divides by this, and dividing by zero would be a
  // silent NaN in a colour rather than a visible mistake.
  const denominator = Math.max(weekNumbers.length - 1, 1);

  const cellRefs = useRef<Map<number, HTMLButtonElement | null>>(new Map());
  // Where the reader is, or the first cell — never nothing, or the grid opens
  // with no keyboard entry point at all.
  const initialIndex = currentWeek === null ? 0 : Math.max(0, weekNumbers.indexOf(currentWeek));
  const [focusIndex, setFocusIndex] = useState(initialIndex);

  const activate = (week: number) => {
    if (!destinations.has(week)) return;
    onSelectWeek(week);
    onDismiss();
  };

  const themePopover = useWeekThemePopover({ themes, onActivate: activate });

  // Focus enters the grid on open, on the week the reader is already in. Doing
  // it here rather than in the caller keeps "which cell is the entry point" in
  // one place — the same value the roving `tabIndex` uses.
  useEffect(() => {
    cellRefs.current.get(weekNumbers[initialIndex])?.focus();
    // Mount only: a later `currentWeek` change must not steal focus back.
    // NOTE for humans, not a real eslint-disable: this repo has no
    // eslint-plugin-react-hooks, so a literal `eslint-disable-next-line
    // react-hooks/exhaustive-deps` comment here is a hard ESLint 9 error
    // ("Definition for rule ... was not found"), not a silenced warning.
    // The dependency array is intentionally empty — see the comment above.
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // Defer to an open theme popover: it listens on `document` and stops
      // propagation, but Preact attaches THIS handler to the element, so it
      // runs first and would dismiss the whole chooser out from under a reader
      // who only meant to close the theme.
      if (themePopover.isOpen) return;
      e.preventDefault();
      onDismiss();
      return;
    }
    const next = moveGridFocus(focusIndex, e.key, weekNumbers.length, columns);
    if (next === null) return;
    e.preventDefault();
    setFocusIndex(next);
    cellRefs.current.get(weekNumbers[next])?.focus();
  };

  if (weekNumbers.length === 0) return null;

  return (
    <div
      data-week-grid
      role="group"
      aria-label="Weeks"
      onKeyDown={onKeyDown}
      className="flex flex-col gap-1"
    >
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} data-week-row className="flex gap-1">
          {row.map(number => {
            const week = seasonWeeks.find(w => w.number === number)!;
            const destination = destinations.get(number);
            const reachable = !!destination;
            const isCurrent = number === currentWeek;
            const index = weekNumbers.indexOf(number);
            const theme = themes?.[number];
            return (
              <button
                key={number}
                type="button"
                data-week-cell={number}
                // The destination day, in the DOM, so a browser check can
                // confirm where a cell actually goes without re-deriving
                // `weekBandDestinations`' rule itself.
                data-week-cell-target={destination?.dayKey}
                aria-label={destination?.label ?? weekBandUnreachableLabel(number)}
                aria-current={isCurrent ? 'true' : undefined}
                // `aria-disabled`, not `disabled`, so the cell stays focusable
                // and the walk above cannot stall on it — the same call the day
                // chips make.
                aria-disabled={reachable ? undefined : true}
                tabIndex={index === focusIndex ? 0 : -1}
                title={buildWeekTitle(week, theme)}
                ref={el => {
                  cellRefs.current.set(number, el);
                  themePopover.registerAnchor(number, el);
                }}
                onClick={() => activate(number)}
                {...themePopover.handlers(number)}
                className={`relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 ${
                  reachable ? '' : 'cursor-default'
                }`}
              >
                <span
                  data-week-cell-fill
                  aria-hidden="true"
                  className={`absolute inset-0 rounded-md ${isCurrent ? 'bg-blue-600' : ''}`}
                  style={isCurrent
                    ? { opacity: reachable ? 1 : UNREACHABLE_FILL_OPACITY }
                    : {
                      // A named token first, so a browser that drops the
                      // `color-mix` declaration still paints a cell rather than
                      // nothing — the same two-line pattern `WeekBandCell` uses.
                      backgroundColor: 'var(--rail-band-start)',
                      background: rampBackground((number - 1) / denominator),
                      opacity: reachable ? 1 : UNREACHABLE_FILL_OPACITY,
                    }}
                />
                {/*
                  The numeral never fades. The ramp sits between this surface and
                  the text colour in both themes, so a faded FILL composites
                  toward the background and can only raise the numeral's
                  contrast; fading the numeral instead is what took an empty iOS
                  chip's text to a sampled ~3.7:1.
                */}
                <span
                  data-week-cell-number
                  aria-hidden="true"
                  className="relative text-sm font-semibold"
                  style={{ color: isCurrent ? '#ffffff' : 'var(--foreground)' }}
                >
                  {number}
                </span>
              </button>
            );
          })}
        </div>
      ))}
      {themePopover.portal}
    </div>
  );
}
