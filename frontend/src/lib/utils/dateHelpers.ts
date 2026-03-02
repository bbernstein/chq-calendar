import type { SeasonWeek } from '@/lib/types';

export function getChautauquaSeasonWeeks(year: number): SeasonWeek[] {
  // Start from June 1st and find the 4th Sunday
  const june1 = new Date(year, 5, 1); // June 1st
  const current = new Date(june1);
  let sundayCount = 0;
  let fourthSunday = null;

  // Find the 4th Sunday of June
  while (current.getMonth() === 5) { // Still in June
    if (current.getDay() === 0) { // Sunday
      sundayCount++;
      if (sundayCount === 4) {
        fourthSunday = new Date(current);
        break;
      }
    }
    current.setDate(current.getDate() + 1);
  }

  if (!fourthSunday) {
    // Fallback: if somehow we can't find 4th Sunday, use a reasonable date for the year
    const fallbackDate = year === 2025 ? 22 : year === 2026 ? 28 : 27; // Approximate 4th Sunday
    fourthSunday = new Date(year, 5, fallbackDate);
  }

  // Find the Saturday before the 4th Sunday, and set it to noon
  // This will be the start of Week 1 at Saturday noon
  const firstWeekStart = new Date(fourthSunday);
  firstWeekStart.setDate(fourthSunday.getDate() - 1); // Go back to Saturday
  firstWeekStart.setHours(12, 0, 0, 0); // Set to noon

  const weeks: SeasonWeek[] = [];
  for (let i = 0; i < 9; i++) {
    const weekStart = new Date(firstWeekStart);
    weekStart.setDate(firstWeekStart.getDate() + (i * 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7); // Next Saturday at noon

    weeks.push({
      number: i + 1,
      start: weekStart,
      end: weekEnd,
      label: `Week ${i + 1} (${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} 12pm - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} 12pm)`
    });
  }

  return weeks;
}

export function isToday(dateString: string): boolean {
  const today = new Date();
  const eventDate = new Date(dateString);
  return eventDate.toDateString() === today.toDateString();
}

export function isNext(dateString: string): boolean {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const eventDate = new Date(dateString);

  // Calculate 6 days in future
  const nextWeek = new Date(now);
  nextWeek.setDate(now.getDate() + 6);
  nextWeek.setHours(23, 59, 59, 999);

  // Show events from one hour ago through 6 days in the future
  return eventDate >= oneHourAgo && eventDate <= nextWeek;
}

export function isThisWeek(dateString: string, seasonWeeks: SeasonWeek[], currentWeekNumber: number | null): boolean {
  const eventDate = new Date(dateString);

  if (currentWeekNumber === null) {
    return false; // Not in season
  }

  const currentWeek = seasonWeeks[currentWeekNumber - 1];
  return eventDate >= currentWeek.start && eventDate < currentWeek.end;
}

export function isInChautauquaWeek(dateString: string, weekNumber: number, seasonWeeks: SeasonWeek[]): boolean {
  const eventDate = new Date(dateString);
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
