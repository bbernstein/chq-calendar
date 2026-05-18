/// <reference types="vitest/globals" />
import { groupEventsByDay } from '@/lib/utils/eventHelpers';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import type { Event } from '@/lib/types';

const seasonWeeks = getChautauquaSeasonWeeks(2026);

function evt(id: string, startDate: string, title = `Event ${id}`): Event {
  return {
    id,
    title,
    startDate,
    endDate: startDate,
  };
}

describe('groupEventsByDay — week-number metadata on day headers', () => {
  it('exposes baseLabel and weekNumbers separately (no embedded "Week N" in baseLabel)', () => {
    const groups = groupEventsByDay([
      evt('1', '2026-07-06T14:00:00'),
    ], seasonWeeks);

    expect(groups).toHaveLength(1);
    expect(groups[0].baseLabel).toBe('Monday, July 6, 2026');
    expect(groups[0].weekNumbers).toEqual([2]);
  });

  it('consolidates all events on the same Saturday into one day group with both adjacent week numbers', () => {
    // Sat July 4, 2026 — Week 1 ends Sat noon, Week 2 starts Sat noon.
    const groups = groupEventsByDay([
      evt('morning', '2026-07-04T09:00:00'),  // belongs to week 1
      evt('afternoon', '2026-07-04T14:00:00'), // belongs to week 2
    ], seasonWeeks);

    expect(groups).toHaveLength(1);
    expect(groups[0].baseLabel).toBe('Saturday, July 4, 2026');
    expect(groups[0].weekNumbers).toEqual([1, 2]);
    expect(groups[0].events.map(e => e.id)).toEqual(['morning', 'afternoon']);
  });

  it('returns an empty weekNumbers array for events outside the season', () => {
    const groups = groupEventsByDay([
      evt('off-season', '2026-05-01T10:00:00'),
    ], seasonWeeks);

    expect(groups).toHaveLength(1);
    expect(groups[0].baseLabel).toBe('Friday, May 1, 2026');
    expect(groups[0].weekNumbers).toEqual([]);
  });

  it('keeps events sorted by start time within each day', () => {
    const groups = groupEventsByDay([
      evt('late', '2026-07-06T19:00:00'),
      evt('early', '2026-07-06T09:00:00'),
      evt('mid', '2026-07-06T13:00:00'),
    ], seasonWeeks);

    expect(groups[0].events.map(e => e.id)).toEqual(['early', 'mid', 'late']);
  });

  it('returns day groups sorted by date', () => {
    const groups = groupEventsByDay([
      evt('mon', '2026-07-06T10:00:00'),
      evt('sun', '2026-07-05T10:00:00'),
    ], seasonWeeks);

    expect(groups.map(g => g.baseLabel)).toEqual([
      'Sunday, July 5, 2026',
      'Monday, July 6, 2026',
    ]);
  });
});
