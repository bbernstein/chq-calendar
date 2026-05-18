import type { Event, SeasonWeek } from '@/lib/types';

// Lookup table for common HTML entities found in event data
const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&#x27;': "'",
  '&ndash;': '\u2013',
  '&mdash;': '\u2014',
  '&nbsp;': '\u00A0',
  '&lsquo;': '\u2018',
  '&rsquo;': '\u2019',
  '&ldquo;': '\u201C',
  '&rdquo;': '\u201D',
  '&hellip;': '\u2026',
  '&copy;': '\u00A9',
  '&reg;': '\u00AE',
  '&trade;': '\u2122',
  '&deg;': '\u00B0',
};

// Match named entities (&amp;) and numeric entities (&#123; &#x1F;)
const ENTITY_REGEX = /&(?:#x[\da-fA-F]+|#\d+|[a-zA-Z]+);/g;

export function decodeHtmlEntities(encodedString: string | undefined): string | undefined {
  if (!encodedString) return undefined;
  if (!encodedString.includes('&')) return encodedString;

  return encodedString.replace(ENTITY_REGEX, (match) => {
    // Check lookup table first (fast path)
    if (HTML_ENTITY_MAP[match]) return HTML_ENTITY_MAP[match];

    // Handle numeric entities: &#123; or &#x1F;
    if (match.startsWith('&#x')) {
      const code = parseInt(match.slice(3, -1), 16);
      return isNaN(code) ? match : String.fromCodePoint(code);
    }
    if (match.startsWith('&#')) {
      const code = parseInt(match.slice(2, -1), 10);
      return isNaN(code) ? match : String.fromCodePoint(code);
    }

    // Unknown named entity — return as-is
    return match;
  });
}

export function decodeEventHtmlEntities(event: Event): Event {
  const decodedTags = event.tags?.map(tag => decodeHtmlEntities(tag) || tag);
  const decodedCategories = event.categories?.map(cat => decodeHtmlEntities(cat.name) || cat.name);

  // Pre-compute lowercase tag set for efficient filtering
  const allTags: string[] = [];
  if (decodedTags) allTags.push(...decodedTags);
  if (decodedCategories) allTags.push(...decodedCategories);
  const _tagsLowerSet = new Set(allTags.map(tag => tag.toLowerCase()));

  // Extract location from venue if it exists, otherwise use location field
  const location = event.venue?.name
    ? (decodeHtmlEntities(event.venue.name) || event.venue.name)
    : (decodeHtmlEntities(event.location) || event.location);

  return {
    ...event,
    title: decodeHtmlEntities(event.title) || event.title,
    description: decodeHtmlEntities(event.description) || event.description,
    location: location,
    presenter: decodeHtmlEntities(event.presenter) || event.presenter,
    category: decodeHtmlEntities(event.category) || event.category,
    originalCategories: decodedCategories || [],
    tags: decodedTags,
    attachments: event.attachments?.map(att => ({
      ...att,
      type: decodeHtmlEntities(att.type) || att.type
    })),
    _tagsLowerSet
  };
}

export interface DayGroup {
  /** Stable key per calendar date (YYYY-MM-DD in local time). */
  key: string;
  /** Display label without the week part, e.g. "Saturday, July 4, 2026". */
  baseLabel: string;
  /** Season week numbers that span any portion of this calendar date (1-2 entries). */
  weekNumbers: number[];
  events: Event[];
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function weekNumbersForCalendarDate(date: Date, seasonWeeks: SeasonWeek[]): number[] {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  const numbers: number[] = [];
  for (const w of seasonWeeks) {
    if (w.start <= dayEnd && w.end > dayStart) {
      numbers.push(w.number);
    }
  }
  return numbers;
}

export function groupEventsByDay(events: Event[], seasonWeeks: SeasonWeek[]): DayGroup[] {
  const grouped = new Map<string, DayGroup>();

  for (const event of events) {
    const eventDate = new Date(event.startDate);
    const key = localDateKey(eventDate);
    let group = grouped.get(key);
    if (!group) {
      const baseLabel = eventDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      group = {
        key,
        baseLabel,
        weekNumbers: weekNumbersForCalendarDate(eventDate, seasonWeeks),
        events: [],
      };
      grouped.set(key, group);
    }
    group.events.push(event);
  }

  for (const group of grouped.values()) {
    group.events.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
  }

  return Array.from(grouped.values()).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
