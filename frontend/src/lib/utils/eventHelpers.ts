import type { Event, SeasonWeek } from '@/lib/types';
import { getWeekNumberForDate } from './dateHelpers';

export function decodeHtmlEntities(encodedString: string | undefined): string | undefined {
  if (!encodedString) return undefined;
  if (!encodedString.includes('&')) return encodedString;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(encodedString, 'text/html');
    const decoded = doc.documentElement.textContent || encodedString;
    return decoded;
  } catch (error) {
    console.warn('Failed to decode HTML entities:', encodedString, error);
    return encodedString;
  }
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
