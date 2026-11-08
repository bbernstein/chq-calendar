/**
 * What the live feeds can support, surveyed from Node alongside the pages.
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
 * So these questions are asked of the feed on every run, and the answer moves
 * with the data.
 *
 * ## The survey reads what the PAGE read, not what it is assumed to read
 *
 * `useEventData` picks its base at build time — `/data` under the dev server,
 * `/cache/calendar-cache` in a build (proxied to production by `vite.config.ts`
 * for the preview server CI uses) — and merges the publisher sidecar
 * `publisher-events-<year>.json` into the year when
 * `VITE_ENABLE_PUBLISHER_FEEDS` is on, which it is for the CI browser-checks
 * build (`build-and-test.yml`) and for production. A survey with its own
 * hardcoded base and no sidecar could pick a year, or a search term, out of a
 * data set the page is not showing. So `learnFeedSource(page)` reads the
 * page's own network log after its first load — the URL of the
 * `all-events-<year>` file it fetched, the `years.json` it fetched, and whether
 * it asked for a publisher sidecar — and every survey below reads from exactly
 * those. `enterList` calls it on the run's first page; a survey before that
 * throws, as an ordering bug, the way `currentRegime()` does.
 */
let source = null;

/**
 * Learn where the page reads its data from. Idempotent; a later page that read
 * from somewhere else is a harness bug and throws.
 */
export async function learnFeedSource(page) {
  // Playwright's own request log first (`page.requests()`, the last ~100):
  // the suites pin the page clock, and `page.clock` replaces `performance`
  // with a fake whose resource-timing buffer is empty — measured, the first
  // version of this read `[]` on every pinned page. The in-page resource
  // timing is kept as a second source for a page that is not pinned.
  const wanted = n => /\/(years\.json|all-events-\d{4}\.json|publisher-events-\d{4}\.json)(\?|$)/.test(n);
  const logged = typeof page.requests === 'function'
    ? (await page.requests()).map(r => r.url())
    : [];
  const timed = await page.evaluate(() => {
    try { return performance.getEntriesByType('resource').map(e => e.name); } catch { return []; }
  });
  const seen = [...new Set([...logged, ...timed])].filter(wanted);
  const events = seen.find(n => /\/all-events-\d{4}\.json/.test(n));
  const manifest = seen.find(n => /\/years\.json/.test(n));
  // A LATER page that no longer has the requests in view — `page.requests()`
  // keeps about the last hundred, and a mounted 2026 season can load more
  // images than that — confirms nothing and contradicts nothing. Only the
  // first page has to be able to answer.
  if (source && (!events || !manifest)) return source;
  if (!events || !manifest) {
    throw new Error(
      'learnFeedSource: the page has no resource entry for years.json and an ' +
      `all-events-<year>.json, so the survey cannot know what it read: ${JSON.stringify(seen)}`
    );
  }
  const learned = {
    base: events.replace(/all-events-\d{4}\.json.*$/, ''),
    manifest: manifest.replace(/\?.*$/, ''),
    publisher: seen.some(n => /\/publisher-events-\d{4}\.json/.test(n)),
  };
  // Compared on the base only. Whether the sidecar request shows up in
  // resource timing is a property of the build, but a sidecar aborted by the
  // app's 3s timeout may leave no entry, and that must not be read as a page
  // reading from somewhere else.
  if (source && source.base !== learned.base) {
    throw new Error(`learnFeedSource: this run read ${JSON.stringify(source)} and a later page ` +
      `read ${JSON.stringify(learned)}`);
  }
  if (!source) {
    source = learned;
    console.log(`feed: ${source.base} (publisher sidecar ${source.publisher ? 'merged' : 'off'})`);
  }
  return source;
}

export const feedSourceKnown = () => source !== null;

function need() {
  if (!source) throw new Error('feed survey before any page taught it the feed source — ordering bug');
  return source;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`feed survey: ${url} answered ${res.status}`);
  return res.json();
}

/**
 * The years manifest the page read. Not cached and not softened: without it
 * there is no default year to reason about, and a suite that cannot learn one
 * should stop loudly rather than guess.
 */
export async function fetchManifest() {
  return getJson(need().manifest);
}

/**
 * One JSON file as `{ data, missing, error }`. Only a 404 is `missing`; every
 * other failure is an `error` with `data` null.
 */
async function readFeed(url) {
  try {
    const res = await fetch(url);
    if (res.status === 404) return { data: [], missing: true, error: null };
    if (!res.ok) return { data: null, missing: false, error: `${url} answered ${res.status}` };
    const body = await res.json();
    if (!Array.isArray(body?.data)) return { data: null, missing: false, error: `${url} has no data array` };
    return { data: body.data, missing: false, error: null };
  } catch (e) {
    return { data: null, missing: false, error: `${url}: ${e.message}` };
  }
}

/**
 * The year as the page shows it — `all-events-<year>.json`, plus the publisher
 * sidecar when the page asked for one, merged the way `useEventData` merges
 * it (appended, deduplicated by `id`, entries without an id dropped) — as
 * `{ year, events, missing, error }`.
 *
 * **Only a 404 means "no feed".** Every other failure — a 5xx, a network
 * error, a body that is not the feed's shape — is an `error`, and `events` is
 * `null`, not `[]`. The first version caught everything into an empty list,
 * so a transient 502 on the DEFAULT year would have read as "2027: 0 events"
 * and quietly moved checks 12, 4, 10, 18 and 20h onto an archived season with
 * a detail line that looked like a fact about the data. (A published-but-empty
 * year is a 200 with `data: []` — 2028 is one today — so `missing` and an
 * empty `events` are different answers, and both honest.)
 *
 * The sidecar is optional in the app: any failure there falls back to the
 * primary alone. Here a 404 is "no publisher events" — the normal state for
 * every year at the time of writing — but any OTHER sidecar failure is an
 * error too, because the page may well have received the sidecar the survey
 * just failed to fetch, and the two would then disagree about the year.
 *
 * Cached per process and year: each feed is several MB (2026 is ~5MB) and a
 * suite asks for the same year up to four times. The cache holds the PROMISE,
 * so concurrent callers share one request.
 */
const yearCache = new Map();
export function loadYear(year) {
  const { base, publisher } = need();
  const key = `${base}|${publisher}|${year}`;
  if (!yearCache.has(key)) {
    yearCache.set(key, (async () => {
      const primary = await readFeed(`${base}all-events-${year}.json`);
      if (primary.error) return { year, events: null, missing: false, error: primary.error };
      let events = primary.data;
      if (publisher) {
        const side = await readFeed(`${base}publisher-events-${year}.json`);
        if (side.error) return { year, events: null, missing: false, error: `publisher sidecar: ${side.error}` };
        const seen = new Set(events.map(e => e.id));
        events = events.concat(side.data.filter(e => e && e.id && !seen.has(e.id)));
      }
      return { year, events, missing: primary.missing, error: null };
    })());
  }
  return yearCache.get(key);
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
export async function yearsWithBusyDay(minEvents) {
  const manifest = await fetchManifest();
  const survey = [];
  for (const year of manifest.years) {
    const { events, missing, error } = await loadYear(year);
    survey.push({ year, events: events?.length ?? null, missing, error,
      busiest: events ? busiestDay(events) : { day: null, count: 0 } });
  }
  // A year whose feed could not be READ is never a candidate — and when that
  // year is the default one, the caller is told, through `defaultError`, so it
  // can fail rather than fall back. Falling back would be choosing an archived
  // season because of a network blip, and saying so in a line that reads as
  // data.
  const fits = s => !s.error && s.busiest.count >= minEvents;
  const ordered = [
    ...survey.filter(s => s.year === manifest.defaultYear && fits(s)),
    ...survey.filter(s => s.year < manifest.defaultYear && fits(s)).sort((a, b) => b.year - a.year),
  ].map(s => s.year);
  const defaultError = survey.find(s => s.year === manifest.defaultYear)?.error ?? null;
  return { defaultYear: manifest.defaultYear, defaultError, years: ordered, survey };
}

/**
 * '' when every year's feed was read, otherwise `; feed trouble: …` naming the
 * years that failed. Appended to every PASSING detail that came out of a
 * survey, so a feed outage on an archived year — which never turns a check
 * red by itself — is still on the page rather than only in the failure path.
 */
export function surveyTrouble(survey) {
  const bad = survey.filter(s => s.error);
  return bad.length ? `; feed trouble: ${bad.map(s => `${s.year} ${s.error}`).join('; ')}` : '';
}

/**
 * One clause per year, for a detail string:
 * `2027: 52 events, busiest 3 (2027-08-20)`, `2029: no feed (404)`, or
 * `2026: FETCH FAILED (… answered 502)` — so a fallback, or the lack of one,
 * explains itself.
 */
export function describeSurvey(survey) {
  return survey
    .map(s => s.error ? `${s.year}: FETCH FAILED (${s.error})`
      : s.missing ? `${s.year}: no feed (404)`
      : `${s.year}: ${s.events} events, busiest ${s.busiest.count}` +
        (s.busiest.day ? ` (${s.busiest.day})` : ''))
    .join('; ');
}

/**
 * The opening Saturday of `year`'s season, as a day key: the Saturday before
 * the fourth Sunday of June.
 *
 * **A restatement, not the source of truth.** The rule lives in the app's
 * `getChautauquaSeasonWeeks` (`src/lib/utils/dateHelpers.ts`), which these
 * plain-Node scripts cannot import. `verify-full-list`'s check 6 carries a
 * third copy. So `verify-rail`'s check 8f compares this, and `seasonWeeksOf`'s
 * nine-week end, against the rail's own first and last chip for the year on
 * screen, and fails when they disagree — the rail is built from
 * `getChautauquaSeasonWeeks`, so a drift in either copy shows up there before
 * it can mislead `isolatingSearchTerm` about which week a day is in.
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

/**
 * `decodeHtmlEntities` (`src/lib/utils/eventHelpers.ts`), restated: these
 * scripts are plain Node and cannot import the app's TypeScript. Same table,
 * same regex, same numeric handling, same "unknown entity stays as-is".
 */
const HTML_ENTITY_MAP = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&apos;': "'", '&#x27;': "'", '&ndash;': '\u2013', '&mdash;': '\u2014',
  '&nbsp;': '\u00A0', '&lsquo;': '\u2018', '&rsquo;': '\u2019',
  '&ldquo;': '\u201C', '&rdquo;': '\u201D', '&hellip;': '\u2026',
  '&copy;': '\u00A9', '&reg;': '\u00AE', '&trade;': '\u2122', '&deg;': '\u00B0',
};
const ENTITY_REGEX = /&(?:#x[\da-fA-F]+|#\d+|[a-zA-Z]+);/g;
function decodeHtmlEntities(str) {
  if (!str) return str;
  const s = String(str);
  if (!s.includes('&')) return s;
  return s.replace(ENTITY_REGEX, (m) => {
    if (HTML_ENTITY_MAP[m]) return HTML_ENTITY_MAP[m];
    if (m.startsWith('&#x')) { const c = parseInt(m.slice(3, -1), 16); return isNaN(c) ? m : String.fromCodePoint(c); }
    if (m.startsWith('&#')) { const c = parseInt(m.slice(2, -1), 10); return isNaN(c) ? m : String.fromCodePoint(c); }
    return m;
  });
}

/**
 * The haystacks `searchEvents` (searchHelpers.ts) scores a term against, built
 * the way the app builds them: `decodeEventHtmlEntities` (eventHelpers.ts)
 * decodes title, description, presenter, tags and category names, and
 * replaces `location` with the decoded `venue.name` whenever there is one.
 * The first version read the raw `location` and undecoded strings, so a term
 * matching only a venue name, or only across an `&amp;`, was predicted wrong.
 */
function haystacks(e) {
  const location = e.venue?.name ? decodeHtmlEntities(e.venue.name) : decodeHtmlEntities(e.location);
  return [
    decodeHtmlEntities(e.title), decodeHtmlEntities(e.description),
    decodeHtmlEntities(e.presenter), location,
    ...(e.tags ?? []).map(decodeHtmlEntities),
    ...(e.categories ?? []).map(c => decodeHtmlEntities(c?.name)),
  ].filter(Boolean).map(x => String(x).toLowerCase());
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
    for (const w of (decodeHtmlEntities(e.title) ?? '').toLowerCase().match(/[a-z]{5,}/g) ?? []) words.add(w);
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
