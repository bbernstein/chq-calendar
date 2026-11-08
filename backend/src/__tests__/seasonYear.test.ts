/**
 * @jest-environment ./src/__tests__/environments/timeZoneEnvironment.ts
 * @jest-environment-options {"timeZone": "Asia/Tokyo"}
 */
import { seasonYearAt, CHQ_TIMEZONE } from '../scripts/seasonYear';

/**
 * The rule that names the file the frontend will ask for. It has been wrong
 * twice in one change — once on the month, once on the clock — so both are
 * pinned here.
 */
describe('seasonYearAt', () => {
  // The whole file runs with the worker on Asia/Tokyo — see the docblock at
  // the top and `environments/timeZoneEnvironment.ts`. Backend jest does not
  // otherwise pin TZ, and the maintainer works on America/New_York, where
  // "the default zone fell back to the machine clock" resolves exactly as
  // Chautauqua time does, so every assertion below would pass over the very
  // regression it exists to catch. Tokyo is 13 hours ahead: at 22:00 ET on
  // Sep 30 it is already October 1.
  const PROCESS_ZONE = 'Asia/Tokyo';

  // Checks the harness, not the code. If the environment stopped taking
  // effect, the suite would quietly be back on the machine's zone and
  // vacuous on an Eastern machine; this is what says so.
  it('really is running on a clock that disagrees with Chautauqua\'s', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(PROCESS_ZONE);
    // 2026-10-01T02:00Z: 22:00 on Sep 30 at Chautauqua, 11:00 on Oct 1 here.
    expect(new Date('2026-10-01T02:00:00Z').getMonth()).toBe(9);
  });

  describe('the October turnover', () => {
    it.each([
      ['2026-01-15T12:00:00Z', 2026],
      ['2026-06-27T12:00:00Z', 2026],
      ['2026-09-30T12:00:00Z', 2026],
      ['2026-12-31T12:00:00Z', 2027],
      ['2027-01-01T12:00:00Z', 2027],
    ])('resolves %s to %i', (iso, expected) => {
      expect(seasonYearAt(new Date(iso))).toBe(expected);
    });

    // A calendar-year rule would answer 2026 here and the frontend would ask
    // for all-events-2027.json — #286's empty calendar, three months on.
    it('turns over on October 1, not January 1', () => {
      // 2026-10-01T00:30 in Chautauqua time.
      expect(seasonYearAt(new Date('2026-10-01T04:30:00Z'))).toBe(2027);
      // Half an hour earlier, still September there.
      expect(seasonYearAt(new Date('2026-10-01T03:30:00Z'))).toBe(2026);
    });
  });

  describe('the turnover is read in Chautauqua time', () => {
    // 2026-10-01T02:00Z is 22:00 ET on Sep 30 — but already October 1 in
    // Tokyo and London. Reading the machine's clock there resolves 2027 while
    // the browser, which uses chqParts, asks for 2026.
    const boundary = new Date('2026-10-01T02:00:00Z');

    it('answers this season at 22:00 ET on September 30', () => {
      expect(seasonYearAt(boundary)).toBe(2026);
    });

    it.each(['Asia/Tokyo', 'Europe/London', 'Australia/Sydney'])(
      'still answers 2026 for a contributor in %s, whose own clock says October',
      (tz) => {
        // Establish that this timezone really does disagree, so the assertion
        // below is testing something rather than passing vacuously.
        expect(seasonYearAt(boundary, tz)).toBe(2027);
        // The default must ignore it.
        expect(seasonYearAt(boundary)).toBe(2026);
      },
    );

    it('is pinned to the Institution, not to UTC', () => {
      // 2026-10-01T02:00Z is October in UTC and September at Chautauqua.
      expect(seasonYearAt(boundary, 'UTC')).toBe(2027);
      expect(seasonYearAt(boundary, CHQ_TIMEZONE)).toBe(2026);
    });
  });
});
