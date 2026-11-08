// Guards the browser-check harness's copy of the app's day-key rule.
//
// `frontend/e2e/feed.mjs` is plain Node and cannot import the app's
// TypeScript, so `chqDayKeyOf` restates `parseEventDate` (chqTime.ts)
// followed by `dayKeyOf` (dayWindow.ts). The survey uses it to find a busy
// day, to place a search hit in a season week, and to count the day sections
// verify-full-list 1a expects — so a copy that drifted would quietly point
// browser checks at the wrong day. This holds the copy to the app's own
// functions over the cases that matter: naive Institution wall time (the CHQ
// feed), explicit offsets and `Z` (publisher feeds) including ones that cross
// midnight in New York, DST edges, calendar normalisation, and unparseable
// input. Same pattern as deployWorkflow.test.ts: a test in this suite about a
// file outside src/.
import { describe, it, expect } from 'vitest';
import { parseEventDate } from '@/lib/utils/chqTime';
import { dayKeyOf } from '@/lib/utils/dayWindow';
// A plain .mjs from the e2e folder; `allowJs` lets tsc infer its signature.
import { chqDayKeyOf } from '../../e2e/feed.mjs';

const harness = chqDayKeyOf as (s: string | undefined) => string | null;

function appDayKey(s: string): string | null {
  const d = parseEventDate(s);
  return Number.isNaN(d.getTime()) ? null : dayKeyOf(d);
}

const CASES: Array<[string, string | null]> = [
  // Naive wall time — the CHQ feed's only shape. The wall date, always.
  ['2027-07-14 10:45:00', '2027-07-14'],
  ['2027-07-14 00:00:00', '2027-07-14'],
  ['2027-07-14 23:59:59', '2027-07-14'],
  ['2027-07-14T23:30', '2027-07-14'],
  // Offsets and Z: the instant's date in America/New_York.
  ['2026-07-04T01:00:00Z', '2026-07-03'],   // 21:00 EDT on the 3rd
  ['2026-07-04T04:00:00Z', '2026-07-04'],   // exactly midnight EDT
  ['2026-07-04T03:59:59Z', '2026-07-03'],
  ['2026-01-15T04:30:00Z', '2026-01-14'],   // 23:30 EST
  ['2026-01-15T05:00:00Z', '2026-01-15'],
  ['2026-07-03T23:30:00-07:00', '2026-07-04'], // 02:30 EDT next day
  ['2026-07-04T00:30:00+02:00', '2026-07-03'],
  ['2026-07-04T00:30:00+0200', '2026-07-03'],
  ['2026-07-04T12:00:00-04:00', '2026-07-04'],
  // DST edges (2026-03-08 and 2026-11-01 in New York).
  ['2026-03-08 02:30:00', '2026-03-08'],    // a wall time that does not exist
  ['2026-11-01 01:30:00', '2026-11-01'],    // one that happens twice
  ['2026-03-08T06:59:00Z', '2026-03-08'],
  ['2026-11-01T04:30:00Z', '2026-11-01'],
  // Calendar normalisation, which `chqDateAt` applies to naive wall time.
  ['2026-02-30 10:00:00', '2026-03-02'],
  ['2026-07-14 24:30:00', '2026-07-15'],
  // Date only.
  ['2027-06-26', '2027-06-26'],
  // Unparseable: the app's Invalid Date, which lands in no day.
  ['', null],
  ['not a date', null],
  ['07/14/2027', null],
];

describe('e2e feed.mjs chqDayKeyOf agrees with the app', () => {
  it.each(CASES)('%s', (input, expected) => {
    expect(appDayKey(input), 'the table itself is wrong about the app').toBe(expected);
    expect(harness(input)).toBe(expected);
  });

  it('handles a missing startDate like an unparseable one', () => {
    expect(harness(undefined)).toBeNull();
  });
});
