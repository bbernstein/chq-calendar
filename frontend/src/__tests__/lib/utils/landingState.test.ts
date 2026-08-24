import { describe, it, expect } from 'vitest';
import { determineLandingState } from '@/lib/utils/landingState';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import { chqDateAt } from '@/lib/utils/chqTime';

const opening = (year: number) => getChautauquaSeasonWeeks(year)[0].start;

describe('determineLandingState', () => {
  it('is pre-season before the selected year opens', () => {
    const state = determineLandingState({
      now: chqDateAt(2026, 3, 1, 10),
      selectedYear: 2026,
      availableYears: [2025, 2026, 2027],
      yearHasEvents: true,
    });
    expect(state.kind).toBe('pre-season');
    if (state.kind !== 'pre-season') return;
    expect(state.opening.getTime()).toBe(opening(2026).getTime());
    expect(state.daysUntil).toBeGreaterThan(100);
  });

  it('is post-season once the season has opened and the year has events', () => {
    const state = determineLandingState({
      now: chqDateAt(2026, 9, 15, 10),
      selectedYear: 2026,
      availableYears: [2025, 2026, 2027],
      yearHasEvents: true,
    });
    expect(state).toEqual({
      kind: 'post-season',
      endedSeasonYear: 2026,
      nextSeasonYear: 2027,
      opening: opening(2027),
      daysUntil: expect.any(Number),
    });
  });

  // The opening instant itself is IN season: the comparison is `<`, so a
  // reader refreshing at noon on opening Saturday must not be told the
  // season has not started.
  it('is not pre-season at the exact opening instant', () => {
    const state = determineLandingState({
      now: opening(2026),
      selectedYear: 2026,
      availableYears: [2026],
      yearHasEvents: true,
    });
    expect(state.kind).toBe('post-season');
  });

  // Rule 3. A failed or empty feed fetch during the season must NOT produce
  // "See you next season" for a July visitor — it means "we have no data",
  // which is what the generic EmptyState says.
  it('is in-season when the year has no events at all and the season has opened', () => {
    const state = determineLandingState({
      now: chqDateAt(2026, 7, 15, 10),
      selectedYear: 2026,
      availableYears: [2026],
      yearHasEvents: false,
    });
    expect(state).toEqual({ kind: 'in-season' });
  });

  // An announced-but-empty future year still gets the countdown.
  it('is pre-season for a future year with no events yet', () => {
    const state = determineLandingState({
      now: chqDateAt(2026, 9, 15, 10),
      selectedYear: 2027,
      availableYears: [2026, 2027],
      yearHasEvents: false,
    });
    expect(state.kind).toBe('pre-season');
  });

  it('reports null next-season fields when no later year is available', () => {
    const state = determineLandingState({
      now: chqDateAt(2026, 9, 15, 10),
      selectedYear: 2026,
      availableYears: [2025, 2026],
      yearHasEvents: true,
    });
    expect(state).toEqual({
      kind: 'post-season',
      endedSeasonYear: 2026,
      nextSeasonYear: null,
      opening: null,
      daysUntil: null,
    });
  });

  it('picks the lowest later year from an unsorted availableYears', () => {
    const state = determineLandingState({
      now: chqDateAt(2026, 9, 15, 10),
      selectedYear: 2026,
      availableYears: [2029, 2024, 2027, 2025, 2028],
      yearHasEvents: true,
    });
    expect(state.kind === 'post-season' && state.nextSeasonYear).toBe(2027);
  });

  // Counts calendar dates, not 24-hour buckets. US DST ends 2026-11-01, so
  // a span crossing it contains a 25-hour day, and millisecond division
  // loses that hour.
  it('counts whole calendar days across a DST transition', () => {
    const early = determineLandingState({
      now: chqDateAt(2026, 10, 20, 9),
      selectedYear: 2027,
      availableYears: [2027],
      yearHasEvents: false,
    });
    const late = determineLandingState({
      now: chqDateAt(2026, 10, 20, 23),
      selectedYear: 2027,
      availableYears: [2027],
      yearHasEvents: false,
    });
    expect(early.kind).toBe('pre-season');
    expect(late.kind).toBe('pre-season');
    if (early.kind !== 'pre-season' || late.kind !== 'pre-season') return;
    // Same calendar day, wildly different hour — the day count must not move.
    //
    // This assertion alone does NOT discriminate: falsified against
    // `Math.floor((to - from) / 86400000)`, the naive version reported 248
    // for BOTH hours and passed this line. It is the calendar answer below
    // that catches it. Kept anyway, because it pins a different property
    // (hour-independence) that a future implementation could break on its
    // own — but do not mistake it for the guard.
    expect(late.daysUntil).toBe(early.daysUntil);
    // The calendar answer. 2026-10-20 → 2027-06-26 is 249 days; the span
    // crosses 2026-11-01 (a 25-hour day), so millisecond division loses an
    // hour and floors to 248. Falsified: it does.
    const expected = Math.round(
      (Date.UTC(2027, 5, 26) - Date.UTC(2026, 9, 20)) / 86400000
    );
    expect(early.daysUntil).toBe(expected);
  });
});
