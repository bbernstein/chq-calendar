/**
 * Joins the compiled catalog to what the crawl found, and decides what each
 * source is allowed to claim.
 *
 * The split of authority:
 *
 *   The catalog describes.   Categories, ages, materials, fees, room — the
 *                            fields it was written to carry, and which the
 *                            ticket site never exposes.
 *   The crawl observes.      Enrollment above all, but also the real time,
 *                            day and place of a session, which can move after
 *                            the catalog goes to print. Where both carry a
 *                            field and disagree, the crawl wins: it reports
 *                            what will happen, not what was planned.
 *
 * And one asymmetry that shapes everything else — the crawl is authoritative
 * for existence, but only forwards. A class cannot be created or cancelled in
 * the past, so absence means "cancelled" only for a class the catalog
 * scheduled after the crawl ran. For one whose sessions were already over,
 * absence means nothing at all, and is recorded as `unobserved`.
 *
 * What this file no longer does is decide *which* catalog row a listing is.
 * That join is fuzzy, and it is resolved once at build time and checked in
 * (see types/catalog.ts). Here it is a dictionary lookup, so an ingest run has
 * no opinions left to get wrong.
 */
import type { CatalogClass, CatalogFile } from '../types/catalog';
import type { ChqClass, ClassSession, ClassStatus, ScheduledWeek } from '../types/classes';

export interface MergeInput {
  /** The compiled catalog, or undefined for a season with none. */
  catalog: CatalogFile | undefined;
  /** Freshly crawled classes, carrying only what the site knows. */
  listed: CrawledClass[];
  /** The previously published catalog, for carrying `lastObserved` forward. */
  previous?: ChqClass[];
  /** The crawl's own date, YYYY-MM-DD in Institution time. */
  crawlDate: string;
}

/** A crawled class before the catalog has been merged into it. */
export type CrawledClass = Omit<
  ChqClass,
  'catalogId' | 'categories' | 'materials' | 'fee' | 'room' | 'provenance'
  | 'weeks' | 'scheduledWeeks' | 'venues'
>;

export interface MergeSummary {
  matched: number;
  /** Listed, with no catalog row: added after the catalog printed. */
  listedOnly: number;
  unobserved: number;
  cancelled: number;
}

export interface MergeResult {
  classes: ChqClass[];
  summary: MergeSummary;
}

/**
 * The programme a class belongs to, when the title says so and the catalog
 * does not.
 *
 * Masters Series masterclasses are booked after the catalog goes to print, so
 * most have no catalog row and would otherwise carry no category at all —
 * which leaves the most recognisable strand on the page unfilterable. Not a
 * guessed category: the titles name the programme outright.
 */
const SERIES_CATEGORY = 'Masters Series';

/** Categories from the catalog plus the programme the title names, deduped. */
export function categoriesFor(title: string, fromCatalog: string[]): string[] {
  if (!/^\s*masters series\b/i.test(title)) return fromCatalog;
  return fromCatalog.includes(SERIES_CATEGORY) ? fromCatalog : [...fromCatalog, SERIES_CATEGORY];
}

/**
 * The building a class meets in, without the room.
 *
 * The catalog keeps location and room in separate columns; the ticket site
 * runs them together into "Hultquist Center 201B". Matching against the venues
 * the catalog names turns the site's string back into a building, so both
 * sources answer a venue filter with the same words. Longest match wins,
 * because "Children's School Jessica Trapasso Pavilion" also starts with
 * "Children's School".
 */
export function venueOf(location: string, knownVenues: string[]): string {
  const trimmed = location.trim();
  if (!trimmed) return '';
  let best = '';
  for (const venue of knownVenues) {
    if (trimmed.startsWith(venue) && venue.length > best.length) best = venue;
  }
  return best || trimmed;
}

/**
 * What a crawl on `crawlDate` may conclude from a catalog class being absent.
 *
 * `cancelled` only when the class was scheduled to run after the crawl — the
 * one case where absence is evidence. Everything else, including a week the
 * catalog could not date, is `unobserved`: not a softer way of saying
 * cancelled, but a refusal to guess.
 */
export function statusForAbsent(
  weeks: number[],
  weekEnds: Map<number, string>,
  crawlDate: string,
): ClassStatus {
  const lastWeek = weeks.length ? Math.max(...weeks) : null;
  if (lastWeek === null) return 'unobserved';
  const end = weekEnds.get(lastWeek);
  if (!end) return 'unobserved';
  return end > crawlDate ? 'cancelled' : 'unobserved';
}

/**
 * Places a session whose "Week N" label could not be read.
 *
 * `parseClassDetail` writes `week: 0` when the label is unreadable, which is
 * not a season week and behaves like one everywhere downstream: two such
 * sessions on a class collapse to a single card row keyed on the same week,
 * they share a favourite key, and a `0` appears in the week picker.
 *
 * The season calendar the build recorded can place it properly — a session
 * knows its own dates even when its label is illegible. Returns null when
 * neither the label nor the dates locate it, and the caller drops it: a
 * session nobody can place tells a reader nothing and pollutes everything
 * that counts weeks.
 */
export function placeSession(
  session: ClassSession,
  weeks: CatalogFile['weeks'],
): ClassSession | null {
  if (session.week >= 1 && session.week <= 9) return session;

  const day = session.startDate.slice(0, 10);
  if (!day) return null;
  for (const [week, [start, end]] of Object.entries(weeks)) {
    if (day >= start && day <= end) return { ...session, week: Number(week) };
  }
  return null;
}

/** "Weeks 2, 3" / "Week 5" — the catalog prints weeks, not dates. */
function weeksLabel(weeks: number[]): string {
  if (weeks.length === 0) return '';
  return weeks.length === 1 ? `Week ${weeks[0]}` : `Weeks ${weeks.join(', ')}`;
}

const DAY_ABBR: Record<string, string> = {
  Monday: 'M', Tuesday: 'Tu', Wednesday: 'W', Thursday: 'Th',
  Friday: 'F', Saturday: 'Sa', Sunday: 'Su',
};

/**
 * The catalog's schedule, one entry per week it runs, dated from the season
 * calendar the build recorded.
 *
 * The catalog prints one day/time per class rather than one per week, so every
 * week it runs shares the same shape. Kept as a list because the reader wants
 * week 2 and week 3 as separate rows on a card.
 */
function scheduledWeeksOf(c: CatalogClass, weeks: CatalogFile['weeks']): ScheduledWeek[] {
  return c.weeks.map((week) => {
    const range = weeks[String(week)];
    return {
      week,
      daysOfWeek: c.daysOfWeek,
      startTime: c.startTime,
      endTime: c.endTime,
      location: c.location,
      room: c.room,
      weekStart: range?.[0] ?? null,
      weekEnd: range?.[1] ?? null,
    };
  });
}

/** Ages rendered the way the site writes them, so both sources read alike. */
function ageRangeText(c: CatalogClass): string {
  const { min, max } = c.ageRange;
  const base = min !== null && max !== null ? `Ages ${min}-${max}`
    : min !== null ? `Ages ${min}+`
      : max !== null ? `Ages ${max} and under`
        : 'All ages';
  return c.caregiver ? `${base} with Caregiver` : base;
}

/**
 * A catalog class the crawl never listed, rendered as a publishable record.
 *
 * It has no sessions, because sessions are something only the crawl can
 * observe, and inventing them from the intended schedule would manufacture
 * exactly the evidence this design refuses to manufacture. What it does carry
 * is the catalog's own description of what was planned.
 */
function fromCatalogOnly(
  c: CatalogClass,
  status: ClassStatus,
  lastObserved: string | null,
  weeks: CatalogFile['weeks'],
): ChqClass {
  return {
    // Namespaced so it cannot be mistaken for, or collide with, an eventAk.
    id: `catalog:${c.id}`,
    catalogId: c.id,
    title: c.title,
    instructor: c.instructor,
    description: c.description,
    summary: c.description,
    categories: categoriesFor(c.title, c.categories),
    ageRange: c.ageRange,
    ageRangeText: ageRangeText(c),
    materials: c.materials,
    fee: c.fee,
    priceLabel: c.fee,
    location: c.location,
    room: c.room,
    venues: c.location ? [c.location] : [],
    weeks: c.weeks,
    scheduledWeeks: scheduledWeeksOf(c, weeks),
    weeksLabel: weeksLabel(c.weeks),
    daysLabel: c.daysOfWeek.map((d) => DAY_ABBR[d] ?? d).join(', '),
    sessionCount: c.weeks.length || null,
    // Not listed, so there is no page to register on. Callers must treat this
    // as "no link" rather than building a URL that 404s.
    sourceUrl: '',
    sessions: [],
    provenance: { catalog: true, lastObserved, status },
    timezone: 'America/New_York',
  };
}

/** Everything the crawl found, with the catalog's description attached. */
export function mergeCatalog(input: MergeInput): MergeResult {
  const { catalog, listed, previous = [], crawlDate } = input;

  // No catalog for this season — off-season, or a year nobody has transcribed.
  // The crawl still publishes; it simply carries no description.
  if (!catalog) {
    return {
      classes: listed.map((c) => ({
        ...c,
        catalogId: null,
        categories: categoriesFor(c.title, []),
        materials: null,
        fee: null,
        room: null,
        venues: [...new Set(c.sessions.map((s) => s.location).filter(Boolean))].sort(),
        weeks: [...new Set(c.sessions.map((s) => s.week))].sort((a, b) => a - b),
        scheduledWeeks: [],
        provenance: { catalog: false, lastObserved: crawlDate, status: 'listed' as const },
      })),
      summary: { matched: 0, listedOnly: listed.length, unobserved: 0, cancelled: 0 },
    };
  }

  // The join, resolved at build time: eventAk -> the catalog row it belongs to.
  const byEventAk = new Map<string, CatalogClass>();
  for (const c of catalog.classes) {
    for (const ak of c.eventAks) byEventAk.set(ak, c);
  }
  const knownVenues = [...new Set(catalog.classes.map((c) => c.location).filter(Boolean))];
  const weekEnds = new Map(
    Object.entries(catalog.weeks).map(([w, range]) => [Number(w), range[1]]),
  );

  let unplaceable = 0;
  const classes: ChqClass[] = listed.map((original) => {
    // Repaired before anything reads `week` — the union below, the card's
    // rows, the favourite keys and the week picker all key on it.
    const sessions: ClassSession[] = [];
    for (const sn of original.sessions) {
      const placed = placeSession(sn, catalog.weeks);
      if (placed) sessions.push(placed);
      else unplaceable++;
    }
    const c = { ...original, sessions };
    const cat = byEventAk.get(c.id);
    return {
      ...c,
      catalogId: cat?.id ?? null,
      categories: categoriesFor(c.title, cat?.categories ?? []),
      materials: cat?.materials ?? null,
      fee: cat?.fee ?? null,
      room: cat?.room ?? null,
      // The catalog's numbers beat a best-effort parse of the site's free
      // text — but only where it has them, so a class the catalog does not
      // cover keeps whatever the listing yielded.
      ageRange: cat && (cat.ageRange.min !== null || cat.ageRange.max !== null)
        ? cat.ageRange
        : c.ageRange,
      // Union rather than either alone. The catalog holds the weeks already
      // past, which the site has dropped; the crawl holds any the catalog did
      // not print, which is all a listing-only class has.
      weeks: [...new Set([...(cat?.weeks ?? []), ...c.sessions.map((s) => s.week)])]
        .sort((a, b) => a - b),
      scheduledWeeks: cat ? scheduledWeeksOf(cat, catalog.weeks) : [],
      venues: venuesFor(c, cat, knownVenues),
    };
  }).map((c) => ({
    ...c,
    provenance: { catalog: c.catalogId !== null, lastObserved: crawlDate, status: 'listed' as const },
  }));

  // Prior records reachable by catalog row, not just by id. A class listed
  // yesterday was stored under its eventAk; today, absent, it is looked up as
  // a catalog row — so without this the date it was last seen is lost at
  // exactly the moment it starts to matter.
  const priorByCatalogId = new Map<string, ChqClass>();
  for (const c of previous) {
    if (c.catalogId) priorByCatalogId.set(c.catalogId, c);
  }

  if (unplaceable > 0) {
    console.warn(
      `[classes] dropped ${unplaceable} session(s) with no readable week and no ` +
      'date that falls in one — they would have counted as week 0 everywhere',
    );
  }

  const seen = new Set(classes.map((c) => c.catalogId).filter(Boolean));
  const absent = catalog.classes
    .filter((c) => !seen.has(c.id))
    .map((c) => {
      const status = statusForAbsent(c.weeks, weekEnds, crawlDate);
      const prior = priorByCatalogId.get(c.id);
      return fromCatalogOnly(c, status, prior?.provenance.lastObserved ?? null, catalog.weeks);
    });

  return {
    classes: [...classes, ...absent],
    summary: {
      matched: classes.filter((c) => c.catalogId !== null).length,
      listedOnly: classes.filter((c) => c.catalogId === null).length,
      unobserved: absent.filter((c) => c.provenance.status === 'unobserved').length,
      cancelled: absent.filter((c) => c.provenance.status === 'cancelled').length,
    },
  };
}

/**
 * Every building a class meets in.
 *
 * The catalog's own name first, then each session's location reduced to a
 * building. The listing row is a last resort only: it is the one place some
 * classes have any location at all — no catalog row, no sessions left — but it
 * carries a room rather than a building, so using it alongside a known venue
 * would list the same place twice under two names.
 */
export function venuesFor(
  crawled: CrawledClass,
  cat: CatalogClass | undefined,
  knownVenues: string[],
): string[] {
  const known = [
    ...(cat?.location ? [cat.location] : []),
    ...crawled.sessions.map((sn) => venueOf(sn.location, knownVenues)),
  ].filter(Boolean);
  if (known.length > 0) return [...new Set(known)].sort();

  const fallback = crawled.location ? venueOf(crawled.location, knownVenues) : '';
  return fallback ? [fallback] : [];
}
