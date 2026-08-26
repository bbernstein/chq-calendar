import { getCategoryDisplayName, getLocationDisplayName } from '@/lib/constants';

export interface ActiveChip {
  key: string;
  category: 'search' | 'location' | 'tag' | 'favorites';
  prefix: string;
  label: string;
  onRemove: () => void;
}

interface BuildArgs {
  searchTerm: string;
  setSearchTerm: (s: string) => void;
  selectedLocations: string[];
  toggleLocation: (loc: string) => void;
  selectedTags: string[];
  toggleTag: (tag: string) => void;
  showFavoritesOnly: boolean;
  toggleFavoritesOnly: () => void;
}

/**
 * The chips for everything the reader has narrowed the list by.
 *
 * There is no date or week chip. Which part of the year is on screen is a
 * scroll position, not a filter, so there is nothing dateish left to remove
 * (#274 phase 4) — and the `When: Jul 4 – Jul 12` chip that named an expanded
 * window went with the window.
 */
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
