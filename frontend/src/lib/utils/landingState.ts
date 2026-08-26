import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import { dayKeyOf } from '@/lib/utils/dayWindow';

/**
 * What the calendar's main panel should show when the default filter comes up
 * empty, derived purely from the clock, the season calendar, the years
 * manifest, and whether the selected year has any events at all.
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
   * not the filtered list. See rule 2 in `determineLandingState`.
   */
  yearHasEvents: boolean;
}

/** Noon on the Saturday before the 4th Sunday of June, in Institution time. */
function seasonStart(year: number): Date {
  return getChautauquaSeasonWeeks(year)[0].start;
}

/** Noon on the Saturday nine weeks later — the close of week 9, in Institution time. */
function seasonEnd(year: number): Date {
  return getChautauquaSeasonWeeks(year)[8].end;
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
 * Rules, in priority order:
 *
 * 1. `now` is before `selectedYear`'s season start → `pre-season`. Both a
 *    fully-loaded future year and an announced-but-empty one belong here; the
 *    countdown is the right screen either way.
 * 2. Else, `now` is still before the season's own end (the close of week 9),
 *    or the year has no events at all → `in-season`.
 * 3. Else (the season's nine weeks have passed, and the year has events) →
 *    `post-season`. The season ran and is over.
 *
 * **The calendar half of rule 2 exists for #274 phase 4 task 3.** Once
 * `page.tsx` derives `showLanding` ahead of and independently of
 * `filteredEvents.length === 0` — rather than calling this function only from
 * inside that branch — a fresh, unfiltered visit during the live season
 * reaches this function with `now` past `start` and the year's events
 * present. Without a season-end check, that satisfied the old rule 2
 * unconditionally: `post-season`, i.e. "See you next season" on day one of
 * the season, for every reader, forever, since the default scope carries no
 * filter that would exempt it. The `now < seasonEnd` half closes that gap;
 * the boundary is symmetric with rule 1's `now < start` — a reader landing at
 * the exact opening instant is in season, and a reader landing at the exact
 * closing instant is not.
 *
 * **The no-events half of rule 2 diverges from iOS deliberately.** iOS takes
 * an `upcomingDefaultCount` and returns `.inSeason` when it is positive —
 * this port has no such parameter, and reaches the same outcome for the same
 * case (a live-season visit) via the calendar check above instead. Where the
 * two still differ is a failed or empty feed fetch during the season:
 * `events: []` with `now` between the season's start and end, which a naive
 * port would tell a July visitor "See you next season". This half of rule 2
 * sends that visitor to the generic empty state, which is the honest screen
 * for "we have no data", and reserves the landing for "we have the data and
 * the season is genuinely over".
 */
export function determineLandingState({
  now,
  selectedYear,
  availableYears,
  yearHasEvents,
}: LandingStateInput): LandingState {
  const start = seasonStart(selectedYear);
  if (now < start) {
    return { kind: 'pre-season', opening: start, daysUntil: daysBetween(now, start) };
  }

  if (now < seasonEnd(selectedYear) || !yearHasEvents) {
    return { kind: 'in-season' };
  }

  const later = availableYears.filter(y => y > selectedYear);
  const nextSeasonYear = later.length > 0 ? Math.min(...later) : null;
  const opening = nextSeasonYear === null ? null : seasonStart(nextSeasonYear);
  return {
    kind: 'post-season',
    endedSeasonYear: selectedYear,
    nextSeasonYear,
    opening,
    daysUntil: opening === null ? null : daysBetween(now, opening),
  };
}
