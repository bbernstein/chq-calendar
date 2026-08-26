import { dayKeyOf, type DayKey } from '@/lib/utils/dayWindow';

export interface LandingDayInput {
  now: Date;
  isCurrentYear: boolean;
  /** Ascending day keys that have at least one matching event. */
  eventDays: DayKey[];
  /** The selected year's season start, as a day key. */
  seasonStartDay: DayKey;
}

/**
 * The day the reader is put in front of on load.
 *
 * With the date scope gone this has to be stated: it used to fall out of
 * `dateFilter: 'next'` starting the list at today. Day keys are `YYYY-MM-DD`
 * in Institution time, so a lexical comparison is a calendar comparison.
 *
 * **A last-viewed day is deliberately never restored**, even inside the 30-day
 * `USER_STATE_EXPIRY_MS` window, and neither is scroll position — the same
 * reasoning `useFilterState` recorded for the session-only window days, and
 * what iOS does with `selectedDayKey`. A date pinned days ago and silently
 * restored on launch would be worse than no restore.
 */
export function landingDayKey({ now, isCurrentYear, eventDays, seasonStartDay }: LandingDayInput): DayKey | null {
  if (eventDays.length === 0) return null;
  const from = isCurrentYear ? dayKeyOf(now) : seasonStartDay;
  // The last day rather than null when everything is behind us: a
  // post-season visitor to the current year with filters applied (no
  // filters gets them the landing instead) should see the end of the season
  // they just had, not the January of a year that is over.
  return eventDays.find(d => d >= from) ?? eventDays[eventDays.length - 1];
}
