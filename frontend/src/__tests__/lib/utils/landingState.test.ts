import { describe, it, expect } from 'vitest';
import { determineLandingState } from '@/lib/utils/landingState';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import { chqDateAt } from '@/lib/utils/chqTime';

const opening = (year: number) => getChautauquaSeasonWeeks(year)[0].start;

describe('determineLandingState', () => {
  // Rule 2 in isolation: no upcoming events, so rule 1 does not preempt it.
  // (A year bucket that is non-empty but has nothing left ahead of `now` is
  // an artificial input for a pure-function test — real production data
  // can't produce "has events, before this year's season start, none of them
  // upcoming" — but it isolates rule 2's own `now < start` boundary from
  // rule 1's short-circuit.)
  it('is pre-season before the selected year opens', () => {
    const state = determineLandingState({
      now: chqDateAt(2026, 3, 1, 10),
      selectedYear: 2026,
      availableYears: [2025, 2026, 2027],
      yearHasEvents: true,
      yearHasUpcomingEvents: false,
    });
    expect(state.kind).toBe('pre-season');
    if (state.kind !== 'pre-season') return;
    expect(state.opening.getTime()).toBe(opening(2026).getTime());
    expect(state.daysUntil).toBeGreaterThan(100);
  });

  // Rule 1, the fix for Critical 1 (2026-08-26 review round 1): a year's
  // programme can be published — real, upcoming events loaded — before its
  // own season calendar has started. A calendar-only rule ("now < start ->
  // pre-season") sends this reader to the pre-season landing, which offers
  // no buttons at all (`OffSeasonLandingView`/`OffSeasonLanding.tsx` gate the
  // whole button row on `kind === 'post-season'`) and hides a non-empty list
  // with no escape except typing a search term. Rule 1 asks the events
  // directly instead, ahead of the calendar check, so this resolves to
  // `in-season` and the reader gets the list.
  it("is in-season, not pre-season, once a future season's programme is already published", () => {
    const state = determineLandingState({
      now: chqDateAt(2027, 3, 1, 10),
      selectedYear: 2027,
      availableYears: [2026, 2027],
      yearHasEvents: true,
      yearHasUpcomingEvents: true,
    });
    expect(state).toEqual({ kind: 'in-season' });
  });

  it('is post-season once the season has opened and the year has events', () => {
    const state = determineLandingState({
      now: chqDateAt(2026, 9, 15, 10),
      selectedYear: 2026,
      availableYears: [2025, 2026, 2027],
      yearHasEvents: true,
      yearHasUpcomingEvents: false,
    });
    expect(state).toEqual({
      kind: 'post-season',
      endedSeasonYear: 2026,
      nextSeasonYear: 2027,
      opening: opening(2027),
      daysUntil: expect.any(Number),
    });
  });

  // Rule 1, the fix for Critical 2 (2026-08-26 review round 1): the live
  // production 2026 feed's last event lands 2026-09-10, ten days past
  // `getChautauquaSeasonWeeks(2026)`'s fixed nine-week close (2026-08-29
  // noon). A calendar-only rule ("now < seasonEnd -> in-season, else
  // post-season") sends a Sep 1 visitor to the post-season landing —
  // "See you next season" — while a real event nine days out sits in the
  // app's own data, and `browseArchiveSeason`'s `.season` scope ends at the
  // calendar close too, so no button on the landing reaches it either. This
  // is the actual mechanism of #269's Sep 1-10 shoulder. Rule 1 fixes it the
  // same way as the March case above: ask the events, not the calendar.
  it("is in-season, not post-season, when the live season's last events run past the nine-week calendar close", () => {
    const state = determineLandingState({
      now: chqDateAt(2026, 9, 1, 10),
      selectedYear: 2026,
      availableYears: [2025, 2026, 2027],
      yearHasEvents: true,
      yearHasUpcomingEvents: true,
    });
    expect(state).toEqual({ kind: 'in-season' });
  });

  // Rule 2's own strict `<` boundary, isolated from rule 1 by construction
  // (no upcoming events — see the comment on the first test above): the
  // opening instant itself already fails `now < start`, so with the year
  // reporting events but none upcoming this falls through to rule 4, not
  // rule 2 — `post-season`, not `pre-season`. A real published season would
  // instead have its own events upcoming at this exact instant and resolve
  // via rule 1 (see the "already published" test above), so this is a
  // deliberately artificial boundary probe of rule 2 alone.
  it('the exact opening instant is not pre-season, even with no upcoming events', () => {
    const state = determineLandingState({
      now: opening(2026),
      selectedYear: 2026,
      availableYears: [2026],
      yearHasEvents: true,
      yearHasUpcomingEvents: false,
    });
    expect(state).toEqual({
      kind: 'post-season',
      endedSeasonYear: 2026,
      nextSeasonYear: null,
      opening: null,
      daysUntil: null,
    });
  });

  // The bug this task exists to fix, pinned directly at the unit level: a
  // reader mid-season, with no filters, must see the list. Before rule 1
  // existed, "now past start, year has events" alone resolved to
  // `post-season` unconditionally (there was no calendar upper bound at
  // all), so this exact case was #269's original defect once `showLanding`
  // stopped being gated on an empty list.
  it('is in-season, not post-season, in the middle of a season with events', () => {
    const state = determineLandingState({
      now: chqDateAt(2026, 7, 15, 10),
      selectedYear: 2026,
      availableYears: [2025, 2026, 2027],
      yearHasEvents: true,
      yearHasUpcomingEvents: true,
    });
    expect(state).toEqual({ kind: 'in-season' });
  });

  // Rule 3, the one deliberate divergence from iOS. A failed or empty feed
  // fetch during the season must NOT produce "See you next season" for a
  // July visitor — it means "we have no data", which is what the generic
  // EmptyState says.
  it('is in-season when the year has no events at all and the season has opened', () => {
    const state = determineLandingState({
      now: chqDateAt(2026, 7, 15, 10),
      selectedYear: 2026,
      availableYears: [2026],
      yearHasEvents: false,
      yearHasUpcomingEvents: false,
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
      yearHasUpcomingEvents: false,
    });
    expect(state.kind).toBe('pre-season');
  });

  it('reports null next-season fields when no later year is available', () => {
    const state = determineLandingState({
      now: chqDateAt(2026, 9, 15, 10),
      selectedYear: 2026,
      availableYears: [2025, 2026],
      yearHasEvents: true,
      yearHasUpcomingEvents: false,
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
      yearHasUpcomingEvents: false,
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
      yearHasUpcomingEvents: false,
    });
    const late = determineLandingState({
      now: chqDateAt(2026, 10, 20, 23),
      selectedYear: 2027,
      availableYears: [2027],
      yearHasEvents: false,
      yearHasUpcomingEvents: false,
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
