'use client';

import React, { useState, useEffect, useMemo, useRef, createContext, useContext, useCallback } from 'react';
import Image from 'next/image';

interface Event {
  id: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  location?: string;
  venue?: {
    name: string;
    id?: number;
    address?: string;
    showMap?: boolean;
  };
  category?: string;
  originalCategories?: string[];
  tags?: string[];
  presenter?: string;
  lastModified?: string;
  attachments?: Array<{
    url: string;
    type: string;
    isImage: boolean;
  }>;
  url?: string;
  // Pre-computed set containing lowercase versions of tags and categories
  // combined, used for efficient filtering
  _tagsLowerSet?: Set<string>;
}

interface GlobalEventData {
  events: Event[] | null;
  categories: string[];
  locations: string[];
  tags: string[];
  weeks: number[];
  loadedAt: number | null;
  setGlobalEventData?: React.Dispatch<React.SetStateAction<GlobalEventData>>;
}

const GlobalEventDataContext = createContext<GlobalEventData | undefined>(undefined);

function useGlobalEventData() {
  const context = useContext(GlobalEventDataContext);
  if (!context) {
    throw new Error('useGlobalEventData must be used within a GlobalEventDataProvider');
  }
  return context;
}

// Custom hook for tag selection management
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

function GlobalEventDataProvider({ children }: { children: React.ReactNode }) {
  const [globalEventData, setGlobalEventData] = useState<GlobalEventData>({
    events: null,
    categories: [],
    locations: [],
    tags: [],
    weeks: [],
    loadedAt: null,
  });

  return (
    <GlobalEventDataContext.Provider value={{ ...globalEventData, setGlobalEventData }}>
      {children}
    </GlobalEventDataContext.Provider>
  );
}

function HomeContent() {
  const globalEventData = useGlobalEventData();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const isLoadingRef = useRef(false);
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'next' | 'this-week'>('next');
  const [selectedWeeks, setSelectedWeeks] = useState<number[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [availableLocations, setAvailableLocations] = useState<string[]>([]);
  const [recentLocations, setRecentLocations] = useState<string[]>([]);
  const [recentCategories, setRecentCategories] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [wasDragged, setWasDragged] = useState(false);
  const [stateInitialized, setStateInitialized] = useState(false);

  // Shortcut alias maps for pills - easily editable
  const locationShortcuts: Record<string, string> = {
    "Elizabeth S. Lenna Hall": "Lenna Hall",
    "AAHH African American Heritage House": "AAHH",
  };

  const categoryShortcuts: Record<string, string> = {
    "Chautauqua Symphony Orchestra/Classical Concerts": "CSO",
    "Chautauqua Lecture Series": "CHQ Lecture",
  };

  // Helper functions to get display names and full names
  const getLocationDisplayName = (location: string): string => {
    return locationShortcuts[location] || location;
  };

  const getCategoryDisplayName = (category: string): string => {
    return categoryShortcuts[category] || category;
  };

  const apiUrl = useMemo(() =>
    process.env.NODE_ENV === 'development'
      ? (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001')
      : ''  // Use root domain for cache path
  , []);

  console.log('API URL:', apiUrl, 'NODE_ENV:', process.env.NODE_ENV);


  const toggleDescription = (eventId: string) => {
    setExpandedDescriptions((prev: Set<string>) => {
      const newSet = new Set(prev);
      if (newSet.has(eventId)) {
        newSet.delete(eventId);
      } else {
        newSet.add(eventId);
      }
      return newSet;
    });
  };

  const decodeHtmlEntities = (encodedString: string | undefined) => {
    if (!encodedString) return undefined;

    // If no HTML entities found, return original string
    if (!encodedString.includes('&')) return encodedString;

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(encodedString, 'text/html');
      const decoded = doc.documentElement.textContent || encodedString;
      return decoded;
    } catch (error) {
      console.warn('Failed to decode HTML entities:', encodedString, error);
      return encodedString;
    }
  };

  // Decode HTML entities for an entire event object and pre-compute lowercase tags
  const decodeEventHtmlEntities = useCallback((event: Event): Event => {
    const decodedTags = event.tags?.map(tag => decodeHtmlEntities(tag) || tag);
    const decodedCategories = event.originalCategories?.map(cat => decodeHtmlEntities(cat) || cat);

    // Pre-compute lowercase tag set for efficient filtering
    const allTags: string[] = [];
    if (decodedTags) allTags.push(...decodedTags);
    if (decodedCategories) allTags.push(...decodedCategories);
    const _tagsLowerSet = new Set(allTags.map(tag => tag.toLowerCase()));

    // Extract location from venue if it exists, otherwise use location field
    const location = event.venue?.name
      ? decodeHtmlEntities(event.venue.name) || event.venue.name
      : decodeHtmlEntities(event.location) || event.location;

    return {
      ...event,
      title: decodeHtmlEntities(event.title) || event.title,
      description: decodeHtmlEntities(event.description) || event.description,
      location: location,
      presenter: decodeHtmlEntities(event.presenter) || event.presenter,
      category: decodeHtmlEntities(event.category) || event.category,
      originalCategories: decodedCategories,
      tags: decodedTags,
      // Also decode attachment types in case they contain HTML entities
      attachments: event.attachments?.map(att => ({
        ...att,
        type: decodeHtmlEntities(att.type) || att.type
      })),
      _tagsLowerSet
    };
  }, []);

  // FIFO utility functions for managing recent items
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

  // Use the tag selection hook with recent tracking
  const { toggleTag: toggleTagBase, isTagSelected } = useTagSelection(selectedTags, setSelectedTags);
  
  const toggleTag = useCallback((tag: string) => {
    const wasSelected = isTagSelected(tag);
    toggleTagBase(tag);
    // Only track categories when they are being selected (not deselected)
    if (availableCategories.includes(tag) && !wasSelected) {
      addToRecentCategories(tag);
    }
  }, [toggleTagBase, addToRecentCategories, availableCategories, isTagSelected]);
  
  // Use the location selection hook with recent tracking
  const { toggleTag: toggleLocationBase, isTagSelected: isLocationSelected } = useTagSelection(selectedLocations, setSelectedLocations);
  
  const toggleLocation = useCallback((location: string) => {
    const wasSelected = isLocationSelected(location);
    toggleLocationBase(location);
    // Only track locations when they are being selected (not deselected)
    if (!wasSelected) {
      addToRecentLocations(location);
    }
  }, [toggleLocationBase, addToRecentLocations, isLocationSelected]);

  // Memoize lowercase selected tags as a Set for O(1) lookup performance
  const selectedTagsLowerSet = useMemo(() =>
    new Set(selectedTags.map(tag => tag.toLowerCase())),
    [selectedTags]
  );

  // Memoize lowercase selected locations as a Set for O(1) lookup performance
  const selectedLocationsLowerSet = useMemo(() =>
    new Set(selectedLocations.map(location => location.toLowerCase())),
    [selectedLocations]
  );

  // Memoize selected categories count to avoid repeated filter operations (excluding Week categories)
  const selectedCategoriesCount = useMemo(() =>
    selectedTags.filter(tag => 
      availableCategories.includes(tag) && !tag.startsWith('Week ')
    ).length,
    [selectedTags, availableCategories]
  );

  // localStorage utilities for persisting user state
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
        // Only load state if it's less than 30 days old
        if (parsed.lastSaved && Date.now() - parsed.lastSaved < 30 * 24 * 60 * 60 * 1000) {
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

  // Save user state to localStorage whenever filter state changes (only after initialization)
  useEffect(() => {
    if (stateInitialized) {
      saveUserState();
    }
  }, [saveUserState, stateInitialized]);

  // Restore user state from localStorage on component mount
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
    // Mark state as initialized to enable auto-saving
    setStateInitialized(true);
  }, [loadUserState]);

  // Calculate Chautauqua season weeks (9 weeks starting from Saturday noon before 4th Sunday of June)
  const getChautauquaSeasonWeeks = (year: number = 2025) => {
    // Start from June 1st and find the 4th Sunday
    const june1 = new Date(year, 5, 1); // June 1st
    const current = new Date(june1);
    let sundayCount = 0;
    let fourthSunday = null;

    // Find the 4th Sunday of June
    while (current.getMonth() === 5) { // Still in June
      if (current.getDay() === 0) { // Sunday
        sundayCount++;
        if (sundayCount === 4) {
          fourthSunday = new Date(current);
          break;
        }
      }
      current.setDate(current.getDate() + 1);
    }

    if (!fourthSunday) {
      // Fallback: if somehow we can't find 4th Sunday, use June 22, 2025
      fourthSunday = new Date(2025, 5, 22);
    }

    // Find the Saturday before the 4th Sunday, and set it to noon
    // This will be the start of Week 1 at Saturday noon
    const firstWeekStart = new Date(fourthSunday);
    firstWeekStart.setDate(fourthSunday.getDate() - 1); // Go back to Saturday
    firstWeekStart.setHours(12, 0, 0, 0); // Set to noon

    const weeks = [];
    for (let i = 0; i < 9; i++) {
      const weekStart = new Date(firstWeekStart);
      weekStart.setDate(firstWeekStart.getDate() + (i * 7));
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7); // Next Saturday at noon

      weeks.push({
        number: i + 1,
        start: weekStart,
        end: weekEnd,
        label: `Week ${i + 1} (${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} 12pm - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} 12pm)`
      });
    }

    return weeks;
  };

  const seasonWeeks = useMemo(() => getChautauquaSeasonWeeks(), []);

  // Date filtering helpers
  const isToday = (dateString: string) => {
    const today = new Date();
    const eventDate = new Date(dateString);
    return eventDate.toDateString() === today.toDateString();
  };

  const isNext = (dateString: string) => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const eventDate = new Date(dateString);

    // Calculate 6 days in future
    const nextWeek = new Date(now);
    nextWeek.setDate(now.getDate() + 6);
    nextWeek.setHours(23, 59, 59, 999);

    // Show events from one hour ago through 6 days in the future
    return eventDate >= oneHourAgo && eventDate <= nextWeek;
  };

  // Get current Chautauqua week number (1-9) or null if not in season
  const currentWeekNumber = useMemo(() => {
    const now = new Date();
    
    for (let i = 0; i < seasonWeeks.length; i++) {
      const week = seasonWeeks[i];
      if (now >= week.start && now <= week.end) {
        return week.number;
      }
    }
    return null; // Not in season
  }, [seasonWeeks]);

  // Helper functions for UI state
  const isThisWeekButtonActive = () => {
    return dateFilter === 'this-week' || (currentWeekNumber !== null && selectedWeeks.length === 1 && selectedWeeks[0] === currentWeekNumber);
  };

  const isWeekHighlighted = (weekNumber: number, isSelected: boolean) => {
    const isCurrent = currentWeekNumber === weekNumber;
    const isCurrentWeekFilterActive = dateFilter === 'this-week' && isCurrent;
    return isSelected || isCurrentWeekFilterActive;
  };

  const isThisWeek = (dateString: string) => {
    const eventDate = new Date(dateString);
    
    if (currentWeekNumber === null) {
      return false; // Not in season
    }
    
    const currentWeek = seasonWeeks[currentWeekNumber - 1];
    return eventDate >= currentWeek.start && eventDate <= currentWeek.end;
  };

  const isInChautauquaWeek = (dateString: string, weekNumber: number) => {
    const eventDate = new Date(dateString);
    const week = seasonWeeks[weekNumber - 1];

    // Week ends at Saturday noon, so we don't need to include the end boundary
    // since week.end is already the next Saturday at noon
    return eventDate >= week.start && eventDate < week.end;
  };

  const isWeekInPast = (weekNumber: number) => {
    const week = seasonWeeks[weekNumber - 1];
    const now = new Date();
    // A week is in the past if its end time (Saturday noon) is before now
    return week.end <= now;
  };

  const getWeekNumberForDate = (date: Date): number | null => {
    // Find which Chautauqua week this date falls into
    for (let i = 0; i < seasonWeeks.length; i++) {
      const week = seasonWeeks[i];
      if (date >= week.start && date < week.end) {
        return week.number;
      }
    }
    return null; // Date is outside the season
  };

  // Week selection handlers
  const handleWeekMouseDown = (weekNum: number, event: React.MouseEvent) => {
    if (process.env.NODE_ENV === 'development') {
      console.log('handleWeekMouseDown called for week', weekNum, { shift: event.shiftKey, cmd: event.metaKey || event.ctrlKey });
    }

    // Prevent default to avoid text selection
    event.preventDefault();
    
    // Clear "This Week" filter when selecting weeks (except for current week without modifiers)
    if (!(weekNum === currentWeekNumber && !event.shiftKey && !event.metaKey && !event.ctrlKey)) {
      setDateFilter('all');
    }

    // Handle different click types - modifier keys take precedence over current week logic
    if (event.metaKey || event.ctrlKey) {
      // CMD/CTRL-Click: Toggle individual week (including current week)
      setSelectedWeeks(prev => {
        // If current week is active via "This Week" filter but not in selectedWeeks,
        // treat it as if it were selected
        const isCurrentWeekActive = weekNum === currentWeekNumber && dateFilter === 'this-week';
        const isInSelection = prev.includes(weekNum) || isCurrentWeekActive;
        
        return isInSelection
          ? prev.filter(w => w !== weekNum) // Remove if selected (will be empty if it was only "This Week")
          : [...prev, weekNum].sort((a, b) => a - b); // Add if not selected
      });
      setDateFilter('all'); // Always clear "This Week" filter for cmd-click
      return;
    }

    // Check if we have existing selections - either in selectedWeeks or via "This Week" filter
    const hasExistingSelection = selectedWeeks.length > 0 || (dateFilter === 'this-week' && currentWeekNumber !== null);
    
    if (event.shiftKey && hasExistingSelection) {
      // Shift-Click: Extend selection to nearest existing week (including current week)
      const existingWeeks = [...selectedWeeks];
      
      // If current week is active via "This Week" filter, include it in existing weeks
      if (dateFilter === 'this-week' && currentWeekNumber !== null && !existingWeeks.includes(currentWeekNumber)) {
        existingWeeks.push(currentWeekNumber);
      }
      
      existingWeeks.sort((a, b) => a - b);
      const minExisting = existingWeeks[0];
      const maxExisting = existingWeeks[existingWeeks.length - 1];
      
      const newRange: number[] = [];
      
      if (weekNum < minExisting) {
        // Extend from clicked week to minimum existing week
        for (let i = weekNum; i <= maxExisting; i++) {
          newRange.push(i);
        }
      } else if (weekNum > maxExisting) {
        // Extend from minimum existing week to clicked week
        for (let i = minExisting; i <= weekNum; i++) {
          newRange.push(i);
        }
      } else {
        // Click is within existing range, extend to nearest boundary
        const distanceToMin = Math.abs(weekNum - minExisting);
        const distanceToMax = Math.abs(weekNum - maxExisting);
        
        if (distanceToMin <= distanceToMax) {
          // Extend from clicked week to max
          for (let i = weekNum; i <= maxExisting; i++) {
            newRange.push(i);
          }
        } else {
          // Extend from min to clicked week
          for (let i = minExisting; i <= weekNum; i++) {
            newRange.push(i);
          }
        }
      }
      
      setSelectedWeeks(newRange);
      setDateFilter('all'); // Always clear "This Week" filter for shift-click
      return;
    }

    // Regular click or drag start (don't handle current week "This Week" logic here - wait for mouse-up)
    setIsDragging(true);
    setDragStart(weekNum);
    setWasDragged(false);
    
    // For regular clicks, start with the clicked week selected
    // For current week, this will be overridden in mouse-up if it wasn't dragged
    setSelectedWeeks([weekNum]);

    // Prevent text selection during potential drag
    document.body.style.userSelect = 'none';
  };

  const handleWeekMouseEnter = (weekNum: number) => {
    if (isDragging && dragStart !== null) {
      setWasDragged(true); // Mark that we've dragged
      const start = Math.min(dragStart, weekNum);
      const end = Math.max(dragStart, weekNum);
      const range = [];
      for (let i = start; i <= end; i++) {
        range.push(i);
      }
      setSelectedWeeks(range);

      // Clear date filter when dragging to select weeks
      setDateFilter('all');
    }
  };

  const handleWeekMouseUp = (weekNum: number) => {
    if (isDragging && dragStart !== null) {
      // If this was a click (not drag) on the current week without modifiers,
      // activate "This Week" filter instead of regular selection
      if (!wasDragged && weekNum === currentWeekNumber && weekNum === dragStart) {
        setDateFilter('this-week');
        setSelectedWeeks([]);
      }
      // Otherwise, selection was already handled in handleWeekMouseDown and handleWeekMouseEnter
    }

    setIsDragging(false);
    setDragStart(null);
    setWasDragged(false);
    // Restore text selection
    document.body.style.userSelect = '';
  };

  // Mobile-friendly tap-to-toggle handler
  const handleWeekTap = (weekNum: number) => {
    // If tapping the current week and no other weeks selected, activate "This Week" filter
    if (weekNum === currentWeekNumber && selectedWeeks.length === 0) {
      setDateFilter('this-week');
      setSelectedWeeks([]);
      return;
    }

    // Otherwise, toggle the week in the selection (including current week if already selected)
    setSelectedWeeks(prev => {
      const newSelection = prev.includes(weekNum)
        ? prev.filter(w => w !== weekNum) // Remove if already selected
        : [...prev, weekNum].sort((a, b) => a - b); // Add if not selected

      // Clear "This Week" date filter when selecting weeks
      if (newSelection.length > 0) {
        setDateFilter('all');
      }

      return newSelection;
    });
  };

  const searchEvents = (events: Event[], term: string) => {
    if (!term) return events;

    // Create search terms array from the input term
    const searchTerms = term.toLowerCase().split(' ').filter(t => t.length > 0);

    const scored = events.map(event => {
      // Ensure we're working with decoded strings for search
      const title = (event.title || '').toLowerCase();
      const description = (event.description || '').toLowerCase();
      const presenter = (event.presenter || '').toLowerCase();
      const location = (event.location || '').toLowerCase();
      const category = (event.category || '').toLowerCase();


      // Combine all tags and categories for searching
      const allTags = [
        ...(event.tags || []),
        ...(event.originalCategories || [])
      ].map(tag => tag.toLowerCase());

      let score = 0;

      // Check all search terms (original + shortcuts)
      searchTerms.forEach(currentTerm => {

        // Exact phrase matches (highest priority)
        if (title.includes(currentTerm)) score += 100;

        if (currentTerm === 'amp') {
          if (location.includes('amphitheater')) score += 100;
        } else {
          if (location.includes(currentTerm)) score += 90;
        }

        if (description.includes(currentTerm)) score += 50;
        if (category.includes(currentTerm)) score += 80;
        if (presenter.includes(currentTerm)) score += 25;

        // Tag matching (including partial matches for Symphony Orchestra)
        allTags.forEach(tag => {
          if (tag.includes(currentTerm)) score += 85;
          // Special case: "cso" or "symphony" should match "Chautauqua Symphony Orchestra/Classical Concerts"
          if ((currentTerm === 'cso' || currentTerm === 'symphony') &&
              tag.includes('chautauqua symphony orchestra/classical concerts')) {
            score += 95;
          }
        });

        // Word matches (lower priority)
        const words = currentTerm.split(/\s+/);
        words.forEach(word => {
          if (word.length > 2) { // Avoid matching very short words
            if (title.includes(word)) score += 10;
            if (location.includes(word)) score += 9;
            if (description.includes(word)) score += 5;
            if (category.includes(word)) score += 8;
            if (presenter.includes(word)) score += 3;

            allTags.forEach(tag => {
              if (tag.includes(word)) score += 7;
            });
          }
        });
      });

      return { event, score };
    });

    return scored
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.event);
  };

  // Filter events based on all criteria
  const filterEvents = (events: Event[]) => {
    let filtered = [...events];

    // Search filter
    if (searchTerm) {
      filtered = searchEvents(filtered, searchTerm);
    }

    // Date filter
    if (dateFilter === 'today') {
      filtered = filtered.filter(event => isToday(event.startDate));
    } else if (dateFilter === 'next') {
      filtered = filtered.filter(event => isNext(event.startDate));
    } else if (dateFilter === 'this-week') {
      filtered = filtered.filter(event => isThisWeek(event.startDate));
    }

    // Week filter (independent of date filter)
    if (selectedWeeks.length > 0) {
      filtered = filtered.filter(event =>
        selectedWeeks.some(weekNum => isInChautauquaWeek(event.startDate, weekNum))
      );
    }

    // Location filter - case insensitive
    if (selectedLocationsLowerSet.size > 0) {
      filtered = filtered.filter(event => {
        if (event.location) {
          return selectedLocationsLowerSet.has(event.location.toLowerCase());
        }
        return false;
      });
    }

    // Tag filter - case insensitive (using pre-computed Sets for O(1) lookups)
    if (selectedTagsLowerSet.size > 0) {
      filtered = filtered.filter(event => {
        // Use pre-computed lowercase tag set if available
        if (event._tagsLowerSet) {
          for (const selectedTag of selectedTagsLowerSet) {
            if (event._tagsLowerSet.has(selectedTag)) {
              return true;
            }
          }
          return false;
        }

        // Fallback for events without pre-computed sets (shouldn't happen normally)
        if (event.tags) {
          for (const eventTag of event.tags) {
            if (selectedTagsLowerSet.has(eventTag.toLowerCase())) {
              return true;
            }
          }
        }
        if (event.originalCategories) {
          for (const eventCat of event.originalCategories) {
            if (selectedTagsLowerSet.has(eventCat.toLowerCase())) {
              return true;
            }
          }
        }
        return false;
      });
    }

    return filtered;
  };

  // Group events by day
  const groupEventsByDay = (events: Event[]) => {
    const grouped: { [key: string]: Event[] } = {};

    events.forEach(event => {
      const eventDate = new Date(event.startDate);
      const baseDayKey = eventDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      // Add week number to the day label
      const weekNumber = getWeekNumberForDate(eventDate);
      const dayKey = weekNumber 
        ? `${baseDayKey} - Week ${weekNumber}`
        : baseDayKey;

      if (!grouped[dayKey]) {
        grouped[dayKey] = [];
      }
      grouped[dayKey].push(event);
    });

    // Sort events within each day by start time
    Object.keys(grouped).forEach(dayKey => {
      grouped[dayKey].sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
    });

    // Return days sorted by date
    const sortedDays = Object.keys(grouped).sort((a, b) => {
      const dateA = new Date(grouped[a][0].startDate);
      const dateB = new Date(grouped[b][0].startDate);
      return dateA.getTime() - dateB.getTime();
    });

    return sortedDays.map(dayKey => ({
      day: dayKey,
      events: grouped[dayKey]
    }));
  };

  // Fetch events from API
  const fetchAllEvents = useCallback(async (forceRefresh = false) => {
    console.log('fetchAllEvents called', {
      forceRefresh,
      isLoadingRef: isLoadingRef.current,
      globalDataLoaded: !!globalEventData.events
    });

    // Clear cache if we're forcing refresh to ensure clean data
    if (forceRefresh) {
      try {
        localStorage.removeItem('chq-calendar-events');
        console.log('Cleared local storage cache');
      } catch (e) {
        console.warn('Failed to clear localStorage:', e);
      }
    }

    // Check global store first
    if (!forceRefresh && globalEventData.events && globalEventData.loadedAt) {
      console.log('Loading from global store');
      // Decode HTML entities for global events in case they weren't decoded when stored
      const decodedEvents = globalEventData.events.map(decodeEventHtmlEntities);
      setEvents(decodedEvents);
      setAvailableCategories(globalEventData.categories);
      setAvailableLocations(globalEventData.locations || []);
      setAvailableTags(globalEventData.tags);
      setDataLoaded(true);
      return;
    }

    // Skip if already loading
    if (isLoadingRef.current && !forceRefresh) {
      console.log('Already loading, skipping duplicate call');
      return;
    }

    // Skip if data already loaded and not forcing refresh
    if (dataLoaded && !forceRefresh) {
      console.log('Data already loaded, skipping API call');
      return;
    }

    isLoadingRef.current = true;

    // Check localStorage first (unless forcing refresh)
    if (!forceRefresh) {
      try {
        const cachedData = localStorage.getItem('chq-calendar-events');
        if (cachedData) {
          const parsed = JSON.parse(cachedData);
          // Check if cache is less than 1 hour old AND has the correct version
          if (parsed.timestamp && Date.now() - parsed.timestamp < 3600000 && parsed.version === 'v2-decoded') {
            console.log('Loading events from local cache (v2-decoded)');
            // Events should already be decoded, but decode again as safety measure
            const decodedEvents = parsed.events.map(decodeEventHtmlEntities);
            setEvents(decodedEvents);
            setAvailableCategories(parsed.categories);
            setAvailableLocations(parsed.locations || []);
            setAvailableTags(parsed.tags);
            setDataLoaded(true);
            isLoadingRef.current = false;
            return;
          } else {
            console.log('Invalidating old cache (missing version or expired)');
            localStorage.removeItem('chq-calendar-events');
          }
        }
      } catch (e) {
        console.warn('Failed to load from localStorage:', e);
      }
    }

    setLoading(true);
    try {
      console.log('Loading all events for the season...');

      const response = await fetch(
        process.env.NODE_ENV === 'development'
          ? '/data/all-events.json'  // Local file in dev mode
          : `${apiUrl}/cache/calendar-cache/all-events.json`,  // Production URL
        {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        const rawEvents = data.data || [];
        // Decode HTML entities for all events
        const fetchedEvents = rawEvents.map(decodeEventHtmlEntities);
        console.log('Loaded all events:', fetchedEvents.length, 'events');
        console.log('First event:', fetchedEvents[0]);
        setEvents(fetchedEvents);
        setDataLoaded(true);

        // Extract unique categories for filter options
        const categories = [...new Set(fetchedEvents.map((e: Event) => e.category).filter(Boolean))] as string[];

        // Extract unique locations for filter options
        const locations = [...new Set(fetchedEvents.map((e: Event) => e.location).filter(Boolean))] as string[];

        // Extract tags separately (event.tags and event.originalCategories)
        const allTags: string[] = [];
        fetchedEvents.forEach((event: Event) => {
          if (event.tags) allTags.push(...event.tags);
          if (event.originalCategories) allTags.push(...event.originalCategories);
        });

        // Deduplicate tags using the same logic as event display
        const normalizeTag = (tag: string) => tag.toLowerCase().replace(/[-\s]+/g, ' ').trim();
        const seenNormalized = new Set<string>();
        const uniqueTags: string[] = [];

        // Sort by preference: prefer tags with spaces and proper capitalization
        const sortedByPreference = allTags.sort((a, b) => {
          // Prefer tags with spaces over dashes
          const aHasSpaces = a.includes(' ');
          const bHasSpaces = b.includes(' ');
          if (aHasSpaces && !bHasSpaces) return -1;
          if (!aHasSpaces && bHasSpaces) return 1;

          // Prefer tags with capital letters
          const aHasCapitals = /[A-Z]/.test(a);
          const bHasCapitals = /[A-Z]/.test(b);
          if (aHasCapitals && !bHasCapitals) return -1;
          if (!aHasCapitals && bHasCapitals) return 1;

          return 0;
        });

        for (const tag of sortedByPreference) {
          if (!tag.startsWith('Week ')) {
            const normalized = normalizeTag(tag);
            if (!seenNormalized.has(normalized)) {
              seenNormalized.add(normalized);
              uniqueTags.push(tag);
            }
          }
        }

        const sortedCategories = categories.sort();
        const sortedLocations = locations.sort();
        const sortedTags = uniqueTags.sort();
        const weeks = seasonWeeks.map(w => w.number);

        setAvailableCategories(sortedCategories);
        setAvailableLocations(sortedLocations);
        setAvailableTags(sortedTags);

        // Update global store
        if (globalEventData.setGlobalEventData) {
          globalEventData.setGlobalEventData({
            events: fetchedEvents,
            categories: sortedCategories,
            locations: sortedLocations,
            tags: sortedTags,
            weeks: weeks,
            loadedAt: Date.now()
          });
        }

        // Cache in localStorage - include a version marker to invalidate old cache
        try {
          localStorage.setItem('chq-calendar-events', JSON.stringify({
            events: fetchedEvents,
            categories: categories.sort(),
            locations: locations.sort(),
            tags: sortedTags,
            weeks: weeks,
            timestamp: Date.now(),
            version: 'v2-decoded' // Version marker to invalidate old cache with HTML entities
          }));
        } catch (e) {
          console.warn('Failed to save to localStorage:', e);
        }
      } else {
        console.error('Failed to fetch events');
      }
    } catch (error) {
      console.error('Error fetching events:', error);
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  }, [apiUrl, dataLoaded, globalEventData, seasonWeeks, decodeEventHtmlEntities]);

  // Create sample data

  // Generate calendar download

  useEffect(() => {
    console.log('Component mounted - Initial useEffect triggered');
    fetchAllEvents();
    return () => {
      console.log('Component unmounting!');
    };
  }, [fetchAllEvents]);

  // Handle global mouse events for week dragging
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        setDragStart(null);
        setWasDragged(false);
        // Restore text selection
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mouseup', handleGlobalMouseUp);
    return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [isDragging]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-2 sm:py-4">
            <div className="flex items-center">
              <Image
                src="/chq-calendar-icon-256.svg"
                alt="Chautauqua Calendar Logo"
                width={40}
                height={40}
                className="w-8 h-8 sm:w-10 sm:h-10 mr-2 sm:mr-3"
              />
              <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">
                CHQ Calendar
              </h1>
              <span className="ml-2 sm:ml-3 px-2 sm:px-3 py-0.5 sm:py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs sm:text-sm font-medium rounded-full">
                2025 Season
              </span>
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
              <button
                onClick={() => window.open('/feedback', '_blank')}
                className="px-2 py-1 sm:px-3 sm:py-1 text-xs sm:text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Feedback
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">

        {/* Main Filter Panel - Compact on mobile */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow mb-4 sm:mb-6">
          <div className="p-2 sm:p-4">
            {/* Search Bar */}
            <div className="mb-2 sm:mb-4">
              <input
                type="text"
                placeholder="Search events..."
                className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm sm:text-base bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            {/* Week Range Selector - Mobile: Below search, Desktop: With date filters */}
            <div className="mb-2 sm:mb-0 block sm:hidden">
              <div className="flex items-center gap-1 sm:gap-2 justify-start">
                <span className="text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap mr-2">Weeks:</span>
                <div
                  className={`flex border border-gray-300 dark:border-gray-600 rounded-md overflow-hidden select-none ${
                    isDragging ? 'cursor-grabbing' : 'cursor-pointer'
                  }`}
                >
                  {seasonWeeks.map((week) => {
                    const isPast = isWeekInPast(week.number);
                    const isSelected = selectedWeeks.includes(week.number);
                    const isHighlighted = isWeekHighlighted(week.number, isSelected);
                    
                    return (
                      <div
                        key={week.number}
                        className={`w-6 h-6 flex items-center justify-center cursor-pointer border-r border-gray-300 dark:border-gray-600 last:border-r-0 transition-all text-xs flex-shrink-0 ${
                          isPast
                            ? isHighlighted
                              ? 'bg-gray-400 dark:bg-gray-500 text-white' // Past and selected
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600' // Past but not selected
                            : isHighlighted
                            ? 'bg-blue-600 text-white' // Current/future and selected
                            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-gray-700' // Current/future and not selected
                        }`}
                        onMouseDown={(e) => handleWeekMouseDown(week.number, e)}
                        onMouseEnter={() => handleWeekMouseEnter(week.number)}
                        onMouseUp={() => handleWeekMouseUp(week.number)}
                        onTouchStart={(e) => {
                          e.preventDefault(); // Prevent mouse events from also firing
                          handleWeekTap(week.number);
                        }}
                        title={week.label}
                      >
                        {week.number}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Date Filters */}
            <div className="mb-2 sm:mb-4">
              <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto">
                {/* Quick Date Filters */}
                <button
                  onClick={() => {
                    setDateFilter(dateFilter === 'next' ? 'all' : 'next');
                    if (dateFilter !== 'next') {
                      setSelectedWeeks([]); // Clear week selection when selecting "Next"
                    }
                  }}
                  title="Show events starting after the current time through the end of this week"
                  className={`px-2 py-1 sm:px-4 sm:py-2 rounded-md border transition-all text-xs sm:text-sm whitespace-nowrap ${
                    dateFilter === 'next'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-gray-600'
                  }`}
                >
                  Now
                </button>
                <button
                  onClick={() => {
                    setDateFilter(dateFilter === 'today' ? 'all' : 'today');
                    if (dateFilter !== 'today') {
                      setSelectedWeeks([]); // Clear week selection when selecting "Today"
                    }
                  }}
                  title="Show all events for today"
                  className={`px-2 py-1 sm:px-4 sm:py-2 rounded-md border transition-all text-xs sm:text-sm whitespace-nowrap ${
                    dateFilter === 'today'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-gray-600'
                  }`}
                >
                  Today
                </button>
                <button
                  onClick={() => {
                    setDateFilter(dateFilter === 'this-week' ? 'all' : 'this-week');
                    if (dateFilter !== 'this-week') {
                      setSelectedWeeks([]); // Clear week selection when selecting "This Week"
                    }
                  }}
                  title="Show events for this week"
                  className={`px-2 py-1 sm:px-4 sm:py-2 rounded-md border transition-all text-xs sm:text-sm whitespace-nowrap ${
                    isThisWeekButtonActive()
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-gray-600'
                  }`}
                >
                  This Week
                </button>

                {/* Week Range Selector - Desktop: Inline with date filters */}
                <div className="hidden sm:flex items-center gap-1 sm:gap-2">
                  <span className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">Weeks:</span>
                  <div
                    className={`flex border border-gray-300 dark:border-gray-600 rounded-md overflow-hidden select-none ${
                      isDragging ? 'cursor-grabbing' : 'cursor-pointer'
                    }`}
                  >
                    {seasonWeeks.map((week) => {
                      const isPast = isWeekInPast(week.number);
                      const isSelected = selectedWeeks.includes(week.number);
                      const isHighlighted = isWeekHighlighted(week.number, isSelected);
                      
                      return (
                        <div
                          key={week.number}
                          className={`w-8 h-8 flex items-center justify-center cursor-pointer border-r border-gray-300 dark:border-gray-600 last:border-r-0 transition-all text-xs flex-shrink-0 ${
                            isPast
                              ? isHighlighted
                                ? 'bg-gray-400 dark:bg-gray-500 text-white' // Past and selected
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600' // Past but not selected
                              : isHighlighted
                              ? 'bg-blue-600 text-white' // Current/future and selected
                              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-gray-700' // Current/future and not selected
                          }`}
                          onMouseDown={(e) => handleWeekMouseDown(week.number, e)}
                          onMouseEnter={() => handleWeekMouseEnter(week.number)}
                          onMouseUp={() => handleWeekMouseUp(week.number)}
                          onTouchStart={(e) => {
                            e.preventDefault(); // Prevent mouse events from also firing
                            handleWeekTap(week.number);
                          }}
                          title={week.label}
                        >
                          {week.number}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Show selected filter info - more compact */}
              {(selectedWeeks.length > 0 || dateFilter !== 'all') && (
                <div className="mt-1 text-xs sm:text-sm text-gray-600 dark:text-gray-300">
                  Selected: {(() => {
                    if (dateFilter === 'today') {
                      const today = new Date();
                      const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
                      const fullDate = today.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      });
                      return `Today, ${dayName}, ${fullDate}`;
                    } else if (dateFilter === 'next') {
                      const now = new Date();
                      const timeString = now.toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                      });
                      return `Next events after ${timeString}`;
                    } else if (dateFilter === 'this-week') {
                      if (currentWeekNumber === null) {
                        return 'This Week (Not in season)';
                      }
                      
                      const currentWeek = seasonWeeks[currentWeekNumber - 1];
                      const startStr = currentWeek.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      const endStr = currentWeek.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      
                      return `This Week (${startStr} 12pm - ${endStr} 12pm)`;
                    } else if (selectedWeeks.length === 1) {
                      const weekNum = selectedWeeks[0];
                      const week = seasonWeeks[weekNum - 1];
                      const startStr = week.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      const endStr = week.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      return `Week ${weekNum} (${startStr} - ${endStr})`;
                    } else if (selectedWeeks.length > 1) {
                      const startWeek = Math.min(...selectedWeeks);
                      const endWeek = Math.max(...selectedWeeks);
                      const startWeekObj = seasonWeeks[startWeek - 1];
                      const endWeekObj = seasonWeeks[endWeek - 1];
                      const startStr = startWeekObj.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      const endStr = endWeekObj.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      return `Weeks ${startWeek}-${endWeek} (${startStr} - ${endStr})`;
                    }
                    return '';
                  })()}
                </div>
              )}
            </div>

            {/* Locations and Categories - Expandable Sections (All Screen Sizes) */}
            <div className="space-y-3">
              {/* Locations - Desktop */}
              <details>
                <summary className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 cursor-pointer flex items-center gap-2 min-w-0">
                  <span className="flex-shrink-0 flex items-center gap-1">
                    <svg className="w-3 h-3 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    Locations {selectedLocations.length > 0 && `(${selectedLocations.length} selected)`}
                  </span>
                  {recentLocations.length > 0 && (
                    <div className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden scrollbar-hide">
                      <div className="flex gap-2 pb-1">
                        {recentLocations.map(location => (
                          <button
                            key={`recent-${location}`}
                            title={location} // Tooltip showing full name
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleLocation(location);
                            }}
                            className={`flex-shrink-0 px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-full text-xs font-medium transition-colors ${
                              isLocationSelected(location)
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-500'
                            }`}
                          >
                            {getLocationDisplayName(location)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </summary>
                <div className="max-h-24 sm:max-h-32 overflow-y-auto mb-2">
                  <div className="flex flex-wrap gap-1 sm:gap-2">
                    {availableLocations.map(location => (
                      <button
                        key={location}
                        onClick={() => toggleLocation(location)}
                        className={`px-1 py-0.5 sm:px-2 sm:py-1 rounded-full text-xs font-medium transition-colors ${
                          isLocationSelected(location)
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        {location}
                      </button>
                    ))}
                  </div>
                </div>
              </details>

              {/* Categories - Desktop */}
              <details>
                <summary className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 cursor-pointer flex items-center gap-2 min-w-0">
                  <span className="flex-shrink-0 flex items-center gap-1">
                    <svg className="w-3 h-3 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    Categories {selectedCategoriesCount > 0 && `(${selectedCategoriesCount} selected)`}
                  </span>
                  {recentCategories.length > 0 && (
                    <div className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden scrollbar-hide">
                      <div className="flex gap-2 pb-1">
                        {recentCategories.map(category => (
                          <button
                            key={`recent-${category}`}
                            title={category} // Tooltip showing full name
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleTag(category);
                            }}
                            className={`flex-shrink-0 px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-full text-xs font-medium transition-colors ${
                              isTagSelected(category)
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-500'
                            }`}
                          >
                            {getCategoryDisplayName(category)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </summary>
                <div className="max-h-24 sm:max-h-32 overflow-y-auto mb-2">
                  <div className="flex flex-wrap gap-1 sm:gap-2">
                    {availableCategories
                      .filter(category => !category.startsWith('Week '))
                      .map(category => (
                      <button
                        key={category}
                        onClick={() => toggleTag(category)}
                        className={`px-1 py-0.5 sm:px-2 sm:py-1 rounded-full text-xs font-medium transition-colors ${
                          isTagSelected(category)
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        {category}
                      </button>
                    ))}
                  </div>
                </div>
              </details>

            </div>

            {/* Clear Filters */}
            {/* Event count and clear filters */}
            <div className="mt-2 sm:mt-4 pt-2 sm:pt-3 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600 dark:text-gray-300 font-medium">
                  {(() => {
                    const filteredCount = filterEvents(events).length;
                    const totalCount = events.length;
                    const hasFilters = searchTerm || selectedTags.length > 0 || selectedLocations.length > 0 || dateFilter !== 'all' || selectedWeeks.length > 0;
                    
                    if (hasFilters) {
                      return `Events (${filteredCount}/${totalCount})`;
                    } else {
                      return `Events (${totalCount})`;
                    }
                  })()}
                </div>
                {(searchTerm || selectedTags.length > 0 || selectedLocations.length > 0 || dateFilter !== 'all' || selectedWeeks.length > 0) && (
                  <button
                    onClick={() => {
                      setSearchTerm('');
                      setSelectedTags([]);
                      setSelectedLocations([]);
                      setDateFilter('all');
                      setSelectedWeeks([]);
                    }}
                    className="px-3 py-1 sm:px-4 sm:py-2 text-sm text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    Clear All Filters
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>


        {/* Events Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          <div className="p-4 sm:p-6">
            {loading ? (
              <div className="text-center py-8">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <p className="mt-2 text-gray-600 dark:text-gray-200">Loading events...</p>
              </div>
            ) : filterEvents(events).length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">🎭</div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No events found</h3>
                <p className="text-gray-600 dark:text-gray-200 mb-4">
                  Try adjusting your filters or search terms.
                </p>
              </div>
            ) : (
              <div className="space-y-4 sm:space-y-6">
                {groupEventsByDay(filterEvents(events)).map((dayGroup) => (
                  <div key={dayGroup.day}>
                    {/* Day Header - more compact on mobile */}
                    <div className="sticky top-0 bg-white dark:bg-gray-800 z-10 border-b border-gray-200 dark:border-gray-700 pb-1 sm:pb-2 mb-2 sm:mb-4">
                      <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">{dayGroup.day}</h3>
                    </div>

                    {/* Events for this day */}
                    <div className="space-y-1">
                      {dayGroup.events.map((event, index) => (
                        <div key={event.id} className={`py-2 sm:py-3 ${index > 0 ? 'border-t border-gray-200 dark:border-gray-700' : ''} hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors`}>
                          <div className="flex justify-between items-start gap-2 sm:gap-4">
                            <div className="flex-1 min-w-0">
                              {/* Time and location above title */}
                              <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-1">
                                🕐 {new Date(event.startDate).toLocaleTimeString([], {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                  hour12: true
                                })}
                                {event.location && (
                                  <span className="ml-2">📍 {event.location}</span>
                                )}
                              </div>

                              {/* Event title */}
                              <h4 className="text-sm sm:text-lg font-semibold text-gray-900 dark:text-white mb-1 leading-tight">
                                {event.url ? (
                                  <a
                                    href={event.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline"
                                  >
                                    {event.title} 🔗
                                  </a>
                                ) : (
                                  event.title
                                )}
                              </h4>

                              {/* Description with disclosure widget */}
                              {(event.description || event.category) && (
                                <div className="mb-2">
                                  {expandedDescriptions.has(event.id) ? (
                                    <div>
                                      <button
                                        onClick={() => toggleDescription(event.id)}
                                        className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-xs font-medium flex items-center gap-1"
                                      >
                                        <span className="text-xs">▼</span> Show less
                                      </button>

                                      {/* Show description if it exists */}
                                      {event.description && (
                                        <p className="text-gray-600 dark:text-gray-300 text-sm mb-2">{event.description}</p>
                                      )}

                                      {/* Show category when expanded */}
                                      <div className="mb-2 flex flex-wrap gap-1">
                                        {event.category && (
                                          <button
                                            onClick={() => toggleTag(event.category!)}
                                            className={`px-1 py-0.5 sm:px-2 sm:py-1 rounded-full text-xs transition-colors cursor-pointer hover:opacity-80 ${
                                              isTagSelected(event.category!)
                                                ? 'bg-blue-600 text-white'
                                                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                                            }`}
                                          >
                                            {event.category}
                                          </button>
                                        )}
                                      </div>

                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => toggleDescription(event.id)}
                                      className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-xs font-medium flex items-center gap-1"
                                    >
                                      <span className="text-xs">▶</span> Show more
                                    </button>
                                  )}
                                </div>
                              )}

                              {/* Compact event info - only show presenter */}
                              {event.presenter && (
                                <div className="flex flex-wrap gap-2 text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                                  <span>👤 {event.presenter}</span>
                                </div>
                              )}
                            </div>

                            {/* Event Image - smaller on mobile */}
                            {event.attachments && event.attachments.length > 0 && (
                              <div className="flex-shrink-0">
                                {event.attachments
                                  .filter(attachment => attachment.isImage)
                                  .slice(0, 1)
                                  .map((attachment, _index) => (
                                    <Image
                                      key={_index}
                                      src={attachment.url}
                                      alt={`${event.title} image`}
                                      width={48}
                                      height={48}
                                      className="w-12 h-12 sm:w-20 sm:h-20 object-cover rounded-lg border border-gray-200"
                                      onError={(e) => {
                                        e.currentTarget.style.display = 'none';
                                      }}
                                    />
                                  ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-gray-800 text-white mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center">
            <p className="text-gray-400">
              © 2025 Chautauqua Calendar by Bernie and Claude
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function Home() {
  return (
    <GlobalEventDataProvider>
      <HomeContent />
    </GlobalEventDataProvider>
  );
}
