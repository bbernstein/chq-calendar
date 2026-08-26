import type { SeasonWeek } from '@/lib/types';
import { CHQ_ZONE, chqDateAt, chqParts } from '@/lib/utils/chqTime';

export function getChautauquaSeasonWeeks(year: number): SeasonWeek[] {
  // The 4th Sunday of June, found by walking Institution calendar days.
  // Anchored at noon throughout: a DST transition never falls at midday, so
  // the walk cannot be knocked onto a neighbouring day.
  let sundayCount = 0;
  let fourthSundayDay: number | null = null;
  for (let day = 1; day <= 30; day++) {
    if (chqParts(chqDateAt(year, 6, day, 12)).weekday === 0) {
      sundayCount++;
      if (sundayCount === 4) { fourthSundayDay = day; break; }
    }
  }
  // The loop above always breaks once the 4th Sunday is found, and June is
  // long enough to contain at least four — so this cannot be null. But a
  // silent NaN downstream would be far worse than an explicit throw.
  if (fourthSundayDay === null) {
    throw new Error(`no 4th Sunday of June ${year}`);
  }

  const weeks: SeasonWeek[] = [];
  for (let i = 0; i < 9; i++) {
    // Week 1 starts at noon on the Saturday before, i.e. the day before the
    // 4th Sunday. `chqDateAt` normalises out-of-range days, so subtracting
    // one and adding 7i needs no month arithmetic here.
    const startDayOfJune = fourthSundayDay - 1 + i * 7;
    const start = chqDateAt(year, 6, startDayOfJune, 12);
    const end = chqDateAt(year, 6, startDayOfJune + 7, 12);
    weeks.push({
      number: i + 1,
      start,
      end,
      label: `Week ${i + 1} (${formatWeekEdge(start)} 12pm - ${formatWeekEdge(end)} 12pm)`,
    });
  }
  return weeks;
}

const weekEdgeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CHQ_ZONE, month: 'short', day: 'numeric',
});

/** `"Jun 27"` at Chautauqua — the week label's edges. */
function formatWeekEdge(d: Date): string {
  return weekEdgeFormatter.format(d);
}

/**
 * The season week numbers that span any portion of the Institution calendar
 * date `date` falls on — 1 or 2 entries, empty off-season.
 *
 * Day-granular on purpose. `seasonWeeks` are bounded noon-to-noon (the gate
 * program's turnover), so a Saturday on an in-season boundary intersects both
 * the outgoing and the incoming week and returns two numbers (e.g. `[1, 2]`).
 * This is the single model of "which week is this day in" for both the day
 * header's `Wk 5/6` badge and the week filter (#257): filtering to week 5
 * hands back the whole boundary Saturday, not the half of it before noon.
 *
 * Weeks therefore overlap by one calendar day and are not a partition. For
 * "which week is it right now" — a question that needs one answer — use
 * `getCurrentWeekNumber`, which stays noon-based.
 */
export function weekNumbersForCalendarDate(date: Date, seasonWeeks: SeasonWeek[]): number[] {
  const { year, month, day } = chqParts(date);
  const dayStart = chqDateAt(year, month, day, 0, 0, 0, 0);
  // Half-open against the next Institution midnight, so a DST day of 23 or
  // 25 hours needs no special case.
  const dayEnd = chqDateAt(year, month, day + 1, 0, 0, 0, 0);
  const numbers: number[] = [];
  for (const w of seasonWeeks) {
    if (w.start < dayEnd && w.end > dayStart) {
      numbers.push(w.number);
    }
  }
  return numbers;
}

export function getWeekNumberForDate(date: Date, seasonWeeks: SeasonWeek[]): number | null {
  for (let i = 0; i < seasonWeeks.length; i++) {
    const week = seasonWeeks[i];
    if (date >= week.start && date < week.end) {
      return week.number;
    }
  }
  return null;
}
