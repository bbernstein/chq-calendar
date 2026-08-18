import type { Event, SeasonWeek } from '@/lib/types';
import { CHQ_ZONE, chqDateAt, chqDayKey, chqParts, parseEventDate } from '@/lib/utils/chqTime';

/**
 * A calendar day as `yyyy-mm-dd`, zero-padded, in Institution time.
 *
 * Lexicographic order is chronological, which is what makes plain string
 * comparison a correct date comparison throughout this module. Matches
 * iOS's `ChqTime.dayKey` byte for byte, so the two platforms describe the
 * same day the same way.
 */
export type DayKey = string;

/** The widest instants a `Date` can hold — used by the unbounded scope. */
const MIN_INSTANT = new Date(-8640000000000000);
const MAX_INSTANT = new Date(8640000000000000);

export function dayKeyOf(d: Date): DayKey {
  return chqDayKey(d);
}

function partsOf(key: DayKey): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number);
  return [y, m, d];
}

export function startOfDay(key: DayKey): Date {
  const [y, m, d] = partsOf(key);
  return chqDateAt(y, m, d, 0, 0, 0, 0);
}

/**
 * The exclusive upper bound of `key` — the next day's midnight.
 *
 * Deliberately not "23:59:59.999": that is an inclusive bound whose
 * correctness depends on `Date` being integer milliseconds. It is here, and
 * it is not on iOS, where `Date` wraps a `Double`. A half-open bound needs
 * no such assumption and tiles exactly with the next day's window.
 */
export function dayAfter(key: DayKey): Date {
  const [y, m, d] = partsOf(key);
  // Built by adding a calendar day, never 86,400,000ms: a DST transition day
  // is 23 or 25 hours long, and millisecond arithmetic lands an hour out.
  return chqDateAt(y, m, d + 1, 0, 0, 0, 0);
}

/**
 * The last day a window actually shows, given its exclusive upper bound.
 *
 * One rule for two cases that look unrelated at the call site: a window
 * ending at midnight does not show that day (`'today'`, `'next'`), while one
 * ending mid-day does (`'this-week'` ends at noon Saturday, and that
 * Saturday morning has events).
 */
export function lastDayCovered(endExclusive: Date): DayKey {
  // Compared as instants, not via ChqParts fields: `ChqParts` has no
  // milliseconds field, and hour/minute/second === 0 alone would misclassify
  // an instant like `00:00:00.400` as midnight, silently dropping the final
  // day. `endExclusive` is midnight exactly when it equals the start of its
  // own day — an exact, ms-safe comparison that needs no new field.
  const key = dayKeyOf(endExclusive);
  const isMidnight = endExclusive.getTime() === startOfDay(key).getTime();
  return isMidnight ? addDays(key, -1) : key;
}

/**
 * `key` shifted by `n` calendar days.
 *
 * Built from date parts and `chqDateAt`, never from millisecond arithmetic:
 * adding 86,400,000 ms across a DST transition lands on the previous or
 * next day's 23:00/01:00 and produces the wrong key. Mirrors iOS's
 * `ChqTime.day(_:offsetBy:)`, which uses `Calendar` for the same reason.
 */
export function addDays(key: DayKey, n: number): DayKey {
  const [y, m, d] = partsOf(key);
  return dayKeyOf(chqDateAt(y, m, d + n, 12, 0, 0, 0));
}

/** A `yyyy-mm-dd` key with a real calendar date behind it. */
function isDayKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = partsOf(key);
  // Noon, not midnight: a date that does not exist rolls over, and noon is
  // far enough from any DST edge that only a genuine rollover moves the day.
  return dayKeyOf(chqDateAt(y, m, d, 12)) === key;
}

/**
 * Every day from `from` through `through`, inclusive. Empty if inverted.
 *
 * Both endpoints are validated first. Without that, a `'NaN-NaN-NaN'` key —
 * what `groupEventsByDay` produces for an unparseable `startDate` — makes the
 * loop non-terminating, because `'N'` sorts above every digit and the cursor
 * can never reach it.
 */
export function dayKeys(from: DayKey, through: DayKey): DayKey[] {
  if (!isDayKey(from) || !isDayKey(through)) return [];
  const out: DayKey[] = [];
  let cursor = from;
  while (cursor <= through) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/**
 * The instants the list is filtered to, plus the days that range covers.
 *
 * **Half-open**: `start <= x < endExclusive`. Never inclusive with a
 * subtracted epsilon — `end - 1` is exact here because `Date` is integer
 * milliseconds, but it is not on iOS where `Date` wraps a `Double`, and the
 * same written rule meaning two different things per platform is the drift
 * this shared model exists to prevent.
 *
 * Half-open is also what the existing code already used, so most scopes need
 * no conversion: the week filter is `>= week.start && < week.end`, and
 * `dayKeyOf` equality is exactly `[startOfDay(d), startOfDay(d+1))`.
 * Those bounds are carried through verbatim below.
 *
 * `startDay`/`endDay` are the navigation-facing projection: what a day rail
 * or a step control moves through. They are derived from `start`/`end`, not
 * the other way round, so they can never disagree with what is filtered.
 */
export interface ViewWindow {
  startDay: DayKey;
  endDay: DayKey;
  start: Date;
  endExclusive: Date;
}

/** `d >= w.start && d < w.endExclusive`. */
export function windowContains(w: ViewWindow, d: Date): boolean {
  return d >= w.start && d < w.endExclusive;
}

/** The outer limit of everything navigation can reach. */
export interface NavigableBounds {
  startDay: DayKey;
  endDay: DayKey;
}

/**
 * The season, widened to contain every day that has an event.
 *
 * The widening is not cosmetic: without it a pre- or post-season event
 * would be permanently unreachable by stepping. Mirrors iOS's
 * `DayWindow.bounds(year:starredDays:)`, which widens by starred days for
 * the same reason.
 */
export function navigableBounds(
  seasonWeeks: SeasonWeek[],
  events: Event[]
): NavigableBounds {
  let startDay = dayKeyOf(seasonWeeks[0].start);
  let endDay = dayKeyOf(seasonWeeks[seasonWeeks.length - 1].end);

  for (const event of events) {
    const parsed = parseEventDate(event.startDate);
    // An unparseable date must not poison the global bound: 'NaN-NaN-NaN'
    // sorts above every real key, so a single bad row would otherwise widen
    // endDay for the whole app. Every other call site (filterHelpers,
    // eventHelpers, dateHelpers) already just drops such a row — match that.
    if (Number.isNaN(parsed.getTime())) continue;
    const key = dayKeyOf(parsed);
    if (key < startDay) startDay = key;
    if (key > endDay) endDay = key;
  }

  return { startDay, endDay };
}

export interface WindowOptions {
  dateFilter: 'all' | 'today' | 'next' | 'this-week' | 'season';
  seasonWeeks: SeasonWeek[];
  currentWeekNumber: number | null;
  now: Date;
  adaptiveEndDate?: Date;
  bounds: NavigableBounds;
  expandedStartDay?: DayKey | null;
  expandedEndDay?: DayKey | null;
}

/**
 * The window a scope defines before any expansion.
 *
 * `null` means "this scope matches nothing right now", which is reachable
 * only for `'this-week'` outside the season — the case the old
 * `isThisWeek` handled by returning `false` for every event.
 */
export function baseWindow(o: WindowOptions): ViewWindow | null {
  switch (o.dateFilter) {
    case 'all':
      // No instant bound at all. Deliberately not derived from the event
      // list: a window computed from the events being filtered would be
      // circular, and would behave differently for a caller that passed a
      // subset.
      // Defensive copies: MIN_INSTANT/MAX_INSTANT are module-level
      // singletons, and a `Date` is mutable. Handing out the singletons
      // themselves would let one `w.start.setHours(...)` in a future caller
      // permanently corrupt every subsequent `'all'` window.
      return {
        startDay: o.bounds.startDay,
        endDay: o.bounds.endDay,
        start: new Date(MIN_INSTANT),
        endExclusive: new Date(MAX_INSTANT),
      };

    case 'today': {
      const key = dayKeyOf(o.now);
      return { startDay: key, endDay: key, start: startOfDay(key), endExclusive: dayAfter(key) };
    }

    case 'next': {
      // One hour of grace so an event that has just begun is still "next".
      const start = new Date(o.now.getTime() - 60 * 60 * 1000);
      // `getAdaptiveEndDate` returns an already-exclusive bound: the
      // Institution midnight that ends the last day it decided to include.
      // It is used directly. The fallback below is the only path that builds
      // an inclusive instant, so it is the only one that needs converting.
      let endExclusive = o.adaptiveEndDate;
      if (!endExclusive) {
        const sixDaysOut = new Date(o.now.getTime() + 6 * 24 * 60 * 60 * 1000);
        const p = chqParts(sixDaysOut);
        endExclusive = chqDateAt(p.year, p.month, p.day + 1, 0, 0, 0, 0);
      }
      return {
        startDay: dayKeyOf(start),
        endDay: lastDayCovered(endExclusive),
        start,
        endExclusive,
      };
    }

    case 'season': {
      // The whole season, absolute. Unlike 'next'/'today'/'this-week' this
      // says nothing about *now*, so it is meaningful in an archived year and
      // is never downgraded — which is exactly why the scope set needed it:
      // 'all' was previously the only non-time-relative scope, and it means
      // the whole year, not the season.
      //
      // Copied, not aliased: these `Date`s belong to the caller's
      // `seasonWeeks` array, and returning them by reference would let a
      // mutation of the returned window reach back into it.
      const first = o.seasonWeeks[0];
      const last = o.seasonWeeks[o.seasonWeeks.length - 1];
      return {
        startDay: dayKeyOf(first.start),
        endDay: lastDayCovered(last.end),
        start: new Date(first.start),
        endExclusive: new Date(last.end),
      };
    }

    case 'this-week': {
      if (o.currentWeekNumber === null) return null;
      const week = o.seasonWeeks[o.currentWeekNumber - 1];
      // The week's own bounds, carried through verbatim — `SeasonWeek` is
      // already half-open (`>= start && < end`). Copied, not aliased: these
      // `Date`s belong to the caller's `seasonWeeks` array, and returning
      // them by reference would let a mutation of the returned window reach
      // back into that array.
      return {
        startDay: dayKeyOf(week.start),
        endDay: lastDayCovered(week.end),
        start: new Date(week.start),
        endExclusive: new Date(week.end),
      };
    }
  }
}

/** `key` moved to the nearest end of `bounds` if it falls outside them. */
function clampToBounds(key: DayKey, bounds: NavigableBounds): DayKey {
  if (key < bounds.startDay) return bounds.startDay;
  if (key > bounds.endDay) return bounds.endDay;
  return key;
}

/**
 * The base window, widened by however far the user has navigated.
 *
 * Expansion only ever grows the window — an `expanded*` value that would
 * narrow it is ignored, so a stale value can never hide events. The added
 * region uses whole days, while an untouched end keeps the base window's
 * exact instant. That is what preserves `'next'`'s one-hour grace and
 * `'this-week'`'s noon boundaries until the user actually navigates past
 * them.
 *
 * Each expansion input is clamped to the nearest edge of `bounds` it falls
 * outside — never snapped across to the far edge, which would silently open
 * the whole navigable range instead of stopping at the edge it overshot.
 * That clamp runs on the *expansion inputs*, not on the merged result. The
 * base window itself is never touched by it: a scope's own window (e.g.
 * off-season `'today'`, which sits entirely outside `bounds` for ~10 months a
 * year) is never rewritten on only one edge, which is what would invert
 * `startDay`/`endDay` if the clamp ran after the merge. `bounds` exists to
 * bound how far navigation can *reach* — it has nothing to say about a scope
 * that hasn't been navigated at all.
 */
export function viewWindow(o: WindowOptions): ViewWindow | null {
  const base = baseWindow(o);
  if (!base) return null;

  const expandedStartDay = o.expandedStartDay ? clampToBounds(o.expandedStartDay, o.bounds) : null;
  const expandedEndDay = o.expandedEndDay ? clampToBounds(o.expandedEndDay, o.bounds) : null;

  let startDay = base.startDay;
  let endDay = base.endDay;

  if (expandedStartDay && expandedStartDay < startDay) startDay = expandedStartDay;
  if (expandedEndDay && expandedEndDay > endDay) endDay = expandedEndDay;

  return {
    startDay,
    endDay,
    start: startDay === base.startDay ? base.start : startOfDay(startDay),
    endExclusive: endDay === base.endDay ? base.endExclusive : dayAfter(endDay),
  };
}

/**
 * Every day that has at least one event, sorted, each listed once.
 *
 * This is the set navigation steps through: expanding the window to a day
 * with no events would move the edge and add nothing to the list, which
 * reads as a broken control. Unparseable dates are dropped, matching every
 * other call site in the app.
 */
export function eventDayKeys(events: Event[]): DayKey[] {
  const keys = new Set<DayKey>();
  for (const event of events) {
    const parsed = parseEventDate(event.startDate);
    if (Number.isNaN(parsed.getTime())) continue;
    keys.add(dayKeyOf(parsed));
  }
  return [...keys].sort();
}

/** The nearest event day beyond each edge of `w`, or `null` if there is none. */
export function navigationTargets(
  eventDays: DayKey[],
  w: ViewWindow | null
): { earlierDay: DayKey | null; laterDay: DayKey | null } {
  if (!w) return { earlierDay: null, laterDay: null };
  let earlierDay: DayKey | null = null;
  let laterDay: DayKey | null = null;
  // eventDays is sorted, so the last key below startDay wins (walk keeps
  // overwriting earlierDay) and the first key above endDay wins (guarded by
  // the null check so later keys don't overwrite it).
  for (const key of eventDays) {
    if (key < w.startDay) earlierDay = key;
    else if (key > w.endDay && laterDay === null) laterDay = key;
  }
  return { earlierDay, laterDay };
}

/** `"Saturday, Aug 15"` — how a navigation control names its target. */
export function formatDayLabel(key: DayKey): string {
  return startOfDay(key).toLocaleDateString('en-US', {
    timeZone: CHQ_ZONE,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

/** `"Sat, Jul 4 – Thu, Jul 9"` — how the date chip names the window it covers. */
export function formatDayRange(from: DayKey, through: DayKey): string {
  // An inverted range is not representable as a sentence; an empty string is
  // what the caller can test for. This is defensive rather than expected:
  // `viewWindow` only ever widens, so start <= end holds for every window it
  // returns.
  if (from > through) return '';
  const fmt = (key: DayKey) =>
    startOfDay(key).toLocaleDateString('en-US', { timeZone: CHQ_ZONE, weekday: 'short', month: 'short', day: 'numeric' });
  if (from === through) return fmt(from);
  return `${fmt(from)} – ${fmt(through)}`;
}

/** One day on the rail. */
export interface DayChip {
  key: DayKey;
  /** `'Sat'` */
  weekday: string;
  /** `'4'` — no leading zero; this is display text, not a key. */
  dayOfMonth: string;
  /** `'Jul'` on the first chip and whenever the month changes; else `null`. */
  month: string | null;
  /** Matching events on that day under the current non-date filters. */
  count: number;
  /**
   * The full accessible name — labelled by target, never by direction.
   *
   * Only a day with matches is named as a destination ("Go to …"). A day
   * with none is named as a fact ("Monday, July 6, no events"): there is
   * nothing to go to, the chip is presented as unavailable, and a control
   * that says "Go to" while going nowhere is the defect this wording exists
   * to avoid.
   */
  label: string;
}

/**
 * How many of `events` fall on each day, by day key.
 *
 * Takes the events themselves rather than the day groups the list renders,
 * because the rail is a navigation surface and not a filter readout: it must
 * be fed the set that navigation can reach (everything matching the
 * *non-date* filters), not the date-windowed subset currently on screen.
 * Counting the rendered groups instead would mark every day outside the
 * current scope "no events" — which is the same wall in a new control, since
 * a chip is judged empty on the strength of that count.
 *
 * Unparseable dates are dropped, matching `eventDayKeys` and every other
 * call site in the app.
 */
export function eventCountsByDay(events: Event[]): Map<DayKey, number> {
  const counts = new Map<DayKey, number>();
  for (const event of events) {
    const parsed = parseEventDate(event.startDate);
    if (Number.isNaN(parsed.getTime())) continue;
    const key = dayKeyOf(parsed);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function dayChips(days: DayKey[], countsByDay: Map<DayKey, number>): DayChip[] {
  let lastMonth: string | null = null;
  return days.map((key) => {
    const date = startOfDay(key);
    const month = date.toLocaleDateString('en-US', { timeZone: CHQ_ZONE, month: 'short' });
    // The month rides the first chip and every change after it — without the
    // first-chip rule a rail scrolled to mid-July would show no month at all,
    // which is exactly the disorientation the rail exists to fix.
    const showMonth = month !== lastMonth;
    lastMonth = month;
    const count = countsByDay.get(key) ?? 0;
    const spoken = date.toLocaleDateString('en-US', { timeZone: CHQ_ZONE, weekday: 'long', month: 'long', day: 'numeric' });
    const events = count === 0 ? 'no events' : count === 1 ? '1 event' : `${count} events`;
    return {
      key,
      weekday: date.toLocaleDateString('en-US', { timeZone: CHQ_ZONE, weekday: 'short' }),
      dayOfMonth: String(chqParts(date).day),
      month: showMonth ? month : null,
      count,
      label: count === 0 ? `${spoken}, ${events}` : `Go to ${spoken}, ${events}`,
    };
  });
}
