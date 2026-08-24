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
import {
  getChautauquaSeasonWeeks,
  getCurrentWeekNumber,
  weekNumbersForCalendarDate,
} from '@/lib/utils/dateHelpers';
import { parseEventDate } from '@/lib/utils/chqTime';
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

// Post-refactor deltas: unlike every describe block above, this one pins
// behavior the ViewWindow refactor deliberately CHANGED, not behavior it
// preserved. Before the refactor, `dateFilter: 'all'` ran no date predicate
// at all, so an event with an unparseable `startDate` reached
// `groupEventsByDay` and rendered as an "Invalid Date" section. Now `'all'`
// is a real ViewWindow (MIN_INSTANT..MAX_INSTANT) checked via
// `windowContains`, and `new Date('garbage')` is `Invalid Date` — every
// comparison against `NaN` is false, so the row is dropped. This is called
// out in the PR description; this test exists so a future change to the
// parsing path can't silently reintroduce the "Invalid Date" row.
describe('filterEvents date stage — post-refactor deltas', () => {
  it("dateFilter: 'all' drops an event with an unparseable startDate", () => {
    const events = [
      makeEvent('good', new Date(2026, 6, 15, 9, 0)),
      { id: 'bad', title: 'Event bad', startDate: 'garbage' } as Event,
    ];
    const result = filterEvents(events, baseOptions({ dateFilter: 'all' }));
    expect(result.map((e) => e.id)).toEqual(['good']);
  });
});

// #257: the week filter is day-granular, matching the `Wk 5/6` badge the day
// headers already render. A boundary Saturday belongs to BOTH adjacent weeks
// in full — the noon split that used to hand back half of it is gone. Weeks
// are therefore no longer a partition: they overlap by one calendar day.
describe('filterEvents week stage — day-granular boundary Saturdays (#257)', () => {
  // Anchor the fixtures to the real 2026 bounds rather than trusting the
  // dates below: week 5 runs Sat Jul 25 noon → Sat Aug 1 noon, week 6 Aug 1
  // noon → Aug 8 noon, so Aug 1 is the week 5/6 boundary Saturday.
  it('has the 2026 season bounds these fixtures assume', () => {
    expect(seasonWeeks[4].start).toEqual(new Date(2026, 6, 25, 12, 0));
    expect(seasonWeeks[5].start).toEqual(new Date(2026, 7, 1, 12, 0));
    expect(seasonWeeks[0].start).toEqual(new Date(2026, 5, 27, 12, 0));
    expect(seasonWeeks[8].end).toEqual(new Date(2026, 7, 29, 12, 0));
  });

  const weekOf = (id: string, at: Date, week: number) =>
    filterEvents([makeEvent(id, at)], baseOptions({ dateFilter: 'all', selectedWeeks: [week] }))
      .map((e) => e.id);

  it('puts a boundary Saturday morning in both adjacent weeks', () => {
    const morning = new Date(2026, 7, 1, 10, 0);
    expect(weekOf('sat-am', morning, 5)).toEqual(['sat-am']);
    expect(weekOf('sat-am', morning, 6)).toEqual(['sat-am']);
  });

  it('puts a boundary Saturday afternoon in both adjacent weeks', () => {
    const afternoon = new Date(2026, 7, 1, 15, 0);
    expect(weekOf('sat-pm', afternoon, 5)).toEqual(['sat-pm']);
    expect(weekOf('sat-pm', afternoon, 6)).toEqual(['sat-pm']);
  });

  it("matches week 1 for the opening Saturday's morning", () => {
    // Before noon on Jun 27 sits before `weeks[0].start`, so the old noon
    // predicate put it in no week at all — on a day the app labels Week 1.
    expect(weekOf('opening-am', new Date(2026, 5, 27, 10, 0), 1)).toEqual(['opening-am']);
  });

  it("matches week 9 for the closing Saturday's afternoon", () => {
    expect(weekOf('closing-pm', new Date(2026, 7, 29, 15, 0), 9)).toEqual(['closing-pm']);
  });

  it('still puts a mid-week event in exactly one week', () => {
    const wednesday = new Date(2026, 6, 29, 10, 0);
    expect(weekOf('midweek', wednesday, 5)).toEqual(['midweek']);
    expect(weekOf('midweek', wednesday, 4)).toEqual([]);
    expect(weekOf('midweek', wednesday, 6)).toEqual([]);
  });

  it('returns the union once, not twice, when both adjacent weeks are picked', () => {
    const events = [
      makeEvent('fri-wk5', new Date(2026, 6, 31, 10, 0)),
      makeEvent('sat-boundary', new Date(2026, 7, 1, 10, 0)),
      makeEvent('sun-wk6', new Date(2026, 7, 2, 10, 0)),
    ];
    const result = filterEvents(events, baseOptions({ dateFilter: 'all', selectedWeeks: [5, 6] }));
    expect(result.map((e) => e.id)).toEqual(['fri-wk5', 'sat-boundary', 'sun-wk6']);
  });

  // The filter derives each selected week's day-granular instant range once
  // (`calendarDaySpanOfWeek`) instead of deriving every event's week numbers
  // (`weekNumbersForCalendarDate`), for ~7 fewer Intl round-trips per event.
  // That is only sound while the two agree EXACTLY, so walk the whole season
  // — every hour of every day from a week before it opens to a week after it
  // closes — and require the filter to return precisely the events the
  // badge's own rule says belong to each week. Any drift between the fast
  // path and the display rule reintroduces #257's two-models bug.
  it('agrees with weekNumbersForCalendarDate for every hour of the season', () => {
    const probes: Event[] = [];
    const cursor = new Date(2026, 5, 20, 0, 0);
    const stop = new Date(2026, 8, 5, 0, 0);
    while (cursor < stop) {
      probes.push(makeEvent(`p-${cursor.getTime()}`, new Date(cursor)));
      cursor.setHours(cursor.getHours() + 1);
    }
    expect(probes.length).toBeGreaterThan(1800);

    for (let week = 1; week <= 9; week++) {
      const expected = probes
        .filter((e) =>
          weekNumbersForCalendarDate(parseEventDate(e.startDate), seasonWeeks).includes(week)
        )
        .map((e) => e.id);
      const actual = filterEvents(
        probes,
        baseOptions({ dateFilter: 'all', selectedWeeks: [week] })
      ).map((e) => e.id);

      expect(actual, `week ${week}`).toEqual(expected);
      // Eight calendar days of 24 hourly probes — a week is 7 days but
      // touches 8, which is the whole point of #257.
      expect(expected.length, `week ${week} span`).toBe(8 * 24);
    }
  });

  it('ignores a selected week number the season does not have', () => {
    // The pre-#257 predicate indexed `seasonWeeks[n - 1]` unguarded and threw
    // on `undefined.start`. Nothing in the UI can select week 12, but a
    // corrupt localStorage payload reaches this code directly.
    const events = [makeEvent('midweek', new Date(2026, 6, 29, 10, 0))];
    expect(
      filterEvents(events, baseOptions({ dateFilter: 'all', selectedWeeks: [12] })).map((e) => e.id)
    ).toEqual([]);
    expect(
      filterEvents(events, baseOptions({ dateFilter: 'all', selectedWeeks: [5, 12] })).map((e) => e.id)
    ).toEqual(['midweek']);
  });

  it('matches no week for an out-of-season event', () => {
    const september = new Date(2026, 8, 15, 10, 0);
    expect(weekOf('off-season', september, 9)).toEqual([]);
    expect(
      filterEvents([makeEvent('off-season', september)],
        baseOptions({ dateFilter: 'all', selectedWeeks: [1, 2, 3, 4, 5, 6, 7, 8, 9] }))
    ).toEqual([]);
  });
});
