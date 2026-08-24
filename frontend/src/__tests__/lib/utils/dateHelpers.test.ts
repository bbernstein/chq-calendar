import { getAdaptiveEndDate, getChautauquaSeasonWeeks, weekNumbersForCalendarDate } from '@/lib/utils/dateHelpers';
import { parseEventDate } from '@/lib/utils/chqTime';
import type { Event } from '@/lib/types';

function makeEvent(dateStr: string, id?: string): Event {
  return {
    id: id || `event-${dateStr}`,
    title: `Event on ${dateStr}`,
    startDate: dateStr,
    endDate: dateStr,
  };
}

describe('getAdaptiveEndDate', () => {
  const events: Event[] = [
    // Day 1 (Jun 30): 10 events
    ...Array.from({ length: 10 }, (_, i) =>
      makeEvent(`2026-06-30T${String(8 + i).padStart(2, '0')}:00:00`, `d1-${i}`)
    ),
    // Day 2 (Jul 1): 15 events
    ...Array.from({ length: 15 }, (_, i) =>
      makeEvent(`2026-07-01T${String(7 + i).padStart(2, '0')}:00:00`, `d2-${i}`)
    ),
    // Day 3 (Jul 2): 20 events
    ...Array.from({ length: 20 }, (_, i) =>
      makeEvent(`2026-07-02T${String(6 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}:00`, `d3-${i}`)
    ),
    // Day 4 (Jul 3): 15 events
    ...Array.from({ length: 15 }, (_, i) =>
      makeEvent(`2026-07-03T${String(8 + i).padStart(2, '0')}:00:00`, `d4-${i}`)
    ),
  ];

  // getAdaptiveEndDate now returns an exclusive bound — the Institution
  // midnight immediately after the last included day — rather than an
  // inclusive 23:59:59.999 on that day, matching the half-open
  // `start <= x < end` convention used throughout. These assertions were
  // updated from the old inclusive values (Task 4).
  it('returns the exclusive next-midnight boundary', () => {
    const startDate = new Date('2026-06-30T07:00:00');
    const endDate = getAdaptiveEndDate(events, startDate, 5);
    expect(endDate.getHours()).toBe(0);
    expect(endDate.getMinutes()).toBe(0);
  });

  it('includes enough full days to meet minEvents', () => {
    const startDate = new Date('2026-06-30T07:00:00');
    // Need 20 events. Day 1 has 10 (< 20, not enough).
    // Day 1 + Day 2 = 25 (>= 20, enough). Return the midnight after Day 2.
    const endDate = getAdaptiveEndDate(events, startDate, 20);
    // End date should be the start of Jul 2 (Day 2 complete, accumulated 25 >= 20)
    expect(endDate.getMonth()).toBe(6); // July = month 6
    expect(endDate.getDate()).toBe(2);
  });

  it('handles when first day has enough events', () => {
    const startDate = new Date('2026-06-30T07:00:00');
    // minEvents = 5, Day 1 has 10 events.
    // After completing Day 1, accumulated=10 >= 5, return the midnight after Day 1
    const endDate = getAdaptiveEndDate(events, startDate, 5);
    expect(endDate.getMonth()).toBe(6); // July = month 6
    expect(endDate.getDate()).toBe(1);
  });

  it('returns the day after the last event day if not enough events exist', () => {
    const startDate = new Date('2026-06-30T07:00:00');
    const endDate = getAdaptiveEndDate(events, startDate, 1000);
    // Should return the midnight after the last event's day (Jul 3 -> Jul 4)
    expect(endDate.getMonth()).toBe(6);
    expect(endDate.getDate()).toBe(4);
  });

  it('returns a 91-day-later fallback for empty events array', () => {
    const startDate = new Date('2026-06-30T07:00:00');
    const endDate = getAdaptiveEndDate([], startDate, 50);
    // Fallback: 91 days from start, at midnight (exclusive equivalent of the
    // old "90 days later, end of day" inclusive bound).
    const expectedDate = new Date(startDate);
    expectedDate.setDate(expectedDate.getDate() + 91);
    expect(endDate.getFullYear()).toBe(expectedDate.getFullYear());
    expect(endDate.getMonth()).toBe(expectedDate.getMonth());
    expect(endDate.getDate()).toBe(expectedDate.getDate());
    expect(endDate.getHours()).toBe(0);
    expect(endDate.getMinutes()).toBe(0);
  });

  it('filters out events before startDate', () => {
    const startDate = new Date('2026-07-01T07:00:00');
    // Only Day 2 onwards (15 + 20 + 15 = 50 events)
    const endDate = getAdaptiveEndDate(events, startDate, 20);
    // Need 20 events. Jul 1 has 15 events (< 20, not enough).
    // Jul 1 + Jul 2 = 35 events (>= 20, enough).
    // When transitioning to Jul 3, we see accumulated=35 >= 20,
    // and return the midnight after Jul 2 (the last completed day).
    expect(endDate.getMonth()).toBe(6); // July
    expect(endDate.getDate()).toBe(3); // Start of Jul 3
  });
});

describe('getChautauquaSeasonWeeks', () => {
  it('generates 9 weeks for 2026', () => {
    const weeks = getChautauquaSeasonWeeks(2026);
    expect(weeks).toHaveLength(9);
    expect(weeks[0].number).toBe(1);
    expect(weeks[8].number).toBe(9);
  });

  it('each week is 7 days long', () => {
    const weeks = getChautauquaSeasonWeeks(2026);
    weeks.forEach(week => {
      const diff = week.end.getTime() - week.start.getTime();
      expect(diff).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });
});

describe('season weeks in Institution time', () => {
  it('starts week 1 at Saturday noon at Chautauqua, not noon on the device', () => {
    const weeks = getChautauquaSeasonWeeks(2026);
    // 2026's 4th Sunday of June is the 28th; the Saturday before is the 27th.
    // Noon EDT on 2026-06-27 is 16:00Z.
    expect(weeks[0].start.toISOString()).toBe('2026-06-27T16:00:00.000Z');
  });

  it('runs each week exactly seven calendar days, noon to noon', () => {
    const weeks = getChautauquaSeasonWeeks(2026);
    expect(weeks[0].end.toISOString()).toBe('2026-07-04T16:00:00.000Z');
    expect(weeks).toHaveLength(9);
  });

  it('tiles: each week ends where the next begins', () => {
    const weeks = getChautauquaSeasonWeeks(2026);
    for (let i = 1; i < weeks.length; i++) {
      expect(weeks[i].start.getTime()).toBe(weeks[i - 1].end.getTime());
    }
  });

  it('places a boundary Saturday in both adjacent weeks, whole (#257)', () => {
    const weeks = getChautauquaSeasonWeeks(2026);
    // Jul 4 is the week 1/2 boundary. The noon bounds still decide which
    // weeks the DAY intersects, but the whole day belongs to both of them —
    // 11:00 and 13:00 answer identically. This replaced `isInChautauquaWeek`,
    // which split the Saturday at noon (11:00 → week 1 only, 13:00 → week 2
    // only) and so handed back half a day when you filtered to a week.
    expect(weekNumbersForCalendarDate(parseEventDate('2026-07-04 11:00:00'), weeks)).toEqual([1, 2]);
    expect(weekNumbersForCalendarDate(parseEventDate('2026-07-04 13:00:00'), weeks)).toEqual([1, 2]);
  });

  it('places a mid-week day in exactly one week', () => {
    const weeks = getChautauquaSeasonWeeks(2026);
    expect(weekNumbersForCalendarDate(parseEventDate('2026-07-01 11:00:00'), weeks)).toEqual([1]);
  });

  it('places the season edges in the first and last weeks', () => {
    const weeks = getChautauquaSeasonWeeks(2026);
    // The opening Saturday morning precedes `weeks[0].start` and the closing
    // Saturday afternoon follows `weeks[8].end`, but both days are labelled
    // Week 1 and Week 9 by the calendar, and now filter that way too.
    expect(weekNumbersForCalendarDate(parseEventDate('2026-06-27 10:00:00'), weeks)).toEqual([1]);
    expect(weekNumbersForCalendarDate(parseEventDate('2026-08-29 15:00:00'), weeks)).toEqual([9]);
    expect(weekNumbersForCalendarDate(parseEventDate('2026-06-26 10:00:00'), weeks)).toEqual([]);
  });
});
