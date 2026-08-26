import { getChautauquaSeasonWeeks, weekNumbersForCalendarDate } from '@/lib/utils/dateHelpers';
import { parseEventDate } from '@/lib/utils/chqTime';

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
