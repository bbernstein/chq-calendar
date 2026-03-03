import { getAdaptiveEndDate, getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
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

  it('returns end-of-day boundary', () => {
    const startDate = new Date('2026-06-30T07:00:00');
    const endDate = getAdaptiveEndDate(events, startDate, 5);
    expect(endDate.getHours()).toBe(23);
    expect(endDate.getMinutes()).toBe(59);
  });

  it('includes enough full days to meet minEvents', () => {
    const startDate = new Date('2026-06-30T07:00:00');
    // Need 20 events. Day 1 has 10, not enough. Day 1+2 = 25, enough.
    // So should return end of Day 1 (since we check AFTER completing day 1 that 10 < 20,
    // then after completing day 2 we have 25 >= 20, return end of day 2)
    const endDate = getAdaptiveEndDate(events, startDate, 20);
    // End date should be end of Jul 1 (Day 2 complete, accumulated 25 >= 20)
    expect(endDate.getMonth()).toBe(6); // July = month 6
    expect(endDate.getDate()).toBe(1);
  });

  it('handles when first day has enough events', () => {
    const startDate = new Date('2026-06-30T07:00:00');
    // minEvents = 5, Day 1 has 10 events.
    // After completing Day 1, accumulated=10 >= 5, return end of Day 1
    const endDate = getAdaptiveEndDate(events, startDate, 5);
    expect(endDate.getMonth()).toBe(5); // June = month 5
    expect(endDate.getDate()).toBe(30);
  });

  it('returns last event day if not enough events exist', () => {
    const startDate = new Date('2026-06-30T07:00:00');
    const endDate = getAdaptiveEndDate(events, startDate, 1000);
    // Should return end of last event's day (Jul 3)
    expect(endDate.getMonth()).toBe(6);
    expect(endDate.getDate()).toBe(3);
  });

  it('returns 90-day fallback for empty events array', () => {
    const startDate = new Date('2026-06-30T07:00:00');
    const endDate = getAdaptiveEndDate([], startDate, 50);
    const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(90);
  });

  it('filters out events before startDate', () => {
    const startDate = new Date('2026-07-01T07:00:00');
    // Only Day 2 onwards (15 + 20 + 15 = 50 events)
    const endDate = getAdaptiveEndDate(events, startDate, 20);
    // Need 20 events. Jul 1 has 15 events (< 20, not enough).
    // Jul 1 + Jul 2 = 35 events (>= 20, enough).
    // When transitioning to Jul 3, we see accumulated=35 >= 20,
    // and return end of Jul 2 (the last completed day).
    expect(endDate.getMonth()).toBe(6); // July
    expect(endDate.getDate()).toBe(2); // End of Jul 2
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
