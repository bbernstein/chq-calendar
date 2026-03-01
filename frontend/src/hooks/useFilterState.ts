import { useState, useCallback, useEffect, useMemo } from 'react';
import { USER_STATE_EXPIRY_MS } from '@/lib/constants';

function useTagSelection(selectedTags: string[], setSelectedTags: React.Dispatch<React.SetStateAction<string[]>>) {
  const toggleTag = useCallback((tag: string) => {
    setSelectedTags(prev => {
      const tagLower = tag.toLowerCase();
      const existingTag = prev.find(t => t.toLowerCase() === tagLower);
      return existingTag
        ? prev.filter(t => t.toLowerCase() !== tagLower)
        : [...prev, tag];
    });
  }, [setSelectedTags]);

  const isTagSelected = useCallback((tag: string) => {
    return selectedTags.some(selectedTag => selectedTag.toLowerCase() === tag.toLowerCase());
  }, [selectedTags]);

  return { toggleTag, isTagSelected };
}

export function useFilterState() {
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'next' | 'this-week'>('next');
  const [selectedWeeks, setSelectedWeeks] = useState<number[]>([]);
  const [recentLocations, setRecentLocations] = useState<string[]>([]);
  const [recentCategories, setRecentCategories] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [availableLocations, setAvailableLocations] = useState<string[]>([]);
  const [stateInitialized, setStateInitialized] = useState(false);

  // Toggle description expansion
  const toggleDescription = useCallback((eventId: string) => {
    setExpandedDescriptions((prev: Set<string>) => {
      const newSet = new Set(prev);
      if (newSet.has(eventId)) {
        newSet.delete(eventId);
      } else {
        newSet.add(eventId);
      }
      return newSet;
    });
  }, []);

  // FIFO utility for managing recent items
  const addToRecentItems = useCallback((item: string, recentItems: string[], maxItems: number = 10): string[] => {
    const filtered = recentItems.filter(existing => existing !== item);
    return [item, ...filtered].slice(0, maxItems);
  }, []);

  const addToRecentLocations = useCallback((location: string) => {
    setRecentLocations(prev => addToRecentItems(location, prev));
  }, [addToRecentItems]);

  const addToRecentCategories = useCallback((category: string) => {
    setRecentCategories(prev => addToRecentItems(category, prev));
  }, [addToRecentItems]);

  // Tag selection with recent tracking
  const { toggleTag: toggleTagBase, isTagSelected } = useTagSelection(selectedTags, setSelectedTags);

  const toggleTag = useCallback((tag: string) => {
    const wasSelected = isTagSelected(tag);
    toggleTagBase(tag);
    if (availableCategories.includes(tag) && !wasSelected) {
      addToRecentCategories(tag);
    }
  }, [toggleTagBase, addToRecentCategories, availableCategories, isTagSelected]);

  // Location selection with recent tracking
  const { toggleTag: toggleLocationBase, isTagSelected: isLocationSelected } = useTagSelection(selectedLocations, setSelectedLocations);

  const toggleLocation = useCallback((location: string) => {
    const wasSelected = isLocationSelected(location);
    toggleLocationBase(location);
    if (!wasSelected) {
      addToRecentLocations(location);
    }
  }, [toggleLocationBase, addToRecentLocations, isLocationSelected]);

  // Memoize lowercase sets for O(1) lookup performance
  const selectedTagsLowerSet = useMemo(() =>
    new Set(selectedTags.map(tag => tag.toLowerCase())),
    [selectedTags]
  );

  const selectedLocationsLowerSet = useMemo(() =>
    new Set(selectedLocations.map(location => location.toLowerCase())),
    [selectedLocations]
  );

  const selectedCategoriesCount = useMemo(() =>
    selectedTags.filter(tag =>
      availableCategories.includes(tag) && !tag.startsWith('Week ')
    ).length,
    [selectedTags, availableCategories]
  );

  // localStorage persistence
  const saveUserState = useCallback(() => {
    try {
      const userState = {
        searchTerm,
        selectedTags,
        selectedLocations,
        dateFilter,
        selectedWeeks,
        expandedDescriptions: Array.from(expandedDescriptions),
        recentLocations,
        recentCategories,
        lastSaved: Date.now()
      };
      localStorage.setItem('chq-calendar-user-state', JSON.stringify(userState));
    } catch (e) {
      console.warn('Failed to save user state to localStorage:', e);
    }
  }, [searchTerm, selectedTags, selectedLocations, dateFilter, selectedWeeks, expandedDescriptions, recentLocations, recentCategories]);

  const loadUserState = useCallback(() => {
    try {
      const savedState = localStorage.getItem('chq-calendar-user-state');
      if (savedState) {
        const parsed = JSON.parse(savedState);
        if (parsed.lastSaved && Date.now() - parsed.lastSaved < USER_STATE_EXPIRY_MS) {
          return {
            searchTerm: parsed.searchTerm || '',
            selectedTags: parsed.selectedTags || [],
            selectedLocations: parsed.selectedLocations || [],
            dateFilter: parsed.dateFilter || 'next',
            selectedWeeks: parsed.selectedWeeks || [],
            expandedDescriptions: new Set<string>(parsed.expandedDescriptions || []),
            recentLocations: parsed.recentLocations || [],
            recentCategories: parsed.recentCategories || []
          };
        }
      }
    } catch (e) {
      console.warn('Failed to load user state from localStorage:', e);
    }
    return null;
  }, []);

  // Auto-save when state changes
  useEffect(() => {
    if (stateInitialized) {
      saveUserState();
    }
  }, [saveUserState, stateInitialized]);

  // Restore state on mount
  useEffect(() => {
    const savedState = loadUserState();
    if (savedState) {
      setSearchTerm(savedState.searchTerm);
      setSelectedTags(savedState.selectedTags);
      setSelectedLocations(savedState.selectedLocations);
      setDateFilter(savedState.dateFilter);
      setSelectedWeeks(savedState.selectedWeeks);
      setExpandedDescriptions(savedState.expandedDescriptions);
      setRecentLocations(savedState.recentLocations);
      setRecentCategories(savedState.recentCategories);
    }
    setStateInitialized(true);
  }, [loadUserState]);

  // Clear all filters
  const clearFilters = useCallback(() => {
    setSearchTerm('');
    setSelectedTags([]);
    setSelectedLocations([]);
    setDateFilter('all');
    setSelectedWeeks([]);
  }, []);

  const hasFilters = searchTerm || selectedTags.length > 0 || selectedLocations.length > 0 || dateFilter !== 'all' || selectedWeeks.length > 0;

  return {
    // State
    expandedDescriptions,
    searchTerm,
    setSearchTerm,
    selectedTags,
    selectedLocations,
    dateFilter,
    setDateFilter,
    selectedWeeks,
    setSelectedWeeks,
    availableCategories,
    setAvailableCategories,
    availableLocations,
    setAvailableLocations,
    recentLocations,
    recentCategories,

    // Computed
    selectedTagsLowerSet,
    selectedLocationsLowerSet,
    selectedCategoriesCount,
    hasFilters,

    // Actions
    toggleDescription,
    toggleTag,
    isTagSelected,
    toggleLocation,
    isLocationSelected,
    clearFilters,
  };
}
