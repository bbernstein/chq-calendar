/// <reference types="vitest/globals" />
import { renderHook, act } from '@testing-library/preact';
import { useFilterState } from '@/hooks/useFilterState';

describe('useFilterState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with dateFilter set to next', () => {
    const { result } = renderHook(() => useFilterState());
    expect(result.current.dateFilter).toBe('next');
  });

  it('loads saved dateFilter from localStorage on the very first render (no flicker)', () => {
    localStorage.setItem('chq-calendar-user-state', JSON.stringify({
      searchTerm: '', selectedTags: [], selectedLocations: [],
      dateFilter: 'today', selectedWeeks: [],
      expandedDescriptions: [], recentLocations: [], recentCategories: [],
      showFavoritesOnly: false,
      lastSaved: Date.now(),
    }));
    const { result } = renderHook(() => useFilterState());
    // No act() / no second render — the synchronous lazy initializer must
    // produce the loaded state on the first render, otherwise the "Now"
    // button would briefly highlight before the loaded state replaces it.
    expect(result.current.dateFilter).toBe('today');
  });

  it('loads saved searchTerm and selections synchronously', () => {
    localStorage.setItem('chq-calendar-user-state', JSON.stringify({
      searchTerm: 'symphony',
      selectedTags: ['Music'], selectedLocations: ['Hall A'],
      dateFilter: 'all', selectedWeeks: [3, 4],
      expandedDescriptions: [], recentLocations: [], recentCategories: [],
      showFavoritesOnly: true,
      lastSaved: Date.now(),
    }));
    const { result } = renderHook(() => useFilterState());
    expect(result.current.searchTerm).toBe('symphony');
    expect(result.current.selectedTags).toEqual(['Music']);
    expect(result.current.selectedLocations).toEqual(['Hall A']);
    expect(result.current.selectedWeeks).toEqual([3, 4]);
    expect(result.current.showFavoritesOnly).toBe(true);
    expect(result.current.dateFilter).toBe('all');
  });

  it('ignores expired saved state and falls back to defaults', () => {
    const longAgo = Date.now() - (40 * 24 * 60 * 60 * 1000); // 40 days, expiry is 30
    localStorage.setItem('chq-calendar-user-state', JSON.stringify({
      searchTerm: 'stale', selectedTags: [], selectedLocations: [],
      dateFilter: 'today', selectedWeeks: [],
      expandedDescriptions: [], recentLocations: [], recentCategories: [],
      showFavoritesOnly: false,
      lastSaved: longAgo,
    }));
    const { result } = renderHook(() => useFilterState());
    expect(result.current.searchTerm).toBe('');
    expect(result.current.dateFilter).toBe('next');
  });

  describe('reconcileFilters', () => {
    it('sets dateFilter to next when reconciling for the current year', () => {
      const { result } = renderHook(() => useFilterState());
      // Set dateFilter to something else first
      act(() => { result.current.setDateFilter('all'); });
      expect(result.current.dateFilter).toBe('all');

      act(() => {
        result.current.reconcileFilters(['Music', 'Art'], ['Hall A'], true);
      });
      expect(result.current.dateFilter).toBe('next');
    });

    it('sets dateFilter to all when reconciling for a non-current year', () => {
      const { result } = renderHook(() => useFilterState());
      // Start with dateFilter as 'next' (default)
      expect(result.current.dateFilter).toBe('next');

      act(() => {
        result.current.reconcileFilters(['Music', 'Art'], ['Hall A'], false);
      });
      expect(result.current.dateFilter).toBe('all');
    });

    it('clears selected weeks on reconciliation', () => {
      const { result } = renderHook(() => useFilterState());
      act(() => { result.current.setSelectedWeeks([1, 2, 3]); });
      expect(result.current.selectedWeeks).toEqual([1, 2, 3]);

      act(() => {
        result.current.reconcileFilters(['Music'], ['Hall A'], false);
      });
      expect(result.current.selectedWeeks).toEqual([]);
    });

    it('removes tags not available in the new year', () => {
      const { result } = renderHook(() => useFilterState());
      act(() => { result.current.setAvailableCategories(['Music', 'Art', 'Dance']); });
      act(() => { result.current.toggleTag('Music'); });
      act(() => { result.current.toggleTag('Dance'); });
      expect(result.current.selectedTags).toEqual(['Music', 'Dance']);

      // Reconcile with only Music available (Dance removed in new year)
      act(() => {
        result.current.reconcileFilters(['Music', 'Art'], ['Hall A'], false);
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
        result.current.reconcileFilters(['Music'], ['Hall A'], true);
      });
      expect(result.current.selectedLocations).toEqual(['Hall A']);
    });

    it('clears extraDays on reconciliation', () => {
      const { result } = renderHook(() => useFilterState());
      act(() => { result.current.addExtraDay(); });
      act(() => { result.current.addExtraDay(); });

      act(() => {
        result.current.reconcileFilters([], [], true);
      });
      expect(result.current.extraDays).toBe(0);
    });

    it('preserves searchTerm on reconciliation', () => {
      const { result } = renderHook(() => useFilterState());
      act(() => { result.current.setSearchTerm('symphony'); });
      act(() => { result.current.reconcileFilters([], [], false); });
      expect(result.current.searchTerm).toBe('symphony');
    });

    it('sets dateFilter back to next when returning to current year', () => {
      const { result } = renderHook(() => useFilterState());
      act(() => { result.current.reconcileFilters([], [], false); });
      expect(result.current.dateFilter).toBe('all');
      act(() => { result.current.reconcileFilters([], [], true); });
      expect(result.current.dateFilter).toBe('next');
    });
  });
});
