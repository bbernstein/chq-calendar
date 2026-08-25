import type { WeekBandDestination, WeekBandSegment } from '@/lib/utils/weekBands';
import { weekBandUnreachableLabel } from '@/lib/utils/weekBands';
import { UNREACHABLE_FILL_OPACITY, rampBackground } from '@/lib/utils/railBandPalette';
import {
  RAIL_BAND_BLEED_PX, RAIL_BAND_RADIUS_PX, RAIL_WEEK_SEAM_PX,
} from '@/lib/utils/railMetrics';

export interface WeekBandCellProps {
  /**
   * This day's segment, or `null` for a day the band says nothing about — out
   * of season, or an index the caller could not confirm belongs to this chip.
   */
  segment: WeekBandSegment | null;
  /**
   * Which weeks can be reached under the current non-date filters.
   *
   * An **empty** map means "no reachability information yet", not "nothing is
   * reachable": nothing is dimmed, so the first paint cannot flash a fully
   * faded band.
   */
  destinations: Map<number, WeekBandDestination>;
  /** Whether this day's fill continues into the gutter on that side. */
  bridgesLeading: boolean;
  bridgesTrailing: boolean;
  /** Whether this cell's button is the band row's single tab stop. */
  isTabStop: boolean;
  onSelectWeek: (week: number) => void;
}

/**
 * One day's slice of the week band above the chips.
 *
 * The cell's own box is exactly one chip wide, and stays that way: only the
 * painted fill and the `WEEK n` label are allowed outside it, both by absolute
 * positioning that cannot change the size of the box it is drawn in. A label
 * that widened its column would pull the band out of line with the chips it
 * labels, and with it the chip below.
 */
export function WeekBandCell({
  segment, destinations, bridgesLeading, bridgesTrailing, isTabStop, onSelectWeek,
}: WeekBandCellProps) {
  const numbers = segment?.weekNumbers ?? [];
  // A day cannot be in three Chautauqua weeks. Drawing the first two rather
  // than crashing a rail over a colour is the same call iOS's `runSteps` makes.
  const steps = (segment?.rampSteps ?? []).slice(0, 2);

  // A bleed is only ever applied to a cell that actually has a run to draw: a
  // null segment paints nothing, so it must not paint nothing *wider*.
  const leadingBleed = segment && bridgesLeading ? RAIL_BAND_BLEED_PX : 0;
  const trailingBleed = segment && bridgesTrailing ? RAIL_BAND_BLEED_PX : 0;

  // Reachability is per WEEK, not per segment, precisely so a shared
  // Saturday's two halves can disagree.
  const isReachable = (week: number | undefined) =>
    destinations.size === 0 || week === undefined || destinations.has(week);

  const target = segment?.navigationTarget ?? null;
  const navigable = target !== null && destinations.has(target);
  const labelled = segment?.labelledWeek ?? null;
  const navigate = () => { if (navigable && target !== null) onSelectWeek(target); };

  const bar = (index: number, roundsLeading: boolean, roundsTrailing: boolean) => (
    <span
      key={index}
      data-band-bar
      className="block flex-1"
      style={{
        // A named token first, so a browser that drops the `color-mix`
        // declaration still paints a band rather than nothing.
        backgroundColor: 'var(--rail-band-start)',
        background: rampBackground(steps[index]),
        opacity: isReachable(numbers[index]) ? 1 : UNREACHABLE_FILL_OPACITY,
        borderTopLeftRadius: roundsLeading ? RAIL_BAND_RADIUS_PX : 0,
        borderBottomLeftRadius: roundsLeading ? RAIL_BAND_RADIUS_PX : 0,
        borderTopRightRadius: roundsTrailing ? RAIL_BAND_RADIUS_PX : 0,
        borderBottomRightRadius: roundsTrailing ? RAIL_BAND_RADIUS_PX : 0,
      }}
    />
  );

  // The attribute is emitted for EVERY day, carrying the key when the band
  // has something to say about it and empty when it does not. Dropping it
  // on an out-of-season day would break the invariant the browser check
  // rests on — one band cell per column — and `navigableBounds` widens past
  // the season whenever a pre- or post-season event exists, so that is a day
  // the rail really renders.
  return (
    <div data-band-cell={segment?.dayKey ?? ''} className="relative h-[var(--rail-band-h)] shrink-0">
      {steps.length > 0 && (
        <span
          data-band-run
          aria-hidden="true"
          className="absolute inset-y-0 flex"
          style={{
            left: `${-leadingBleed}px`,
            right: `${-trailingBleed}px`,
            gap: `${RAIL_WEEK_SEAM_PX}px`,
          }}
        >
          {/*
            Rounded only where the run actually ends — at a seam, or at the
            edge of the season. A rounded end inside a run would be a false
            boundary; a square end at a real one would blunt the only signal
            this design has left. Both inner ends of a split are rounded: they
            are the ends of two different weeks' runs, not the middle of one.
          */}
          {steps.length === 1
            ? bar(0, !bridgesLeading, !bridgesTrailing)
            : [bar(0, !bridgesLeading, true), bar(1, true, !bridgesTrailing)]}
        </span>
      )}

      {labelled !== null ? (
        <button
          type="button"
          data-week-band-button={labelled}
          // Named by destination, never by direction — and an unreachable week
          // is stated as a fact rather than offered.
          aria-label={destinations.get(labelled)?.label ?? weekBandUnreachableLabel(labelled)}
          aria-disabled={navigable ? undefined : true}
          // One tab stop for the whole band, like the chip row below it. The
          // rail's own key handler walks between the week buttons.
          tabIndex={isTabStop ? 0 : -1}
          onClick={navigate}
          className="absolute inset-0 block"
        >
          {/*
            Absolutely positioned and centred, so a label wider than one chip
            overhangs its neighbours (clipped only by the scroller) instead of
            widening this column. `pointer-events-none` so the overhang cannot
            steal a tap from the week beside it.
          */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] font-semibold uppercase leading-none tracking-wide"
            style={{ color: 'var(--foreground)' }}
          >
            {`Week ${labelled}`}
          </span>
        </button>
      ) : (
        /*
          A div, not a button, and carrying no accessible name. This layer is a
          tap target, not content: exposing all ~64 segments would put
          sixty-odd mostly-unlabelled stops in front of a reader swiping the
          rail, and an unlabelled element is itself what an audit flags. It
          holds nothing focusable, which is what keeps axe's
          `aria-hidden-focus` clean.
        */
        <div
          data-band-hit
          aria-hidden="true"
          onClick={navigate}
          className={`absolute inset-0 ${navigable ? 'cursor-pointer' : ''}`}
        />
      )}
    </div>
  );
}
