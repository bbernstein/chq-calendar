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

/**
 * Every day that has at least one event, sorted, each listed once.
 *
 * This is the set navigation reaches: a rail chip or week-band cell for a day
 * with no events is presented as unavailable rather than as a destination,
 * because scrolling to it would land on nothing. Unparseable dates are
 * dropped, matching every other call site in the app.
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

/**
 * `"Saturday, July 25"` — the long spoken form every rail control names its
 * target by.
 *
 * Extracted from `dayChips` so the week band names a day exactly as the chip
 * under it does. Two spellings of the same day in one strip is the kind of
 * drift a screen-reader user hears and a sighted reviewer never sees.
 */
export function spokenDayTitle(key: DayKey): string {
  return startOfDay(key).toLocaleDateString('en-US', {
    timeZone: CHQ_ZONE, weekday: 'long', month: 'long', day: 'numeric',
  });
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
    const spoken = spokenDayTitle(key);
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
