import { describe, it, expect } from 'vitest';
import { eventDayKeys, eventCountsByDay, summarizeEventDates } from '@/lib/utils/dayWindow';
import { groupEventsByDay } from '@/lib/utils/eventHelpers';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import { parseEventDate } from '@/lib/utils/chqTime';
import type { Event } from '@/lib/types';

/**
 * The premise `page.tsx` now leans on for its rail inputs.
 *
 * `page.tsx` used to walk `filteredEvents` three times — `eventDayKeys` for
 * the reachable days, `eventCountsByDay` for the per-day counts, and
 * `groupEventsByDay` for the list — and each pass called `parseEventDate` on
 * every one of the year's 1,687 events. That call goes through
 * `Intl.formatToParts` and is roughly 51x `new Date` for the feed's naive
 * wall-time strings, so the two nav passes were pure duplicate cost: the day
 * groups already carry both answers.
 *
 * They are read off the groups now, which is only correct while these two
 * statements hold:
 *
 *   groups.map(g => g.key)                         === eventDayKeys(events)
 *   Map(groups.map(g => [g.key, g.events.length])) === eventCountsByDay(events)
 *
 * Nothing else in the suite says so. `groupEventsByDay` and the two helpers
 * are tested separately and thoroughly, and each would go on passing its own
 * tests while drifting apart from the other — a changed sort, a different
 * rule for an unparseable date, a group emitted for a day with no events —
 * and the rail would quietly start naming days the list does not render.
 *
 * The helpers are kept for exactly this: they are the independent statement
 * of what the rail's inputs mean, and this file is where the cheap derivation
 * has to keep agreeing with them.
 *
 * Falsified by deleting `groupEventsByDay`'s final `.sort()`: the key-order
 * case below fails, since the fixture's events arrive out of date order.
 */

const YEAR = 2026;
const seasonWeeks = getChautauquaSeasonWeeks(YEAR);

function ev(id: string, startDate: string): Event {
  return { id, title: id, startDate } as Event;
}

/**
 * Deliberately awkward: out of order, several events per day, days both
 * inside and outside the season, and two rows the feed dated unusably.
 */
const events: Event[] = [
  ev('d', `${YEAR}-07-07T20:15:00`),
  ev('a', `${YEAR}-07-06T10:45:00`),
  ev('bad1', 'not-a-date'),
  ev('f', `${YEAR}-10-01T09:00:00`),
  ev('b', `${YEAR}-07-06T14:00:00`),
  ev('e', `${YEAR}-07-07T08:00:00`),
  ev('bad2', ''),
  ev('c', `${YEAR}-07-06T19:30:00`),
  ev('z', `${YEAR}-05-01T09:00:00`),
];

const groups = groupEventsByDay(events, seasonWeeks);

describe('the day groups carry the rail inputs', () => {
  it('is a fixture with something to get wrong', () => {
    // A guard on the guard: if the fixture ever collapses to one event on one
    // day, both cases below become true of almost any implementation.
    expect(groups.length).toBeGreaterThan(3);
    expect(Math.max(...groups.map(g => g.events.length))).toBeGreaterThan(1);
    expect(events.some(e => Number.isNaN(parseEventDate(e.startDate).getTime()))).toBe(true);
  });

  it('yields the same day keys, in the same order, as eventDayKeys', () => {
    expect(groups.map(g => g.key)).toEqual(eventDayKeys(events));
  });

  it('yields the same per-day counts as eventCountsByDay', () => {
    const derived = new Map(groups.map(g => [g.key, g.events.length] as const));
    expect(derived).toEqual(eventCountsByDay(events));
  });

  it('names no day the helpers do not, and misses none they do', () => {
    // Stated separately from the ordering case so a pure ORDER regression and
    // a pure MEMBERSHIP regression fail different tests.
    expect(new Set(groups.map(g => g.key))).toEqual(new Set(eventDayKeys(events)));
  });
});

describe('summarizeEventDates', () => {
  it('reports the first and last day across the whole set', () => {
    const s = summarizeEventDates(events);
    expect(s.firstDay).toBe(`${YEAR}-05-01`);
    expect(s.lastDay).toBe(`${YEAR}-10-01`);
  });

  it('counts only the rows that can be placed on a day', () => {
    const s = summarizeEventDates(events);
    // Seven parseable, two not — and `events.length` would say nine, which is
    // the count the header used to be able to print over a shorter list.
    expect(s.placeableCount).toBe(7);
    expect(s.placeableCount).toBe(groups.reduce((n, g) => n + g.events.length, 0));
  });

  it('reports the latest start instant, which answers "is anything ahead"', () => {
    const s = summarizeEventDates(events);
    expect(s.latestStartMs).toBe(parseEventDate(`${YEAR}-10-01T09:00:00`).getTime());
    // The equivalence `page.tsx` relies on for `yearHasUpcomingEvents`:
    // "some event starts at or after t" is "the latest start is at or after t".
    for (const t of [`${YEAR}-04-01T00:00:00`, `${YEAR}-07-07T09:00:00`, `${YEAR}-12-01T00:00:00`]) {
      const threshold = parseEventDate(t).getTime();
      expect(s.latestStartMs !== null && s.latestStartMs >= threshold).toBe(
        events.some(e => parseEventDate(e.startDate).getTime() >= threshold)
      );
    }
  });

  it('is all-null and zero for an empty set', () => {
    expect(summarizeEventDates([])).toEqual({
      firstDay: null, lastDay: null, placeableCount: 0, latestStartMs: null,
    });
  });

  it('is all-null and zero when every row is unparseable', () => {
    // Not the same as empty, and worth its own case: a bad row must not widen
    // a bound, must not be counted, and must not be reported as "upcoming".
    // 'NaN-NaN-NaN' sorts above every real key, so a leak here would push the
    // rail's end day past the end of the calendar.
    expect(summarizeEventDates([ev('bad1', 'not-a-date'), ev('bad2', '')])).toEqual({
      firstDay: null, lastDay: null, placeableCount: 0, latestStartMs: null,
    });
  });
});
