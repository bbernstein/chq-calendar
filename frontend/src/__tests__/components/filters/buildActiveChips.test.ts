/// <reference types="vitest/globals" />
import { buildActiveChips } from '@/components/filters/buildActiveChips';

function makeArgs(overrides: Partial<Parameters<typeof buildActiveChips>[0]> = {}): Parameters<typeof buildActiveChips>[0] {
  return {
    searchTerm: '',
    setSearchTerm: vi.fn(),
    dateFilter: 'all',
    setDateFilter: vi.fn(),
    selectedWeeks: [],
    setSelectedWeeks: vi.fn(),
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
    expect(buildActiveChips(makeArgs())).toEqual([]);
  });

  it('emits a search chip whose remove callback clears the search term', () => {
    const setSearchTerm = vi.fn();
    const chips = buildActiveChips(makeArgs({ searchTerm: 'symphony', setSearchTerm }));
    expect(chips).toHaveLength(1);
    expect(chips[0].category).toBe('search');
    expect(chips[0].label).toBe('"symphony"');
    chips[0].onRemove();
    expect(setSearchTerm).toHaveBeenCalledWith('');
  });

  it('does not emit a search chip for whitespace-only search terms', () => {
    expect(buildActiveChips(makeArgs({ searchTerm: '   ' }))).toEqual([]);
  });

  it('trims surrounding whitespace from the search chip label', () => {
    const chips = buildActiveChips(makeArgs({ searchTerm: '  symphony  ' }));
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe('"symphony"');
  });

  it('emits a date chip with a friendly label and a remove that resets to "all"', () => {
    const setDateFilter = vi.fn();
    const chips = buildActiveChips(makeArgs({ dateFilter: 'next', setDateFilter }));
    expect(chips).toHaveLength(1);
    expect(chips[0].category).toBe('date');
    expect(chips[0].label).toBe('Now');
    chips[0].onRemove();
    expect(setDateFilter).toHaveBeenCalledWith('all');
  });

  it('emits no date chip when dateFilter is "all"', () => {
    expect(buildActiveChips(makeArgs({ dateFilter: 'all' }))).toEqual([]);
  });

  it('emits one chip per selected week with the label "Week N"', () => {
    const setSelectedWeeks = vi.fn();
    const chips = buildActiveChips(makeArgs({ selectedWeeks: [1, 3, 5], setSelectedWeeks }));
    expect(chips.map(c => c.label)).toEqual(['Week 1', 'Week 3', 'Week 5']);
  });

  it('week chip remove only filters out its own week (closure captures the right value)', () => {
    let weeks = [1, 3, 5];
    const setSelectedWeeks = vi.fn((updater: number[] | ((prev: number[]) => number[])) => {
      weeks = typeof updater === 'function' ? updater(weeks) : updater;
    });
    const chips = buildActiveChips(makeArgs({ selectedWeeks: weeks, setSelectedWeeks }));
    chips[1].onRemove();
    expect(weeks).toEqual([1, 5]);
  });

  it('emits a chip per location and removes via toggleLocation', () => {
    const toggleLocation = vi.fn();
    const chips = buildActiveChips(makeArgs({
      selectedLocations: ['Hall of Philosophy', 'Amphitheater'],
      toggleLocation,
    }));
    expect(chips).toHaveLength(2);
    chips[0].onRemove();
    expect(toggleLocation).toHaveBeenCalledWith('Hall of Philosophy');
  });

  it('emits a chip per tag and removes via toggleTag', () => {
    const toggleTag = vi.fn();
    const chips = buildActiveChips(makeArgs({
      selectedTags: ['Lecture', 'Music'],
      toggleTag,
    }));
    expect(chips).toHaveLength(2);
    chips[1].onRemove();
    expect(toggleTag).toHaveBeenCalledWith('Music');
  });

  it('emits a favorites chip whose remove flips toggleFavoritesOnly', () => {
    const toggleFavoritesOnly = vi.fn();
    const chips = buildActiveChips(makeArgs({ showFavoritesOnly: true, toggleFavoritesOnly }));
    expect(chips).toHaveLength(1);
    expect(chips[0].category).toBe('favorites');
    chips[0].onRemove();
    expect(toggleFavoritesOnly).toHaveBeenCalledTimes(1);
  });

  it('emits chips in a stable order: search, date, weeks, locations, tags, favorites', () => {
    const chips = buildActiveChips(makeArgs({
      searchTerm: 'q',
      dateFilter: 'today',
      selectedWeeks: [2],
      selectedLocations: ['Hall'],
      selectedTags: ['Lecture'],
      showFavoritesOnly: true,
    }));
    expect(chips.map(c => c.category)).toEqual(['search', 'date', 'week', 'location', 'tag', 'favorites']);
  });
});
