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
  // const mountTimeRef = useRef(Date.now());
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

  // Description truncation helpers
  const DESCRIPTION_TRUNCATE_LENGTH = 200;

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

  const  decodeHtmlEntities = (encodedString: string | undefined) => {
      const parser = new DOMParser();
      if (encodedString === undefined) return null;
      const doc = parser.parseFromString(encodedString, 'text/html');
      return doc.documentElement.textContent;
  }

  const truncateDescription = (description: string, eventId: string) => {
    if (!description) return null;

    const isExpanded = expandedDescriptions.has(eventId);
    const needsTruncation = description.length > DESCRIPTION_TRUNCATE_LENGTH;

    if (!needsTruncation) {
      return <p className="text-gray-600 mb-2">{description}</p>;
    }

    const displayText = isExpanded
      ? description
      : description.substring(0, DESCRIPTION_TRUNCATE_LENGTH) + '...';

    return (
      <div className="mb-2">
        <p className="text-gray-600 mb-1">{displayText}</p>
        <button
          onClick={() => toggleDescription(eventId)}
          className="text-blue-600 hover:text-blue-800 text-sm font-medium"
        >
          {isExpanded ? 'Show less' : 'Show more'}
        </button>
      </div>
    );
  };

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
      const title = event.title.toLowerCase();
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
    } else if (dateFilter === 'this-week') {
      filtered = filtered.filter(event => isThisWeek(event.startDate));
    } else if (dateFilter === 'next') {
      filtered = filtered.filter(event => isNext(event.startDate));
    }

    // Week filter (independent of date filter)
    if (selectedWeeks.length > 0) {
      filtered = filtered.filter(event =>
        selectedWeeks.some(weekNum => isInChautauquaWeek(event.startDate, weekNum))
      );
    }

    // Tag filter
    if (selectedTags.length > 0) {
      filtered = filtered.filter(event =>
        selectedTags.some(tag =>
          event.tags?.includes(tag) ||
          event.originalCategories?.includes(tag)
        )
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
      dataLoaded,
      forceRefresh,
      isLoadingRef: isLoadingRef.current,
      globalDataLoaded: !!globalEventData.events
    });

    // Check global store first
    if (!forceRefresh && globalEventData.events && globalEventData.loadedAt) {
      console.log('Loading from global store');
      setEvents(globalEventData.events);
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
          // Check if cache is less than 1 hour old
          if (parsed.timestamp && Date.now() - parsed.timestamp < 3600000) {
            console.log('Loading events from session cache');
            setEvents(parsed.events);
            setAvailableTags(parsed.tags);
            setDataLoaded(true);
            isLoadingRef.current = false;
            return;
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
        const fetchedEvents = data.events || [];
        console.log('Loaded all events:', fetchedEvents.length, 'events');
        console.log('First event:', fetchedEvents[0]);
        setEvents(fetchedEvents);
        setDataLoaded(true);

        // Extract unique categories for filter options
        const categories = [...new Set(fetchedEvents.map((e: Event) => e.category).filter(Boolean))] as string[];

        // Extract all unique tags from both tags and originalCategories
        const allTags = new Set<string>();
        fetchedEvents.forEach((event: Event) => {
          event.tags?.forEach(tag => allTags.add(tag));
          event.originalCategories?.forEach(cat => allTags.add(cat));
        });

        const sortedCategories = categories.sort();
        const sortedTags = Array.from(allTags).sort();
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

        // Cache in sessionStorage
        try {
          sessionStorage.setItem('chq-calendar-events', JSON.stringify({
            events: fetchedEvents,
            categories: categories.sort(),
            tags: Array.from(allTags).sort(),
            weeks: weeks,
            timestamp: Date.now()
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
  }, [apiUrl, dataLoaded, globalEventData, seasonWeeks]);

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
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <h1 className="text-3xl font-bold text-gray-900">
                Chautauqua Calendar
              </h1>
              <span className="ml-3 px-3 py-1 bg-blue-100 text-blue-800 text-sm font-medium rounded-full">
                2025 Season
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Main Filter Panel */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="p-4">
            {/* Search Bar */}
            <div className="mb-4">
              <input
                type="text"
                placeholder="Search titles, descriptions, presenters, locations, categories... (try 'amp' or 'cso')"
                className="w-full border border-gray-300 rounded-md px-4 py-2 text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            {/* Date and Week Filters */}
            <div className="mb-4">
              <div className="flex flex-wrap items-center gap-2 sm:gap-4">
                {/* Quick Date Filters */}
                <button
                  onClick={() => {
                    setDateFilter(dateFilter === 'today' ? 'all' : 'today');
                    if (dateFilter !== 'today') {
                      setSelectedWeeks([]); // Clear week selection when selecting "Today"
                    }
                  }}
                  title="Show all events for today (full day, regardless of current time)"
                  className={`px-4 py-2 rounded-md border transition-all ${
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
                      setSelectedWeeks([]); // Clear week selection when selecting "This Week"
                    }
                  }}
                  title="Show events starting after the current time through the end of this week"
                  className={`px-4 py-2 rounded-md border transition-all ${
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
                  title="Show events starting after the current time through the end of this week"
                  className={`px-4 py-2 rounded-md border transition-all ${
                    dateFilter === 'this-week'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                  }`}
                >
                  This Week
                </button>

                {/* Week Range Selector */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
                  <span className="text-sm text-gray-600 whitespace-nowrap">Weeks:</span>
                  <div
                    className={`flex border border-gray-300 rounded-md overflow-hidden select-none overflow-x-auto ${
                      isDragging ? 'cursor-grabbing' : 'cursor-pointer'
                    }`}
                  >
                    {seasonWeeks.map((week) => (
                      <div
                        key={week.number}
                        className={`w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center cursor-pointer border-r border-gray-300 last:border-r-0 transition-all text-xs sm:text-sm flex-shrink-0 ${
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

              {/* Show selected weeks info */}
              {selectedWeeks.length > 0 && (
                <div className="mt-2 text-sm text-gray-600">
                  Selected: {selectedWeeks.length === 1
                    ? seasonWeeks[selectedWeeks[0] - 1].label
                    : `Weeks ${Math.min(...selectedWeeks)}-${Math.max(...selectedWeeks)} (${selectedWeeks.length} weeks)`
                  }
                </div>
              )}

              {/* Usage instructions */}
              <div className="mt-2 text-xs text-gray-500">
                <span className="hidden sm:inline">Click and drag to select multiple weeks, or </span>
                <span className="sm:hidden">Tap weeks to select/deselect, or </span>
                click individual weeks to select one
              </div>
            </div>

            {/* All Tags */}
            <div>
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
                      onClick={() => {
                        setSelectedTags(prev =>
                          prev.includes(tag)
                            ? prev.filter(t => t !== tag)
                            : [...prev, tag]
                        );
                      }}
                      className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                        selectedTags.includes(tag)
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {decodeHtmlEntities(tag)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Clear Filters */}
            {(searchTerm || selectedTags.length > 0 || dateFilter !== 'all' || selectedWeeks.length > 0) && (
              <div className="mt-4 pt-3 border-t border-gray-200">
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedTags([]);
                    setDateFilter('all');
                    setSelectedWeeks([]);
                  }}
                  className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Clear All Filters
                </button>
              </div>
            )}
          </div>
        </div>


        {/* Events Section */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h3 className="text-lg font-semibold text-gray-900">
              Events {filterEvents(events).length > 0 && `(${filterEvents(events).length})`}
            </h3>
            <div className="flex space-x-2">
              <button
                onClick={() => fetchAllEvents(true)}
                disabled={loading}
                className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700 disabled:opacity-50"
              >
                {loading ? '⟳ Loading...' : '🔄 Refresh'}
              </button>
            </div>
          </div>

          <div className="p-6">
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
              <div className="space-y-6">
                {groupEventsByDay(filterEvents(events)).map((dayGroup) => (
                  <div key={dayGroup.day}>
                    {/* Day Header */}
                    <div className="sticky top-0 bg-white z-10 border-b border-gray-200 pb-2 mb-4">
                      <h3 className="text-xl font-bold text-gray-900">{dayGroup.day}</h3>
                    </div>

                    {/* Events for this day */}
                    <div className="space-y-3">
                      {dayGroup.events.map((event) => (
                  <div key={event.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex-1">
                        <h4 className="text-lg font-semibold text-gray-900 mb-1">
                          {event.url ? (
                            <a
                              href={event.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              {decodeHtmlEntities(event.title)} 🔗
                            </a>
                          ) : (
                            decodeHtmlEntities(event.title)
                          )}
                        </h4>
                        {truncateDescription(decodeHtmlEntities(event.description) || '', event.id)}
                        <div className="flex flex-wrap gap-4 text-sm text-gray-500">
                          <span>🕐 {new Date(event.startDate).toLocaleTimeString()}</span>
                          {event.location && <span>📍 {event.location}</span>}
                          {event.presenter && <span>👤 {event.presenter}</span>}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {event.category && (
                            <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">
                              {event.category}
                            </span>
                          )}
                          {event.originalCategories
                            ?.filter(cat => !cat.startsWith('Week '))
                            ?.map(cat => (
                            <span key={cat} className="px-2 py-1 bg-purple-100 text-purple-800 rounded-full text-xs">
                              {decodeHtmlEntities(cat)}
                            </span>
                          ))}
                          {/* {event.tags?.filter(tag => !event.originalCategories?.includes(tag)).map(tag => (
                            <span key={tag} className="px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-xs">
                              {decodeHtmlEntities(tag)}
                            </span>
                          ))} */}
                        </div>
                      </div>

                      {/* Event Image */}
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
                                width={96}
                                height={96}
                                className="w-20 h-20 sm:w-24 sm:h-24 object-cover rounded-lg border border-gray-200"
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
