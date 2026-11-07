/**
 * What the live feeds can support, surveyed from Node before any page opens.
 *
 * Several checks need something specific from the data: a day with enough
 * events on it to be tall, or a search term confined to one week of the
 * season. Those used to be assumptions — "the default year is dense", "the
 * Colonial Williamsburg residency is in week 6" — and both broke on
 * 2026-10-01, when the manifest's `defaultYear` rolled over to 2027. That year
 * was already published, but SPARSE: 52 events over 37 days, never more than
 * three on one day, and no Williamsburg programme at all. The app was right
 * about every one of them; the harness had written the 2026 season down.
 *
 * So these questions are asked of the feed on every run, through the same
 * origin the app itself reads (`/cache` is proxied to production by
 * `vite.config.ts` for the preview server CI uses), and the answer moves with
 * the data.
 */

const feedUrl = (base, file) => new URL(`cache/calendar-cache/${file}`, base).toString();

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`feed survey: ${url} answered ${res.status}`);
  return res.json();
}

export async function fetchManifest(base) {
  return getJson(feedUrl(base, 'years.json'));
}

/** The per-year file `useEventData` reads — never the unsuffixed every-year blob. */
export async function fetchYear(base, year) {
  const { data } = await getJson(feedUrl(base, `all-events-${year}.json`));
  return Array.isArray(data) ? data : [];
}

const dayOf = e => (e.startDate ?? '').slice(0, 10);

/** The largest number of events on any single day of `events`. */
export function busiestDay(events) {
  const per = new Map();
  for (const e of events) per.set(dayOf(e), (per.get(dayOf(e)) ?? 0) + 1);
  let best = { day: null, count: 0 };
  for (const [day, count] of per) {
    if (count > best.count || (count === best.count && day < best.day)) best = { day, count };
  }
  return best;
}

/**
 * The years worth trying for a check that needs a day with `minEvents` or more
 * events on it, in the order to try them: the default year first if it
 * qualifies, then the archived years that do, newest first.
 *
 * The default year goes first on purpose. It is what a reader actually opens,
 * and in season it is dense — so the fallback to an archived year is only
 * taken while the coming season is still sparse (October to roughly June), and
 * the default-year path keeps running for the rest of the year rather than
 * rotting. Archived years come next because a year that has run is complete
 * and stays complete; a future year can be emptier than the default one.
 *
 * Returns the full survey alongside, so a caller that finds nothing can say
 * what each year offered instead of failing on an empty list.
 */
export async function yearsWithBusyDay(base, minEvents) {
  const manifest = await fetchManifest(base);
  const survey = [];
  for (const year of manifest.years) {
    const events = await fetchYear(base, year).catch(() => []);
    survey.push({ year, events: events.length, busiest: busiestDay(events) });
  }
  const fits = s => s.busiest.count >= minEvents;
  const ordered = [
    ...survey.filter(s => s.year === manifest.defaultYear && fits(s)),
    ...survey.filter(s => s.year < manifest.defaultYear && fits(s)).sort((a, b) => b.year - a.year),
  ].map(s => s.year);
  return { defaultYear: manifest.defaultYear, years: ordered, survey };
}

/** One line per year, for a detail string: `2027: 52 events, busiest 3 (2027-08-20)`. */
export function describeSurvey(survey) {
  return survey
    .map(s => `${s.year}: ${s.events} events, busiest ${s.busiest.count}` +
      (s.busiest.day ? ` (${s.busiest.day})` : ''))
    .join('; ');
}

/**
 * The opening Saturday of `year`'s season, as a day key: the Saturday before
 * the fourth Sunday of June — the rule `getChautauquaSeasonWeeks` implements
 * and `verify-full-list`'s check 6 reads back.
 */
export function seasonStartDay(year) {
  const june1 = new Date(Date.UTC(year, 5, 1));
  const firstSunday = 1 + ((7 - june1.getUTCDay()) % 7);
  return new Date(Date.UTC(year, 5, firstSunday + 21 - 1)).toISOString().slice(0, 10);
}

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/**
 * The season weeks a day belongs to: one, or two for a boundary Saturday,
 * which opens one week and closes the previous (`weekBands.ts`). Empty outside
 * the nine weeks.
 */
export function seasonWeeksOf(day, start, weeks = 9) {
  const d = daysBetween(start, day);
  if (d < 0 || d > weeks * 7) return [];
  const out = [];
  const n = Math.floor(d / 7) + 1;
  if (d % 7 === 0 && n > 1) out.push(n - 1);
  if (n <= weeks) out.push(n);
  return out;
}

/** The haystacks `searchEvents` (searchHelpers.ts) scores a term against. */
function haystacks(e) {
  return [
    e.title, e.description, e.presenter, e.location,
    ...(e.tags ?? []), ...(e.categories ?? []).map(c => c?.name),
  ].filter(Boolean).map(s => String(s).toLowerCase());
}

/**
 * A one-word search term whose matches all fall inside ONE week of the
 * default year's season, while the season has events in other weeks too.
 *
 * `verify-rail`'s checks 18 and 20h need the rail to show a week the reader
 * cannot reach — which an unfiltered feed never produces, so it has to be
 * constructed with a search. They used to hardcode `'williamsburg'`, Colonial
 * Williamsburg's week-6 residency in 2026; the 2027 feed has no such event, so
 * the seeded search matched nothing, the list emptied, and `enterList` threw
 * on the generic empty state — taking every check after 17 with it.
 *
 * One word, because `searchEvents` splits a term on spaces and scores each
 * word on its own: "Chris Hayes" would also match every "Christian". The match
 * rule here is that function's, restated (lower-cased substring of title,
 * description, presenter, location, tags or category names) — and it is a
 * PREDICTION, nothing more. The checks never trust it: `18-pre` and
 * `20h-pre` measure what the app's rail actually did with the term, and fail
 * if it left no week reachable or none unreachable. A wrong prediction costs a
 * red check, never a vacuous green one.
 *
 * Among qualifying words the one matching the most events wins, then
 * alphabetical, so a run is reproducible against one snapshot of the feed.
 */
export function isolatingSearchTerm(events, year) {
  const start = seasonStartDay(year);
  const inSeason = events.filter(e => seasonWeeksOf(dayOf(e), start).length > 0);
  const weeksWithEvents = new Set(inSeason.flatMap(e => seasonWeeksOf(dayOf(e), start)));
  if (weeksWithEvents.size < 2) {
    return { term: null, why: `the ${year} season has events in ${weeksWithEvents.size} week(s); ` +
      'no search can leave one reachable and another not' };
  }
  const indexed = events.map(e => ({ day: dayOf(e), hay: haystacks(e) }));
  const words = new Set();
  for (const e of inSeason) {
    for (const w of (e.title ?? '').toLowerCase().match(/[a-z]{5,}/g) ?? []) words.add(w);
  }
  let best = null;
  for (const word of [...words].sort()) {
    const hits = indexed.filter(e => e.hay.some(h => h.includes(word)));
    const weeks = new Set(hits.flatMap(h => seasonWeeksOf(h.day, start)));
    // Every hit inside the season, and inside one week of it. A boundary
    // Saturday counts towards both of its weeks, so a term whose only days
    // are such a Saturday reaches two — still a strict subset of nine.
    const confined = hits.length > 0
      && hits.every(h => seasonWeeksOf(h.day, start).length > 0)
      && new Set(hits.map(h => seasonWeeksOf(h.day, start).at(-1))).size === 1;
    if (!confined) continue;
    if (!best || hits.length > best.events) {
      best = { term: word, events: hits.length, days: [...new Set(hits.map(h => h.day))].sort(), weeks: [...weeks].sort((a, b) => a - b) };
    }
  }
  return best ?? { term: null, why: `no title word in the ${year} feed is confined to one season week` };
}
