import { describe, expect, it } from 'vitest';
import { bridgesGutter, weekBandDestinations, weekBandSegments, weekBandUnreachableLabel, weekDayKeySpans, type WeekBandSegment } from '@/lib/utils/weekBands';
import { getChautauquaSeasonWeeks, weekNumbersForCalendarDate } from '@/lib/utils/dateHelpers';
import { dayKeys, startOfDay } from '@/lib/utils/dayWindow';

const weeks = getChautauquaSeasonWeeks(2026);
const segments = (keys: string[]) => weekBandSegments(keys, weeks);

describe('weekBandSegments — membership', () => {
  it('puts a boundary Saturday in both of its weeks', () => {
    expect(segments(['2026-07-04'])[0].weekNumbers).toEqual([1, 2]);
  });

  it('puts a midweek day in one week', () => {
    expect(segments(['2026-06-30'])[0].weekNumbers).toEqual([1]);
  });

  it('puts the opening Saturday in week 1 alone', () => {
    // No previous week to share with.
    expect(segments(['2026-06-27'])[0].weekNumbers).toEqual([1]);
  });

  it("puts the season's final Saturday in week 9 alone", () => {
    // No week 10 to share with — the mirror image of week 1's opening
    // Saturday above. A future "first/last day" special case in the
    // membership walk could pass every other test here and still get this
    // one boundary wrong in either direction.
    expect(segments(['2026-08-29'])[0].weekNumbers).toEqual([9]);
    expect(segments(['2026-08-29'])[0].navigationTarget).toBe(9);
  });

  it('gives an out-of-season day no week at all', () => {
    const s = segments(['2026-01-15'])[0];
    expect(s.weekNumbers).toEqual([]);
    expect(s.navigationTarget).toBeNull();
    expect(s.labelledWeek).toBeNull();
  });

  // The guard that makes the day-key comparison a checked claim rather than a
  // second, faster model that happens to agree today.
  it('agrees with weekNumbersForCalendarDate across the whole navigable range', () => {
    const keys = dayKeys('2026-06-01', '2026-09-30');
    for (const s of weekBandSegments(keys, weeks)) {
      expect(s.weekNumbers).toEqual(weekNumbersForCalendarDate(startOfDay(s.dayKey), weeks));
    }
  });
});

describe('weekBandSegments — tap targets', () => {
  it('makes a shared Saturday no tap target', () => {
    // Ambiguous by construction: it opens one week and closes another, so a
    // tap on it cannot mean one week. The six non-shared days carry the
    // week's navigation instead.
    expect(segments(['2026-07-04'])[0].navigationTarget).toBeNull();
  });

  it('sends a non-shared day to its own week', () => {
    expect(segments(['2026-06-30'])[0].navigationTarget).toBe(1);
  });

  it("makes week 1's opening Saturday a tap target", () => {
    // Shared with nothing, so unlike every other Saturday it is unambiguous.
    expect(segments(['2026-06-27'])[0].navigationTarget).toBe(1);
  });
});

describe('weekBandSegments — the WEEK n label', () => {
  it('gives exactly one day per week the label', () => {
    const result = segments(dayKeys('2026-06-27', '2026-07-11'));
    expect(result.filter(s => s.labelledWeek === 1)).toHaveLength(1);
    expect(result.filter(s => s.labelledWeek === 2)).toHaveLength(1);
  });

  it('never lands the label on a shared Saturday', () => {
    for (const s of segments(dayKeys('2026-06-27', '2026-08-29'))) {
      if (s.labelledWeek !== null) expect(s.weekNumbers).toHaveLength(1);
    }
  });

  it('follows the visible run when a week is clipped by the rail', () => {
    // The rail spans navigableBounds, which can start mid-week. The label
    // must land inside what is actually rendered, not at a fixed offset from
    // a week start that may be off screen. Pinned away from both ends so a
    // naive "always index 0" or "always last" is caught.
    const keys = dayKeys('2026-07-01', '2026-07-03');
    const labelled = weekBandSegments(keys, weeks).filter(s => s.labelledWeek === 1);
    expect(labelled).toHaveLength(1);
    expect(labelled[0].dayKey).toBe('2026-07-02');
  });
});

describe('weekBandSegments — the ramp', () => {
  it('runs 0 to 1 across the season', () => {
    expect(segments(['2026-06-29'])[0].rampSteps).toEqual([0]);   // week 1
    expect(segments(['2026-08-24'])[0].rampSteps).toEqual([1]);   // week 9
  });

  it('gives a shared Saturday both weeks steps, ascending', () => {
    const steps = segments(['2026-07-04'])[0].rampSteps;
    expect(steps).toHaveLength(2);
    expect(steps[0]).toBeLessThan(steps[1]);
  });
});

describe('weekDayKeySpans', () => {
  it('spans each week from the Saturday it opens through the Saturday it closes', () => {
    const spans = weekDayKeySpans(weeks);
    expect(spans).toHaveLength(9);
    expect(spans[0]).toEqual({ number: 1, opening: '2026-06-27', closing: '2026-07-04' });
    expect(spans[8]).toEqual({ number: 9, opening: '2026-08-22', closing: '2026-08-29' });
  });
});

// 2026: week 5 opens Sat 07-25 and closes Sat 08-01, which it shares with
// week 6.
const SEASON_BOUNDS = { startDay: '2026-06-01', endDay: '2026-09-30' };

function destinations(
  eventDays: string[],
  counts: Record<string, number> = {},
  bounds = SEASON_BOUNDS,
) {
  return weekBandDestinations({
    seasonWeeks: weeks, eventDays, bounds,
    countsByDay: new Map(Object.entries(counts)),
  });
}

describe('weekBandDestinations — which day a week tap lands on', () => {
  it('takes the opening Saturday when it has events', () => {
    expect(destinations(['2026-07-25', '2026-07-28']).get(5)?.dayKey).toBe('2026-07-25');
  });

  it("falls back to the week's first day with events when the opening Saturday is empty", () => {
    // The rail never announces a destination it cannot reach.
    expect(destinations(['2026-07-28', '2026-07-30']).get(5)?.dayKey).toBe('2026-07-28');
  });

  it("takes the week's earliest day, not the list's first", () => {
    // `eventDays` spans the whole rail, not one week, and is sorted ascending
    // — which is what lets the fallback stop at the first match. What it must
    // not do is stop at the first element: 07-20 is in week 4.
    expect(destinations(['2026-07-20', '2026-07-28', '2026-07-30']).get(5)?.dayKey)
      .toBe('2026-07-28');
  });

  it('leaves a week with nothing reachable out of the map', () => {
    // Absent is the signal the band is DISABLED. Days on either side of week
    // 5, none inside it.
    expect(destinations(['2026-07-20', '2026-08-05']).has(5)).toBe(false);
  });

  it('counts a shared Saturday for both of its weeks', () => {
    const result = destinations(['2026-08-01']);
    expect(result.get(5)?.dayKey).toBe('2026-08-01');
    expect(result.get(6)?.dayKey).toBe('2026-08-01');
  });

  it('refuses a day outside the rail\'s own bounds', () => {
    // `railTarget` refuses a day past `navigableBounds`, so a target outside
    // them would be announced and then declined.
    const clamped = { startDay: '2026-07-28', endDay: '2026-09-30' };
    expect(destinations(['2026-07-25', '2026-07-29'], {}, clamped).get(5)?.dayKey)
      .toBe('2026-07-29');
  });

  it('leaves a week entirely outside the bounds unreachable', () => {
    const clamped = { startDay: '2026-08-10', endDay: '2026-09-30' };
    expect(destinations(['2026-07-25'], {}, clamped).has(5)).toBe(false);
  });
});

describe('weekBandDestinations — what it is named', () => {
  it('says the opening Saturday opens the week', () => {
    expect(destinations(['2026-07-25'], { '2026-07-25': 84 }).get(5)?.label)
      .toBe('Go to Week 5, opens Saturday, July 25, 84 events');
  });

  it('does not claim a fallback day opens the week', () => {
    // Saying "opens" here would be a small lie about where the reader is put
    // down.
    expect(destinations(['2026-07-28'], { '2026-07-28': 1 }).get(5)?.label)
      .toBe('Go to Week 5, first events Tuesday, July 28, 1 event');
  });

  it('states an unreachable week as a fact rather than offering it', () => {
    // Mirrors an empty day chip ("Monday, July 6, no events"), which also
    // never says "Go to".
    expect(weekBandUnreachableLabel(6)).toBe('Week 6, no events');
  });

  it('never names a week by direction', () => {
    const result = destinations(['2026-07-25', '2026-08-10'], { '2026-07-25': 3 });
    for (const d of result.values()) {
      expect(d.label).not.toMatch(/\bnext\b|\bprevious\b|\bforward\b|\bback\b/i);
    }
  });
});

const bridges = (keys: string[]) => {
  const all = segments(keys);
  return Array.from({ length: Math.max(all.length - 1, 0) }, (_, i) => bridgesGutter(i, all));
};

describe('bridgesGutter', () => {
  it('bridges every gutter inside a week', () => {
    // Sun through Fri of week 2 — six days, five gutters, none a boundary. If
    // any came back false the week would be drawn in pieces and the boundary
    // would stop being the only break.
    expect(bridges(['2026-07-05', '2026-07-06', '2026-07-07',
                    '2026-07-08', '2026-07-09', '2026-07-10']))
      .toEqual([true, true, true, true, true]);
  });

  it('bridges both ways across a boundary Saturday', () => {
    // Sat Jul 4 closes week 1 and opens week 2, so it joins the run on each
    // side and the break goes *through* it rather than beside it.
    expect(bridges(['2026-07-03', '2026-07-04', '2026-07-05'])).toEqual([true, true]);
  });

  it("ends a run at the season's edge", () => {
    // Thu/Fri before the season, then the opening Saturday. Nothing to share,
    // so the run starts flush with week 1's first chip.
    expect(bridges(['2026-06-25', '2026-06-26', '2026-06-27', '2026-06-28']))
      .toEqual([false, false, true]);
  });

  it('never bridges two out-of-season days', () => {
    expect(bridges(['2026-01-15', '2026-01-16'])).toEqual([false]);
  });

  it('has no gutter to bridge at the ends of the array', () => {
    const all = segments(['2026-07-06', '2026-07-07']);
    expect(bridgesGutter(-1, all)).toBe(false);
    expect(bridgesGutter(1, all)).toBe(false);
    expect(bridgesGutter(5, all)).toBe(false);
  });
});

// Hand-built segments, isolated from `weekBandSegments`, pinning the exact
// case a `[0] === [0]` comparison would get wrong.
describe('bridgesGutter — two-entry sets', () => {
  const segment = (dayKey: string, weekNumbers: number[]): WeekBandSegment => ({
    dayKey, weekNumbers, rampSteps: weekNumbers.map(n => n),
    navigationTarget: null, labelledWeek: null,
  });

  it("bridges on a shared Saturday's SECOND week number", () => {
    // Left is the boundary Saturday, [5, 6]; right is plain week 6. Comparing
    // first-to-first compares 5 to 6 and misses the match in the second slot.
    expect(bridgesGutter(0, [segment('2026-08-01', [5, 6]), segment('2026-08-02', [6])]))
      .toBe(true);
  });

  it("bridges on a shared Saturday's FIRST week number on the other side", () => {
    expect(bridgesGutter(0, [segment('2026-07-31', [5]), segment('2026-08-01', [5, 6])]))
      .toBe(true);
  });

  it('never bridges disjoint sets, even with two entries each', () => {
    expect(bridgesGutter(0, [segment('2026-08-01', [5, 6]), segment('2026-08-08', [7, 8])]))
      .toBe(false);
  });
});
