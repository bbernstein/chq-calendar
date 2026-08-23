import type { Event, SeasonWeek } from '@/lib/types';
import { parseEventDate } from '@/lib/utils/chqTime';
import { weekNumbersForCalendarDate } from './dateHelpers';
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

  // The date stage. One half-open range check for every scope — the four
  // scope-specific predicates this replaced (isToday, isThisWeek, the
  // inline 'next' arithmetic, and 'all' doing nothing) all reduce to this
  // once the scope has been turned into a window.
  const dateWindow = options.viewWindow;
  filtered = filtered.filter((event) => windowContains(dateWindow, parseEventDate(event.startDate)));

  // Week filter (independent of date filter). Day-granular, matching the
  // day header's `Wk 5/6` badge: a boundary Saturday belongs to both adjacent
  // weeks in full, so filtering to week 5 no longer hands back only the half
  // of that Saturday before noon (#257). `parseEventDate` is expensive, so it
  // runs once per event here, not once per selected week.
  if (options.selectedWeeks.length > 0) {
    const selected = new Set(options.selectedWeeks);
    filtered = filtered.filter(event => {
      const numbers = weekNumbersForCalendarDate(parseEventDate(event.startDate), options.seasonWeeks);
      return numbers.some(n => selected.has(n));
    });
  }

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
