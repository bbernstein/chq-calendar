import { parseProgramDateText } from '../services/programDates';

describe('parseProgramDateText', () => {
  it('parses a single date', () => {
    expect(parseProgramDateText('August 04, 2026')).toEqual({
      startDate: '2026-08-04',
      endDate: '2026-08-04',
    });
  });

  it('parses a same-month range', () => {
    expect(parseProgramDateText('July 18 - 21, 2026')).toEqual({
      startDate: '2026-07-18',
      endDate: '2026-07-21',
    });
  });

  it('parses a cross-month range', () => {
    expect(parseProgramDateText('June 28 - July 26, 2026')).toEqual({
      startDate: '2026-06-28',
      endDate: '2026-07-26',
    });
  });

  it('parses an en-dash range', () => {
    expect(parseProgramDateText('July 18 – 21, 2026')).toEqual({
      startDate: '2026-07-18',
      endDate: '2026-07-21',
    });
  });

  it('collapses whitespace and newlines before parsing', () => {
    expect(parseProgramDateText('  August 04,\n   2026  ')).toEqual({
      startDate: '2026-08-04',
      endDate: '2026-08-04',
    });
  });

  it('returns null for bylines and blurbs', () => {
    expect(parseProgramDateText('by Sharyn Rothstein')).toBeNull();
    expect(
      parseProgramDateText("CTC's 2026 Acting Conservatory Mengwe Wapimewah performance"),
    ).toBeNull();
    expect(parseProgramDateText('')).toBeNull();
  });

  it('returns null for an unknown month name', () => {
    expect(parseProgramDateText('Augtember 04, 2026')).toBeNull();
  });
});
