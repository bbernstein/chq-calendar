import type { Event, SeasonWeek } from '@/lib/types';
import { parseEventDate } from '@/lib/utils/chqTime';
import { calendarDaySpanOfWeek } from './dateHelpers';
import { windowContains, type ViewWindow } from './dayWindow';
import { searchEvents } from './searchHelpers';

export interface FilterOptions {
  searchTerm: string;
  selectedWeeks: number[];
  selectedTagsLowerSet: Set<string>;
  selectedLocationsLowerSet: Set<string>;
  seasonWeeks: SeasonWeek[];
  /**
   * The instant range the list is narrowed to, derived by `dayWindow`.
   * `null` means the current scope matches nothing — reachable only for
   * `'this-week'` outside the season.
   */
  viewWindow: ViewWindow | null;
  showFavoritesOnly?: boolean;
  favoriteIds?: Set<string>;
}

export function filterEvents(events: Event[], options: FilterOptions): Event[] {
  // A null window means the scope matches nothing. Returning early also
  // keeps the weeks/venue/category stages from running over a set that is
  // already empty.
  if (options.viewWindow === null) return [];

  let filtered = [...events];

  if (options.searchTerm) {
    filtered = searchEvents(filtered, options.searchTerm);
  }

  // The date and week stages, as one pass over the events.
  //
  // They are two independent, ANDed predicates and read as two stages, but
  // both need the event's start instant and `parseEventDate` is the most
  // expensive thing either of them does — a regex plus, for the feed's naive
  // wall-time strings, ~3 `Intl.formatToParts` round-trips. Run separately
  // they parsed the same event twice whenever both were active, over a
  // ~1,470-event corpus that `page.tsx` filters twice per filter change.
  // Merging them is worth the small loss in readability; nothing else in the
  // pipeline needs the parsed date, so this is the only place it happens.
  //
  // The date half: one half-open range check for every scope — the four
  // scope-specific predicates this replaced (isToday, isThisWeek, the
  // inline 'next' arithmetic, and 'all' doing nothing) all reduce to this
  // once the scope has been turned into a window.
  //
  // The week half: day-granular, matching the day header's `Wk 5/6` badge —
  // a boundary Saturday belongs to both adjacent weeks in full, so filtering
  // to week 5 no longer hands back only the half of that Saturday before noon
  // (#257). Each selected week becomes its day-granular instant range once,
  // below, leaving a pair of numeric comparisons per event; deriving the
  // event's week numbers per event instead would be the same answer at ~7
  // extra `Intl.formatToParts` round-trips each.
  const dateWindow = options.viewWindow;
  // `null` (rather than an empty array) means "no week narrowing at all". An
  // *empty* array is a real, different answer: it is what a selection of week
  // numbers the season does not have reduces to, and it must match nothing.
  const weekSpans = options.selectedWeeks.length > 0
    ? options.selectedWeeks
        .map(n => options.seasonWeeks[n - 1])
        .filter((w): w is SeasonWeek => w !== undefined)
        .map(calendarDaySpanOfWeek)
    : null;

  filtered = filtered.filter((event) => {
    const at = parseEventDate(event.startDate);
    if (!windowContains(dateWindow, at)) return false;
    if (weekSpans === null) return true;
    return weekSpans.some(s => at >= s.start && at < s.end);
  });

  // Location filter - case insensitive
  if (options.selectedLocationsLowerSet.size > 0) {
    filtered = filtered.filter(event => {
      if (event.location) {
        return options.selectedLocationsLowerSet.has(event.location.toLowerCase());
      }
      return false;
    });
  }

  // Tag filter - case insensitive (using pre-computed Sets for O(1) lookups)
  if (options.selectedTagsLowerSet.size > 0) {
    filtered = filtered.filter(event => {
      // Use pre-computed lowercase tag set if available
      if (event._tagsLowerSet) {
        for (const selectedTag of options.selectedTagsLowerSet) {
          if (event._tagsLowerSet.has(selectedTag)) {
            return true;
          }
        }
        return false;
      }

      // Fallback for events without pre-computed sets
      if (event.tags) {
        for (const eventTag of event.tags) {
          if (options.selectedTagsLowerSet.has(eventTag.toLowerCase())) {
            return true;
          }
        }
      }
      if (event.categories) {
        for (const eventCat of event.categories) {
          if (options.selectedTagsLowerSet.has(eventCat.name.toLowerCase())) {
            return true;
          }
        }
      }
      return false;
    });
  }

  // Favorites filter
  if (options.showFavoritesOnly) {
    if (!options.favoriteIds || options.favoriteIds.size === 0) {
      return [];
    }
    filtered = filtered.filter(event => options.favoriteIds!.has(event.id));
  }

  return filtered;
}
