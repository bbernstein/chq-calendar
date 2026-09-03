/**
 * Special Studies classes scraped from tickets.chq.org.
 *
 * Dates follow the events feed's convention — naive Institution-local
 * datetimes plus an explicit `timezone` — so the web and iOS clients resolve
 * them through the same helpers they already use for events, rather than
 * meeting a second date convention here.
 */

/**
 * Whether a session can still be booked. `full` is not currently emitted:
 * every full session observed on the site offers a waitlist. It exists so a
 * future "full, no waitlist" state has somewhere to land instead of being
 * silently reported as `open`.
 */
export type ClassAvailability = 'open' | 'waitlist' | 'full' | 'unknown';

/**
 * Ages the class admits, parsed best-effort from `ageRangeText`. Both bounds
 * are inclusive; `null` means unbounded on that side, so "All ages" is
 * `{ min: null, max: null }` and "Ages 18+" is `{ min: 18, max: null }`.
 */
export interface ClassAgeRange {
  min: number | null;
  max: number | null;
}

/** One offering of a class: a specific week, at a specific place and time. */
export interface ClassSession {
  /**
   * The site's own performance id, e.g. "CHQ.EVN1687.PRF1". Stable across
   * scrapes and unique per session, which is what makes it usable as a
   * favorite key. Not derivable from the class id — the numbering is not
   * aligned to week numbers.
   */
  performanceId: string;
  /** Season week, 1-9. */
  week: number;
  /** Raw range as shown, e.g. "Aug 17 - Aug 21". */
  dateRangeLabel: string;
  /** First day at the session's start time: "2026-08-17 13:00:00". */
  startDate: string;
  /** Last day at the session's end time: "2026-08-21 15:00:00". */
  endDate: string;
  /** Full day names as shown, e.g. ["Monday", "Wednesday", "Friday"]. */
  daysOfWeek: string[];
  /** Raw range as shown, e.g. "1:00 pm - 3:00 pm". */
  timeRangeLabel: string;
  location: string;
  /** Seats left, or null when the session is full or the count is unreadable. */
  spotsRemaining: number | null;
  availability: ClassAvailability;
}

/**
 * One week the printed catalog schedules a class for.
 *
 * This is the plan, not an observation. The ticket site drops a session the
 * moment its week ends, so for any week already past this is the only record
 * of when and where the class met — which is what makes a card still readable
 * when someone filters to week 2 in late August.
 *
 * It deliberately carries no enrolment: how full a class was is something
 * only the crawl could ever have seen, and inventing it here would be
 * inventing evidence.
 */
export interface ScheduledWeek {
  week: number;
  /** Full day names, Monday-first, as the catalog prints them. */
  daysOfWeek: string[];
  /** As printed, e.g. "9:00 AM". Empty when the catalog leaves it blank. */
  startTime: string;
  endTime: string;
  location: string;
  room: string;
  /**
   * When this season week ran, dated from the crawl's own sessions. Null when
   * no session anywhere fell in that week, which is every week off-season.
   *
   * The catalog numbers its weeks and never dates them, so without this a
   * reader cannot tell a printed week already past from one still to come —
   * and a card ends up calling a week in September "over".
   */
  weekStart: string | null;
  weekEnd: string | null;
}

/** A class as it appears in a search-results row (no per-session detail). */
export interface ClassSearchRow {
  /** Event id, e.g. "CHQ.EVN1687". */
  id: string;
  title: string;
  /** Raw weeks text, e.g. "Weeks 1, 2, 6, 7, 9" or "Weeks 4 to 5". */
  weeksLabel: string;
  /** Abbreviated days as shown in the listing, e.g. "M, W, F". */
  daysLabel: string;
  location: string;
  /** Raw age text, e.g. "Ages 12+; 0 - 11 with Caregiver". */
  ageRangeText: string;
  ageRange: ClassAgeRange;
  instructor: string;
  /** Price as shown, e.g. "Sessions: $145.00". Free-form on purpose. */
  priceLabel: string;
  /** Truncated blurb from the listing; the detail page carries the full text. */
  summary: string;
  sessionCount: number | null;
  /** Absolute URL of the class page — where people actually register. */
  sourceUrl: string;
}

/** The per-class content that only the detail page carries. */
export interface ClassDetail {
  id: string;
  title: string;
  /** Plain text with line breaks kept; markup is stripped at ingest. */
  description: string;
  instructor: string;
  sessions: ClassSession[];
}

/**
 * What a crawl was able to establish about a class existing.
 *
 * `unobserved` and `cancelled` are deliberately different words for
 * deliberately different claims, because a crawl can only see forwards: a
 * class cannot be created or cancelled in the past, so a crawl on date D can
 * say a class scheduled after D is gone, but says nothing at all about one
 * whose sessions had all finished before D.
 */
export type ClassStatus =
  /** Seen in the crawl. */
  | 'listed'
  /** In the catalog, not crawled, and its sessions were already over. Unknowable. */
  | 'unobserved'
  /** In the catalog, scheduled after the crawl, and absent from it. Gone. */
  | 'cancelled';

/** Which source said what, and when the class was last actually seen. */
export interface ClassProvenance {
  /** The pre-season catalog describes this class. */
  catalog: boolean;
  /** ISO date of the most recent crawl that listed it, or null if never. */
  lastObserved: string | null;
  status: ClassStatus;
}

/** Materials a class needs, from the catalog. The site does not expose these. */
export interface ClassMaterials {
  /** Extra materials fee as printed, e.g. "$20". Empty when none. */
  fee: string;
  student: boolean;
  instructor: boolean;
}

/** A class in the published catalog: search row plus detail-page content. */
export interface ChqClass extends ClassSearchRow, ClassDetail {
  /**
   * Row id from the offline transcription the catalog was compiled from,
   * or null when the site added the class after the catalog went to print —
   * Masters Series masterclasses, mostly, booked late by design.
   */
  catalogId: string | null;
  /**
   * Editorial categories, in the printed catalog's vocabulary. Empty when the
   * catalog does not cover the class: an honest gap beats a guessed label,
   * and the site's own subject taxonomy is deliberately not mapped onto this.
   */
  categories: string[];
  /** Catalog only; null when the catalog does not cover the class. */
  materials: ClassMaterials | null;
  /** Tuition as printed by the catalog, e.g. "$115". Null when unknown. */
  fee: string | null;
  /** Room within `location`, which the site runs together into one string. */
  room: string | null;
  /**
   * Every season week the class is scheduled for, ascending.
   *
   * Not derivable from `sessions`: the ticket site drops a session the moment
   * its week is over, so by late August a listed class shows only the weeks
   * still to come. The catalog remembers the whole schedule, which is what
   * makes filtering by a week that has already happened possible at all.
   * Falls back to the weeks the crawl saw for a class the catalog never
   * printed.
   */
  weeks: number[];
  /**
   * The catalog's intended schedule, one entry per week in `weeks`. Empty for
   * a class the catalog never printed, whose only schedule is its sessions.
   */
  scheduledWeeks: ScheduledWeek[];
  /**
   * Every building the class meets in, without room numbers.
   *
   * The catalog keeps location and room apart; the ticket site runs them
   * together. Normalising both to the catalog's building names is what lets a
   * venue filter offer 44 places rather than a few hundred rooms.
   */
  venues: string[];
  provenance: ClassProvenance;
  timezone: 'America/New_York';
}

/** Shape of cache/calendar-cache/classes-<year>.json. */
export interface ClassesFile {
  generatedAt: string;
  year: number;
  classes: ChqClass[];
}
