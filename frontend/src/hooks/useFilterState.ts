import { useReducer, useCallback, useEffect, useMemo } from 'react';
import { USER_STATE_EXPIRY_MS } from '@/lib/constants';

interface FilterState {
  searchTerm: string;
  selectedTags: string[];
  selectedLocations: string[];
  expandedDescriptions: Set<string>;
  recentLocations: string[];
  recentCategories: string[];
  availableCategories: string[];
  availableLocations: string[];
  showFavoritesOnly: boolean;
}

type FilterAction =
  | { type: 'SET_SEARCH'; payload: string }
  | { type: 'TOGGLE_TAG'; payload: string }
  | { type: 'TOGGLE_LOCATION'; payload: string }
  | { type: 'TOGGLE_DESCRIPTION'; payload: string }
  | { type: 'SET_AVAILABLE_CATEGORIES'; payload: string[] }
  | { type: 'SET_AVAILABLE_LOCATIONS'; payload: string[] }
  | { type: 'TOGGLE_FAVORITES_ONLY' }
  | { type: 'RECONCILE_FILTERS'; payload: { availableCategories: string[]; availableLocations: string[] } }
  | { type: 'CLEAR_FILTERS' };

function addToRecent(item: string, items: string[], max: number = 10): string[] {
  return [item, ...items.filter(i => i !== item)].slice(0, max);
}

function toggleInList(list: string[], item: string): string[] {
  const lower = item.toLowerCase();
  const existing = list.find(t => t.toLowerCase() === lower);
  return existing ? list.filter(t => t.toLowerCase() !== lower) : [...list, item];
}

function filterReducer(state: FilterState, action: FilterAction): FilterState {
  switch (action.type) {
    case 'SET_SEARCH':
      return { ...state, searchTerm: action.payload };
    case 'TOGGLE_TAG': {
      const tag = action.payload;
      const wasSelected = state.selectedTags.some(t => t.toLowerCase() === tag.toLowerCase());
      const newTags = toggleInList(state.selectedTags, tag);
      const newRecent = (!wasSelected && state.availableCategories.includes(tag))
        ? addToRecent(tag, state.recentCategories)
        : state.recentCategories;
      return { ...state, selectedTags: newTags, recentCategories: newRecent };
    }
    case 'TOGGLE_LOCATION': {
      const loc = action.payload;
      const wasSelected = state.selectedLocations.some(l => l.toLowerCase() === loc.toLowerCase());
      const newLocs = toggleInList(state.selectedLocations, loc);
      const newRecent = !wasSelected ? addToRecent(loc, state.recentLocations) : state.recentLocations;
      return { ...state, selectedLocations: newLocs, recentLocations: newRecent };
    }
    case 'TOGGLE_DESCRIPTION': {
      const newSet = new Set(state.expandedDescriptions);
      if (newSet.has(action.payload)) { newSet.delete(action.payload); } else { newSet.add(action.payload); }
      return { ...state, expandedDescriptions: newSet };
    }
    case 'SET_AVAILABLE_CATEGORIES':
      return { ...state, availableCategories: action.payload };
    case 'SET_AVAILABLE_LOCATIONS':
      return { ...state, availableLocations: action.payload };
    case 'TOGGLE_FAVORITES_ONLY':
      return { ...state, showFavoritesOnly: !state.showFavoritesOnly };
    case 'RECONCILE_FILTERS': {
      // Categories and locations only. This used to choose a scope as well —
      // `next` for the current year, `all` for an archived one — and take an
      // `isCurrentYear` flag purely to make that choice. With no scope left
      // there is nothing year-relative to reconcile: a category or venue that
      // the newly-selected year does not have is the whole subject (#274
      // phase 4).
      const { availableCategories, availableLocations } = action.payload;
      const availCatsLower = new Set(availableCategories.map(c => c.toLowerCase()));
      const availLocsLower = new Set(availableLocations.map(l => l.toLowerCase()));
      return {
        ...state,
        selectedTags: state.selectedTags.filter(t => availCatsLower.has(t.toLowerCase())),
        selectedLocations: state.selectedLocations.filter(l => availLocsLower.has(l.toLowerCase())),
      };
    }
    case 'CLEAR_FILTERS':
      return { ...state, searchTerm: '', selectedTags: [], selectedLocations: [], showFavoritesOnly: false };
    default:
      return state;
  }
}

const initialState: FilterState = {
  searchTerm: '',
  selectedTags: [],
  selectedLocations: [],
  expandedDescriptions: new Set(),
  recentLocations: [],
  recentCategories: [],
  availableCategories: [],
  availableLocations: [],
  showFavoritesOnly: false,
};

function loadInitialState(): FilterState {
  try {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('chq-calendar-user-state') : null;
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.lastSaved && Date.now() - parsed.lastSaved < USER_STATE_EXPIRY_MS) {
        // An old payload's `dateFilter`/`selectedWeeks` are ignored, not
        // migrated — there is no field left for them to mean anything in.
        // The reverse direction is safe too and is why nothing needs a
        // version bump: an old build reading a new payload finds
        // `parsed.dateFilter === undefined` and falls back to `'next'`
        // through its own `|| 'next'`, so a reader who downgrades gets the
        // old default rather than a crash.
        return {
          ...initialState,
          searchTerm: parsed.searchTerm || '',
          selectedTags: parsed.selectedTags || [],
          selectedLocations: parsed.selectedLocations || [],
          expandedDescriptions: new Set<string>(parsed.expandedDescriptions || []),
          recentLocations: parsed.recentLocations || [],
          recentCategories: parsed.recentCategories || [],
          showFavoritesOnly: parsed.showFavoritesOnly || false,
        };
      }
    }
  } catch (e) { console.warn('Failed to load user state:', e); }
  return initialState;
}

export function useFilterState() {
  const [state, dispatch] = useReducer(filterReducer, undefined, loadInitialState);

  // Actions
  const setSearchTerm = useCallback((term: string) => dispatch({ type: 'SET_SEARCH', payload: term }), []);
  const toggleTag = useCallback((tag: string) => dispatch({ type: 'TOGGLE_TAG', payload: tag }), []);
  const toggleLocation = useCallback((loc: string) => dispatch({ type: 'TOGGLE_LOCATION', payload: loc }), []);
  const toggleDescription = useCallback((id: string) => dispatch({ type: 'TOGGLE_DESCRIPTION', payload: id }), []);
  const setAvailableCategories = useCallback((cats: string[]) => dispatch({ type: 'SET_AVAILABLE_CATEGORIES', payload: cats }), []);
  const setAvailableLocations = useCallback((locs: string[]) => dispatch({ type: 'SET_AVAILABLE_LOCATIONS', payload: locs }), []);
  const toggleFavoritesOnly = useCallback(() => dispatch({ type: 'TOGGLE_FAVORITES_ONLY' }), []);
  const clearFilters = useCallback(() => dispatch({ type: 'CLEAR_FILTERS' }), []);
  const reconcileFilters = useCallback(
    (availableCategories: string[], availableLocations: string[]) =>
      dispatch({ type: 'RECONCILE_FILTERS', payload: { availableCategories, availableLocations } }),
    []
  );

  const isTagSelected = useCallback((tag: string) =>
    state.selectedTags.some(t => t.toLowerCase() === tag.toLowerCase()),
    [state.selectedTags]
  );
  const isLocationSelected = useCallback((loc: string) =>
    state.selectedLocations.some(l => l.toLowerCase() === loc.toLowerCase()),
    [state.selectedLocations]
  );

  // Computed
  const selectedTagsLowerSet = useMemo(() => new Set(state.selectedTags.map(t => t.toLowerCase())), [state.selectedTags]);
  const selectedLocationsLowerSet = useMemo(() => new Set(state.selectedLocations.map(l => l.toLowerCase())), [state.selectedLocations]);
  const selectedCategoriesCount = useMemo(() =>
    state.selectedTags.filter(t => state.availableCategories.includes(t) && !t.startsWith('Week ')).length,
    [state.selectedTags, state.availableCategories]
  );
  // One flag now, where there were three. With no scope, "the reader has
  // narrowed the list" and "a filter is in effect" are the same statement —
  // `hasDateFilters`, `hasNonDateFilters` and `hasNonDefaultFilters` existed
  // only because the app started on the `next` scope, so a date filter was
  // always in effect and an indicator driven by it was lit before the reader
  // touched anything. Trimmed rather than raw: a whitespace-only search emits
  // no chip, so it must not count as a filter either.
  const hasFilters: boolean = !!(
    state.searchTerm.trim() || state.selectedTags.length > 0 ||
    state.selectedLocations.length > 0 || state.showFavoritesOnly
  );

  // localStorage persistence
  useEffect(() => {
    try {
      localStorage.setItem('chq-calendar-user-state', JSON.stringify({
        searchTerm: state.searchTerm, selectedTags: state.selectedTags,
        selectedLocations: state.selectedLocations,
        expandedDescriptions: Array.from(state.expandedDescriptions),
        recentLocations: state.recentLocations, recentCategories: state.recentCategories,
        showFavoritesOnly: state.showFavoritesOnly,
        lastSaved: Date.now(),
      }));
    } catch (e) { console.warn('Failed to save user state:', e); }
  }, [state]);

  return {
    expandedDescriptions: state.expandedDescriptions,
    searchTerm: state.searchTerm, setSearchTerm,
    selectedTags: state.selectedTags,
    selectedLocations: state.selectedLocations,
    availableCategories: state.availableCategories, setAvailableCategories,
    availableLocations: state.availableLocations, setAvailableLocations,
    recentLocations: state.recentLocations,
    recentCategories: state.recentCategories,
    selectedTagsLowerSet, selectedLocationsLowerSet, selectedCategoriesCount,
    hasFilters,
    toggleDescription, toggleTag, isTagSelected, toggleLocation, isLocationSelected,
    clearFilters,
    showFavoritesOnly: state.showFavoritesOnly, toggleFavoritesOnly,
    reconcileFilters,
  };
}
