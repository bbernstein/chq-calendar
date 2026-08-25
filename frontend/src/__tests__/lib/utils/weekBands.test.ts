import { describe, expect, it } from 'vitest';
import { weekBandSegments, weekDayKeySpans } from '@/lib/utils/weekBands';
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
