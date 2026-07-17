import { createHash } from 'crypto';
import type {
  ArticleLinkKind,
  CalendarEventLite,
  DailyArticle,
  MatchRecord,
  MatchState,
  PublishedArticleLink,
  StoredArticle,
} from '../types/articles';
import { normalize } from './textNormalize';
import { conceptsFor, conceptsInBody } from './chqConcepts';

/**
 * Bump when weights, threshold, aliases, or signal logic change — forces a
 * one-time full recompute so scoring improvements apply retroactively.
 */
export const MATCHER_VERSION = 6;
export const MATCH_THRESHOLD = 0.6;
export const MAX_LINKS_PER_EVENT = 4;

const WEIGHTS = {
  venue: 0.3,
  people: 0.35,
  timeOfDay: 0.4,
  category: 0.15,
  proximityMax: 0.1,
  // Bonus when a performer/title match AND an exact-program (concept) match
  // co-fire — a strong joint identifier that survives a venue change.
  peopleConceptBonus: 0.05,
} as const;

/** Event date must fall within [pubDate - RECAP_DAYS, pubDate + PREVIEW_DAYS]. */
const RECAP_WINDOW_DAYS = 3;
const PREVIEW_WINDOW_DAYS = 7;

/** canonical (normalized) venue → aliases as they appear in Daily copy. */
const VENUE_ALIASES: Record<string, string[]> = {
  amphitheater: ['amp', 'the amp', 'amphitheatre'],
  'elizabeth s lenna hall': ['lenna hall'],
  'bratton theater': ['bratton theatre'],
};

const STOPWORDS = new Set([
  'the', 'and', 'with', 'from', 'that', 'this', 'for', 'week',
  'chautauqua', 'institution', 'series', 'lecture', 'lectures', 'morning',
  'afternoon', 'evening', 'event', 'events', 'presents', 'present', 'special',
  'featuring', 'performance', 'concert', 'program', 'daily', 'season', 'opens',
]);

export interface PairScore {
  score: number;
  reasons: string[];
  kind: ArticleLinkKind;
}

/** Local calendar date (YYYY-MM-DD) from a site-local ISO string. */
function localDate(iso: string): string {
  return iso.slice(0, 10);
}

/** Whole days from dateB to dateA (both YYYY-MM-DD). */
function dayDiff(dateA: string, dateB: string): number {
  const [ay, am, ad] = dateA.split('-').map(Number);
  const [by, bm, bd] = dateB.split('-').map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
}

/**
 * Render an event start time the way the Daily prints it: "10:45 a.m.",
 * "2 p.m.", "12 p.m." (noon). Returns null when startDate has no parseable
 * HH:MM component. Accepts either date/time separator — production events use
 * a space ("2026-07-16 20:00:00"), not "T" (issue #140).
 */
export function formatEventTimeAsPrinted(startDate: string): string | null {
  const m = startDate.match(/[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const hour24 = Number(m[1]);
  const minute = Number(m[2]);
  if (hour24 > 23 || minute > 59) return null;
  const ampm = hour24 < 12 ? 'a.m.' : 'p.m.';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return minute === 0 ? `${hour12} ${ampm}` : `${hour12}:${String(minute).padStart(2, '0')} ${ampm}`;
}

/** Canonical venue key for comparison; unknown venues normalize to themselves. */
function canonicalVenue(name: string): string {
  const n = normalize(name);
  if (!n) return '';
  for (const [canon, aliases] of Object.entries(VENUE_ALIASES)) {
    if (n === canon || aliases.includes(n)) return canon;
  }
  return n;
}

/** True when the normalized text mentions the canonical venue or an alias. */
function venueMentioned(normalizedText: string, canonVenue: string): boolean {
  const names = [canonVenue, ...(VENUE_ALIASES[canonVenue] ?? [])];
  return names.some(v => v.length > 2 && normalizedText.includes(` ${v} `));
}

function distinctiveTokens(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter(t => t.length >= 4 && !STOPWORDS.has(t));
}

function eventCategoryNames(e: CalendarEventLite): string[] {
  const names = (e.categories ?? []).map(c => c.name);
  if (e.category) names.push(e.category);
  return names;
}

/**
 * Score one (article, event) pair. Returns null below MATCH_THRESHOLD or
 * outside the date gate. Deterministic; no I/O.
 */
export function scorePair(article: StoredArticle, event: CalendarEventLite): PairScore | null {
  const eventDate = localDate(event.startDate);
  const pubDate = localDate(article.pubDate);
  const diff = dayDiff(eventDate, pubDate); // >0: article precedes event (preview direction)
  if (diff < -RECAP_WINDOW_DAYS || diff > PREVIEW_WINDOW_DAYS) return null;

  let score = 0;
  const reasons: string[] = [];
  const normBody = ` ${normalize(`${article.excerptText} ${article.bodyText}`)} `;

  // Venue. The Daily files an event's venue as a structured taxonomy term, but
  // inconsistently: sometimes a WP category ("Amphitheater" on a symphony
  // preview), sometimes only a post_tag ("Amphitheater" on a morning-lecture
  // preview — its categories are just Lectures/Morning Lecture). Read BOTH, the
  // same way the people and category signals already do (article.tags feeds
  // both) — otherwise a venue named only in a tag is missed and, with no prose
  // mention to fall back on, a 0.30 signal silently vanishes (event 98373).
  const eventVenue = canonicalVenue(event.venue?.name ?? event.location ?? '');
  if (eventVenue) {
    if ([...article.categories, ...article.tags].some(c => canonicalVenue(c) === eventVenue)) {
      score += WEIGHTS.venue;
      reasons.push('venue-category');
    } else if (venueMentioned(normBody, eventVenue)) {
      score += WEIGHTS.venue;
      reasons.push('venue-body');
    }
  }

  // People / title overlap
  const articleTokens = new Set(distinctiveTokens(`${article.title} ${article.tags.join(' ')}`));
  const presenterTokens = distinctiveTokens(event.presenter ?? '');
  const surname = presenterTokens[presenterTokens.length - 1];
  const titleOverlap = distinctiveTokens(event.title).filter(t => articleTokens.has(t));
  if ((surname && articleTokens.has(surname)) || titleOverlap.length >= 2) {
    score += WEIGHTS.people;
    reasons.push('people');
  }

  // Time-of-day: printed start time + today/tonight on the event's own day
  if (diff === 0) {
    const printed = formatEventTimeAsPrinted(event.startDate);
    const rawText = `${article.excerptText} ${article.bodyText}`.toLowerCase();
    if (
      printed &&
      rawText.includes(printed) &&
      /\b(today|tonight|this morning|this afternoon|this evening)\b/.test(rawText)
    ) {
      score += WEIGHTS.timeOfDay;
      reasons.push('time-of-day');
    }
  }

  // Category alignment, most-precise tier first (at most one fires):
  //  1. concept match — bridges acronyms / short↔long vocabulary (CSO ↔
  //     "Chautauqua Symphony Orchestra/Classical Concerts"). Now also reads
  //     article.tags, where the Daily often puts the program shorthand.
  //  2. raw distinctive-token overlap — the original fallback, over tags too.
  //  3. bounded prose corroboration — half credit, multi-word phrases only.
  const eventCatNames = eventCategoryNames(event);
  const eventConcepts = new Set(eventCatNames.flatMap(name => [...conceptsFor(name)]));
  const articleCatSources = [...article.categories, ...article.tags];
  const articleConcepts = new Set(articleCatSources.flatMap(s => [...conceptsFor(s)]));

  if ([...eventConcepts].some(k => articleConcepts.has(k))) {
    score += WEIGHTS.category;
    reasons.push('category-concept');
  } else {
    const articleCatTokens = new Set(articleCatSources.flatMap(distinctiveTokens));
    const tokenAligned = eventCatNames.some(name =>
      distinctiveTokens(name).some(t => articleCatTokens.has(t)),
    );
    if (tokenAligned) {
      score += WEIGHTS.category;
      reasons.push('category-token');
    } else {
      const bodyConcepts = conceptsInBody(normBody);
      if ([...eventConcepts].some(k => bodyConcepts.has(k))) {
        score += WEIGHTS.category * 0.5;
        reasons.push('category-body');
      }
    }
  }

  // Corroboration bonus: a performer/title match AND an exact-program (concept)
  // match together identify an event with high confidence even when the venue
  // disagrees — e.g. a concert moved indoors after the Daily's preview ran, so
  // the article still names the old venue. Gated on BOTH signals, so it never
  // rescues a weak single match: venue + concept without people is still
  // 0.30 + 0.15 + 0.10 = 0.55 < 0.60.
  if (reasons.includes('people') && reasons.includes('category-concept')) {
    score += WEIGHTS.peopleConceptBonus;
    reasons.push('people-concept-corroboration');
  }

  // Date proximity (tiebreaker between recurring events)
  score += WEIGHTS.proximityMax * (1 - Math.min(Math.abs(diff), PREVIEW_WINDOW_DAYS) / PREVIEW_WINDOW_DAYS);

  // Round once so the threshold comparison and the published score agree at
  // the boundary (avoids a raw 0.59996 that rounds to 0.6000 being rejected).
  const finalScore = Math.min(1, Number(score.toFixed(4)));
  if (finalScore < MATCH_THRESHOLD) return null;

  const isRecapTagged = [...article.categories, ...article.tags].some(c => /recap/i.test(c));
  // A recap is either explicitly tagged, or published after the event started.
  // Compare full site-local ISO timestamps (not just calendar dates) so an
  // evening recap of a morning/afternoon event is classified correctly instead
  // of slipping through as a same-day "preview". Both are local wall-clock with
  // no offset, so a lexicographic comparison is timezone-safe — but the WP
  // pubDate uses a "T" separator while event startDate uses a space, and 'T' >
  // ' ' would flag every same-day article a recap. Normalize the separator
  // first (issue #140).
  const publishedAfterEventStart =
    article.pubDate.replace(' ', 'T') > event.startDate.replace(' ', 'T');
  const kind: ArticleLinkKind = isRecapTagged || publishedAfterEventStart ? 'recap' : 'preview';
  return { score: finalScore, reasons, kind };
}

export function computeArticleContentHash(a: DailyArticle): string {
  return createHash('sha256')
    .update(JSON.stringify([a.title, a.bodyText, a.excerptText, a.categories, a.tags, a.pubDate]))
    .digest('hex');
}

export function computeEventFingerprint(e: CalendarEventLite): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        e.id,
        e.title,
        e.startDate,
        e.location ?? null,
        e.venue?.name ?? null,
        e.category ?? null,
        (e.categories ?? []).map(c => c.name),
        e.presenter ?? null,
      ]),
    )
    .digest('hex');
}

export interface MatchComputation {
  state: MatchState;
  links: Record<string, PublishedArticleLink[]>;
  /** True when the published sidecar content would differ from the previous run. */
  linksChanged: boolean;
  /** True when the private state object needs re-saving. */
  stateChanged: boolean;
}

/**
 * Canonical serialization of the published-link set, order-independent. Keyed
 * on (eventId, wpPostId, kind) plus the matched article's contentHash so that
 * an article edit changing its displayed title/pubDate — even one that still
 * matches the same events — flips `linksChanged` and republishes the sidecar.
 * The raw score is deliberately excluded: a score-only change (same articles,
 * same kinds, same order) does not alter the published sidecar, so it must not
 * force a republish.
 */
function canonicalMatches(matches: MatchRecord[], hashes: Record<string, string>): string {
  return JSON.stringify(
    [...matches]
      .sort((a, b) => a.eventId.localeCompare(b.eventId) || a.wpPostId - b.wpPostId)
      .map(m => [m.eventId, m.wpPostId, m.kind, hashes[String(m.wpPostId)] ?? '']),
  );
}

function buildLinks(
  matches: MatchRecord[],
  articleById: Map<string, StoredArticle>,
  eventDateById: Map<string, string>,
): Record<string, PublishedArticleLink[]> {
  const byEvent = new Map<string, MatchRecord[]>();
  for (const m of matches) {
    if (!byEvent.has(m.eventId)) byEvent.set(m.eventId, []);
    byEvent.get(m.eventId)!.push(m);
  }
  const links: Record<string, PublishedArticleLink[]> = {};
  for (const [eventId, ms] of byEvent) {
    const entries = ms
      .map(m => {
        const a = articleById.get(String(m.wpPostId));
        if (!a) return null;
        return { title: a.title, url: a.link, kind: m.kind, pubDate: a.pubDate.slice(0, 10) };
      })
      .filter((l): l is PublishedArticleLink => l !== null);

    // Recurring events (a symphony that plays several nights, a chaplain who
    // preaches daily) pull previews/recaps of their OTHER occurrences into the
    // date window. The article closest in time is the one actually about this
    // occurrence, so keep only the latest preview date and the earliest recap
    // date that is on/after the event (a recap of a prior occurrence can be
    // recap-tagged yet dated before this event). Same-day siblings on those
    // dates all survive, so a program note + a piece note for one concert both
    // show.
    const eventDate = eventDateById.get(eventId) ?? '';
    const previews = entries.filter(e => e.kind === 'preview');
    const recaps = entries.filter(e => e.kind === 'recap');
    const kept: PublishedArticleLink[] = [];
    if (previews.length > 0) {
      const latest = previews.reduce((mx, e) => (e.pubDate > mx ? e.pubDate : mx), previews[0].pubDate);
      kept.push(...previews.filter(e => e.pubDate === latest));
    }
    if (recaps.length > 0) {
      const postEvent = recaps.filter(e => e.pubDate >= eventDate);
      const pool = postEvent.length > 0 ? postEvent : recaps;
      const earliest = pool.reduce((mn, e) => (e.pubDate < mn ? e.pubDate : mn), pool[0].pubDate);
      kept.push(...pool.filter(e => e.pubDate === earliest));
    }

    const ordered = kept
      .sort((x, y) =>
        x.kind === y.kind ? x.pubDate.localeCompare(y.pubDate) : x.kind === 'preview' ? -1 : 1,
      )
      .slice(0, MAX_LINKS_PER_EVENT);
    if (ordered.length > 0) links[eventId] = ordered;
  }
  return links;
}

/**
 * Incremental matching: rescore only pairs involving a changed article or a
 * changed event; carry everything else over from prevState. A matcherVersion
 * mismatch (or missing prevState) forces a full recompute.
 */
export function computeMatchState(input: {
  articles: StoredArticle[];
  events: CalendarEventLite[];
  prevState?: MatchState;
}): MatchComputation {
  const { articles, events, prevState } = input;
  const fullRecompute = !prevState || prevState.matcherVersion !== MATCHER_VERSION;

  const articleById = new Map(articles.map(a => [String(a.wpPostId), a]));
  const eventIds = new Set(events.map(e => e.id));

  const articleHashes: Record<string, string> = {};
  const dirtyArticles = new Set<string>();
  for (const a of articles) {
    const key = String(a.wpPostId);
    articleHashes[key] = a.contentHash;
    if (fullRecompute || prevState!.articleHashes[key] !== a.contentHash) dirtyArticles.add(key);
  }

  const eventFingerprints: Record<string, string> = {};
  const dirtyEvents = new Set<string>();
  for (const e of events) {
    const fp = computeEventFingerprint(e);
    eventFingerprints[e.id] = fp;
    if (fullRecompute || prevState!.eventFingerprints[e.id] !== fp) dirtyEvents.add(e.id);
  }

  const kept = fullRecompute
    ? []
    : prevState!.matches.filter(
        m =>
          articleById.has(String(m.wpPostId)) &&
          eventIds.has(m.eventId) &&
          !dirtyArticles.has(String(m.wpPostId)) &&
          !dirtyEvents.has(m.eventId),
      );

  const rescored: MatchRecord[] = [];
  for (const a of articles) {
    const aDirty = dirtyArticles.has(String(a.wpPostId));
    for (const e of events) {
      if (!aDirty && !dirtyEvents.has(e.id)) continue;
      const r = scorePair(a, e);
      if (r) rescored.push({ eventId: e.id, wpPostId: a.wpPostId, ...r });
    }
  }

  const matches = kept.concat(rescored);
  const state: MatchState = { matcherVersion: MATCHER_VERSION, articleHashes, eventFingerprints, matches };
  const eventDateById = new Map(events.map(e => [e.id, e.startDate.slice(0, 10)]));
  // A matcherVersion bump (fullRecompute) changes how links are derived from
  // matches, so always republish then — canonicalMatches compares the match set
  // and can't see buildLinks-level changes on its own.
  const linksChanged =
    !prevState ||
    fullRecompute ||
    canonicalMatches(matches, articleHashes) !==
      canonicalMatches(prevState.matches, prevState.articleHashes);
  const stateChanged =
    fullRecompute || linksChanged || dirtyArticles.size > 0 || dirtyEvents.size > 0 ||
    Object.keys(prevState!.articleHashes).length !== articles.length ||
    Object.keys(prevState!.eventFingerprints).length !== events.length;

  return { state, links: buildLinks(matches, articleById, eventDateById), linksChanged, stateChanged };
}
