import type { Event, SeasonWeek } from '@/lib/types';
import { isToday, isNext, isThisWeek, isInChautauquaWeek } from './dateHelpers';
import { searchEvents } from './searchHelpers';

export interface FilterOptions {
  searchTerm: string;
  dateFilter: 'all' | 'today' | 'next' | 'this-week';
  selectedWeeks: number[];
  selectedTagsLowerSet: Set<string>;
  selectedLocationsLowerSet: Set<string>;
  seasonWeeks: SeasonWeek[];
  currentWeekNumber: number | null;
}

export function filterEvents(events: Event[], options: FilterOptions): Event[] {
  let filtered = [...events];

  // Search filter
  if (options.searchTerm) {
    filtered = searchEvents(filtered, options.searchTerm);
  }

  // Date filter
  if (options.dateFilter === 'today') {
    filtered = filtered.filter(event => isToday(event.startDate));
  } else if (options.dateFilter === 'next') {
    filtered = filtered.filter(event => isNext(event.startDate));
  } else if (options.dateFilter === 'this-week') {
    filtered = filtered.filter(event => isThisWeek(event.startDate, options.seasonWeeks, options.currentWeekNumber));
  }

  // Week filter (independent of date filter)
  if (options.selectedWeeks.length > 0) {
    filtered = filtered.filter(event =>
      options.selectedWeeks.some(weekNum => isInChautauquaWeek(event.startDate, weekNum, options.seasonWeeks))
    );
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

  return filtered;
}
