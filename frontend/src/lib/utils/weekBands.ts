import type { SeasonWeek } from '@/lib/types';
import { type DayKey, dayKeyOf } from '@/lib/utils/dayWindow';

/**
 * One week's extent expressed in day keys — the opening Saturday through the
 * closing Saturday, both inclusive.
 *
 * This is the day-granular model, not the noon-granular one. A Chautauqua
 * week turns over at Saturday *noon*, but splitting a 44px chip at its centre
 * is a distinction no reader can use at swipe speed, so a boundary Saturday
 * belongs to both of its weeks — the same rule
 * `weekNumbersForCalendarDate` gives the day header's `Wk 5/6` badge and the
 * week filter (#257).
 *
 * Day keys are `"yyyy-mm-dd"`, so string order is chronological order and
 * membership is a plain pair of comparisons. That is the whole reason this
 * type exists: `weekNumbersForCalendarDate` costs ~7 `Intl.formatToParts`
 * round-trips per call and the rail asks about ~70 days on every filter
 * change. Nine `dayKeyOf` calls, then string compares.
 * `weekBands.test.ts` walks the whole navigable range asserting the two
 * agree, so this stays a faster spelling of one model rather than a second
 * model that happens to match.
 */
export interface WeekDayKeySpan {
  number: number;
  opening: DayKey;
  closing: DayKey;
}

export function weekDayKeySpans(seasonWeeks: SeasonWeek[]): WeekDayKeySpan[] {
  return seasonWeeks.map(w => ({
    number: w.number,
    opening: dayKeyOf(w.start),
    closing: dayKeyOf(w.end),
  }));
}

/** One day's slice of the week band above the day rail. */
export interface WeekBandSegment {
  dayKey: DayKey;
  /** Ascending. Two entries = a boundary Saturday. Empty = outside the season. */
  weekNumbers: number[];
  /** `(n - 1) / (weeks - 1)` per entry, same order. Drives the lightness ramp. */
  rampSteps: number[];
  /**
   * The week a tap here navigates to, or `null` when a tap would be ambiguous
   * or meaningless.
   *
   * `null` for a *shared* Saturday: it opens one week and closes another, so
   * a tap on it cannot mean one week. Each week's six non-shared days carry
   * its navigation instead — plus week 1's opening Saturday and the final
   * week's closing Saturday, which have no neighbour to share with. Also
   * `null` outside the season.
   */
  navigationTarget: number | null;
  /** The week whose `WEEK n` label this segment draws. At most one per week. */
  labelledWeek: number | null;
}

/**
 * Segments for `keys`, in the order given.
 *
 * `keys` is the rail's own span (`navigableBounds`), a superset of the season
 * that can start or end mid-week. Label placement therefore follows the
 * *visible* run of each week rather than a fixed offset from a week start
 * that may be off screen.
 *
 * Pure and fully unit-testable: *which* spans the band covers is decided
 * here; where they land in pixels is `WeekBandCell`'s problem. That split is
 * deliberate — the pixel half is the part only a browser can check.
 */
export function weekBandSegments(keys: DayKey[], seasonWeeks: SeasonWeek[]): WeekBandSegment[] {
  // Built once and reused for every day, rather than per lookup: the iOS
  // version needed exactly this fix after a ~70-chip rail cost ~70 season
  // rebuilds per scroll tick (#256).
  const spans = weekDayKeySpans(seasonWeeks);
  // `getChautauquaSeasonWeeks` always returns nine, so an empty season is
  // unreachable — but the ramp divides by this, and a one-week season would
  // divide by zero rather than merely look wrong.
  const denominator = Math.max(seasonWeeks.length - 1, 1);

  const membership = keys.map(key =>
    spans.filter(s => s.opening <= key && key <= s.closing).map(s => s.number));

  // A week's label goes on the middle of its visible *non-shared* days, so it
  // never lands on a boundary Saturday — where it would have to pick one of
  // two weeks and would sit on the split fill.
  const soloIndicesByWeek = new Map<number, number[]>();
  membership.forEach((numbers, index) => {
    if (numbers.length !== 1) return;
    const existing = soloIndicesByWeek.get(numbers[0]);
    if (existing) existing.push(index);
    else soloIndicesByWeek.set(numbers[0], [index]);
  });
  const labelIndexByWeek = new Map<number, number>();
  for (const [week, indices] of soloIndicesByWeek) {
    labelIndexByWeek.set(week, indices[Math.floor(indices.length / 2)]);
  }

  return keys.map((key, index) => {
    const numbers = membership[index];
    // Unambiguous only when this day belongs to exactly one week.
    const target = numbers.length === 1 ? numbers[0] : null;
    const labelled =
      numbers.length === 1 && labelIndexByWeek.get(numbers[0]) === index ? numbers[0] : null;
    return {
      dayKey: key,
      weekNumbers: numbers,
      rampSteps: numbers.map(n => (n - 1) / denominator),
      navigationTarget: target,
      labelledWeek: labelled,
    };
  });
}
