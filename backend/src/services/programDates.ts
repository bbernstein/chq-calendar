const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Parses the listing-page date text into an inclusive date range. Handles
 * "August 04, 2026", "July 18 - 21, 2026", and "June 28 - July 26, 2026"
 * (hyphen, en- or em-dash). Anything else — theatre bylines, blurbs —
 * returns null, which the matcher treats as "undated", not an error.
 */
export function parseProgramDateText(
  raw: string,
): { startDate: string; endDate: string } | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  const m = /^([A-Za-z]+) (\d{1,2})(?:\s*[-–—]\s*(?:([A-Za-z]+) )?(\d{1,2}))?, (\d{4})$/.exec(text);
  if (!m) return null;
  const [, month1, day1, month2, day2, yearStr] = m;
  const startMonth = MONTHS[month1.toLowerCase()];
  if (!startMonth) return null;
  const year = Number(yearStr);
  const startDate = `${year}-${pad(startMonth)}-${pad(Number(day1))}`;
  if (!day2) return { startDate, endDate: startDate };
  const endMonth = month2 ? MONTHS[month2.toLowerCase()] : startMonth;
  if (!endMonth) return null;
  return { startDate, endDate: `${year}-${pad(endMonth)}-${pad(Number(day2))}` };
}
