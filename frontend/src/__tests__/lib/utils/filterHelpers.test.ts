// Characterization tests: these pin what filterEvents' DATE stage does
// TODAY, before the ViewWindow refactor replaces four scope-specific
// predicates with one range check.
//
// They are the safety net for that refactor. Do NOT edit them to make a
// later change pass — if one of these goes red, the refactor is wrong, not
// the test. Written first because filterEvents had no direct coverage at
// all.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { filterEvents, type FilterOptions } from '@/lib/utils/filterHelpers';
import { getChautauquaSeasonWeeks, getCurrentWeekNumber } from '@/lib/utils/dateHelpers';
import { navigableBounds, viewWindow } from '@/lib/utils/dayWindow';
import type { Event } from '@/lib/types';

// Fixed reference instant: Wednesday 2026-07-15, 15:00 local. Mid-season,
// mid-week, mid-afternoon — so "one hour ago" stays on the same calendar
// day and the week boundaries sit clear of it in both directions.
const NOW = new Date(2026, 6, 15, 15, 0, 0, 0);

function makeEvent(id: string, date: Date): Event {
  return {
    id,
    title: `Event ${id}`,
    startDate: date.toISOString(),
  } as Event;
}

const seasonWeeks = getChautauquaSeasonWeeks(2026);

function baseOptions(overrides: {
  dateFilter?: 'all' | 'today' | 'next' | 'this-week';
  selectedWeeks?: number[];
  seasonWeeks?: typeof seasonWeeks;
  currentWeekNumber?: number | null;
  adaptiveEndDate?: Date;
  searchTerm?: string;
}): FilterOptions {
  const weeks = overrides.seasonWeeks ?? seasonWeeks;
  const currentWeekNumber =
    overrides.currentWeekNumber !== undefined
      ? overrides.currentWeekNumber
      : getCurrentWeekNumber(weeks);
  return {
    searchTerm: overrides.searchTerm ?? '',
    selectedWeeks: overrides.selectedWeeks ?? [],
    selectedTagsLowerSet: new Set<string>(),
    selectedLocationsLowerSet: new Set<string>(),
    seasonWeeks: weeks,
    viewWindow: viewWindow({
      dateFilter: overrides.dateFilter ?? 'all',
      seasonWeeks: weeks,
      currentWeekNumber,
      now: new Date(),
      adaptiveEndDate: overrides.adaptiveEndDate,
      bounds: navigableBounds(weeks, []),
    }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('filterEvents date stage — characterization', () => {
  describe("dateFilter: 'all'", () => {
    it('filters nothing by date, including events years away', () => {
      const events = [
        makeEvent('past', new Date(2020, 0, 1, 9, 0)),
        makeEvent('today', new Date(2026, 6, 15, 9, 0)),
        makeEvent('future', new Date(2030, 0, 1, 9, 0)),
      ];
      const result = filterEvents(events, baseOptions({ dateFilter: 'all' }));
      expect(result.map((e) => e.id)).toEqual(['past', 'today', 'future']);
    });
  });

  describe("dateFilter: 'today'", () => {
    it('keeps only events on the current calendar day', () => {
      const events = [
        makeEvent('yesterday-2359', new Date(2026, 6, 14, 23, 59)),
        makeEvent('today-0000', new Date(2026, 6, 15, 0, 0)),
        makeEvent('today-2359', new Date(2026, 6, 15, 23, 59)),
        makeEvent('tomorrow-0000', new Date(2026, 6, 16, 0, 0)),
      ];
      const result = filterEvents(events, baseOptions({ dateFilter: 'today' }));
      expect(result.map((e) => e.id)).toEqual(['today-0000', 'today-2359']);
    });

    it('keeps an event earlier today that has already finished', () => {
      // 'today' is a whole-day filter, NOT a from-now filter. This is the
      // distinction that separates it from 'next'.
      const events = [makeEvent('this-morning', new Date(2026, 6, 15, 8, 0))];
      const result = filterEvents(events, baseOptions({ dateFilter: 'today' }));
      expect(result.map((e) => e.id)).toEqual(['this-morning']);
    });
  });

  describe("dateFilter: 'next'", () => {
    it('includes an event that started within the last hour', () => {
      const events = [makeEvent('started-30m-ago', new Date(2026, 6, 15, 14, 30))];
      const result = filterEvents(
        events,
        baseOptions({
          dateFilter: 'next',
          adaptiveEndDate: new Date(2026, 6, 17, 23, 59, 59, 999),
        })
      );
      expect(result.map((e) => e.id)).toEqual(['started-30m-ago']);
    });

    it('excludes an event that started more than an hour ago', () => {
      const events = [makeEvent('started-90m-ago', new Date(2026, 6, 15, 13, 30))];
      const result = filterEvents(
        events,
        baseOptions({
          dateFilter: 'next',
          adaptiveEndDate: new Date(2026, 6, 17, 23, 59, 59, 999),
        })
      );
      expect(result).toEqual([]);
    });

    it('excludes an event after adaptiveEndDate', () => {
      const events = [
        makeEvent('inside', new Date(2026, 6, 17, 20, 0)),
        makeEvent('outside', new Date(2026, 6, 18, 9, 0)),
      ];
      const result = filterEvents(
        events,
        baseOptions({
          dateFilter: 'next',
          adaptiveEndDate: new Date(2026, 6, 17, 23, 59, 59, 999),
        })
      );
      expect(result.map((e) => e.id)).toEqual(['inside']);
    });

    it('falls back to a six-day end-of-day window when adaptiveEndDate is absent', () => {
      const events = [
        makeEvent('day-6', new Date(2026, 6, 21, 23, 0)),
        makeEvent('day-7', new Date(2026, 6, 22, 9, 0)),
      ];
      const result = filterEvents(events, baseOptions({ dateFilter: 'next' }));
      expect(result.map((e) => e.id)).toEqual(['day-6']);
    });
  });

  describe("dateFilter: 'this-week'", () => {
    it('uses noon-Saturday boundaries, not calendar-week ones', () => {
      const current = getCurrentWeekNumber(seasonWeeks);
      expect(current, 'NOW must fall inside the 2026 season').not.toBeNull();
      const week = seasonWeeks[current! - 1];

      const events = [
        makeEvent('one-ms-before-start', new Date(week.start.getTime() - 1)),
        makeEvent('exactly-at-start', new Date(week.start.getTime())),
        makeEvent('one-ms-before-end', new Date(week.end.getTime() - 1)),
        makeEvent('exactly-at-end', new Date(week.end.getTime())),
      ];
      const result = filterEvents(events, baseOptions({ dateFilter: 'this-week' }));
      // Start is inclusive, end is exclusive. The boundary Saturday
      // therefore belongs to two weeks, which is why the season cannot be
      // paged into disjoint weeks.
      expect(result.map((e) => e.id)).toEqual(['exactly-at-start', 'one-ms-before-end']);
    });

    it('returns nothing when NOW is outside the season', () => {
      vi.setSystemTime(new Date(2026, 11, 25, 12, 0));
      const offSeasonWeeks = getChautauquaSeasonWeeks(2026);
      const events = [makeEvent('anything', new Date(2026, 11, 25, 12, 0))];
      const result = filterEvents(
        events,
        baseOptions({
          dateFilter: 'this-week',
          seasonWeeks: offSeasonWeeks,
          currentWeekNumber: getCurrentWeekNumber(offSeasonWeeks),
        })
      );
      expect(result).toEqual([]);
    });
  });

  describe('the weeks stage is independent of the date stage', () => {
    it('ANDs a week selection with the date filter', () => {
      // This is the behavior the ViewWindow refactor must NOT change in
      // phase 1: scope and weeks are two separate AND-ed stages today.
      // Mutual exclusion arrives in phase 3.
      const week1 = seasonWeeks[0];
      const inWeek1 = new Date(week1.start.getTime() + 60 * 60 * 1000);
      const events = [makeEvent('week1-not-today', inWeek1)];

      const weekOnly = filterEvents(
        events,
        baseOptions({ dateFilter: 'all', selectedWeeks: [1] })
      );
      expect(weekOnly.map((e) => e.id)).toEqual(['week1-not-today']);

      const weekAndToday = filterEvents(
        events,
        baseOptions({ dateFilter: 'today', selectedWeeks: [1] })
      );
      expect(weekAndToday).toEqual([]);
    });
  });
});
