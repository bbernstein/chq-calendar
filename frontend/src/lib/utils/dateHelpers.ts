import type { Event, SeasonWeek } from '@/lib/types';
import { chqDateAt, chqParts, parseEventDate } from '@/lib/utils/chqTime';

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
  // June always contains four Sundays, so this cannot be null — but a
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
  timeZone: 'America/New_York', month: 'short', day: 'numeric',
});

/** `"Jun 27"` at Chautauqua — the week label's edges. */
function formatWeekEdge(d: Date): string {
  return weekEdgeFormatter.format(d);
}

export function isInChautauquaWeek(dateString: string, weekNumber: number, seasonWeeks: SeasonWeek[]): boolean {
  const eventDate = parseEventDate(dateString);
  const week = seasonWeeks[weekNumber - 1];
  return eventDate >= week.start && eventDate < week.end;
}

export function isWeekInPast(weekNumber: number, seasonWeeks: SeasonWeek[]): boolean {
  const week = seasonWeeks[weekNumber - 1];
  const now = new Date();
  return week.end <= now;
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

export function getCurrentWeekNumber(seasonWeeks: SeasonWeek[]): number | null {
  const now = new Date();
  for (let i = 0; i < seasonWeeks.length; i++) {
    const week = seasonWeeks[i];
    if (now >= week.start && now <= week.end) {
      return week.number;
    }
  }
  return null;
}

/**
 * Finds the end-of-day boundary needed to include at least `minEvents` events
 * starting from `startDate`. Returns an exclusive bound — the Institution
 * midnight immediately after the last included day — matching the half-open
 * `start <= x < end` convention used throughout.
 * Expands day-by-day until enough events are accumulated.
 */
export function getAdaptiveEndDate(events: Event[], startDate: Date, minEvents: number): Date {
  const futureEvents = events
    .filter(e => parseEventDate(e.startDate) >= startDate)
    .sort((a, b) => parseEventDate(a.startDate).getTime() - parseEventDate(b.startDate).getTime());

  if (futureEvents.length === 0) {
    const p = chqParts(startDate);
    return chqDateAt(p.year, p.month, p.day + 91, 0, 0, 0, 0);
  }

  let accumulated = 0;
  let lastCompleteDayEnd: Date | null = null;
  let currentDayDate: Date | null = null;

  for (const event of futureEvents) {
    const eventDate = parseEventDate(event.startDate);
    const p = chqParts(eventDate);
    const eventDay = chqDateAt(p.year, p.month, p.day, 0, 0, 0, 0);

    if (!currentDayDate || eventDay.getTime() !== currentDayDate.getTime()) {
      if (currentDayDate) {
        // Exclusive end-of-day: the next Institution midnight, so a 23- or
        // 25-hour DST day needs no special case.
        const c = chqParts(currentDayDate);
        lastCompleteDayEnd = chqDateAt(c.year, c.month, c.day + 1, 0, 0, 0, 0);
        if (accumulated >= minEvents) {
          return lastCompleteDayEnd;
        }
      }
      currentDayDate = eventDay;
    }
    accumulated++;
  }

  const last = chqParts(currentDayDate!);
  return chqDateAt(last.year, last.month, last.day + 1, 0, 0, 0, 0);
}
