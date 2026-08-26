/// <reference types="vitest/globals" />
import { buildActiveChips } from '@/components/filters/buildActiveChips';

function baseArgs(overrides: Partial<Parameters<typeof buildActiveChips>[0]> = {}): Parameters<typeof buildActiveChips>[0] {
  return {
    searchTerm: '',
    setSearchTerm: vi.fn(),
    selectedLocations: [],
    toggleLocation: vi.fn(),
    selectedTags: [],
    toggleTag: vi.fn(),
    showFavoritesOnly: false,
    toggleFavoritesOnly: vi.fn(),
    ...overrides,
  };
}

describe('buildActiveChips', () => {
  it('returns no chips when no filters are active', () => {
    expect(buildActiveChips(baseArgs())).toEqual([]);
  });

  it('emits a search chip whose remove callback clears the search term', () => {
    const setSearchTerm = vi.fn();
    const chips = buildActiveChips(baseArgs({ searchTerm: 'symphony', setSearchTerm }));
    expect(chips).toHaveLength(1);
    expect(chips[0].category).toBe('search');
    expect(chips[0].label).toBe('"symphony"');
    chips[0].onRemove();
    expect(setSearchTerm).toHaveBeenCalledWith('');
  });

  it('does not emit a search chip for whitespace-only search terms', () => {
    expect(buildActiveChips(baseArgs({ searchTerm: '   ' }))).toEqual([]);
  });

  it('trims surrounding whitespace from the search chip label', () => {
    const chips = buildActiveChips(baseArgs({ searchTerm: '  symphony  ' }));
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe('"symphony"');
  });

  it('emits a chip per location and removes via toggleLocation', () => {
    const toggleLocation = vi.fn();
    const chips = buildActiveChips(baseArgs({
      selectedLocations: ['Hall of Philosophy', 'Amphitheater'],
      toggleLocation,
    }));
    expect(chips).toHaveLength(2);
    chips[0].onRemove();
    expect(toggleLocation).toHaveBeenCalledWith('Hall of Philosophy');
  });

  it('emits a chip per tag and removes via toggleTag', () => {
    const toggleTag = vi.fn();
    const chips = buildActiveChips(baseArgs({
      selectedTags: ['Lecture', 'Music'],
      toggleTag,
    }));
    expect(chips).toHaveLength(2);
    chips[1].onRemove();
    expect(toggleTag).toHaveBeenCalledWith('Music');
  });

  it('emits a favorites chip whose remove flips toggleFavoritesOnly', () => {
    const toggleFavoritesOnly = vi.fn();
    const chips = buildActiveChips(baseArgs({ showFavoritesOnly: true, toggleFavoritesOnly }));
    expect(chips).toHaveLength(1);
    expect(chips[0].category).toBe('favorites');
    chips[0].onRemove();
    expect(toggleFavoritesOnly).toHaveBeenCalledTimes(1);
  });

  it('emits chips in a stable order: search, locations, tags, favorites', () => {
    const chips = buildActiveChips(baseArgs({
      searchTerm: 'q',
      selectedLocations: ['Hall'],
      selectedTags: ['Lecture'],
      showFavoritesOnly: true,
    }));
    expect(chips.map(c => c.category)).toEqual(['search', 'location', 'tag', 'favorites']);
  });
});
