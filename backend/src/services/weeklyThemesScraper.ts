import * as cheerio from 'cheerio';

export interface ParsedWeek {
  number: number;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
}

const WORD_TO_NUMBER: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
  SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9,
};

const MONTHS: Record<string, number> = {
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, MAY: 5, JUNE: 6,
  JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12,
};

function parseWeekNumber(headingText: string): number | null {
  const m = headingText.trim().match(/^Week\s+([A-Za-z]+)\b/i);
  if (!m) return null;
  return WORD_TO_NUMBER[m[1].toUpperCase()] ?? null;
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Parse a chq.org weekly-themes date range like:
 *   "June 27–July 4"     (cross-month)
 *   "July 4–11"          (same month)
 * The separator is a Unicode en-dash (U+2013). Hyphen-minus is tolerated.
 */
function parseDateRange(rangeText: string, year: number): { startDate: string; endDate: string } | null {
  const cleaned = rangeText.replace(/\s+/g, ' ').trim();
  // Split on en-dash, em-dash, or hyphen-minus.
  const parts = cleaned.split(/\s*[–—-]\s*/);
  if (parts.length !== 2) return null;

  const [left, right] = parts;
  const leftMatch = left.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (!leftMatch) return null;
  const startMonth = MONTHS[leftMatch[1].toUpperCase()];
  const startDay = parseInt(leftMatch[2], 10);
  if (!startMonth || !startDay) return null;

  // Right side can be "August 1" (cross-month) or just "11" (same month).
  let endMonth = startMonth;
  let endDay: number;
  const rightCross = right.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  const rightSame = right.match(/^(\d{1,2})$/);
  if (rightCross) {
    const m = MONTHS[rightCross[1].toUpperCase()];
    if (!m) return null;
    endMonth = m;
    endDay = parseInt(rightCross[2], 10);
  } else if (rightSame) {
    endDay = parseInt(rightSame[1], 10);
  } else {
    return null;
  }

  return {
    startDate: toIso(year, startMonth, startDay),
    endDate: toIso(year, endMonth, endDay),
  };
}

export function parseWeeklyThemes(html: string, year: number): ParsedWeek[] {
  const $ = cheerio.load(html);
  const weeks: ParsedWeek[] = [];

  $('.hub-item').each((_, el) => {
    const heading = $(el).find('h2.season').first().text();
    const number = parseWeekNumber(heading);
    if (number === null) return;

    const paragraph = $(el).find('p.has-text-align-center').first().text();
    // Format: "<dates> • <title>" where the bullet is U+2022.
    const bulletIdx = paragraph.indexOf('•');
    if (bulletIdx < 0) return;

    const rangeText = paragraph.slice(0, bulletIdx).trim();
    const title = paragraph.slice(bulletIdx + 1).trim();

    const range = parseDateRange(rangeText, year);
    if (!range) return;

    weeks.push({
      number,
      title,
      description: '',
      startDate: range.startDate,
      endDate: range.endDate,
    });
  });

  return weeks;
}

export function validateWeeklyThemes(weeks: ParsedWeek[], year: number): void {
  if (weeks.length !== 9) {
    throw new Error(`Expected exactly 9 weeks, got ${weeks.length}`);
  }
  for (let i = 0; i < 9; i++) {
    if (weeks[i].number !== i + 1) {
      throw new Error(`Weeks must be numbered 1..9 in order; entry ${i} has number ${weeks[i].number}`);
    }
    if (!weeks[i].title || !weeks[i].title.trim()) {
      throw new Error(`Week ${weeks[i].number} is missing a title`);
    }
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(weeks[i].startDate) || !datePattern.test(weeks[i].endDate)) {
      throw new Error(`Week ${weeks[i].number} has an unparseable date`);
    }
    const startYear = parseInt(weeks[i].startDate.slice(0, 4), 10);
    const endYear = parseInt(weeks[i].endDate.slice(0, 4), 10);
    if (startYear !== year || endYear !== year) {
      throw new Error(`Week ${weeks[i].number} dates are not in year ${year} (got ${weeks[i].startDate}..${weeks[i].endDate})`);
    }
  }
}
