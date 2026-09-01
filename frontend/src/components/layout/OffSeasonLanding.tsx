import { CHQ_ZONE } from '@/lib/utils/chqTime';
import type { LandingState } from '@/lib/utils/landingState';

export interface OffSeasonLandingProps {
  state: LandingState;
  /**
   * Show the given year instead. Nothing but a year change: it used to also
   * open the date scope right up, because `next`'s adaptive window had
   * nothing to adapt to that far ahead, and #274 phase 4 deleted the scopes.
   */
  onPreviewNextSeason: (year: number) => void;
  /**
   * Browse the past season named on the button — the year is always the one
   * on that button's own label, so the label and the outcome cannot come
   * apart. It takes a year because the two landing states offer different
   * ones (#186): `post-season` offers `endedSeasonYear`, which is already the
   * year on screen, while `pre-season` offers an earlier year from the
   * manifest and so needs a year switch as well as the dismissal. Mirrors
   * iOS's `AppModel.browsePastSeason(year:)`, which replaced its own
   * year-blind action for the same reason.
   */
  onBrowseArchiveSeason: (year: number) => void;
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

  // `in-season` is narrowed out above, and both remaining arms carry these
  // two fields, so the union access is `Date | null` / `number | null`.
  const { opening, daysUntil } = state;
  // Whether there is a season still genuinely ahead to count down to.
  // `pre-season.opening` is always a `Date` (rule 2 only returns that kind
  // once `now < start`), so this is unconditionally true there. For
  // `post-season`, `determineLandingState` nulls `opening` both when no
  // later year is announced at all and when the next announced year has
  // already begun (#274 phase 4 task 10) — either way there is nothing left
  // to count down to.
  const seasonIsAhead = opening !== null;
  // The season the countdown names: next year's when this one has ended,
  // this year's when it has not started yet.
  const openingYear =
    state.kind === 'post-season' ? state.nextSeasonYear : chqYearOf(state.opening);
  // Hoisted to a local `const` so the `!== null` guard below narrows it for
  // the click handler too. Narrowing a property access does NOT survive into
  // a closure — TypeScript cannot know `state.nextSeasonYear` is unchanged by
  // the time the handler runs — so the earlier version needed an `as number`
  // cast, and a cast is exactly the thing that would hide the field's type
  // widening later. A `const` cannot be reassigned, so the narrowing holds.
  const nextSeasonYear = state.kind === 'post-season' ? state.nextSeasonYear : null;
  // The past season this landing can offer, or `null` to hide the button —
  // the web half of iOS's `LandingState.archiveYear` projection (#186).
  // `post-season` offers the year that just ended, which is the one already
  // selected; `pre-season` offers whatever earlier year `determineLandingState`
  // found in the manifest, which is a DIFFERENT year from the one on screen.
  // Hoisted to a `const` for the same reason as `nextSeasonYear` above: a
  // property narrowing would not survive into the click handler's closure.
  const archiveYear = state.kind === 'post-season' ? state.endedSeasonYear : state.archiveYear;
  // `state.kind === 'pre-season'` narrows the ternary's other branch to
  // `post-season`, so `state.endedSeasonYear` is valid there without a cast.
  const heading =
    state.kind === 'pre-season'
      ? 'Almost showtime'
      : seasonIsAhead
        ? 'See you next season'
        : `The ${state.endedSeasonYear} season has ended`;

  // The two ways forward, each built here rather than gated inline in the
  // JSX, so that each has exactly ONE guard. Gating a button inside a wrapper
  // that is itself gated on the same condition makes both lines redundant and
  // neither falsifiable: injected against the earlier inline version,
  // deleting the archive button's own `archiveYear !== null` check changed
  // nothing observable, because the wrapper had already declined to render.
  // With the wrapper derived from these two values instead, deleting either
  // guard renders a button with a blank year, which the tests catch.
  const previewButton =
    nextSeasonYear === null ? null : (
      <button
        type="button"
        onClick={() => onPreviewNextSeason(nextSeasonYear)}
        className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
      >
        {seasonIsAhead
          ? `Preview the ${nextSeasonYear} season`
          : `Go to the ${nextSeasonYear} season`}
      </button>
    );
  const archiveButton =
    archiveYear === null ? null : (
      <button
        type="button"
        onClick={() => onBrowseArchiveSeason(archiveYear)}
        className="px-4 py-2 rounded-md border border-gray-300 dark:border-gray-500 text-gray-700 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
      >
        Browse the {archiveYear} season
      </button>
    );

  return (
    <div data-testid="off-season-landing" className="text-center py-12 px-4">
      <div className="text-6xl mb-4" aria-hidden="true">🎭</div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-6">
        {heading}
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

      {/*
        The row renders only when it has a button to hold — an empty one would
        still contribute its own `mb-6`. Each button is gated on its own year
        rather than on the landing's kind: the block used to be gated on
        `state.kind === 'post-season'` wholesale, which is how a pre-season
        reader got a countdown and no way anywhere — the web half of the dead
        end #186 describes. `pre-season` now offers the archive button
        whenever the manifest has an earlier year; the preview button stays
        post-season-only because `nextSeasonYear` is `null` in every other
        state by construction.
      */}
      {(previewButton !== null || archiveButton !== null) && (
        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-6">
          {previewButton}
          {archiveButton}
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
