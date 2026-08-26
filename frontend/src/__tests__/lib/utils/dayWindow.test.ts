import { describe, it, expect } from 'vitest';
import {
  dayKeyOf,
  startOfDay,
  dayAfter,
  addDays,
  dayKeys,
  navigableBounds,
  eventDayKeys,
  dayChips,
  eventCountsByDay,
} from '@/lib/utils/dayWindow';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import { parseEventDate } from '@/lib/utils/chqTime';
import type { Event } from '@/lib/types';

const seasonWeeks = getChautauquaSeasonWeeks(2026);

function makeEvent(id: string, date: Date): Event {
  // The real feed sends naive Institution wall time ("2026-07-27 12:45:00"),
  // never an absolute instant with a `Z`/offset suffix — see
  // `parseEventDate`. Built from local getters, not `toISOString()`: under
  // the pinned test TZ (`America/New_York`, equal to `CHQ_ZONE`) those
  // getters already read Institution wall time, so this reproduces the
  // feed shape exactly instead of a UTC instant `parseEventDate` would
  // reinterpret as if it were local time.
  const pad = (n: number) => String(n).padStart(2, '0');
  const startDate = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return { id, title: id, startDate } as Event;
}

describe('day key arithmetic', () => {
  it('formats a date as a zero-padded local day key', () => {
    expect(dayKeyOf(new Date(2026, 6, 5, 23, 30))).toBe('2026-07-05');
    expect(dayKeyOf(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });

  it('sorts lexicographically in chronological order', () => {
    const keys = ['2026-12-31', '2026-07-05', '2026-07-15'];
    expect([...keys].sort()).toEqual(['2026-07-05', '2026-07-15', '2026-12-31']);
  });

  it('does not throw on an Invalid Date, and yields the NaN-NaN-NaN key', () => {
    const bad = parseEventDate('not a date');
    expect(() => dayKeyOf(bad)).not.toThrow();
    expect(dayKeyOf(bad)).toBe('NaN-NaN-NaN');
  });

  it('adds and subtracts days across month and year boundaries', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-08-01', -1)).toBe('2026-07-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-07-15', 0)).toBe('2026-07-15');
  });

  it('crosses a DST transition without drifting', () => {
    // US DST ends 2026-11-01. A naive +86400000ms lands on 2026-10-31
    // 23:00, whose day key is the day it started from.
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    // DST begins 2026-03-08.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
  });

  it('produces inclusive contiguous ranges', () => {
    expect(dayKeys('2026-07-14', '2026-07-16')).toEqual([
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
    ]);
    expect(dayKeys('2026-07-14', '2026-07-14')).toEqual(['2026-07-14']);
  });

  it('returns an empty range when the bounds are inverted', () => {
    expect(dayKeys('2026-07-16', '2026-07-14')).toEqual([]);
  });

  it('bounds a day at local midnight and one ms before the next', () => {
    expect(startOfDay('2026-07-15').getTime()).toBe(new Date(2026, 6, 15, 0, 0, 0, 0).getTime());
    expect(dayAfter('2026-07-15').getTime()).toBe(new Date(2026, 6, 16, 0, 0, 0, 0).getTime());
  });
});

describe('navigableBounds', () => {
  it('spans the season when every event is inside it', () => {
    const events = [makeEvent('mid', new Date(2026, 6, 15, 9, 0))];
    const bounds = navigableBounds(seasonWeeks, events);
    expect(bounds.startDay).toBe(dayKeyOf(seasonWeeks[0].start));
    expect(bounds.endDay).toBe(dayKeyOf(seasonWeeks[8].end));
  });

  it('widens to contain events outside the season', () => {
    const events = [
      makeEvent('early', new Date(2026, 4, 1, 9, 0)),
      makeEvent('late', new Date(2026, 9, 1, 9, 0)),
    ];
    const bounds = navigableBounds(seasonWeeks, events);
    expect(bounds.startDay).toBe('2026-05-01');
    expect(bounds.endDay).toBe('2026-10-01');
  });

  it('falls back to the season alone when there are no events', () => {
    const bounds = navigableBounds(seasonWeeks, []);
    expect(bounds.startDay).toBe(dayKeyOf(seasonWeeks[0].start));
    expect(bounds.endDay).toBe(dayKeyOf(seasonWeeks[8].end));
  });

  it('ignores an event with an unparseable date rather than poisoning the bound', () => {
    // 'NaN-NaN-NaN' sorts above every real day key, so letting a bad row
    // through would silently widen endDay for the whole app. Every other
    // call site just drops the row; this one must match.
    const events: Event[] = [
      { id: 'good', title: 'good', startDate: new Date(2026, 6, 20, 9, 0).toISOString() } as Event,
      { id: 'bad', title: 'bad', startDate: 'not-a-date' } as Event,
    ];
    const bounds = navigableBounds(seasonWeeks, events);
    expect(bounds.startDay).toBe(dayKeyOf(seasonWeeks[0].start));
    expect(bounds.endDay).toBe(dayKeyOf(seasonWeeks[8].end));
  });
});

describe('dayKeys termination', () => {
  it('returns an empty list when either endpoint is not a real day key', () => {
    // 'NaN-NaN-NaN' is what groupEventsByDay produces for an unparseable
    // startDate, and 'N' > '2' lexicographically — so the naive
    // `while (cursor <= through)` loop never terminates. This is not
    // hypothetical: navigableBounds used to be able to hand out such a key.
    expect(dayKeys('2026-07-05', 'NaN-NaN-NaN')).toEqual([]);
    expect(dayKeys('NaN-NaN-NaN', '2026-07-05')).toEqual([]);
    expect(dayKeys('', '2026-07-05')).toEqual([]);
  });

  it('still enumerates a normal range inclusively', () => {
    expect(dayKeys('2026-07-05', '2026-07-07')).toEqual([
      '2026-07-05', '2026-07-06', '2026-07-07',
    ]);
    expect(dayKeys('2026-07-05', '2026-07-05')).toEqual(['2026-07-05']);
    expect(dayKeys('2026-07-07', '2026-07-05')).toEqual([]);
  });
});

describe('eventDayKeys', () => {
  it('returns each event day once, in chronological order', () => {
    const events = [
      makeEvent('c', new Date(2026, 6, 7, 9, 0)),
      makeEvent('a', new Date(2026, 6, 5, 20, 0)),
      makeEvent('b', new Date(2026, 6, 5, 8, 0)),
    ];
    expect(eventDayKeys(events)).toEqual(['2026-07-05', '2026-07-07']);
  });

  it('drops events whose startDate does not parse', () => {
    const events = [
      makeEvent('a', new Date(2026, 6, 5, 8, 0)),
      { id: 'bad', title: 'bad', startDate: 'not a date' } as Event,
    ];
    expect(eventDayKeys(events)).toEqual(['2026-07-05']);
  });

  it('returns an empty list for no events', () => {
    expect(eventDayKeys([])).toEqual([]);
  });
});

describe('dayChips', () => {
  const counts = new Map([['2026-07-04', 12], ['2026-08-01', 3]]);

  it('shows the month on the first chip', () => {
    expect(dayChips(['2026-07-04'], counts)[0].month).toBe('Jul');
  });

  it('omits the month while it has not changed', () => {
    const chips = dayChips(['2026-07-04', '2026-07-05'], counts);
    expect(chips[1].month).toBeNull();
  });

  it('shows the month again when it changes', () => {
    const chips = dayChips(['2026-07-31', '2026-08-01'], counts);
    expect(chips[1].month).toBe('Aug');
  });

  it('carries the weekday abbreviation and day of month', () => {
    const [chip] = dayChips(['2026-07-04'], counts);
    expect(chip.weekday).toBe('Sat');
    expect(chip.dayOfMonth).toBe('4');
  });

  it('carries the count of matching events', () => {
    expect(dayChips(['2026-07-04'], counts)[0].count).toBe(12);
  });

  it('reports zero for a day with no matching events', () => {
    expect(dayChips(['2026-07-06'], counts)[0].count).toBe(0);
  });

  // Controls are labelled by target, never by direction — "next" tells a
  // screen-reader user nothing about where they are going.
  it('labels a chip by its target and its count', () => {
    expect(dayChips(['2026-07-04'], counts)[0].label).toBe('Go to Saturday, July 4, 12 events');
  });

  // Named as a fact, not as a destination: an empty chip is presented as
  // unavailable, and "Go to" on a control that goes nowhere is precisely the
  // announcement/behaviour mismatch that wording is there to avoid.
  it('names a day with no matches without offering to go there', () => {
    expect(dayChips(['2026-07-06'], counts)[0].label).toBe('Monday, July 6, no events');
  });

  it('uses the singular for exactly one event', () => {
    expect(dayChips(['2026-08-01'], new Map([['2026-08-01', 1]]))[0].label)
      .toBe('Go to Saturday, August 1, 1 event');
  });
});

describe('eventCountsByDay', () => {
  it('counts the events falling on each day', () => {
    const counts = eventCountsByDay([
      makeEvent('a', new Date(2026, 6, 4, 9, 0)),
      makeEvent('b', new Date(2026, 6, 4, 20, 0)),
      makeEvent('c', new Date(2026, 6, 5, 10, 0)),
    ]);
    expect(counts.get('2026-07-04')).toBe(2);
    expect(counts.get('2026-07-05')).toBe(1);
  });

  it('omits a day with nothing on it rather than recording a zero', () => {
    const counts = eventCountsByDay([makeEvent('a', new Date(2026, 6, 4, 9, 0))]);
    expect(counts.has('2026-07-05')).toBe(false);
  });

  it('drops events whose startDate does not parse', () => {
    const counts = eventCountsByDay([
      makeEvent('a', new Date(2026, 6, 4, 9, 0)),
      { id: 'bad', title: 'bad', startDate: 'not a date' } as Event,
    ]);
    expect(counts.size).toBe(1);
    expect(counts.get('2026-07-04')).toBe(1);
  });
});

describe('Institution-anchored day boundaries', () => {
  it('files an instant under the Institution day, not the device day', () => {
    // 03:45Z on the 27th is 23:45 on the 26th at Chautauqua.
    expect(dayKeyOf(new Date('2026-07-27T03:45:00Z'))).toBe('2026-07-26');
  });

  it('starts a day at Institution midnight', () => {
    expect(startOfDay('2026-07-27').toISOString()).toBe('2026-07-27T04:00:00.000Z');
  });

  it('starts a winter day at Institution midnight', () => {
    expect(startOfDay('2026-01-15').toISOString()).toBe('2026-01-15T05:00:00.000Z');
  });

  it('ends a day at the next Institution midnight', () => {
    expect(dayAfter('2026-07-27').toISOString()).toBe('2026-07-28T04:00:00.000Z');
  });

  it('tiles exactly: one day\'s end is the next day\'s start', () => {
    expect(dayAfter('2026-03-07').getTime()).toBe(startOfDay('2026-03-08').getTime());
    expect(dayAfter('2026-10-31').getTime()).toBe(startOfDay('2026-11-01').getTime());
  });

});

describe('day chips and labels read Institution time', () => {
  it('names the chip after its own key', () => {
    const chips = dayChips(['2026-07-27'], new Map([['2026-07-27', 3]]));
    expect(chips[0].dayOfMonth).toBe('27');
    expect(chips[0].weekday).toBe('Mon');
    expect(chips[0].month).toBe('Jul');
    expect(chips[0].label).toBe('Go to Monday, July 27, 3 events');
  });

  it('names a chip on the far side of a DST transition correctly', () => {
    const chips = dayChips(['2026-11-01'], new Map());
    expect(chips[0].dayOfMonth).toBe('1');
    expect(chips[0].label).toBe('Sunday, November 1, no events');
  });
});
