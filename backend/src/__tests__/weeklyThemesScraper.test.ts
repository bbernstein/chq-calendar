import { readFileSync } from 'fs';
import { join } from 'path';
import { parseWeeklyThemes, validateWeeklyThemes, ParsedWeek } from '../services/weeklyThemesScraper';

const FIXTURE_PATH = join(__dirname, 'fixtures', 'weekly-themes-2026.html');

describe('parseWeeklyThemes', () => {
  const html = readFileSync(FIXTURE_PATH, 'utf8');

  it('extracts all 9 weeks from the fixture in order', () => {
    const weeks = parseWeeklyThemes(html, 2026);
    expect(weeks).toHaveLength(9);
    expect(weeks.map(w => w.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('parses week 1 title and dates', () => {
    const weeks = parseWeeklyThemes(html, 2026);
    expect(weeks[0]).toEqual({
      number: 1,
      title: 'Icons and Instigators: Women Who Change the World',
      description: '',
      startDate: '2026-06-27',
      endDate: '2026-07-04',
    });
  });

  it('handles a same-month date range like "July 4–11"', () => {
    const weeks = parseWeeklyThemes(html, 2026);
    expect(weeks[1]).toMatchObject({
      number: 2,
      title: 'Breaking the News: Charting a New Media Landscape',
      startDate: '2026-07-04',
      endDate: '2026-07-11',
    });
  });

  it('handles a cross-month range like "July 25–August 1"', () => {
    const weeks = parseWeeklyThemes(html, 2026);
    expect(weeks[4]).toMatchObject({
      number: 5,
      startDate: '2026-07-25',
      endDate: '2026-08-01',
    });
  });

  it('decodes HTML entities and curly punctuation in titles', () => {
    const weeks = parseWeeklyThemes(html, 2026);
    // Week three on chq.org uses a curly apostrophe in "What's at Stake?"
    expect(weeks[2].title).toBe('The 2026 Election: What’s at Stake?');
  });

  it('trims trailing whitespace from titles', () => {
    const weeks = parseWeeklyThemes(html, 2026);
    for (const w of weeks) {
      expect(w.title).toBe(w.title.trim());
      expect(w.title.length).toBeGreaterThan(0);
    }
  });
});

describe('validateWeeklyThemes', () => {
  const goodWeeks: ParsedWeek[] = Array.from({ length: 9 }, (_, i) => {
    const start = new Date(Date.UTC(2026, 5, 27 + i * 7)); // Sat June 27 + i weeks
    const end = new Date(Date.UTC(2026, 6, 4 + i * 7));
    return {
      number: i + 1,
      title: `Week ${i + 1} title`,
      description: '',
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    };
  });

  it('passes on 9 sequential, titled, dated weeks', () => {
    expect(() => validateWeeklyThemes(goodWeeks, 2026)).not.toThrow();
  });

  it('throws when there are not exactly 9 weeks', () => {
    expect(() => validateWeeklyThemes(goodWeeks.slice(0, 8), 2026)).toThrow(/exactly 9/i);
  });

  it('throws when weeks are not numbered 1..9 in order', () => {
    const bad = [...goodWeeks];
    bad[3] = { ...bad[3], number: 99 };
    expect(() => validateWeeklyThemes(bad, 2026)).toThrow(/numbered 1\.\.9/i);
  });

  it('throws when any week is missing a title', () => {
    const bad = [...goodWeeks];
    bad[2] = { ...bad[2], title: '' };
    expect(() => validateWeeklyThemes(bad, 2026)).toThrow(/title/i);
  });

  it('throws when any week is missing dates', () => {
    const bad = [...goodWeeks];
    bad[4] = { ...bad[4], startDate: '' };
    expect(() => validateWeeklyThemes(bad, 2026)).toThrow(/date/i);
  });

  it('throws when dates are not in the requested year', () => {
    const bad = [...goodWeeks];
    bad[0] = { ...bad[0], startDate: '2025-06-27' };
    expect(() => validateWeeklyThemes(bad, 2026)).toThrow(/2026/);
  });

  it('throws on an impossible calendar date (e.g. 2026-06-31)', () => {
    const bad = [...goodWeeks];
    bad[3] = { ...bad[3], startDate: '2026-06-31' };
    expect(() => validateWeeklyThemes(bad, 2026)).toThrow(/impossible date/i);
  });

  it('throws when endDate is not after startDate', () => {
    const bad = [...goodWeeks];
    bad[2] = { ...bad[2], startDate: '2026-07-04', endDate: '2026-07-04' };
    expect(() => validateWeeklyThemes(bad, 2026)).toThrow(/must be after/i);
  });

  it('throws when weeks are not in chronological order', () => {
    const sequential: ParsedWeek[] = Array.from({ length: 9 }, (_, i) => ({
      number: i + 1,
      title: `Week ${i + 1}`,
      description: '',
      startDate: `2026-07-0${i % 9 + 1}`,
      endDate: `2026-07-0${i % 9 + 1}`,
    }));
    // Make all start/end dates real and sequential except week 5 which goes backward.
    for (let i = 0; i < 9; i++) {
      const start = new Date(Date.UTC(2026, 5, 27 + i * 7));
      const end = new Date(Date.UTC(2026, 6, 4 + i * 7));
      sequential[i].startDate = start.toISOString().slice(0, 10);
      sequential[i].endDate = end.toISOString().slice(0, 10);
    }
    sequential[4].startDate = '2026-06-27'; // earlier than week 4's end
    expect(() => validateWeeklyThemes(sequential, 2026)).toThrow(/before the previous week/i);
  });
});
