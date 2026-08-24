import { CHQ_ZONE } from '@/lib/utils/chqTime';
import type { LandingState } from '@/lib/utils/landingState';

export interface OffSeasonLandingProps {
  state: LandingState;
  /** Show the given year instead, with the date scope opened right up. */
  onPreviewNextSeason: (year: number) => void;
  /** Show the whole of the year already selected. Takes no year on purpose. */
  onBrowseArchiveSeason: () => void;
}

/**
 * What the main panel shows when the default filter is empty because the
 * season itself is over or has not started — rather than the generic
 * `EmptyState`, whose "try adjusting your filters" is false advice when the
 * reader has not set any.
 *
 * Mirrors iOS's `OffSeasonLandingView`. Presentational: it owns no state and
 * reads no clock, so `page.tsx` decides what the buttons do and the tests can
 * mount it directly.
 *
 * Returns `null` for `in-season`, which `page.tsx` already gates out. A future
 * caller that forgets the gate then renders nothing, rather than crashing the
 * whole calendar.
 */
export function OffSeasonLanding({
  state,
  onPreviewNextSeason,
  onBrowseArchiveSeason,
}: OffSeasonLandingProps) {
  if (state.kind === 'in-season') return null;

  const isPostSeason = state.kind === 'post-season';
  // `in-season` is narrowed out above, and both remaining arms carry these
  // two fields, so the union access is `Date | null` / `number | null`.
  const { opening, daysUntil } = state;
  // The season the countdown names: next year's when this one has ended,
  // this year's when it has not started yet.
  const openingYear =
    state.kind === 'post-season' ? state.nextSeasonYear : chqYearOf(state.opening);

  return (
    <div data-testid="off-season-landing" className="text-center py-12 px-4">
      <div className="text-6xl mb-4" aria-hidden="true">🎭</div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-6">
        {isPostSeason ? 'See you next season' : 'Almost showtime'}
      </h3>

      {opening !== null && daysUntil !== null && openingYear !== null && (
        <div className="max-w-sm mx-auto mb-6 rounded-lg bg-gray-50 dark:bg-gray-700/50 p-4">
          {/*
            `data-testid`, because this line interpolates twice and so renders
            as three text nodes. `getByText(/The 2027 season begins June 26/)`
            matches against a single node and would never find it — a test
            that fails on correct code teaches people to weaken the assertion.
          */}
          <p data-testid="off-season-countdown" className="font-medium text-gray-900 dark:text-white">
            The {openingYear} season begins {monthDay(opening)}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
            {daysUntil === 1 ? '1 day away' : `${daysUntil} days away`}
          </p>
        </div>
      )}

      {state.kind === 'post-season' && (
        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-6">
          {state.nextSeasonYear !== null && (
            <button
              type="button"
              onClick={() => onPreviewNextSeason(state.nextSeasonYear as number)}
              className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
            >
              Preview the {state.nextSeasonYear} season
            </button>
          )}
          <button
            type="button"
            onClick={onBrowseArchiveSeason}
            className="px-4 py-2 rounded-md border border-gray-300 dark:border-gray-500 text-gray-700 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
          >
            Browse the {state.endedSeasonYear} season
          </button>
        </div>
      )}

      <p className="text-sm text-gray-500 dark:text-gray-400">
        Starred events and filters still work in past seasons.
      </p>
    </div>
  );
}

/**
 * `"June 27"`. Deliberately not the app's day-title format, which also names
 * the weekday — the line below already states the day count, so a weekday
 * would be redundant. Matches iOS's `monthDayFormatter`.
 */
const monthDayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CHQ_ZONE,
  month: 'long',
  day: 'numeric',
});

function monthDay(d: Date): string {
  return monthDayFormatter.format(d);
}

const yearFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CHQ_ZONE,
  year: 'numeric',
});

/** The calendar year an instant falls in, read at Chautauqua. */
function chqYearOf(d: Date): number {
  return Number(yearFormatter.format(d));
}
