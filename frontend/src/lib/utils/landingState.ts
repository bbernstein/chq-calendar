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
 * Ports `ios/ChqCalendarShared/Domain/LandingState.swift`, and as of #288 the
 * two implementations agree rule for rule with no remaining divergence — iOS
 * adopted this file's rules 3 and 4 in the same change that unbound its rule-1
 * input from the `.next` scope's 90-day window. The two apps should not hold
 * different opinions about whether the season is over.
 *
 * **The parity covers the payloads too, not only the classification.** #186
 * added `pre-season`'s `archiveYear` on iOS first, and `LandingState.swift`
 * carried an explicit "iOS-only until #186's web half lands" note against it
 * for exactly as long as that was true; this file's rule 2 now computes the
 * same year by the same manifest-derived rule, and that note is gone from
 * both sides. Say so here as well as there: this pair's recorded failure mode
 * (#288, six months) was a parity comment nobody re-checked, and a claim
 * stated on only one side is a claim only one side's reader can falsify.
 *
 * `determineLandingState` reads no clock — callers own supplying `now`
 * consistently with whatever else they derive from the same instant.
 */
export type LandingState =
  | { kind: 'in-season' }
  /**
   * `selectedYear`'s season has not started yet. `archiveYear` names the
   * newest season in the years manifest *older* than `selectedYear` — the
   * past season a reader waiting for this one can browse instead — or is
   * `null` when the manifest holds no earlier year, which correctly hides
   * `OffSeasonLanding`'s button rather than offering a dead one. See rule 2
   * for why it is manifest-derived and not `selectedYear - 1`.
   */
  | { kind: 'pre-season'; opening: Date; daysUntil: number; archiveYear: number | null }
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
   * or after `now` **minus one hour of grace** — NOT the bare `now` this same
   * interface carries above? The two fields deliberately describe different
   * instants, and callers must honour that: `page.tsx` derives this from
   * `graceStart`, and `AppModel.landingState` on iOS from
   * `now().addingTimeInterval(-3600)`.
   *
   * The grace is `.next`'s own opening grace (`dayWindow.ts`; iOS's
   * `ViewWindow.swift`). Without it, the hour after the season's final event
   * *begins* would already read as "nothing upcoming", and the landing would
   * cover a list containing a currently-running event — "See you next season"
   * while it is happening. `offSeasonLanding.test.tsx` pins both sides of
   * that boundary.
   *
   * See rule 1 in `determineLandingState` — this, not the season calendar, is
   * what decides whether there is a list to show.
   *
   * **Full and unfiltered is load-bearing**, not incidental: iOS derived this
   * from its default filter's result count instead, which silently folded
   * that filter's 90-day scope cap into "is the season over" and produced a
   * six-month divergence from this file (#288). Note that #288 and this
   * docstring are the same failure in two forms — a predicate whose stated
   * contract and actual input drift apart while both look right in isolation.
   * If you change what callers pass here, change this sentence with it.
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
 * 2. Else, `now` is before `selectedYear`'s season start → `pre-season`,
 *    carrying the newest year in `availableYears` strictly below
 *    `selectedYear` as its `archiveYear` (`null` if there is none). Both a
 *    fully-loaded future year and an announced-but-empty one belong here;
 *    the countdown is the right screen either way, and either way the reader
 *    is offered the last season that actually ran (#186).
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
 * non-empty list behind a countdown; #186 has since put an archive button on
 * that screen, but it reaches the PREVIOUS season, never the published list
 * being hidden), and (b) the live season's own last
 * events, whenever they run later than the fixed nine-week calendar window
 * `getChautauquaSeasonWeeks` allots (#269's real Sep 1-10 shoulder: the
 * 2026 feed's last event lands Sep 10, ten days past the calendar's Aug 29
 * close). Rule 1 fixes both by asking the events directly instead of the
 * calendar — the calendar is consulted only once rule 1 has already said
 * there is nothing left to show. This paragraph used to add "exactly as iOS
 * already does", which was the assumption #288 turned out to falsify: iOS
 * implemented the same rule over a *different input*, its default filter's
 * 90-day-capped result count. Same rule, different question.
 *
 * **Rule 3 originated here and iOS has since adopted it** (#288); it was the
 * one divergence this module's header used to document. It catches a case
 * iOS also handles, more narrowly, via `AppModel`'s `guard snapshot != nil`:
 * a failed or empty feed fetch during the season gives `events: []` (so
 * `yearHasEvents` is false)
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
    // Deliberately the newest year the MANIFEST lists below this one, never
    // `selectedYear - 1`: the manifest is the only evidence a year's feed
    // exists, so on a manifest that skips a year (`[2024, 2027]`) the
    // arithmetic names 2026, whose feed 404s and lands the reader on an
    // empty screen. Same rule, same reasoning, as iOS's rule 2 (#186).
    const earlier = availableYears.filter(y => y < selectedYear);
    return {
      kind: 'pre-season',
      opening: start,
      daysUntil: daysBetween(now, start),
      archiveYear: earlier.length > 0 ? Math.max(...earlier) : null,
    };
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
