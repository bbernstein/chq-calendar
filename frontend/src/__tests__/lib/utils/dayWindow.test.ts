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
  windowContains,
  eventDayKeys,
  navigationTargets,
  formatDayLabel,
  formatDayRange,
  dayChips,
  eventCountsByDay,
} from '@/lib/utils/dayWindow';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
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

describe('windowContains', () => {
  // A synthetic window is enough here: this is testing the half-open
  // comparison itself, not any scope's derivation of start/endExclusive.
  const w = {
    startDay: '2026-07-15',
    endDay: '2026-07-15',
    start: new Date(2026, 6, 15, 0, 0, 0, 0),
    endExclusive: new Date(2026, 6, 16, 0, 0, 0, 0),
  };

  it('contains an instant exactly at start', () => {
    expect(windowContains(w, w.start)).toBe(true);
  });

  it('contains an instant strictly inside', () => {
    expect(windowContains(w, new Date(2026, 6, 15, 12, 0, 0, 0))).toBe(true);
  });

  it('does not contain an instant exactly at endExclusive', () => {
    // This is the half-openness the whole shared model exists to enforce:
    // endExclusive belongs to the next window, not this one.
    expect(windowContains(w, w.endExclusive)).toBe(false);
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

  it("does not leak the 'all' singleton Dates — mutating a returned window must not corrupt a later one", () => {
    const first = baseWindow({
      dateFilter: 'all', seasonWeeks, currentWeekNumber, now: NOW, bounds,
    })!;
    const originalStart = first.start.getTime();
    const originalEnd = first.endExclusive.getTime();

    first.start.setFullYear(2026, 6, 15);
    first.endExclusive.setFullYear(2026, 6, 15);

    const second = baseWindow({
      dateFilter: 'all', seasonWeeks, currentWeekNumber, now: NOW, bounds,
    })!;
    expect(second.start.getTime()).toBe(originalStart);
    expect(second.endExclusive.getTime()).toBe(originalEnd);
  });

  it("does not leak the 'this-week' SeasonWeek Dates — mutating a returned window must not corrupt the season or a later window", () => {
    const week = seasonWeeks[currentWeekNumber! - 1];
    const originalWeekStart = week.start.getTime();
    const originalWeekEnd = week.end.getTime();

    const first = baseWindow({
      dateFilter: 'this-week', seasonWeeks, currentWeekNumber, now: NOW, bounds,
    })!;
    first.start.setFullYear(1999, 0, 1);
    first.endExclusive.setFullYear(1999, 0, 1);

    // The caller's seasonWeeks array itself must be untouched.
    expect(week.start.getTime()).toBe(originalWeekStart);
    expect(week.end.getTime()).toBe(originalWeekEnd);

    const second = baseWindow({
      dateFilter: 'this-week', seasonWeeks, currentWeekNumber, now: NOW, bounds,
    })!;
    expect(second.start.getTime()).toBe(originalWeekStart);
    expect(second.endExclusive.getTime()).toBe(originalWeekEnd);
  });

  describe("baseWindow: 'season'", () => {
    it('spans the first week start to the last week end', () => {
      const w = baseWindow({
        dateFilter: 'season', seasonWeeks, currentWeekNumber, now: NOW, bounds,
      })!;
      expect(w.start).toEqual(seasonWeeks[0].start);
      expect(w.endExclusive).toEqual(seasonWeeks[seasonWeeks.length - 1].end);
      expect(w.startDay).toBe(dayKeyOf(seasonWeeks[0].start));
      expect(w.endDay).toBe(lastDayCovered(seasonWeeks[seasonWeeks.length - 1].end));
    });

    // The season's own dates are the caller's array. Handing them back by
    // reference would let one mutation of a returned window corrupt every
    // later window derived from the same season — the same defensive-copy
    // rule 'all' and 'this-week' already follow.
    it('copies the season dates rather than aliasing seasonWeeks', () => {
      const w = baseWindow({
        dateFilter: 'season', seasonWeeks, currentWeekNumber, now: NOW, bounds,
      })!;
      expect(w.start).not.toBe(seasonWeeks[0].start);
      expect(w.endExclusive).not.toBe(seasonWeeks[seasonWeeks.length - 1].end);
    });

    // Season is absolute, not time-relative, so it is meaningful in an
    // archived year and must not be null there.
    it('is non-null regardless of whether the season is in progress', () => {
      const offSeason = new Date(2026, 0, 15, 12, 0, 0);
      expect(baseWindow({
        dateFilter: 'season', seasonWeeks, currentWeekNumber: null, now: offSeason, bounds,
      })).not.toBeNull();
    });

    it('is widened by navigation exactly as every other scope is', () => {
      const w = viewWindow({
        dateFilter: 'season', seasonWeeks, currentWeekNumber, now: NOW, bounds,
        expandedStartDay: null, expandedEndDay: bounds.endDay,
      })!;
      expect(w.endDay).toBe(bounds.endDay);
    });
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

  it("does not invert an off-season 'today' window", () => {
    // The season runs roughly June-August 2026; this 'today' sits entirely
    // outside `bounds` for the other ~10 months of the year — the app's
    // normal state most of the time. `bounds` must clamp how far navigation
    // can reach, not rewrite one edge of a scope's own window: doing the
    // latter here would put startDay/endDay in December against endDay
    // clamped back to the August season end, inverting the window.
    const offSeasonNow = new Date(2026, 11, 25, 12, 0, 0, 0);
    const w = viewWindow({
      dateFilter: 'today',
      seasonWeeks,
      currentWeekNumber: null,
      now: offSeasonNow,
      bounds,
    })!;
    expect(w.startDay <= w.endDay).toBe(true);
    expect(w.start.getTime()).toBeLessThan(w.endExclusive.getTime());
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

describe('start-direction expansion', () => {
  // Phase 1a had no coverage in this direction at all: every expansion test
  // widened the end. Phase 2's "Show earlier" is the first caller that
  // widens the start, so these are the tests that make it safe.
  // The real 2026 season: week 1 starts Saturday June 27 at noon, week 9
  // ends Saturday August 29 at noon.
  const bounds = { startDay: '2026-06-27', endDay: '2026-08-29' };
  const base = {
    seasonWeeks,
    currentWeekNumber: 2,
    now: new Date(2026, 6, 5, 12, 0),
    bounds,
  } as const;

  it('widens the start to the expansion day and takes that day from midnight', () => {
    const w = viewWindow({ ...base, dateFilter: 'today', expandedStartDay: '2026-07-03' })!;
    expect(w.startDay).toBe('2026-07-03');
    expect(w.endDay).toBe('2026-07-05');
    expect(w.start).toEqual(new Date(2026, 6, 3, 0, 0, 0, 0));
  });

  it('ignores an expansion day that would narrow the window', () => {
    const w = viewWindow({ ...base, dateFilter: 'today', expandedStartDay: '2026-07-09' })!;
    expect(w.startDay).toBe('2026-07-05');
    expect(w.start).toEqual(new Date(2026, 6, 5, 0, 0, 0, 0));
  });

  it('clamps an expansion day that reaches past the navigable start', () => {
    const w = viewWindow({ ...base, dateFilter: 'today', expandedStartDay: '2026-01-01' })!;
    expect(w.startDay).toBe('2026-06-27');
  });

  it('does not invert the window when the base sits entirely after the bounds', () => {
    // Off-season 'today' in December: the base window is outside `bounds` in
    // the *other* direction, so an expansion day can be both earlier than
    // the base and later than anything navigation may reach. It clamps to
    // the nearest reachable day — the navigable END, because that is the
    // edge it overshot. Clamping the merged result instead of the expansion
    // input would produce startDay > endDay here.
    const december = { ...base, now: new Date(2026, 11, 1, 12, 0), currentWeekNumber: null };
    const w = viewWindow({ ...december, dateFilter: 'today', expandedStartDay: '2026-11-01' })!;
    expect(w.startDay).toBe('2026-08-29');
    expect(w.endDay).toBe('2026-12-01');
    expect(w.startDay <= w.endDay).toBe(true);
  });

  it('clamps to the near edge, never across the range', () => {
    // A clamp moves a value to the boundary it overshot. Snapping an
    // overshoot of the *end* down to the *start* would silently open the
    // whole season, which is a different operation wearing a clamp's name.
    const december = { ...base, now: new Date(2026, 11, 1, 12, 0), currentWeekNumber: null };
    expect(viewWindow({ ...december, dateFilter: 'today', expandedStartDay: '2026-11-01' })!.startDay)
      .not.toBe('2026-06-27');
  });

  it('widens both ends at once', () => {
    const w = viewWindow({
      ...base,
      dateFilter: 'today',
      expandedStartDay: '2026-07-03',
      expandedEndDay: '2026-07-08',
    })!;
    expect(w.startDay).toBe('2026-07-03');
    expect(w.endDay).toBe('2026-07-08');
    expect(w.start).toEqual(new Date(2026, 6, 3, 0, 0, 0, 0));
    expect(w.endExclusive).toEqual(new Date(2026, 6, 9, 0, 0, 0, 0));
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

describe('navigationTargets', () => {
  const days = ['2026-07-03', '2026-07-05', '2026-07-06', '2026-07-09'];
  const w = (startDay: string, endDay: string) => ({
    startDay, endDay, start: startOfDay(startDay), endExclusive: dayAfter(endDay),
  });

  it('names the nearest event day outside each edge', () => {
    expect(navigationTargets(days, w('2026-07-05', '2026-07-06')))
      .toEqual({ earlierDay: '2026-07-03', laterDay: '2026-07-09' });
  });

  it('skips days with no events rather than stepping one calendar day', () => {
    // 2026-07-04 and 2026-07-07/08 have no events. A calendar-day step would
    // expand the window and add nothing to the list — a control that looks
    // broken. The target is always a day that will actually render.
    expect(navigationTargets(days, w('2026-07-05', '2026-07-06')).earlierDay).toBe('2026-07-03');
    expect(navigationTargets(days, w('2026-07-05', '2026-07-06')).laterDay).toBe('2026-07-09');
  });

  it('returns null on an edge with nothing beyond it', () => {
    expect(navigationTargets(days, w('2026-07-03', '2026-07-09')))
      .toEqual({ earlierDay: null, laterDay: null });
  });

  it('returns nulls for a null window', () => {
    expect(navigationTargets(days, null)).toEqual({ earlierDay: null, laterDay: null });
  });

  it('returns nulls when there are no event days at all', () => {
    expect(navigationTargets([], w('2026-07-05', '2026-07-06')))
      .toEqual({ earlierDay: null, laterDay: null });
  });

  it('finds a target even when the whole window sits outside the event range', () => {
    expect(navigationTargets(days, w('2026-12-01', '2026-12-01')))
      .toEqual({ earlierDay: '2026-07-09', laterDay: null });
  });
});

describe('formatDayLabel', () => {
  it('names the weekday, abbreviated month and day', () => {
    expect(formatDayLabel('2026-07-05')).toBe('Sunday, Jul 5');
    expect(formatDayLabel('2026-08-15')).toBe('Saturday, Aug 15');
  });
});

describe('formatDayRange', () => {
  it('names a single day once', () => {
    expect(formatDayRange('2026-07-04', '2026-07-04')).toBe('Sat, Jul 4');
  });

  it('names the month on both endpoints even within a single month', () => {
    expect(formatDayRange('2026-07-04', '2026-07-09')).toBe('Sat, Jul 4 – Thu, Jul 9');
  });

  it('keeps both months across a month boundary', () => {
    expect(formatDayRange('2026-07-28', '2026-08-02')).toBe('Tue, Jul 28 – Sun, Aug 2');
  });

  it('returns an empty string for an inverted range rather than a nonsense one', () => {
    expect(formatDayRange('2026-07-09', '2026-07-04')).toBe('');
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

  it('treats Institution midnight as midnight for lastDayCovered', () => {
    // 04:00Z is midnight EDT, so the window does not show that day.
    expect(lastDayCovered(new Date('2026-07-28T04:00:00.000Z'))).toBe('2026-07-27');
  });

  it('keeps the final day when a window ends mid-day at Chautauqua', () => {
    // Noon EDT Saturday — 'this-week' ends here and that morning has events.
    expect(lastDayCovered(new Date('2026-07-25T16:00:00.000Z'))).toBe('2026-07-25');
  });
});
