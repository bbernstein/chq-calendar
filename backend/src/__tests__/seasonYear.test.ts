import { seasonYearAt, CHQ_TIMEZONE } from '../scripts/seasonYear';

/**
 * The rule that names the file the frontend will ask for. It has been wrong
 * twice in one change — once on the month, once on the clock — so both are
 * pinned here.
 */
describe('seasonYearAt', () => {
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
