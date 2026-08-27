import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import { dayKeyOf } from '@/lib/utils/dayWindow';

/**
 * What the calendar's main panel should show instead of the event list,
 * derived purely from the clock, the season calendar, the years manifest,
 * and the selected year's events. Consulted on every render (#274 phase 4
 * task 3) — not only when the default filter comes up empty — so a reader
 * mid-season, or with a published-but-not-yet-open next season, or past the
 * season's own nine-week calendar window with events still pending, must all
 * resolve to `in-season` and see the list, not the landing.
 *
 * Ports `ios/ChqCalendarShared/Domain/LandingState.swift`, with one deliberate
 * divergence documented on `determineLandingState` below. The two apps should
 * not hold different opinions about whether the season is over.
 *
 * `determineLandingState` reads no clock — callers own supplying `now`
 * consistently with whatever else they derive from the same instant.
 */
export type LandingState =
  | { kind: 'in-season' }
  | { kind: 'pre-season'; opening: Date; daysUntil: number }
  | {
      kind: 'post-season';
      endedSeasonYear: number;
      nextSeasonYear: number | null;
      opening: Date | null;
      daysUntil: number | null;
    };

export interface LandingStateInput {
  now: Date;
  selectedYear: number;
  availableYears: number[];
  /**
   * `events.length > 0` for the selected year's full, UNFILTERED event set —
   * not the filtered list. See rule 3 in `determineLandingState`.
   */
  yearHasEvents: boolean;
  /**
   * Does any event in the selected year's full, UNFILTERED event set start at
   * or after `now`? Ports iOS's `upcomingDefaultCount > 0`. See rule 1 in
   * `determineLandingState` — this, not the season calendar, is what decides
   * whether there is a list to show.
   */
  yearHasUpcomingEvents: boolean;
}

/** Noon on the Saturday before the 4th Sunday of June, in Institution time. */
function seasonStart(year: number): Date {
  return getChautauquaSeasonWeeks(year)[0].start;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole Institution calendar days between the day containing `from` and the
 * day containing `to`.
 *
 * Reduced to day keys first, then subtracted as pure UTC calendar dates: a
 * calendar date has no DST in it, so the subtraction is exact. Dividing the
 * raw instant difference by 86,400,000 would be off by a fraction of a day
 * across either transition — enough that two instants on the same calendar
 * day floor to different counts, which is exactly the class of bug
 * `chqDateAt` exists to prevent elsewhere in this codebase.
 */
function daysBetween(from: Date, to: Date): number {
  const [fy, fm, fd] = dayKeyOf(from).split('-').map(Number);
  const [ty, tm, td] = dayKeyOf(to).split('-').map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / MS_PER_DAY
  );
}

/**
 * Rules, in priority order — matching `LandingState.swift`'s `determine`
 * exactly, rule for rule:
 *
 * 1. `yearHasUpcomingEvents` → `in-season`, regardless of the calendar. The
 *    default filter has something to show; that is the only question this
 *    function exists to answer, and the season calendar is just a fallback
 *    for when the events themselves don't say.
 * 2. Else, `now` is before `selectedYear`'s season start → `pre-season`. Both
 *    a fully-loaded future year and an announced-but-empty one belong here;
 *    the countdown is the right screen either way.
 * 3. Else, the year has no events at all → `in-season`.
 * 4. Else (past the season start, no upcoming events, but the year has SOME
 *    events) → `post-season`. The season ran and is over. Its `opening`
 *    and `daysUntil` name the *next* announced season past `selectedYear`
 *    — but only while that season is still ahead of `now`. Once `now` has
 *    reached that next season's own start, it is no longer something to
 *    count down to (a reader who picked an archived year mid-way through
 *    the season after it must not see a countdown that has already run
 *    negative — #274 phase 4 task 10), so `opening`/`daysUntil` go `null`
 *    while `nextSeasonYear` itself stays populated: the caller still has a
 *    year to send the reader to, just not a wait to announce for it.
 *
 * **Rule 1 exists for #274 phase 4 task 3.** Once `page.tsx` derives
 * `showLanding` ahead of and independently of `filteredEvents.length === 0`
 * — rather than calling this function only from inside that branch — every
 * other rule here is reachable with `now` and the events genuinely
 * mid-season, or with a next season already published but not yet open. A
 * calendar-only rule 2 (`now < seasonStart` / else `post-season`) was
 * tried and rejected: it fixed a live mid-season visit but broke two more
 * cases the same way — (a) a next season's programme published before its
 * calendar start (`now < start` still true, so `pre-season`, hiding a
 * non-empty list behind a countdown with no button that reaches it — the
 * pre-season landing renders none), and (b) the live season's own last
 * events, whenever they run later than the fixed nine-week calendar window
 * `getChautauquaSeasonWeeks` allots (#269's real Sep 1-10 shoulder: the
 * 2026 feed's last event lands Sep 10, ten days past the calendar's Aug 29
 * close). Rule 1 fixes both by asking the events directly instead of the
 * calendar, exactly as iOS already does — the calendar is now consulted only
 * once rule 1 has already said there is nothing left to show.
 *
 * **Rule 3 diverges from iOS deliberately** — the one documented divergence
 * this module's header promises. iOS has no equivalent: once
 * `upcomingDefaultCount <= 0` and `now >= start`, iOS always returns
 * `.postSeason`. This port adds rule 3 to catch a case iOS handles
 * separately via `AppModel`'s `guard snapshot != nil`: a failed or empty feed
 * fetch during the season gives `events: []` (so `yearHasEvents` is false)
 * with `now` past the season start, and a naive port would tell a July
 * visitor "See you next season". Rule 3 sends that visitor to the generic
 * empty state instead, which is the honest screen for "we have no data", and
 * reserves `post-season` for "we have the data, and it says nothing is
 * left".
 */
export function determineLandingState({
  now,
  selectedYear,
  availableYears,
  yearHasEvents,
  yearHasUpcomingEvents,
}: LandingStateInput): LandingState {
  if (yearHasUpcomingEvents) {
    return { kind: 'in-season' };
  }

  const start = seasonStart(selectedYear);
  if (now < start) {
    return { kind: 'pre-season', opening: start, daysUntil: daysBetween(now, start) };
  }

  if (!yearHasEvents) {
    return { kind: 'in-season' };
  }

  const later = availableYears.filter(y => y > selectedYear);
  const nextSeasonYear = later.length > 0 ? Math.min(...later) : null;
  const nextOpening = nextSeasonYear === null ? null : seasonStart(nextSeasonYear);
  // `nextOpening` is only a countdown target while it is still ahead of
  // `now`. Once `now` has reached it, that season is current or past, not
  // upcoming — reporting it here would render a countdown stuck at a
  // negative day count (the archived-year defect this rule exists to
  // close).
  const opening = nextOpening !== null && now < nextOpening ? nextOpening : null;
  return {
    kind: 'post-season',
    endedSeasonYear: selectedYear,
    nextSeasonYear,
    opening,
    daysUntil: opening === null ? null : daysBetween(now, opening),
  };
}
