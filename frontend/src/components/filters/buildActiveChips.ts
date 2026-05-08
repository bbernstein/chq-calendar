import { getCategoryDisplayName, getLocationDisplayName } from '@/lib/constants';

export interface ActiveChip {
  key: string;
  category: 'search' | 'date' | 'week' | 'location' | 'tag' | 'favorites';
  prefix: string;
  label: string;
  onRemove: () => void;
}

type DateFilter = 'all' | 'today' | 'next' | 'this-week';

const DATE_LABELS: Record<Exclude<DateFilter, 'all'>, string> = {
  next: 'Now',
  today: 'Today',
  'this-week': 'This Week',
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
}

export function buildActiveChips(args: BuildArgs): ActiveChip[] {
  const chips: ActiveChip[] = [];

  if (args.searchTerm.trim()) {
    chips.push({
      key: 'search',
      category: 'search',
      prefix: 'Search',
      label: `"${args.searchTerm}"`,
      onRemove: () => args.setSearchTerm(''),
    });
  }

  if (args.dateFilter !== 'all') {
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
