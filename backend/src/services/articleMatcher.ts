import { createHash } from 'crypto';
import type {
  ArticleLinkKind,
  CalendarEventLite,
  DailyArticle,
  StoredArticle,
} from '../types/articles';

/**
 * Bump when weights, threshold, aliases, or signal logic change — forces a
 * one-time full recompute so scoring improvements apply retroactively.
 */
export const MATCHER_VERSION = 1;
export const MATCH_THRESHOLD = 0.6;
export const MAX_LINKS_PER_EVENT = 4;

const WEIGHTS = {
  venue: 0.3,
  people: 0.35,
  timeOfDay: 0.4,
  category: 0.15,
  proximityMax: 0.1,
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

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
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
 * HH:MM component.
 */
export function formatEventTimeAsPrinted(startDate: string): string | null {
  const m = startDate.match(/T(\d{2}):(\d{2})/);
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

  // Venue
  const eventVenue = canonicalVenue(event.venue?.name ?? event.location ?? '');
  if (eventVenue) {
    if (article.categories.some(c => canonicalVenue(c) === eventVenue)) {
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

  // Category alignment: any distinctive token shared between taxonomies
  const articleCatTokens = new Set(article.categories.flatMap(distinctiveTokens));
  const aligned = eventCategoryNames(event).some(name =>
    distinctiveTokens(name).some(t => articleCatTokens.has(t)),
  );
  if (aligned) {
    score += WEIGHTS.category;
    reasons.push('category');
  }

  // Date proximity (tiebreaker between recurring events)
  score += WEIGHTS.proximityMax * (1 - Math.min(Math.abs(diff), PREVIEW_WINDOW_DAYS) / PREVIEW_WINDOW_DAYS);

  if (score < MATCH_THRESHOLD) return null;

  const isRecapTagged = [...article.categories, ...article.tags].some(c => /recap/i.test(c));
  const kind: ArticleLinkKind = isRecapTagged || diff < 0 ? 'recap' : 'preview';
  return { score: Math.min(1, Number(score.toFixed(4))), reasons, kind };
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
