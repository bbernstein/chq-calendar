import { describe, it, expect } from 'vitest';
import {
  dayKeyOf,
  startOfDay,
  dayAfter,
  lastDayCovered,
  addDays,
  dayKeys,
  navigableBounds,
  baseWindow,
  viewWindow,
} from '@/lib/utils/dayWindow';
import { getChautauquaSeasonWeeks, getCurrentWeekNumber } from '@/lib/utils/dateHelpers';
import type { Event } from '@/lib/types';

const seasonWeeks = getChautauquaSeasonWeeks(2026);

function makeEvent(id: string, date: Date): Event {
  return { id, title: id, startDate: date.toISOString() } as Event;
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

  it('names the last day shown, stepping back only on an exact midnight', () => {
    // A window ending at midnight does not show that day; one ending mid-day
    // does. `this-week` ends at noon Saturday and that Saturday has events.
    expect(lastDayCovered(new Date(2026, 6, 16, 0, 0, 0, 0))).toBe('2026-07-15');
    expect(lastDayCovered(new Date(2026, 6, 18, 12, 0, 0, 0))).toBe('2026-07-18');
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
});

describe('baseWindow', () => {
  const NOW = new Date(2026, 6, 15, 15, 0, 0, 0);
  const bounds = navigableBounds(seasonWeeks, []);
  const currentWeekNumber = (() => {
    // getCurrentWeekNumber reads the real clock, so derive it from NOW
    // directly rather than faking timers in a pure-module test.
    const w = seasonWeeks.find((week) => NOW >= week.start && NOW <= week.end);
    return w ? w.number : null;
  })();

  it("'today' spans exactly the current calendar day", () => {
    const w = baseWindow({
      dateFilter: 'today', seasonWeeks, currentWeekNumber, now: NOW, bounds,
    })!;
    expect(w.startDay).toBe('2026-07-15');
    expect(w.endDay).toBe('2026-07-15');
    expect(w.start.getTime()).toBe(new Date(2026, 6, 15, 0, 0, 0, 0).getTime());
    expect(w.endExclusive.getTime()).toBe(new Date(2026, 6, 16, 0, 0, 0, 0).getTime());
  });

  it("'next' starts one hour before now, not at midnight", () => {
    const adaptiveEndDate = new Date(2026, 6, 17, 23, 59, 59, 999);
    const w = baseWindow({
      dateFilter: 'next', seasonWeeks, currentWeekNumber, now: NOW, adaptiveEndDate, bounds,
    })!;
    expect(w.start.getTime()).toBe(new Date(2026, 6, 15, 14, 0, 0, 0).getTime());
    // adaptiveEndDate is an inclusive 23:59:59.999; the half-open bound is
    // the following midnight. No representable event falls in the gap.
    expect(w.endExclusive.getTime()).toBe(new Date(2026, 6, 18, 0, 0, 0, 0).getTime());
    expect(w.startDay).toBe('2026-07-15');
    expect(w.endDay).toBe('2026-07-17');
  });

  it("'next' near midnight puts startDay on the previous calendar day", () => {
    // 00:30 minus one hour is 23:30 yesterday. The navigation-facing
    // startDay has to follow the actual bound, not "today".
    const nearMidnight = new Date(2026, 6, 15, 0, 30, 0, 0);
    const w = baseWindow({
      dateFilter: 'next',
      seasonWeeks,
      currentWeekNumber,
      now: nearMidnight,
      adaptiveEndDate: new Date(2026, 6, 17, 23, 59, 59, 999),
      bounds,
    })!;
    expect(w.startDay).toBe('2026-07-14');
  });

  it("'this-week' carries the week's own exclusive noon bound through", () => {
    const week = seasonWeeks[currentWeekNumber! - 1];
    const w = baseWindow({
      dateFilter: 'this-week', seasonWeeks, currentWeekNumber, now: NOW, bounds,
    })!;
    expect(w.start.getTime()).toBe(week.start.getTime());
    expect(w.endExclusive.getTime()).toBe(week.end.getTime());
  });

  it("'this-week' spans both boundary Saturdays", () => {
    const w = baseWindow({
      dateFilter: 'this-week', seasonWeeks, currentWeekNumber, now: NOW, bounds,
    })!;
    expect(dayKeys(w.startDay, w.endDay)).toHaveLength(8);
  });

  it("'this-week' is null outside the season", () => {
    const w = baseWindow({
      dateFilter: 'this-week',
      seasonWeeks,
      currentWeekNumber: null,
      now: new Date(2026, 11, 25, 12, 0),
      bounds,
    });
    expect(w).toBeNull();
  });

  it("'all' bounds no instant, but still reports navigable days", () => {
    const w = baseWindow({
      dateFilter: 'all', seasonWeeks, currentWeekNumber, now: NOW, bounds,
    })!;
    expect(w.start.getTime()).toBeLessThan(new Date(1900, 0, 1).getTime());
    expect(w.endExclusive.getTime()).toBeGreaterThan(new Date(2200, 0, 1).getTime());
    expect(w.startDay).toBe(bounds.startDay);
    expect(w.endDay).toBe(bounds.endDay);
  });
});

describe('viewWindow expansion', () => {
  const NOW = new Date(2026, 6, 15, 15, 0, 0, 0);
  const bounds = navigableBounds(seasonWeeks, []);
  const currentWeekNumber =
    seasonWeeks.find((w) => NOW >= w.start && NOW <= w.end)?.number ?? null;

  const todayOpts = {
    dateFilter: 'today' as const, seasonWeeks, currentWeekNumber, now: NOW, bounds,
  };

  it('is the base window when nothing is expanded', () => {
    const w = viewWindow(todayOpts)!;
    expect(w.startDay).toBe('2026-07-15');
    expect(w.endDay).toBe('2026-07-15');
  });

  it('extends the end and uses a full day for the added region', () => {
    const w = viewWindow({ ...todayOpts, expandedEndDay: '2026-07-17' })!;
    expect(w.endDay).toBe('2026-07-17');
    expect(w.endExclusive.getTime()).toBe(new Date(2026, 6, 18, 0, 0, 0, 0).getTime());
    // The start is untouched, so it keeps the base window's exact instant.
    expect(w.start.getTime()).toBe(new Date(2026, 6, 15, 0, 0, 0, 0).getTime());
  });

  it('extends the start backwards', () => {
    const w = viewWindow({ ...todayOpts, expandedStartDay: '2026-07-13' })!;
    expect(w.startDay).toBe('2026-07-13');
    expect(w.start.getTime()).toBe(new Date(2026, 6, 13, 0, 0, 0, 0).getTime());
  });

  it('drops the intra-day start instant once expanded earlier', () => {
    // 'next' starts at now-1h. Once the user reaches back past that day,
    // they want the whole earlier day, not a window that still begins at
    // 14:00 on a day they have scrolled away from.
    const w = viewWindow({
      dateFilter: 'next',
      seasonWeeks,
      currentWeekNumber,
      now: NOW,
      adaptiveEndDate: new Date(2026, 6, 17, 23, 59, 59, 999),
      bounds,
      expandedStartDay: '2026-07-13',
    })!;
    expect(w.start.getTime()).toBe(new Date(2026, 6, 13, 0, 0, 0, 0).getTime());
  });

  it('ignores an expansion that would narrow the base window', () => {
    const w = viewWindow({ ...todayOpts, expandedEndDay: '2026-07-10' })!;
    expect(w.endDay).toBe('2026-07-15');
  });

  it('clamps expansion to the navigable bounds', () => {
    const w = viewWindow({ ...todayOpts, expandedEndDay: '2030-01-01' })!;
    expect(w.endDay).toBe(bounds.endDay);
  });

  it('stays null when the base window is null', () => {
    const w = viewWindow({
      dateFilter: 'this-week',
      seasonWeeks,
      currentWeekNumber: null,
      now: new Date(2026, 11, 25, 12, 0),
      bounds,
      expandedEndDay: '2026-12-31',
    });
    expect(w).toBeNull();
  });
});
