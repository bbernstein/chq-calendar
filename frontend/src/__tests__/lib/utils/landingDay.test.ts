import { landingDayKey } from '@/lib/utils/landingDay';

const DAYS = ['2026-01-03', '2026-06-27', '2026-07-04', '2026-08-29'];

test('the current year lands on today when today has events', () => {
  expect(landingDayKey({
    now: new Date('2026-07-04T14:00:00Z'), isCurrentYear: true,
    eventDays: DAYS, selectedYear: 2026, seasonStartDay: '2026-06-27',
  })).toBe('2026-07-04');
});

test('the current year lands on the next day with events when today has none', () => {
  expect(landingDayKey({
    now: new Date('2026-06-30T14:00:00Z'), isCurrentYear: true,
    eventDays: DAYS, selectedYear: 2026, seasonStartDay: '2026-06-27',
  })).toBe('2026-07-04');
});

test('past the last event day, the current year lands on the last day rather than nowhere', () => {
  expect(landingDayKey({
    now: new Date('2026-09-20T14:00:00Z'), isCurrentYear: true,
    eventDays: DAYS, selectedYear: 2026, seasonStartDay: '2026-06-27',
  })).toBe('2026-08-29');
});

test('an archived year lands at the season start, not at January', () => {
  expect(landingDayKey({
    now: new Date('2026-07-04T14:00:00Z'), isCurrentYear: false,
    eventDays: DAYS, selectedYear: 2026, seasonStartDay: '2026-06-27',
  })).toBe('2026-06-27');
});

test('an archived year whose first event is after the season start lands on that event', () => {
  expect(landingDayKey({
    now: new Date('2026-07-04T14:00:00Z'), isCurrentYear: false,
    eventDays: ['2026-01-03', '2026-07-04'], selectedYear: 2026, seasonStartDay: '2026-06-27',
  })).toBe('2026-07-04');
});

test('a year with no events lands nowhere', () => {
  expect(landingDayKey({
    now: new Date('2026-07-04T14:00:00Z'), isCurrentYear: true,
    eventDays: [], selectedYear: 2026, seasonStartDay: '2026-06-27',
  })).toBeNull();
});

// ---------------------------------------------------------------------------
// The torn commit: `selectedYear` has flipped, the events have not.
//
// `page.tsx` derives `seasonStartDay` and `isCurrentYear` straight from
// `selectedYear` (both synchronous `useMemo`s), but `eventDays` comes from
// `useEventData`, which clears `events` in an EFFECT keyed on the year. So
// there is exactly one commit in every year switch where this function is
// handed the new year's season start alongside the OLD year's event days.
//
// Measured against the branch's own preview build on 2026-08-26, switching
// 2026 → 2025 with the app instrumented:
//
//   landingDayKey {"isCurrentYear":false,"seasonStartDay":"2025-06-21",
//                  "n":89,"first":"2026-01-03","last":"2026-09-10",
//                  "result":"2026-01-03"}
//   useInitialLanding {"targetDay":"2026-01-03","year":2025,
//                      "listMounted":true,"landedFor":2026,"hasSection":true}
//
// 2026's 89 sections are still in the DOM in that commit, so the landing
// hook found a section for `2026-01-03`, scrolled to it, and latched
// `landedFor = 2025`. When the real `2025-06-21` arrived two commits later
// its own `landedFor.current === year` guard refused it, and nothing ever
// re-triggered the effect — the reader was left on `2025-03-13`, `scrollY 0`.
//
// The fix is here rather than in the hook: a day key carries its own year, so
// this function can tell that it has been handed events belonging to a year
// it was not asked about, and decline to guess. `null` costs nothing — the
// hook returns early WITHOUT latching, and re-runs the moment the right data
// lands.
test('the commit where the year has flipped but the events have not lands nowhere', () => {
  expect(landingDayKey({
    now: new Date('2026-08-26T14:00:00Z'), isCurrentYear: false,
    eventDays: DAYS, selectedYear: 2025, seasonStartDay: '2025-06-21',
  })).toBeNull();
});

// The same tear, switching the other way — an archived year back to the
// current one. `isCurrentYear` is true here, so `from` is today, every one of
// the previous year's days is behind it, and the `?? last` fallback (written
// for a post-season visitor) hands back a day from the wrong year instead.
test('the same tear on a switch into the current year lands nowhere', () => {
  expect(landingDayKey({
    now: new Date('2026-08-26T14:00:00Z'), isCurrentYear: true,
    eventDays: ['2025-03-13', '2025-06-21', '2025-11-20'], selectedYear: 2026, seasonStartDay: '2026-06-27',
  })).toBeNull();
});

// ...but a stray day key from a neighbouring year does not disqualify the
// whole list. This is the guard on the implementation CHOICE: the simplest
// reading of the rule above ("if any key is not this year's, return null")
// would land nobody at all in a year whose feed happens to carry one event
// either side of the calendar boundary. Filtering, not rejecting.
test('a day key from another year is skipped, not treated as poisoning the list', () => {
  expect(landingDayKey({
    now: new Date('2026-08-26T14:00:00Z'), isCurrentYear: false,
    eventDays: ['2025-12-31', '2026-01-03', '2026-06-27', '2027-01-02'],
    selectedYear: 2026, seasonStartDay: '2026-06-27',
  })).toBe('2026-06-27');
});
