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
}

interface GlobalEventData {
  events: Event[] | null;
  categories: string[];
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

function GlobalEventDataProvider({ children }: { children: React.ReactNode }) {
  const [globalEventData, setGlobalEventData] = useState<GlobalEventData>({
    events: null,
    categories: [],
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
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'next' | 'this-week'>('all');
  const [selectedWeeks, setSelectedWeeks] = useState<number[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [hasMouseMoved, setHasMouseMoved] = useState(false);

  const apiUrl = useMemo(() =>
    process.env.NODE_ENV === 'development'
      ? (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001')
      : '/api'
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

  // Decode HTML entities for an entire event object
  const decodeEventHtmlEntities = useCallback((event: Event): Event => {
    return {
      ...event,
      title: decodeHtmlEntities(event.title) || event.title,
      description: decodeHtmlEntities(event.description) || event.description,
      location: decodeHtmlEntities(event.location) || event.location,
      presenter: decodeHtmlEntities(event.presenter) || event.presenter,
      category: decodeHtmlEntities(event.category) || event.category,
      originalCategories: event.originalCategories?.map(cat => decodeHtmlEntities(cat) || cat),
      tags: event.tags?.map(tag => decodeHtmlEntities(tag) || tag),
      // Also decode attachment types in case they contain HTML entities
      attachments: event.attachments?.map(att => ({
        ...att,
        type: decodeHtmlEntities(att.type) || att.type
      }))
    };
  }, []);

  // Helper functions for case-insensitive tag operations
  const toggleTagSelection = useCallback((tag: string, setSelectedTags: React.Dispatch<React.SetStateAction<string[]>>) => {
    setSelectedTags(prev => {
      const tagLower = tag.toLowerCase();
      const existingTag = prev.find(t => t.toLowerCase() === tagLower);
      return existingTag
        ? prev.filter(t => t.toLowerCase() !== tagLower)
        : [...prev, tag];
    });
  }, []);

  const isTagSelected = useCallback((tag: string, selectedTags: string[]) => {
    return selectedTags.some(selectedTag => selectedTag.toLowerCase() === tag.toLowerCase());
  }, []);

  // Calculate Chautauqua season weeks (9 weeks starting from 4th Sunday of June)
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

    const weeks = [];
    for (let i = 0; i < 9; i++) {
      const weekStart = new Date(fourthSunday.getTime() + (i * 7 * 24 * 60 * 60 * 1000));
      const weekEnd = new Date(weekStart.getTime() + (6 * 24 * 60 * 60 * 1000));

      weeks.push({
        number: i + 1,
        start: weekStart,
        end: weekEnd,
        label: `Week ${i + 1} (${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
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
    const today = new Date();
    const eventDate = new Date(dateString);
    const dayOfWeek = today.getDay();
    const saturday = new Date(today);
    saturday.setDate(today.getDate() - dayOfWeek + 6);
    return eventDate >= today && eventDate <= saturday;
  };

  const isThisWeek = (dateString: string) => {
    const today = new Date();
    const eventDate = new Date(dateString);
    const dayOfWeek = today.getDay();
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - dayOfWeek - 1);
    const saturday = new Date(today);
    saturday.setDate(today.getDate() - dayOfWeek + 6);
    return eventDate >= sunday && eventDate <= saturday;
  };

  const isInChautauquaWeek = (dateString: string, weekNumber: number) => {
    const eventDate = new Date(dateString);
    const week = seasonWeeks[weekNumber - 1];

    // Create end of day for proper comparison
    const weekEndInclusive = new Date(week.end);
    weekEndInclusive.setHours(23, 59, 59, 999);

    return eventDate >= week.start && eventDate <= weekEndInclusive;
  };

  // Week selection handlers
  const handleWeekMouseDown = (weekNum: number) => {
    if (process.env.NODE_ENV === 'development') {
      console.log('handleWeekMouseDown called for week', weekNum);
    }

    // Batch state updates to reduce re-renders
    setIsDragging(true);
    setDragStart(weekNum);
    setHasMouseMoved(false);
    setSelectedWeeks([weekNum]);

    // Prevent text selection during potential drag
    document.body.style.userSelect = 'none';
  };

  const handleWeekMouseEnter = (weekNum: number) => {
    if (isDragging && dragStart !== null) {
      setHasMouseMoved(true);
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
      if (!hasMouseMoved) {
        // This was a click, not a drag - select only this week
        setSelectedWeeks([weekNum]);
      }
      // If hasMouseMoved is true, the selection was already set in handleWeekMouseEnter

      // Clear date filter when selecting weeks
      setDateFilter('all');
    }

    setIsDragging(false);
    setDragStart(null);
    setHasMouseMoved(false);
    // Restore text selection
    document.body.style.userSelect = '';
  };

  // Mobile-friendly tap-to-toggle handler
  const handleWeekTap = (weekNum: number) => {
    setSelectedWeeks(prev => {
      const newSelection = prev.includes(weekNum)
        ? prev.filter(w => w !== weekNum) // Remove if already selected
        : [...prev, weekNum].sort((a, b) => a - b); // Add if not selected

      // Clear date filter when selecting weeks
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

    // Tag filter - case insensitive
    if (selectedTags.length > 0) {
      const selectedTagsLower = selectedTags.map(tag => tag.toLowerCase());
      filtered = filtered.filter(event =>
        selectedTagsLower.some(selectedTagLower => {
          return event.tags?.some(eventTag => eventTag.toLowerCase() === selectedTagLower) ||
                 event.originalCategories?.some(eventCat => eventCat.toLowerCase() === selectedTagLower);
        })
      );
    }

    return filtered;
  };

  // Group events by day
  const groupEventsByDay = (events: Event[]) => {
    const grouped: { [key: string]: Event[] } = {};

    events.forEach(event => {
      const eventDate = new Date(event.startDate);
      const dayKey = eventDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

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
        sessionStorage.removeItem('chq-calendar-events');
        console.log('Cleared session storage cache');
      } catch (e) {
        console.warn('Failed to clear sessionStorage:', e);
      }
    }

    // Check global store first
    if (!forceRefresh && globalEventData.events && globalEventData.loadedAt) {
      console.log('Loading from global store');
      // Decode HTML entities for global events in case they weren't decoded when stored
      const decodedEvents = globalEventData.events.map(decodeEventHtmlEntities);
      setEvents(decodedEvents);
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

    // Check sessionStorage first (unless forcing refresh)
    if (!forceRefresh) {
      try {
        const cachedData = sessionStorage.getItem('chq-calendar-events');
        if (cachedData) {
          const parsed = JSON.parse(cachedData);
          // Check if cache is less than 1 hour old AND has the correct version
          if (parsed.timestamp && Date.now() - parsed.timestamp < 3600000 && parsed.version === 'v2-decoded') {
            console.log('Loading events from session cache (v2-decoded)');
            // Events should already be decoded, but decode again as safety measure
            const decodedEvents = parsed.events.map(decodeEventHtmlEntities);
            setEvents(decodedEvents);
            setAvailableTags(parsed.tags);
            setDataLoaded(true);
            isLoadingRef.current = false;
            return;
          } else {
            console.log('Invalidating old cache (missing version or expired)');
            sessionStorage.removeItem('chq-calendar-events');
          }
        }
      } catch (e) {
        console.warn('Failed to load from sessionStorage:', e);
      }
    }

    setLoading(true);
    try {
      console.log('Loading all events for the season...');

      const response = await fetch(`${apiUrl}/calendar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filters: {}, // Empty filters to get all events
          format: 'json'
        })
      });

      if (response.ok) {
        const data = await response.json();
        const rawEvents = data.events || [];
        // Decode HTML entities for all events
        const fetchedEvents = rawEvents.map(decodeEventHtmlEntities);
        console.log('Loaded all events:', fetchedEvents.length, 'events');
        console.log('First event:', fetchedEvents[0]);
        setEvents(fetchedEvents);
        setDataLoaded(true);

        // Extract unique categories for filter options
        const categories = [...new Set(fetchedEvents.map((e: Event) => e.category).filter(Boolean))] as string[];

        // Extract all unique tags from both tags and originalCategories with deduplication
        const allTagsAndCategories: string[] = [];
        fetchedEvents.forEach((event: Event) => {
          if (event.tags) allTagsAndCategories.push(...event.tags);
          if (event.originalCategories) allTagsAndCategories.push(...event.originalCategories);
        });
        
        // Deduplicate tags using the same logic as event display
        const normalizeTag = (tag: string) => tag.toLowerCase().replace(/[-\s]+/g, ' ').trim();
        const seenNormalized = new Set<string>();
        const uniqueTags: string[] = [];
        
        // Sort by preference: prefer tags with spaces and proper capitalization
        const sortedByPreference = allTagsAndCategories.sort((a, b) => {
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
        const sortedTags = uniqueTags.sort();
        const weeks = seasonWeeks.map(w => w.number);

        setAvailableTags(sortedTags);

        // Update global store
        if (globalEventData.setGlobalEventData) {
          globalEventData.setGlobalEventData({
            events: fetchedEvents,
            categories: sortedCategories,
            tags: sortedTags,
            weeks: weeks,
            loadedAt: Date.now()
          });
        }

        // Cache in sessionStorage - include a version marker to invalidate old cache
        try {
          sessionStorage.setItem('chq-calendar-events', JSON.stringify({
            events: fetchedEvents,
            categories: categories.sort(),
            tags: sortedTags,
            weeks: weeks,
            timestamp: Date.now(),
            version: 'v2-decoded' // Version marker to invalidate old cache with HTML entities
          }));
        } catch (e) {
          console.warn('Failed to save to sessionStorage:', e);
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
        setHasMouseMoved(false);
        // Restore text selection
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mouseup', handleGlobalMouseUp);
    return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [isDragging]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-2 sm:py-4">
            <div className="flex items-center">
              <h1 className="text-lg sm:text-2xl font-bold text-gray-900">
                Chautauqua Calendar
              </h1>
              <span className="ml-2 sm:ml-3 px-2 sm:px-3 py-0.5 sm:py-1 bg-blue-100 text-blue-800 text-xs sm:text-sm font-medium rounded-full">
                2025 Season
              </span>
            </div>
            <div className="text-xs sm:text-sm text-gray-600 font-medium">
              {filterEvents(events).length > 0 && `Events (${filterEvents(events).length})`}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">

        {/* Main Filter Panel - Compact on mobile */}
        <div className="bg-white rounded-lg shadow mb-4 sm:mb-6">
          <div className="p-2 sm:p-4">
            {/* Search Bar */}
            <div className="mb-2 sm:mb-4">
              <input
                type="text"
                placeholder="Search events..."
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm sm:text-base"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            {/* Date and Week Filters */}
            <div className="mb-2 sm:mb-4">
              <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto">
                {/* Quick Date Filters */}
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
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                  }`}
                >
                  Today
                </button>
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
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                  }`}
                >
                  Next
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
                    dateFilter === 'this-week'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                  }`}
                >
                  This Week
                </button>

                {/* Week Range Selector */}
                <div className="flex items-center gap-1 sm:gap-2">
                  <span className="hidden sm:inline text-xs sm:text-sm text-gray-600 whitespace-nowrap">Weeks:</span>
                  <div
                    className={`flex border border-gray-300 rounded-md overflow-hidden select-none ${
                      isDragging ? 'cursor-grabbing' : 'cursor-pointer'
                    }`}
                  >
                    {seasonWeeks.map((week) => (
                      <div
                        key={week.number}
                        className={`w-6 h-6 sm:w-8 sm:h-8 flex items-center justify-center cursor-pointer border-r border-gray-300 last:border-r-0 transition-all text-xs flex-shrink-0 ${
                          selectedWeeks.includes(week.number)
                            ? 'bg-blue-600 text-white'
                            : 'bg-white text-gray-700 hover:bg-blue-50'
                        }`}
                        onMouseDown={() => handleWeekMouseDown(week.number)}
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
                    ))}
                  </div>
                </div>
              </div>

              {/* Show selected filter info - more compact */}
              {(selectedWeeks.length > 0 || dateFilter !== 'all') && (
                <div className="mt-1 text-xs sm:text-sm text-gray-600">
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
                      const today = new Date();
                      const dayOfWeek = today.getDay();
                      const sunday = new Date(today);
                      sunday.setDate(today.getDate() - dayOfWeek);
                      const saturday = new Date(today);
                      saturday.setDate(today.getDate() - dayOfWeek + 6);
                      
                      const sundayStr = sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      const saturdayStr = saturday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      return `This Week (${sundayStr} - ${saturdayStr})`;
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

            {/* All Tags - Collapsible on mobile */}
            <div className="sm:block">
              <details className="sm:hidden">
                <summary className="text-sm font-medium text-gray-700 mb-2 cursor-pointer">
                  Tags & Categories {selectedTags.length > 0 && `(${selectedTags.length} selected)`}
                </summary>
                <div className="max-h-24 overflow-y-auto mb-2">
                  <div className="flex flex-wrap gap-1">
                    {availableTags
                      .filter(tag => !tag.startsWith('Week '))
                      .map(tag => (
                      <button
                        key={tag}
                        onClick={() => toggleTagSelection(tag, setSelectedTags)}
                        className={`px-1 py-0.5 rounded-full text-xs font-medium transition-colors ${
                          isTagSelected(tag, selectedTags)
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              </details>
              
              {/* Desktop tags */}
              <div className="hidden sm:block">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  All Tags & Categories
                </label>
                <div className="max-h-32 overflow-y-auto">
                  <div className="flex flex-wrap gap-2">
                    {availableTags
                      .filter(tag => !tag.startsWith('Week '))
                      .map(tag => (
                      <button
                        key={tag}
                        onClick={() => toggleTagSelection(tag, setSelectedTags)}
                        className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                          isTagSelected(tag, selectedTags)
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Clear Filters */}
            {(searchTerm || selectedTags.length > 0 || dateFilter !== 'all' || selectedWeeks.length > 0) && (
              <div className="mt-2 sm:mt-4 pt-2 sm:pt-3 border-t border-gray-200">
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedTags([]);
                    setDateFilter('all');
                    setSelectedWeeks([]);
                  }}
                  className="px-3 py-1 sm:px-4 sm:py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Clear All Filters
                </button>
              </div>
            )}
          </div>
        </div>


        {/* Events Section */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 sm:p-6">
            {loading ? (
              <div className="text-center py-8">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <p className="mt-2 text-gray-600">Loading events...</p>
              </div>
            ) : filterEvents(events).length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">🎭</div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No events found</h3>
                <p className="text-gray-600 mb-4">
                  Try adjusting your filters or search terms.
                </p>
              </div>
            ) : (
              <div className="space-y-4 sm:space-y-6">
                {groupEventsByDay(filterEvents(events)).map((dayGroup) => (
                  <div key={dayGroup.day}>
                    {/* Day Header - more compact on mobile */}
                    <div className="sticky top-0 bg-white z-10 border-b border-gray-200 pb-1 sm:pb-2 mb-2 sm:mb-4">
                      <h3 className="text-lg sm:text-xl font-bold text-gray-900">{dayGroup.day}</h3>
                    </div>

                    {/* Events for this day */}
                    <div className="space-y-1">
                      {dayGroup.events.map((event, index) => (
                        <div key={event.id} className={`py-2 sm:py-3 ${index > 0 ? 'border-t border-gray-200' : ''} hover:bg-gray-50 transition-colors`}>
                          <div className="flex justify-between items-start gap-2 sm:gap-4">
                            <div className="flex-1 min-w-0">
                              {/* Time and location above title */}
                              <div className="text-xs sm:text-sm text-gray-500 mb-1">
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
                              <h4 className="text-sm sm:text-lg font-semibold text-gray-900 mb-1 leading-tight">
                                {event.url ? (
                                  <a
                                    href={event.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-800 hover:underline"
                                  >
                                    {event.title} 🔗
                                  </a>
                                ) : (
                                  event.title
                                )}
                              </h4>

                              {/* Description with disclosure widget */}
                              {(event.description || event.category || (event.originalCategories && event.originalCategories.length > 0)) && (
                                <div className="mb-2">
                                  {expandedDescriptions.has(event.id) ? (
                                    <div>
                                      {/* Show description if it exists */}
                                      {event.description && (
                                        <p className="text-gray-600 text-sm mb-2">{event.description}</p>
                                      )}
                                      
                                      {/* Show all tags and categories when expanded */}
                                      <div className="mb-2 flex flex-wrap gap-1">
                                        {(() => {
                                          // Collect all tags and categories
                                          const allTagsAndCategories = [
                                            ...(event.category ? [event.category] : []),
                                            ...(event.originalCategories || []),
                                            ...(event.tags || [])
                                          ];
                                          
                                          // Filter out Week tags and deduplicate
                                          const normalizeTag = (tag: string) => tag.toLowerCase().replace(/[-\s]+/g, ' ').trim();
                                          const seenNormalized = new Set();
                                          const uniqueTags = [];
                                          
                                          for (const tag of allTagsAndCategories) {
                                            if (!tag.startsWith('Week ')) {
                                              const normalized = normalizeTag(tag);
                                              if (!seenNormalized.has(normalized)) {
                                                seenNormalized.add(normalized);
                                                uniqueTags.push(tag);
                                              }
                                            }
                                          }
                                          
                                          return uniqueTags.map((tag, index) => (
                                            <button
                                              key={`${tag}-${index}`}
                                              onClick={() => toggleTagSelection(tag, setSelectedTags)}
                                              className={`px-1 py-0.5 sm:px-2 sm:py-1 rounded-full text-xs transition-colors cursor-pointer hover:opacity-80 ${
                                                isTagSelected(tag, selectedTags)
                                                  ? 'bg-blue-600 text-white'
                                                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                              }`}
                                            >
                                              {tag}
                                            </button>
                                          ));
                                        })()}
                                      </div>
                                      
                                      <button
                                        onClick={() => toggleDescription(event.id)}
                                        className="text-blue-600 hover:text-blue-800 text-xs font-medium flex items-center gap-1"
                                      >
                                        <span className="text-xs">▼</span> Show less
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => toggleDescription(event.id)}
                                      className="text-blue-600 hover:text-blue-800 text-xs font-medium flex items-center gap-1"
                                    >
                                      <span className="text-xs">▶</span> Show details
                                    </button>
                                  )}
                                </div>
                              )}

                              {/* Compact event info - only show presenter */}
                              {event.presenter && (
                                <div className="flex flex-wrap gap-2 text-xs sm:text-sm text-gray-500">
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
              © 2025 Chautauqua Calendar Generator. Built for the Chautauqua Institution community.
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
