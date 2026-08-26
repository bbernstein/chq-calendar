import type { Event } from '@/lib/types';
import { searchEvents } from './searchHelpers';

export interface FilterOptions {
  searchTerm: string;
  selectedTagsLowerSet: Set<string>;
  selectedLocationsLowerSet: Set<string>;
  showFavoritesOnly?: boolean;
  favoriteIds?: Set<string>;
}

/**
 * There is no date stage. The list is the whole year, and which part of it the
 * reader is looking at is a scroll position, not a filter (#274 phase 4). The
 * merged date/week pass this replaced was the only thing in the pipeline that
 * needed `parseEventDate`, which is why that import is gone rather than
 * merely unused.
 */
export function filterEvents(events: Event[], options: FilterOptions): Event[] {
  let filtered = [...events];

  if (options.searchTerm) {
    filtered = searchEvents(filtered, options.searchTerm);
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
