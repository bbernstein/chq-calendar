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

  describe('clearNonDateFilters', () => {
    it('clears search, tags, locations, and favorites but keeps dateFilter and selectedWeeks', () => {
      const { result } = renderHook(() => useFilterState());
      act(() => {
        result.current.setSearchTerm('symphony');
        result.current.toggleTag('Music');
        result.current.toggleLocation('Hall A');
        result.current.toggleFavoritesOnly();
        result.current.setDateFilter('today');
        result.current.setSelectedWeeks([2, 3]);
      });
      expect(result.current.hasDateFilters).toBe(true);
      expect(result.current.hasNonDateFilters).toBe(true);

      act(() => { result.current.clearNonDateFilters(); });

      expect(result.current.searchTerm).toBe('');
      expect(result.current.selectedTags).toEqual([]);
      expect(result.current.selectedLocations).toEqual([]);
      expect(result.current.showFavoritesOnly).toBe(false);
      expect(result.current.dateFilter).toBe('today');
      expect(result.current.selectedWeeks).toEqual([2, 3]);
      expect(result.current.hasDateFilters).toBe(true);
      expect(result.current.hasNonDateFilters).toBe(false);
      // hasFilters stays true because date filters remain
      expect(result.current.hasFilters).toBe(true);
    });
  });

  // Drives the day rail's funnel dot. The distinction from `hasFilters` is
  // the whole reason it exists: `hasFilters` is already true on a default
  // visit, so a dot driven by it is lit for every reader before they touch
  // anything and tells them nothing at all.
  describe('hasNonDefaultFilters', () => {
    it('is false on a default visit, where hasFilters is already true', () => {
      const { result } = renderHook(() => useFilterState());
      expect(result.current.dateFilter).toBe('next');
      expect(result.current.hasFilters).toBe(true);
      expect(result.current.hasNonDefaultFilters).toBe(false);
    });

    it('is true once the reader narrows the scope', () => {
      const { result } = renderHook(() => useFilterState());
      act(() => { result.current.setDateFilter('today'); });
      expect(result.current.hasNonDefaultFilters).toBe(true);
      act(() => { result.current.setDateFilter('this-week'); });
      expect(result.current.hasNonDefaultFilters).toBe(true);
    });

    // `all` is where an archived season starts (`reconcileFilters` with
    // `isCurrentYear: false`), and on the current year it widens rather than
    // narrows — either way the reader is looking at everything, which is the
    // one thing the dot must not claim is a slice.
    it('is false on the all-season scope, in either direction', () => {
      const { result } = renderHook(() => useFilterState());
      act(() => { result.current.setDateFilter('all'); });
      expect(result.current.hasNonDefaultFilters).toBe(false);
      act(() => { result.current.reconcileFilters([], [], false); });
      expect(result.current.dateFilter).toBe('all');
      expect(result.current.hasNonDefaultFilters).toBe(false);
    });

    it('is true for a week selection, a search, a venue, a category or favourites', () => {
      const { result } = renderHook(() => useFilterState());
      act(() => { result.current.setDateFilter('all'); });
      act(() => { result.current.setSelectedWeeks([3]); });
      expect(result.current.hasNonDefaultFilters).toBe(true);

      act(() => { result.current.setSelectedWeeks([]); });
      act(() => { result.current.setSearchTerm('symphony'); });
      expect(result.current.hasNonDefaultFilters).toBe(true);

      act(() => { result.current.setSearchTerm(''); });
      act(() => { result.current.toggleLocation('Amphitheater'); });
      expect(result.current.hasNonDefaultFilters).toBe(true);

      act(() => { result.current.toggleLocation('Amphitheater'); });
      act(() => { result.current.toggleFavoritesOnly(); });
      expect(result.current.hasNonDefaultFilters).toBe(true);
    });
  });

  describe('hasDateFilters / hasNonDateFilters', () => {
    it('hasDateFilters is true when dateFilter is non-all', () => {
      const { result } = renderHook(() => useFilterState());
      expect(result.current.hasDateFilters).toBe(true); // 'next' is the default
      act(() => { result.current.setDateFilter('all'); });
      expect(result.current.hasDateFilters).toBe(false);
      act(() => { result.current.setDateFilter('today'); });
      expect(result.current.hasDateFilters).toBe(true);
    });

    it('hasDateFilters is true when any week is selected, even with dateFilter=all', () => {
      const { result } = renderHook(() => useFilterState());
      act(() => { result.current.setDateFilter('all'); });
      expect(result.current.hasDateFilters).toBe(false);
      act(() => { result.current.setSelectedWeeks([1]); });
      expect(result.current.hasDateFilters).toBe(true);
    });

    it('hasNonDateFilters reflects only non-date filters', () => {
      const { result } = renderHook(() => useFilterState());
      expect(result.current.hasNonDateFilters).toBe(false);
      act(() => { result.current.setSearchTerm('q'); });
      expect(result.current.hasNonDateFilters).toBe(true);
      act(() => { result.current.setSearchTerm(''); });
      expect(result.current.hasNonDateFilters).toBe(false);
      act(() => { result.current.toggleLocation('Hall'); });
      expect(result.current.hasNonDateFilters).toBe(true);
      act(() => { result.current.toggleLocation('Hall'); }); // toggle off
      expect(result.current.hasNonDateFilters).toBe(false);
      act(() => { result.current.toggleFavoritesOnly(); });
      expect(result.current.hasNonDateFilters).toBe(true);
    });

    it('hasNonDateFilters ignores whitespace-only searchTerm to match chip rendering', () => {
      const { result } = renderHook(() => useFilterState());
      act(() => { result.current.setSearchTerm('   '); });
      // buildActiveChips trims before deciding to emit a chip; the boolean
      // must agree, otherwise the "Keep dates, show all" button can appear
      // for a filter that has no visible chip.
      expect(result.current.hasNonDateFilters).toBe(false);
    });
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

    it('clears the date window on reconciliation', () => {
      const { result } = renderHook(() => useFilterState());
      act(() => { result.current.expandWindowEnd('2026-07-16'); });
      act(() => { result.current.expandWindowStart('2026-07-13'); });

      act(() => {
        result.current.reconcileFilters([], [], true);
      });
      expect(result.current.windowEndDay).toBeNull();
      expect(result.current.windowStartDay).toBeNull();
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
