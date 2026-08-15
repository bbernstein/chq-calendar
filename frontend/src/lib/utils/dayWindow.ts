import type { Event, SeasonWeek } from '@/lib/types';

/**
 * A calendar day as `yyyy-mm-dd`, zero-padded, in local time.
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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function partsOf(key: DayKey): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number);
  return [y, m, d];
}

export function startOfDay(key: DayKey): Date {
  const [y, m, d] = partsOf(key);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
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
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + 1);
  return date;
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
  const isMidnight =
    endExclusive.getHours() === 0 && endExclusive.getMinutes() === 0 &&
    endExclusive.getSeconds() === 0 && endExclusive.getMilliseconds() === 0;
  const key = dayKeyOf(endExclusive);
  return isMidnight ? addDays(key, -1) : key;
}

/**
 * `key` shifted by `n` calendar days.
 *
 * Built from date parts and `setDate`, never from millisecond arithmetic:
 * adding 86,400,000 ms across a DST transition lands on the previous or
 * next day's 23:00/01:00 and produces the wrong key. Mirrors iOS's
 * `ChqTime.day(_:offsetBy:)`, which uses `Calendar` for the same reason.
 */
export function addDays(key: DayKey, n: number): DayKey {
  const [y, m, d] = partsOf(key);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + n);
  return dayKeyOf(date);
}

/** Every day from `from` through `through`, inclusive. Empty if inverted. */
export function dayKeys(from: DayKey, through: DayKey): DayKey[] {
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
 * `localDateKey` equality is exactly `[startOfDay(d), startOfDay(d+1))`.
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
    const parsed = new Date(event.startDate);
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
  dateFilter: 'all' | 'today' | 'next' | 'this-week';
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
      return {
        startDay: o.bounds.startDay,
        endDay: o.bounds.endDay,
        start: MIN_INSTANT,
        endExclusive: MAX_INSTANT,
      };

    case 'today': {
      const key = dayKeyOf(o.now);
      return { startDay: key, endDay: key, start: startOfDay(key), endExclusive: dayAfter(key) };
    }

    case 'next': {
      // One hour of grace so an event that has just begun is still "next".
      const start = new Date(o.now.getTime() - 60 * 60 * 1000);
      // `adaptiveEndDate` is an inclusive end-of-day; the half-open
      // equivalent is that day's exclusive end. No representable event falls
      // in the difference — event times carry no sub-second component.
      let inclusiveEnd = o.adaptiveEndDate;
      if (!inclusiveEnd) {
        inclusiveEnd = new Date(o.now.getTime() + 6 * 24 * 60 * 60 * 1000);
        inclusiveEnd.setHours(23, 59, 59, 999);
      }
      const endExclusive = dayAfter(dayKeyOf(inclusiveEnd));
      return {
        startDay: dayKeyOf(start),
        endDay: lastDayCovered(endExclusive),
        start,
        endExclusive,
      };
    }

    case 'this-week': {
      if (o.currentWeekNumber === null) return null;
      const week = o.seasonWeeks[o.currentWeekNumber - 1];
      // The week's own bounds, carried through verbatim — `SeasonWeek` is
      // already half-open (`>= start && < end`).
      return {
        startDay: dayKeyOf(week.start),
        endDay: lastDayCovered(week.end),
        start: week.start,
        endExclusive: week.end,
      };
    }
  }
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
 * `bounds` is clamped onto the *expansion inputs*, not onto the merged
 * result. The base window itself is never touched by the clamp: a scope's
 * own window (e.g. off-season `'today'`, which sits entirely outside
 * `bounds` for ~10 months a year) is never rewritten on only one edge, which
 * is what would invert `startDay`/`endDay` if the clamp ran after the merge.
 * `bounds` exists to bound how far navigation can *reach* — it has nothing
 * to say about a scope that hasn't been navigated at all.
 */
export function viewWindow(o: WindowOptions): ViewWindow | null {
  const base = baseWindow(o);
  if (!base) return null;

  let expandedStartDay = o.expandedStartDay;
  if (expandedStartDay && expandedStartDay < o.bounds.startDay) {
    expandedStartDay = o.bounds.startDay;
  }
  let expandedEndDay = o.expandedEndDay;
  if (expandedEndDay && expandedEndDay > o.bounds.endDay) {
    expandedEndDay = o.bounds.endDay;
  }

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
