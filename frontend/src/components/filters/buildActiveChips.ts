import { getCategoryDisplayName, getLocationDisplayName } from '@/lib/constants';
import type { DateFilter } from '@/hooks/useFilterState';
import { formatDayRange, type ViewWindow } from '@/lib/utils/dayWindow';

export interface ActiveChip {
  key: string;
  category: 'search' | 'date' | 'week' | 'location' | 'tag' | 'favorites';
  prefix: string;
  label: string;
  onRemove: () => void;
}

const DATE_LABELS: Record<Exclude<DateFilter, 'all'>, string> = {
  next: 'Now',
  today: 'Today',
  'this-week': 'This Week',
  season: 'All Season',
};

interface BuildArgs {
  searchTerm: string;
  setSearchTerm: (s: string) => void;
  dateFilter: DateFilter;
  setDateFilter: (f: DateFilter) => void;
  selectedWeeks: number[];
  setSelectedWeeks: (next: number[] | ((prev: number[]) => number[])) => void;
  selectedLocations: string[];
  toggleLocation: (loc: string) => void;
  selectedTags: string[];
  toggleTag: (tag: string) => void;
  showFavoritesOnly: boolean;
  toggleFavoritesOnly: () => void;
  /** The window the list is actually showing, or null if the scope matches nothing. */
  viewWindow: ViewWindow | null;
  /** True once navigation has grown the window past the scope's own bounds. */
  windowExpanded: boolean;
  resetWindow: () => void;
}

export function buildActiveChips(args: BuildArgs): ActiveChip[] {
  const chips: ActiveChip[] = [];

  const trimmedSearch = args.searchTerm.trim();
  if (trimmedSearch) {
    chips.push({
      key: 'search',
      category: 'search',
      prefix: 'Search',
      label: `"${trimmedSearch}"`,
      onRemove: () => args.setSearchTerm(''),
    });
  }

  // Two chips' worth of meaning in one chip, because they are never both
  // true. An untouched window is exactly the scope, so the chip says the
  // scope's name and its ✕ clears the scope — unchanged behaviour for anyone
  // who never navigates. A window that has grown is no longer the scope, so
  // saying "Now" would be a lie about what is on screen; the chip names the
  // days instead and its ✕ puts the window back to the scope's base, leaving
  // the scope alone. That is the first of D3's two distinct escapes; the
  // second is ⟳ Now, which moves the reader without touching any filter.
  if (args.windowExpanded && args.viewWindow) {
    chips.push({
      key: 'date-window',
      category: 'date',
      prefix: 'When',
      label: formatDayRange(args.viewWindow.startDay, args.viewWindow.endDay),
      onRemove: () => args.resetWindow(),
    });
  } else if (args.dateFilter !== 'all') {
    chips.push({
      key: `date-${args.dateFilter}`,
      category: 'date',
      prefix: 'When',
      label: DATE_LABELS[args.dateFilter],
      onRemove: () => args.setDateFilter('all'),
    });
  }

  for (const week of args.selectedWeeks) {
    chips.push({
      key: `week-${week}`,
      category: 'week',
      prefix: '',
      label: `Week ${week}`,
      onRemove: () => args.setSelectedWeeks(prev => prev.filter(w => w !== week)),
    });
  }

  for (const location of args.selectedLocations) {
    chips.push({
      key: `loc-${location}`,
      category: 'location',
      prefix: 'Location',
      label: getLocationDisplayName(location),
      onRemove: () => args.toggleLocation(location),
    });
  }

  for (const tag of args.selectedTags) {
    chips.push({
      key: `tag-${tag}`,
      category: 'tag',
      prefix: 'Category',
      label: getCategoryDisplayName(tag),
      onRemove: () => args.toggleTag(tag),
    });
  }

  if (args.showFavoritesOnly) {
    chips.push({
      key: 'favorites',
      category: 'favorites',
      prefix: '',
      label: '★ Favorites only',
      onRemove: () => args.toggleFavoritesOnly(),
    });
  }

  return chips;
}
