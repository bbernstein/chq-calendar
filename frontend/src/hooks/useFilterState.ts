import { useReducer, useCallback, useEffect, useMemo } from 'react';
import { USER_STATE_EXPIRY_MS } from '@/lib/constants';

export type DateFilter = 'all' | 'today' | 'next' | 'this-week';

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
  /**
   * How far the user has navigated beyond the current scope's own window,
   * as day keys. `null` means "not expanded in that direction".
   *
   * Session-only: deliberately absent from the localStorage payload below,
   * matching iOS's `selectedDayKey` and the `extraDays` this replaced. A
   * date pinned days ago and silently restored on launch would be worse
   * than no restore.
   */
  windowStartDay: string | null;
  windowEndDay: string | null;
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
  | { type: 'EXPAND_WINDOW_START'; payload: string }
  | { type: 'EXPAND_WINDOW_END'; payload: string }
  | { type: 'RESET_WINDOW' }
  | { type: 'RECONCILE_FILTERS'; payload: { availableCategories: string[]; availableLocations: string[]; isCurrentYear: boolean } }
  | { type: 'CLEAR_FILTERS' }
  | { type: 'CLEAR_NON_DATE_FILTERS' };

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
      // Resetting here rather than in an effect keyed on dateFilter: the
      // effect this replaces ran a second render pass to undo state the
      // first pass had already applied, and left a frame in which the
      // window belonged to the previous scope.
      return { ...state, dateFilter: action.payload, windowStartDay: null, windowEndDay: null };
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
    case 'EXPAND_WINDOW_START':
      return { ...state, windowStartDay: action.payload };
    case 'EXPAND_WINDOW_END':
      return { ...state, windowEndDay: action.payload };
    case 'RESET_WINDOW':
      return { ...state, windowStartDay: null, windowEndDay: null };
    case 'RECONCILE_FILTERS': {
      const { availableCategories, availableLocations, isCurrentYear } = action.payload;
      const availCatsLower = new Set(availableCategories.map(c => c.toLowerCase()));
      const availLocsLower = new Set(availableLocations.map(l => l.toLowerCase()));
      return {
        ...state,
        selectedTags: state.selectedTags.filter(t => availCatsLower.has(t.toLowerCase())),
        selectedLocations: state.selectedLocations.filter(l => availLocsLower.has(l.toLowerCase())),
        selectedWeeks: [],
        dateFilter: isCurrentYear ? 'next' : 'all',
        windowStartDay: null,
        windowEndDay: null,
      };
    }
    case 'CLEAR_FILTERS':
      return { ...state, searchTerm: '', selectedTags: [], selectedLocations: [], dateFilter: 'all', selectedWeeks: [], showFavoritesOnly: false, windowStartDay: null, windowEndDay: null };
    case 'CLEAR_NON_DATE_FILTERS':
      return { ...state, searchTerm: '', selectedTags: [], selectedLocations: [], showFavoritesOnly: false };
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
  windowStartDay: null,
  windowEndDay: null,
};

function loadInitialState(): FilterState {
  try {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('chq-calendar-user-state') : null;
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.lastSaved && Date.now() - parsed.lastSaved < USER_STATE_EXPIRY_MS) {
        return {
          ...initialState,
          searchTerm: parsed.searchTerm || '',
          selectedTags: parsed.selectedTags || [],
          selectedLocations: parsed.selectedLocations || [],
          dateFilter: parsed.dateFilter || 'next',
          selectedWeeks: parsed.selectedWeeks || [],
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
  const setDateFilter = useCallback((filter: DateFilter) => dispatch({ type: 'SET_DATE_FILTER', payload: filter }), []);
  const setSelectedWeeks = useCallback((weeks: number[] | ((prev: number[]) => number[])) => dispatch({ type: 'SET_SELECTED_WEEKS', payload: weeks }), []);
  const toggleTag = useCallback((tag: string) => dispatch({ type: 'TOGGLE_TAG', payload: tag }), []);
  const toggleLocation = useCallback((loc: string) => dispatch({ type: 'TOGGLE_LOCATION', payload: loc }), []);
  const toggleDescription = useCallback((id: string) => dispatch({ type: 'TOGGLE_DESCRIPTION', payload: id }), []);
  const setAvailableCategories = useCallback((cats: string[]) => dispatch({ type: 'SET_AVAILABLE_CATEGORIES', payload: cats }), []);
  const setAvailableLocations = useCallback((locs: string[]) => dispatch({ type: 'SET_AVAILABLE_LOCATIONS', payload: locs }), []);
  const toggleFavoritesOnly = useCallback(() => dispatch({ type: 'TOGGLE_FAVORITES_ONLY' }), []);
  const expandWindowStart = useCallback((day: string) => dispatch({ type: 'EXPAND_WINDOW_START', payload: day }), []);
  const expandWindowEnd = useCallback((day: string) => dispatch({ type: 'EXPAND_WINDOW_END', payload: day }), []);
  const resetWindow = useCallback(() => dispatch({ type: 'RESET_WINDOW' }), []);
  const clearFilters = useCallback(() => dispatch({ type: 'CLEAR_FILTERS' }), []);
  const clearNonDateFilters = useCallback(() => dispatch({ type: 'CLEAR_NON_DATE_FILTERS' }), []);
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
  const hasDateFilters: boolean = state.dateFilter !== 'all' || state.selectedWeeks.length > 0;
  // Trim searchTerm to stay consistent with buildActiveChips (which only emits a
  // search chip when the trimmed value is non-empty). Otherwise a whitespace-only
  // search would set hasNonDateFilters=true with no chip to represent it.
  const hasNonDateFilters: boolean = !!(state.searchTerm.trim() || state.selectedTags.length > 0 || state.selectedLocations.length > 0 || state.showFavoritesOnly);
  const hasFilters: boolean = hasDateFilters || hasNonDateFilters;

  // localStorage persistence
  useEffect(() => {
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
  }, [state]);

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
    selectedTagsLowerSet, selectedLocationsLowerSet, selectedCategoriesCount,
    hasFilters, hasDateFilters, hasNonDateFilters,
    toggleDescription, toggleTag, isTagSelected, toggleLocation, isLocationSelected,
    clearFilters, clearNonDateFilters,
    showFavoritesOnly: state.showFavoritesOnly, toggleFavoritesOnly,
    windowStartDay: state.windowStartDay, windowEndDay: state.windowEndDay,
    expandWindowStart, expandWindowEnd, resetWindow,
    reconcileFilters,
  };
}
