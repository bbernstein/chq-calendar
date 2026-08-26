/// <reference types="vitest/globals" />
import { renderHook, act } from '@testing-library/preact';
import { useFilterState } from '@/hooks/useFilterState';

describe('useFilterState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // The payload below is exactly what the version BEFORE #274 phase 4 wrote,
  // date fields included, and the assertions say none of it comes back as
  // state. Nothing is migrated: there is no field left for a scope or a week
  // selection to mean anything in.
  it('a payload written by the previous version loads, and restores nothing date-shaped', () => {
    localStorage.setItem('chq-calendar-user-state', JSON.stringify({
      searchTerm: 'organ', selectedTags: ['Music'], selectedLocations: [],
      dateFilter: 'this-week', selectedWeeks: [3, 4],
      expandedDescriptions: [], recentLocations: [], recentCategories: [],
      showFavoritesOnly: false, lastSaved: Date.now(),
    }));

    const { result } = renderHook(() => useFilterState());

    expect(result.current.searchTerm).toBe('organ');
    expect(result.current.selectedTags).toEqual(['Music']);
    expect(result.current).not.toHaveProperty('dateFilter');
    expect(result.current).not.toHaveProperty('selectedWeeks');
    expect(result.current.hasFilters).toBe(true);
  });

  it('an untouched visit has no filters', () => {
    const { result } = renderHook(() => useFilterState());
    expect(result.current.hasFilters).toBe(false);
  });

  it('loads saved searchTerm and selections synchronously', () => {
    localStorage.setItem('chq-calendar-user-state', JSON.stringify({
      searchTerm: 'symphony',
      selectedTags: ['Music'], selectedLocations: ['Hall A'],
      expandedDescriptions: [], recentLocations: [], recentCategories: [],
      showFavoritesOnly: true,
      lastSaved: Date.now(),
    }));
    // No act() / no second render — the synchronous lazy initializer must
    // produce the loaded state on the first render, otherwise a reader's
    // saved filters would flash off and back on.
    const { result } = renderHook(() => useFilterState());
    expect(result.current.searchTerm).toBe('symphony');
    expect(result.current.selectedTags).toEqual(['Music']);
    expect(result.current.selectedLocations).toEqual(['Hall A']);
    expect(result.current.showFavoritesOnly).toBe(true);
  });

  it('ignores expired saved state and falls back to defaults', () => {
    const longAgo = Date.now() - (40 * 24 * 60 * 60 * 1000); // 40 days, expiry is 30
    localStorage.setItem('chq-calendar-user-state', JSON.stringify({
      searchTerm: 'stale', selectedTags: [], selectedLocations: [],
      expandedDescriptions: [], recentLocations: [], recentCategories: [],
      showFavoritesOnly: false,
      lastSaved: longAgo,
    }));
    const { result } = renderHook(() => useFilterState());
    expect(result.current.searchTerm).toBe('');
    expect(result.current.hasFilters).toBe(false);
  });

  // The single "the reader has narrowed the list" flag, and the one thing the
  // day rail's funnel dot is driven by. There used to be three of these
  // (`hasDateFilters`, `hasNonDateFilters`, `hasNonDefaultFilters`) purely
  // because the app started on the `next` scope, so a date filter was always
  // in effect and a dot driven by "any filter" was lit before the reader
  // touched anything.
  describe('hasFilters', () => {
    it('reflects each kind of filter, and goes back to false when it is undone', () => {
      const { result } = renderHook(() => useFilterState());
      expect(result.current.hasFilters).toBe(false);

      act(() => { result.current.setSearchTerm('q'); });
      expect(result.current.hasFilters).toBe(true);
      act(() => { result.current.setSearchTerm(''); });
      expect(result.current.hasFilters).toBe(false);

      act(() => { result.current.toggleLocation('Hall'); });
      expect(result.current.hasFilters).toBe(true);
      act(() => { result.current.toggleLocation('Hall'); });
      expect(result.current.hasFilters).toBe(false);

      act(() => { result.current.toggleTag('Music'); });
      expect(result.current.hasFilters).toBe(true);
      act(() => { result.current.toggleTag('Music'); });
      expect(result.current.hasFilters).toBe(false);

      act(() => { result.current.toggleFavoritesOnly(); });
      expect(result.current.hasFilters).toBe(true);
    });

    it('ignores a whitespace-only searchTerm, to match chip rendering', () => {
      const { result } = renderHook(() => useFilterState());
      act(() => { result.current.setSearchTerm('   '); });
      // buildActiveChips trims before deciding to emit a chip; the boolean
      // must agree, otherwise the funnel dot lights for a filter that has no
      // visible chip to remove.
      expect(result.current.hasFilters).toBe(false);
    });
  });

  describe('clearFilters', () => {
    it('clears search, tags, locations and favourites', () => {
      const { result } = renderHook(() => useFilterState());
      act(() => {
        result.current.setSearchTerm('symphony');
        result.current.toggleTag('Music');
        result.current.toggleLocation('Hall A');
        result.current.toggleFavoritesOnly();
      });
      expect(result.current.hasFilters).toBe(true);

      act(() => { result.current.clearFilters(); });

      expect(result.current.searchTerm).toBe('');
      expect(result.current.selectedTags).toEqual([]);
      expect(result.current.selectedLocations).toEqual([]);
      expect(result.current.showFavoritesOnly).toBe(false);
      expect(result.current.hasFilters).toBe(false);
    });
  });

  describe('reconcileFilters', () => {
    it('removes tags not available in the new year', () => {
      const { result } = renderHook(() => useFilterState());
      act(() => { result.current.setAvailableCategories(['Music', 'Art', 'Dance']); });
      act(() => { result.current.toggleTag('Music'); });
      act(() => { result.current.toggleTag('Dance'); });
      expect(result.current.selectedTags).toEqual(['Music', 'Dance']);

      // Reconcile with only Music available (Dance removed in new year)
      act(() => {
        result.current.reconcileFilters(['Music', 'Art'], ['Hall A']);
      });
      expect(result.current.selectedTags).toEqual(['Music']);
    });

    it('removes locations not available in the new year', () => {
      const { result } = renderHook(() => useFilterState());
      act(() => { result.current.toggleLocation('Hall A'); });
      act(() => { result.current.toggleLocation('Hall B'); });
      expect(result.current.selectedLocations).toEqual(['Hall A', 'Hall B']);

      // Reconcile with only Hall A available
      act(() => {
        result.current.reconcileFilters(['Music'], ['Hall A']);
      });
      expect(result.current.selectedLocations).toEqual(['Hall A']);
    });

    it('preserves searchTerm on reconciliation', () => {
      const { result } = renderHook(() => useFilterState());
      act(() => { result.current.setSearchTerm('symphony'); });
      act(() => { result.current.reconcileFilters([], []); });
      expect(result.current.searchTerm).toBe('symphony');
    });

    it('preserves the favourites toggle on reconciliation', () => {
      const { result } = renderHook(() => useFilterState());
      act(() => { result.current.toggleFavoritesOnly(); });
      act(() => { result.current.reconcileFilters([], []); });
      expect(result.current.showFavoritesOnly).toBe(true);
    });
  });
});
