/**
 * The pre-season catalog, as a build artifact rather than a runtime input.
 *
 * `config/SpecialStudies.csv` is a transcription of the 2026 Special Studies
 * PDF, made once by hand. It is this season's accident, not the contract:
 * 2027's catalog will come from somewhere else. So the CSV is compiled into
 * this shape by `npm run build:catalog`, the result is checked in, and
 * everything downstream reads only this. Changing where a season's catalog
 * comes from then means changing one tool.
 *
 * Two things are resolved at build time that used to be recomputed on every
 * ingest run:
 *
 * `eventAks` — the join to the ticket site. Matching titles across the two
 * sources is fuzzy work (see classCatalogMatcher), but its answer does not
 * change during a season: an eventAk is fixed once the site lists a class. So
 * it is decided once, under review, and lands here as data a human can read
 * in a diff rather than logic that reruns unattended twenty-five times a day.
 *
 * `weeks` — the season calendar. The catalog numbers its weeks and never
 * dates them; the ticket site prints dates and never numbers the season. The
 * mapping is a fixed fact about the year, so it is recorded once here rather
 * than re-derived from whatever sessions a crawl happens to still see.
 */

/** A season week's span, as [start, end] in naive Institution-local dates. */
export type CatalogWeekRange = [string, string];

/** Materials a class needs, and who is expected to bring them. */
export interface CatalogMaterials {
  /** Extra fee as printed, e.g. "$20". Empty when none. */
  fee: string;
  student: boolean;
  instructor: boolean;
}

/** One class as the printed catalog describes it, plus its resolved join. */
export interface CatalogClass {
  /** Row id from the source catalog. Unique within it. */
  id: string;
  /**
   * Every ticket-site id this row was matched to, resolved at build time.
   *
   * Usually one. A few catalog rows legitimately back several listings, where
   * the site splits an offering into a page per day. Empty means the match
   * was never made — the class is in the catalog and the site did not list it
   * at build time.
   */
  eventAks: string[];
  title: string;
  instructor: string;
  description: string;
  /**
   * Editorial categories in the printed catalog's own vocabulary — the words
   * a reader holding the PDF sees.
   */
  categories: string[];
  ageRange: { min: number | null; max: number | null };
  /** The class admits a child accompanied by an adult. */
  caregiver: boolean;
  /** Tuition as printed, e.g. "$115". */
  fee: string;
  materials: CatalogMaterials;
  /** The building, without the room. */
  location: string;
  room: string;
  /** Season weeks the class is scheduled for, ascending. */
  weeks: number[];
  /** Full day names, Monday-first. */
  daysOfWeek: string[];
  /** As printed, e.g. "9:00 AM". Empty when the catalog leaves it blank. */
  startTime: string;
  endTime: string;
}

/** A pair the matcher found plausible and declined to join. Read these. */
export interface CatalogReviewPair {
  catalogId: string;
  catalogTitle: string;
  eventAk: string;
  listedTitle: string;
  similarity: number;
}

export interface CatalogFile {
  season: number;
  /** When the tool ran. Not a crawl date — this file is not an observation. */
  generatedAt: string;
  /**
   * Where this came from, in prose rather than paths.
   *
   * The paths were machine-specific and one of them is gitignored, so they
   * told a later reader nothing. What matters is that a human derived the
   * descriptive half offline, and when the crawl behind the join was taken.
   *
   * `config/SpecialStudies.csv` stays checked in as the reference for the
   * first of those — it is the provenance, not an input anything reads.
   */
  source: {
    catalog: string;
    /** When the crawl the join was resolved against was taken. */
    crawledAt: string;
  };
  /** Season week number to [start, end]. Keys are stringified numbers. */
  weeks: Record<string, CatalogWeekRange>;
  classes: CatalogClass[];
  /** Listings with no catalog row at build time, for the report only. */
  listedOnly: string[];
  needsReview: CatalogReviewPair[];
}
