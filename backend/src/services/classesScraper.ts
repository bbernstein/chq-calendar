import * as cheerio from 'cheerio';
import type {
  ClassAgeRange,
  ClassAvailability,
  ClassDetail,
  ClassSearchRow,
  ClassSession,
} from '../types/classes';

const DEFAULT_BASE_URL = 'https://tickets.chq.org';

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();
const pad = (n: number): string => String(n).padStart(2, '0');

/** Splits on <br> tags, then strips remaining markup from each part. */
function splitOnBreaks(html: string): string[] {
  return html
    .split(/<br\s*\/?>/i)
    .map((part) => collapse(cheerio.load(`<div>${part}</div>`)('div').text()));
}

/**
 * Reads the ages a class admits from its free-form label.
 *
 * The catalog uses at least eight shapes for this one field — "Ages 18+",
 * "Ages 7-13", "Ages 14 +", "Ages 12+; 0 - 11 with Caregiver", "Ages 0-3 with
 * Caregiver", "Ages All ages", "Ages Families", "Ages 50 and Up", "Ages 50 and
 * under" — so this parses what it recognizes and reports unbounded otherwise.
 * The raw text is kept alongside the parse precisely because this will not
 * catch everything; display uses the raw text, only filtering uses the bounds.
 *
 * Where a caregiver clause names a second, younger range ("Ages 12+; 0 - 11
 * with Caregiver"), the bounds describe the unaccompanied range — the clause
 * is a conditional exception to it, not a widening of it.
 */
export function parseAgeRange(raw: string): ClassAgeRange {
  const text = collapse(raw).replace(/^Ages?\s+/i, '');
  const primary = text.split(';')[0].trim();

  const upTo = /^(\d{1,3})\s*and\s+under$/i.exec(primary);
  if (upTo) return { min: null, max: Number(upTo[1]) };

  const andUp = /^(\d{1,3})\s*and\s+up$/i.exec(primary);
  if (andUp) return { min: Number(andUp[1]), max: null };

  const between = /^(\d{1,3})\s*-\s*(\d{1,3})/.exec(primary);
  if (between) return { min: Number(between[1]), max: Number(between[2]) };

  // "14+" and the "14 +" spacing variant.
  const atLeast = /^(\d{1,3})\s*\+/.exec(primary);
  if (atLeast) return { min: Number(atLeast[1]), max: null };

  // "All ages", "Families", and anything else we have not seen.
  return { min: null, max: null };
}

/**
 * Turns a published description into plain text, keeping its line structure.
 *
 * Descriptions carry light markup — paragraph breaks, and materials lists as
 * <ul>. The web app renders no raw HTML anywhere (there is not a single
 * dangerouslySetInnerHTML in it), so publishing markup would force either a
 * break in that rule or literal tags on screen. Stripping to one line instead
 * would run a materials list together as "Sketchbook Pencils Brushes", so
 * block boundaries become newlines and list items keep a bullet.
 */
export function descriptionToText(html: string): string {
  if (!html) return '';
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n\u2022 ')
    .replace(/<\/(p|div|ul|ol|li|h[1-6])>/gi, '\n');
  return cheerio
    .load(`<div>${withBreaks}</div>`)('div')
    .text()
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Splits a listing row's "Quick Detail" cell. The cell packs four
 * pipe-delimited fields — weeks, days, location, ages — and the age field is
 * located by its prefix rather than by position, so a location containing a
 * pipe, or a row with no age at all, degrades instead of shifting every
 * field one place left.
 */
function parseQuickDetail(parts: string[]): {
  weeksLabel: string;
  daysLabel: string;
  location: string;
  ageRangeText: string;
} {
  const ageIdx = parts.findIndex((p) => /^Ages?\b/i.test(p));
  const end = ageIdx === -1 ? parts.length : ageIdx;
  return {
    weeksLabel: parts[0] ?? '',
    daysLabel: parts[1] ?? '',
    location: parts.slice(2, end).join(' | '),
    ageRangeText: ageIdx === -1 ? '' : parts[ageIdx],
  };
}

/**
 * Parses the HTML fragment returned by `POST /post/search/classes`.
 *
 * Rows carry everything except per-session availability, which only exists on
 * each class's detail page.
 *
 * The fragment lists every class *twice*: once in a desktop table of four
 * cells, and again in a mobile table of one cell holding labelled divs. Only
 * the four-cell layout is read, and results are deduplicated by class id, so
 * the mobile copy neither double-counts nor overwrites a good row with a
 * layout this parser cannot read. Selecting on shape rather than on the
 * `id="table-desktop"` attribute keeps that working if the table is renamed;
 * if the four-cell layout disappears entirely, this returns nothing, which
 * the caller treats as markup drift rather than an empty catalog.
 */
export function parseSearchResults(
  html: string,
  baseUrl: string = DEFAULT_BASE_URL,
): ClassSearchRow[] {
  const $ = cheerio.load(html);
  const rows: ClassSearchRow[] = [];
  const seen = new Set<string>();

  $('tbody tr').each((_, el) => {
    const tr = $(el);
    if (tr.children('td').length < 4) return;
    const href = tr.find('a[href*="eventAk="]').first().attr('href');
    const id = href ? /eventAk=([A-Z0-9.]+)/.exec(href)?.[1] : undefined;
    const titleCell = tr.find('td.event-cell').first();
    const title = collapse(titleCell.attr('data-event-title') ?? titleCell.text());
    if (!id || !title || !href || seen.has(id)) return;
    seen.add(id);

    const detailHtml = tr.find('td').eq(1).html() ?? '';
    // The cell is: <pipe-delimited facts><br><count> <i>price</i><br><br><blurb>
    const segments = splitOnBreaks(detailHtml);
    const { weeksLabel, daysLabel, location, ageRangeText } = parseQuickDetail(
      (segments[0] ?? '').split('|').map(collapse),
    );
    const countAndPrice = segments[1] ?? '';
    const sessionCount = /^(\d+)\b/.exec(countAndPrice);

    rows.push({
      id,
      title,
      weeksLabel,
      daysLabel,
      location,
      ageRangeText,
      ageRange: parseAgeRange(ageRangeText),
      instructor: collapse(tr.find('td').eq(2).text()),
      priceLabel: collapse(countAndPrice.replace(/^\d+\s*/, '')),
      summary: segments.slice(2).filter(Boolean).join(' '),
      sessionCount: sessionCount ? Number(sessionCount[1]) : null,
      sourceUrl: new URL(href, baseUrl).toString(),
    });
  });

  return rows;
}


/** "Aug 19" -> { month: 8, day: 19 }; null when unrecognized. */
function parseMonthDay(raw: string): { month: number; day: number } | null {
  const m = /^([A-Za-z]{3,})\.?\s+(\d{1,2})$/.exec(collapse(raw));
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
  return month ? { month, day: Number(m[2]) } : null;
}

/** "4:30 pm" -> { hour: 16, minute: 30 }; null when unrecognized. */
function parseClockTime(raw: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i.exec(collapse(raw));
  if (!m) return null;
  const minute = Number(m[2]);
  let hour = Number(m[1]) % 12;
  if (m[3].toLowerCase() === 'p') hour += 12;
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

/**
 * Builds the naive Institution-local datetime the feed convention expects,
 * e.g. "2026-08-17 13:00:00". The year is supplied by the caller: the site
 * prints "Aug 17 - Aug 21" with no year anywhere on the page.
 */
function toNaiveLocal(
  year: number,
  md: { month: number; day: number },
  time: { hour: number; minute: number },
): string {
  return `${year}-${pad(md.month)}-${pad(md.day)} ${pad(time.hour)}:${pad(time.minute)}:00`;
}

/**
 * Reads a session card's booking state.
 *
 * Scoped to the card on purpose: every detail page also carries a hidden
 * "Join the Waitlist" modal template and a nav blob mentioning "SOLD OUT", so
 * a page-wide search reports classes as full when they are not.
 *
 * Returns `unknown` rather than throwing on markup it does not recognize — a
 * single unreadable session should cost that session's state, not the run.
 */
function parseSessionAvailability(
  card: cheerio.Cheerio<never>,
): { availability: ClassAvailability; spotsRemaining: number | null } {
  if (card.find('.js-waitlist').length > 0) {
    return { availability: 'waitlist', spotsRemaining: null };
  }
  const spots = /Spots\s+remaining:\s*(\d+)/i.exec(card.text());
  if (spots) {
    const remaining = Number(spots[1]);
    // Zero seats and no waitlist button is the `full` state the type reserves
    // — the one the plan noted had never been observed. Calling it `open`
    // read as "0 spots left" in urgent red beside a Register link, and passed
    // the page's Open-by-default filter: an offer that cannot be taken up.
    if (remaining === 0) return { availability: 'full', spotsRemaining: 0 };
    return { availability: 'open', spotsRemaining: remaining };
  }
  return { availability: 'unknown', spotsRemaining: null };
}

/**
 * Parses a class detail page (`class.html?eventAk=…`).
 *
 * A class with no session cards is normal, not an error: sessions disappear
 * from this page once their week has passed, so late in the season a class
 * still listed in search legitimately has none left.
 */
export function parseClassDetail(
  html: string,
  id: string,
  year: number,
): ClassDetail {
  const $ = cheerio.load(html);
  const sessions: ClassSession[] = [];

  $('.js-week-select').each((_, el) => {
    const card = $(el) as unknown as cheerio.Cheerio<never>;
    const performanceId = card.find('[data-performance]').first().attr('data-performance');
    if (!performanceId) return;

    // "Week 8 | Aug 17 - Aug 21<br>Monday, …<br>1:00 pm - 3:00 pm<br>Location"
    const lines = splitOnBreaks(card.find('em span').first().html() ?? '');
    const [weekLabel = '', dateRangeLabel = ''] = (lines[0] ?? '').split('|').map(collapse);
    const week = Number(/Week\s+(\d+)/i.exec(weekLabel)?.[1]);
    const timeRangeLabel = lines[2] ?? '';

    const [startText, endText] = dateRangeLabel.split(/\s*-\s*/);
    const [startClock, endClock] = timeRangeLabel.split(/\s*-\s*/);
    const startMd = parseMonthDay(startText ?? '');
    const endMd = parseMonthDay(endText ?? '') ?? startMd;
    const startTime = parseClockTime(startClock ?? '');
    const endTime = parseClockTime(endClock ?? '') ?? startTime;

    sessions.push({
      performanceId,
      week: Number.isFinite(week) ? week : 0,
      dateRangeLabel,
      // A session spans its whole run at the same daily time, so the bounds
      // are the first day's start and the last day's end; the days between
      // are described by daysOfWeek and timeRangeLabel.
      startDate: startMd && startTime ? toNaiveLocal(year, startMd, startTime) : '',
      endDate: endMd && endTime ? toNaiveLocal(year, endMd, endTime) : '',
      daysOfWeek: (lines[1] ?? '').split(',').map(collapse).filter(Boolean),
      timeRangeLabel,
      location: lines[3] ?? '',
      ...parseSessionAvailability(card),
    });
  });

  return {
    id,
    title: collapse($('.perf-title').first().text()),
    description: descriptionToText($('.description-tab').last().html() ?? ''),
    // The instructor tab leads with the name in bold, then the bio.
    instructor: collapse($('.instructor-tab').last().find('b').first().text()),
    sessions,
  };
}
