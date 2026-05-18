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

function parseIsoOrThrow(iso: string, weekNumber: number): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new Error(`Week ${weekNumber} has an unparseable date "${iso}"`);
  }
  const [y, m, d] = iso.split('-').map(s => parseInt(s, 10));
  const parsed = new Date(Date.UTC(y, m - 1, d));
  // Round-trip check: rejects impossible day-of-month like 2026-06-31.
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() !== m - 1 ||
    parsed.getUTCDate() !== d
  ) {
    throw new Error(`Week ${weekNumber} has an impossible date "${iso}"`);
  }
  return parsed;
}

export function validateWeeklyThemes(weeks: ParsedWeek[], year: number): void {
  if (weeks.length !== 9) {
    throw new Error(`Expected exactly 9 weeks, got ${weeks.length}`);
  }
  let prevEnd: Date | null = null;
  for (let i = 0; i < 9; i++) {
    const w = weeks[i];
    if (w.number !== i + 1) {
      throw new Error(`Weeks must be numbered 1..9 in order; entry ${i} has number ${w.number}`);
    }
    if (!w.title || !w.title.trim()) {
      throw new Error(`Week ${w.number} is missing a title`);
    }
    const start = parseIsoOrThrow(w.startDate, w.number);
    const end = parseIsoOrThrow(w.endDate, w.number);
    if (start.getUTCFullYear() !== year || end.getUTCFullYear() !== year) {
      throw new Error(`Week ${w.number} dates are not in year ${year} (got ${w.startDate}..${w.endDate})`);
    }
    if (end <= start) {
      throw new Error(`Week ${w.number} end date "${w.endDate}" must be after start "${w.startDate}"`);
    }
    if (prevEnd && start < prevEnd) {
      throw new Error(`Week ${w.number} starts at "${w.startDate}" before the previous week ended at "${weeks[i - 1].endDate}"`);
    }
    prevEnd = end;
  }
}
