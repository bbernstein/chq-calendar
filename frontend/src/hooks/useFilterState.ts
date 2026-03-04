import { useReducer, useCallback, useEffect, useMemo } from 'react';
import { USER_STATE_EXPIRY_MS } from '@/lib/constants';

type DateFilter = 'all' | 'today' | 'next' | 'this-week';

interface FilterState {
  searchTerm: string;
  selectedTags: string[];
  selectedLocations: string[];
  dateFilter: DateFilter;
  selectedWeeks: number[];
  expandedDescriptions: Set<string>;
  recentLocations: string[];
  recentCategories: string[];
  availableCategories: string[];
  availableLocations: string[];
  showFavoritesOnly: boolean;
  extraDays: number;
  stateInitialized: boolean;
}

type FilterAction =
  | { type: 'SET_SEARCH'; payload: string }
  | { type: 'SET_DATE_FILTER'; payload: DateFilter }
  | { type: 'SET_SELECTED_WEEKS'; payload: number[] | ((prev: number[]) => number[]) }
  | { type: 'TOGGLE_TAG'; payload: string }
  | { type: 'TOGGLE_LOCATION'; payload: string }
  | { type: 'TOGGLE_DESCRIPTION'; payload: string }
  | { type: 'SET_AVAILABLE_CATEGORIES'; payload: string[] }
  | { type: 'SET_AVAILABLE_LOCATIONS'; payload: string[] }
  | { type: 'TOGGLE_FAVORITES_ONLY' }
  | { type: 'ADD_EXTRA_DAY' }
  | { type: 'CLEAR_EXTRA_DAYS' }
  | { type: 'RECONCILE_FILTERS'; payload: { availableCategories: string[]; availableLocations: string[]; isCurrentYear: boolean } }
  | { type: 'CLEAR_FILTERS' }
  | { type: 'LOAD_STATE'; payload: Partial<FilterState> }
  | { type: 'INIT' };

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
    case 'SET_DATE_FILTER':
      return { ...state, dateFilter: action.payload };
    case 'SET_SELECTED_WEEKS': {
      const weeks = typeof action.payload === 'function' ? action.payload(state.selectedWeeks) : action.payload;
      return { ...state, selectedWeeks: weeks };
    }
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
    case 'ADD_EXTRA_DAY':
      return { ...state, extraDays: state.extraDays + 1 };
    case 'CLEAR_EXTRA_DAYS':
      return { ...state, extraDays: 0 };
    case 'RECONCILE_FILTERS': {
      const { availableCategories, availableLocations, isCurrentYear } = action.payload;
      const availCatsLower = new Set(availableCategories.map(c => c.toLowerCase()));
      const availLocsLower = new Set(availableLocations.map(l => l.toLowerCase()));
      return {
        ...state,
        selectedTags: state.selectedTags.filter(t => availCatsLower.has(t.toLowerCase())),
        selectedLocations: state.selectedLocations.filter(l => availLocsLower.has(l.toLowerCase())),
        selectedWeeks: [],
        dateFilter: isCurrentYear ? 'next' as DateFilter : 'all' as DateFilter,
        extraDays: 0,
      };
    }
    case 'CLEAR_FILTERS':
      return { ...state, searchTerm: '', selectedTags: [], selectedLocations: [], dateFilter: 'all', selectedWeeks: [], showFavoritesOnly: false, extraDays: 0 };
    case 'LOAD_STATE':
      return { ...state, ...action.payload, stateInitialized: true };
    case 'INIT':
      return { ...state, stateInitialized: true };
    default:
      return state;
  }
}

const initialState: FilterState = {
  searchTerm: '',
  selectedTags: [],
  selectedLocations: [],
  dateFilter: 'next',
  selectedWeeks: [],
  expandedDescriptions: new Set(),
  recentLocations: [],
  recentCategories: [],
  availableCategories: [],
  availableLocations: [],
  showFavoritesOnly: false,
  extraDays: 0,
  stateInitialized: false,
};

export function useFilterState() {
  const [state, dispatch] = useReducer(filterReducer, initialState);

  // Actions
  const setSearchTerm = useCallback((term: string) => dispatch({ type: 'SET_SEARCH', payload: term }), []);
  const setDateFilter = useCallback((filter: DateFilter) => dispatch({ type: 'SET_DATE_FILTER', payload: filter }), []);
  const setSelectedWeeks = useCallback((weeks: number[] | ((prev: number[]) => number[])) => dispatch({ type: 'SET_SELECTED_WEEKS', payload: weeks }), []);
  const toggleTag = useCallback((tag: string) => dispatch({ type: 'TOGGLE_TAG', payload: tag }), []);
  const toggleLocation = useCallback((loc: string) => dispatch({ type: 'TOGGLE_LOCATION', payload: loc }), []);
  const toggleDescription = useCallback((id: string) => dispatch({ type: 'TOGGLE_DESCRIPTION', payload: id }), []);
  const setAvailableCategories = useCallback((cats: string[]) => dispatch({ type: 'SET_AVAILABLE_CATEGORIES', payload: cats }), []);
  const setAvailableLocations = useCallback((locs: string[]) => dispatch({ type: 'SET_AVAILABLE_LOCATIONS', payload: locs }), []);
  const toggleFavoritesOnly = useCallback(() => dispatch({ type: 'TOGGLE_FAVORITES_ONLY' }), []);
  const addExtraDay = useCallback(() => dispatch({ type: 'ADD_EXTRA_DAY' }), []);
  const clearFilters = useCallback(() => dispatch({ type: 'CLEAR_FILTERS' }), []);
  const reconcileFilters = useCallback(
    (availableCategories: string[], availableLocations: string[], isCurrentYear: boolean) =>
      dispatch({ type: 'RECONCILE_FILTERS', payload: { availableCategories, availableLocations, isCurrentYear } }),
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
  const hasFilters = state.searchTerm || state.selectedTags.length > 0 || state.selectedLocations.length > 0 || state.dateFilter !== 'all' || state.selectedWeeks.length > 0 || state.showFavoritesOnly;

  // localStorage persistence
  useEffect(() => {
    if (state.stateInitialized) {
      try {
        localStorage.setItem('chq-calendar-user-state', JSON.stringify({
          searchTerm: state.searchTerm, selectedTags: state.selectedTags,
          selectedLocations: state.selectedLocations, dateFilter: state.dateFilter,
          selectedWeeks: state.selectedWeeks, expandedDescriptions: Array.from(state.expandedDescriptions),
          recentLocations: state.recentLocations, recentCategories: state.recentCategories,
          showFavoritesOnly: state.showFavoritesOnly,
          lastSaved: Date.now(),
        }));
      } catch (e) { console.warn('Failed to save user state:', e); }
    }
  }, [state]);

  // Restore on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('chq-calendar-user-state');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.lastSaved && Date.now() - parsed.lastSaved < USER_STATE_EXPIRY_MS) {
          dispatch({ type: 'LOAD_STATE', payload: {
            searchTerm: parsed.searchTerm || '',
            selectedTags: parsed.selectedTags || [],
            selectedLocations: parsed.selectedLocations || [],
            dateFilter: parsed.dateFilter || 'next',
            selectedWeeks: parsed.selectedWeeks || [],
            expandedDescriptions: new Set<string>(parsed.expandedDescriptions || []),
            recentLocations: parsed.recentLocations || [],
            recentCategories: parsed.recentCategories || [],
            showFavoritesOnly: parsed.showFavoritesOnly || false,
          }});
          return;
        }
      }
    } catch (e) { console.warn('Failed to load user state:', e); }
    dispatch({ type: 'INIT' });
  }, []);

  // Reset extra days when date filter changes
  useEffect(() => {
    if (state.stateInitialized && state.extraDays > 0) {
      dispatch({ type: 'CLEAR_EXTRA_DAYS' });
    }
  }, [state.dateFilter]); // intentionally only depends on dateFilter

  return {
    expandedDescriptions: state.expandedDescriptions,
    searchTerm: state.searchTerm, setSearchTerm,
    selectedTags: state.selectedTags,
    selectedLocations: state.selectedLocations,
    dateFilter: state.dateFilter, setDateFilter,
    selectedWeeks: state.selectedWeeks, setSelectedWeeks,
    availableCategories: state.availableCategories, setAvailableCategories,
    availableLocations: state.availableLocations, setAvailableLocations,
    recentLocations: state.recentLocations,
    recentCategories: state.recentCategories,
    selectedTagsLowerSet, selectedLocationsLowerSet, selectedCategoriesCount, hasFilters,
    toggleDescription, toggleTag, isTagSelected, toggleLocation, isLocationSelected, clearFilters,
    showFavoritesOnly: state.showFavoritesOnly, toggleFavoritesOnly,
    extraDays: state.extraDays, addExtraDay,
    reconcileFilters,
  };
}
