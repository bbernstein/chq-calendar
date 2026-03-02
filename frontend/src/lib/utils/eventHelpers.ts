import type { Event, SeasonWeek } from '@/lib/types';
import { getWeekNumberForDate } from './dateHelpers';

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

export function groupEventsByDay(events: Event[], seasonWeeks: SeasonWeek[]): Array<{ day: string; events: Event[] }> {
  const grouped: { [key: string]: Event[] } = {};

  events.forEach(event => {
    const eventDate = new Date(event.startDate);
    const baseDayKey = eventDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Add week number to the day label
    const weekNumber = getWeekNumberForDate(eventDate, seasonWeeks);
    const dayKey = weekNumber
      ? `${baseDayKey} - Week ${weekNumber}`
      : baseDayKey;

    if (!grouped[dayKey]) {
      grouped[dayKey] = [];
    }
    grouped[dayKey].push(event);
  });

  // Sort events within each day by start time
  Object.keys(grouped).forEach(dayKey => {
    grouped[dayKey].sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
  });

  // Return days sorted by date
  const sortedDays = Object.keys(grouped).sort((a, b) => {
    const dateA = new Date(grouped[a][0].startDate);
    const dateB = new Date(grouped[b][0].startDate);
    return dateA.getTime() - dateB.getTime();
  });

  return sortedDays.map(dayKey => ({
    day: dayKey,
    events: grouped[dayKey]
  }));
}
