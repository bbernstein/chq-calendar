import { landingDayKey } from '@/lib/utils/landingDay';

const DAYS = ['2026-01-03', '2026-06-27', '2026-07-04', '2026-08-29'];

test('the current year lands on today when today has events', () => {
  expect(landingDayKey({
    now: new Date('2026-07-04T14:00:00Z'), isCurrentYear: true,
    eventDays: DAYS, seasonStartDay: '2026-06-27',
  })).toBe('2026-07-04');
});

test('the current year lands on the next day with events when today has none', () => {
  expect(landingDayKey({
    now: new Date('2026-06-30T14:00:00Z'), isCurrentYear: true,
    eventDays: DAYS, seasonStartDay: '2026-06-27',
  })).toBe('2026-07-04');
});

test('past the last event day, the current year lands on the last day rather than nowhere', () => {
  expect(landingDayKey({
    now: new Date('2026-09-20T14:00:00Z'), isCurrentYear: true,
    eventDays: DAYS, seasonStartDay: '2026-06-27',
  })).toBe('2026-08-29');
});

test('an archived year lands at the season start, not at January', () => {
  expect(landingDayKey({
    now: new Date('2026-07-04T14:00:00Z'), isCurrentYear: false,
    eventDays: DAYS, seasonStartDay: '2026-06-27',
  })).toBe('2026-06-27');
});

test('an archived year whose first event is after the season start lands on that event', () => {
  expect(landingDayKey({
    now: new Date('2026-07-04T14:00:00Z'), isCurrentYear: false,
    eventDays: ['2026-01-03', '2026-07-04'], seasonStartDay: '2026-06-27',
  })).toBe('2026-07-04');
});

test('a year with no events lands nowhere', () => {
  expect(landingDayKey({
    now: new Date('2026-07-04T14:00:00Z'), isCurrentYear: true,
    eventDays: [], seasonStartDay: '2026-06-27',
  })).toBeNull();
});
