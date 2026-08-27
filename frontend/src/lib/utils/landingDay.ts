import { dayKeyOf, type DayKey } from '@/lib/utils/dayWindow';

export interface LandingDayInput {
  now: Date;
  isCurrentYear: boolean;
  /** Ascending day keys that have at least one matching event. */
  eventDays: DayKey[];
  /** The selected year's season start, as a day key. */
  seasonStartDay: DayKey;
  /**
   * The year on screen.
   *
   * Passed rather than inferred from `seasonStartDay`'s prefix. The two agree
   * today — `getChautauquaSeasonWeeks(y)` builds every week from June of `y` —
   * but inferring made the *calendar* year the filter, and a feed is allowed
   * to carry days outside it: `navigableBounds` is documented as "the season,
   * widened to contain any event outside it", and `groupEventsByDay` clamps to
   * no year at all. A 2027-01-02 event published under 2026 would be mounted
   * in the list and drawn on the rail while being invisible here. One
   * parameter removes the divergence instead of documenting it.
   */
  selectedYear: number;
}

/**
 * The day the reader is put in front of on load.
 *
 * With the date scope gone this has to be stated: it used to fall out of
 * `dateFilter: 'next'` starting the list at today. Day keys are `YYYY-MM-DD`
 * in Institution time, so a lexical comparison is a calendar comparison.
 *
 * ## A day key carries its own year, and that is load-bearing
 *
 * Every year switch has exactly one commit in which `seasonStartDay` and
 * `isCurrentYear` already describe the NEW year while `eventDays` still holds
 * the OLD one's: `page.tsx` derives the first two synchronously from
 * `selectedYear`, but `useEventData` clears `events` in an effect keyed on the
 * year, so the clear lands a commit later. In that commit 2026's 89 day
 * sections are still mounted, so a target chosen from them is one
 * `useInitialLanding` can and does scroll to — latching its once-per-year ref
 * on a guess made from the wrong year's data, and refusing the real season
 * start when it arrives two commits later. Measured: switching 2026 → 2025
 * left the reader on `2025-03-13` at `scrollY 0`, never at `2025-06-21`.
 *
 * So days that are not the selected year's are not candidates. Returning
 * `null` is free: `useInitialLanding` returns early on a null target WITHOUT
 * latching, and its effect re-runs the moment the right data lands — which is
 * the same contract `listMounted` relies on for a feed that arrives late.
 *
 * **A last-viewed day is deliberately never restored**, even inside the 30-day
 * `USER_STATE_EXPIRY_MS` window, and neither is scroll position — the same
 * reasoning `useFilterState` recorded for the session-only window days, and
 * what iOS does with `selectedDayKey`. A date pinned days ago and silently
 * restored on launch would be worse than no restore.
 */
export function landingDayKey({ now, isCurrentYear, eventDays, seasonStartDay, selectedYear }: LandingDayInput): DayKey | null {
  // Only the selected year's own days are candidates — see the module note
  // above on the torn commit.
  //
  // Filtered rather than rejected wholesale: a feed carrying one event either
  // side of the calendar boundary is a plausible year, and "any stray key
  // means land nobody" would strand a reader in it forever.
  const yearPrefix = `${selectedYear}-`;
  const days = eventDays.filter(d => d.startsWith(yearPrefix));
  if (days.length === 0) return null;
  const from = isCurrentYear ? dayKeyOf(now) : seasonStartDay;
  // The last day rather than null when everything is behind us: a
  // post-season visitor to the CURRENT year — whether they narrowed the
  // list with a filter, or reached it by dismissing the landing outright
  // (task 6 fix round 1: a rail tap, or "Browse this season") — should see
  // the end of the season they just had, not the January of a year that is
  // over.
  //
  // Unreachable for an ARCHIVED year, and that is the year filter's doing:
  // `from` is that season's own start, and a year whose days all precede it
  // has no days left after the filter, so the `days.length === 0` return
  // above has already fired.
  return days.find(d => d >= from) ?? days[days.length - 1];
}
