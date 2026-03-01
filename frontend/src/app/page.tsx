'use client';

import React, { useState, useEffect, useMemo, useRef, createContext, useContext } from 'react';
import Image from 'next/image';
import type { GlobalEventData } from '@/lib/types';
import { ACTIVE_YEAR, getLocationDisplayName, getCategoryDisplayName } from '@/lib/constants';
import { getChautauquaSeasonWeeks, isWeekInPast, getCurrentWeekNumber } from '@/lib/utils/dateHelpers';
import { groupEventsByDay } from '@/lib/utils/eventHelpers';
import { filterEvents, type FilterOptions } from '@/lib/utils/filterHelpers';
import { useFilterState } from '@/hooks/useFilterState';
import { useHorizontalScroll, useVerticalScroll, useWeekDragSelection } from '@/hooks/useScrollState';
import { useEventData } from '@/hooks/useEventData';

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

  // Season weeks and current week
  const seasonWeeks = useMemo(() => getChautauquaSeasonWeeks(ACTIVE_YEAR), []);
  const currentWeekNumber = useMemo(() => getCurrentWeekNumber(seasonWeeks), [seasonWeeks]);

  // Filter state (search, tags, locations, dates, weeks, descriptions, recent items, localStorage)
  const filters = useFilterState();

  // Scroll state for pills and lists
  const locationScroll = useHorizontalScroll();
  const categoryScroll = useHorizontalScroll();
  const locationListScroll = useVerticalScroll();
  const categoryListScroll = useVerticalScroll();

  // Update scroll indicators when content changes
  useEffect(() => { locationScroll.updateScrollState(); }, [filters.recentLocations, locationScroll.updateScrollState]);
  useEffect(() => { categoryScroll.updateScrollState(); }, [filters.recentCategories, categoryScroll.updateScrollState]);
  useEffect(() => { locationListScroll.updateScrollState(); }, [filters.availableLocations, locationListScroll.updateScrollState]);
  useEffect(() => { categoryListScroll.updateScrollState(); }, [filters.availableCategories, categoryListScroll.updateScrollState]);

  // Week drag selection
  const weekDrag = useWeekDragSelection(
    currentWeekNumber, filters.dateFilter, filters.setDateFilter,
    filters.selectedWeeks, filters.setSelectedWeeks,
  );

  // Event data fetching
  const { events, loading } = useEventData({
    globalEventData, seasonWeeks,
    setAvailableCategories: filters.setAvailableCategories,
    setAvailableLocations: filters.setAvailableLocations,
  });

  // Filtered and grouped events
  const filterOpts: FilterOptions = useMemo(() => ({
    searchTerm: filters.searchTerm,
    dateFilter: filters.dateFilter,
    selectedWeeks: filters.selectedWeeks,
    selectedTagsLowerSet: filters.selectedTagsLowerSet,
    selectedLocationsLowerSet: filters.selectedLocationsLowerSet,
    seasonWeeks,
    currentWeekNumber,
  }), [filters.searchTerm, filters.dateFilter, filters.selectedWeeks, filters.selectedTagsLowerSet, filters.selectedLocationsLowerSet, seasonWeeks, currentWeekNumber]);

  const filteredEvents = useMemo(() => filterEvents(events, filterOpts), [events, filterOpts]);
  const groupedEvents = useMemo(() => groupEventsByDay(filteredEvents, seasonWeeks), [filteredEvents, seasonWeeks]);

  // UI helpers
  const isThisWeekButtonActive = () => {
    return filters.dateFilter === 'this-week' || (currentWeekNumber !== null && filters.selectedWeeks.length === 1 && filters.selectedWeeks[0] === currentWeekNumber);
  };

  const isWeekHighlighted = (weekNumber: number, isSelected: boolean) => {
    const isCurrent = currentWeekNumber === weekNumber;
    const isCurrentWeekFilterActive = filters.dateFilter === 'this-week' && isCurrent;
    return isSelected || isCurrentWeekFilterActive;
  };

  // Menu state
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }
    return () => { document.removeEventListener('mousedown', handleClickOutside); };
  }, [menuOpen]);

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
                {ACTIVE_YEAR} Season
              </span>
            </div>
            {/* Desktop: Show both buttons separately */}
            <div className="hidden md:flex items-center gap-2">
              <button
                onClick={() => window.open('/feedback', '_blank')}
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Feedback
              </button>
              <button
                onClick={() => window.open('https://programs.chq.org/', '_blank')}
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Programs
              </button>
            </div>
            {/* Mobile: Show dropdown menu */}
            <div className="md:hidden relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="px-2 py-1 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center gap-1"
              >
                More
                <svg
                  className={`w-3 h-3 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-40 bg-white dark:bg-gray-700 rounded-md shadow-lg py-1 z-50">
                  <button
                    onClick={() => {
                      window.open('/feedback', '_blank');
                      setMenuOpen(false);
                    }}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600"
                  >
                    Feedback
                  </button>
                  <button
                    onClick={() => {
                      window.open('https://programs.chq.org/', '_blank');
                      setMenuOpen(false);
                    }}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600"
                  >
                    Programs
                  </button>
                </div>
              )}
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
                value={filters.searchTerm}
                onChange={(e) => filters.setSearchTerm(e.target.value)}
              />
            </div>

            {/* Week Range Selector - Mobile: Below search, Desktop: With date filters */}
            <div className="mb-2 sm:mb-0 block sm:hidden">
              <div className="flex items-center gap-1 sm:gap-2 justify-start">
                <span className="text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap mr-2">Weeks:</span>
                <div
                  className={`flex border border-gray-300 dark:border-gray-600 rounded-md overflow-hidden select-none ${
                    weekDrag.isDragging ? 'cursor-grabbing' : 'cursor-pointer'
                  }`}
                >
                  {seasonWeeks.map((week) => {
                    const isPast = isWeekInPast(week.number, seasonWeeks);
                    const isSelected = filters.selectedWeeks.includes(week.number);
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
                        onMouseDown={(e) => weekDrag.handleWeekMouseDown(week.number, e)}
                        onMouseEnter={() => weekDrag.handleWeekMouseEnter(week.number)}
                        onMouseUp={() => weekDrag.handleWeekMouseUp(week.number)}
                        onTouchStart={(e) => {
                          e.preventDefault(); // Prevent mouse events from also firing
                          weekDrag.handleWeekTap(week.number);
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
                    filters.setDateFilter(filters.dateFilter === 'next' ? 'all' : 'next');
                    if (filters.dateFilter !== 'next') {
                      filters.setSelectedWeeks([]); // Clear week selection when selecting "Next"
                    }
                  }}
                  title="Show events starting after the current time through the end of this week"
                  className={`px-2 py-1 sm:px-4 sm:py-2 rounded-md border transition-all text-xs sm:text-sm whitespace-nowrap ${
                    filters.dateFilter === 'next'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-gray-600'
                  }`}
                >
                  Now
                </button>
                <button
                  onClick={() => {
                    filters.setDateFilter(filters.dateFilter === 'today' ? 'all' : 'today');
                    if (filters.dateFilter !== 'today') {
                      filters.setSelectedWeeks([]); // Clear week selection when selecting "Today"
                    }
                  }}
                  title="Show all events for today"
                  className={`px-2 py-1 sm:px-4 sm:py-2 rounded-md border transition-all text-xs sm:text-sm whitespace-nowrap ${
                    filters.dateFilter === 'today'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-gray-600'
                  }`}
                >
                  Today
                </button>
                <button
                  onClick={() => {
                    filters.setDateFilter(filters.dateFilter === 'this-week' ? 'all' : 'this-week');
                    if (filters.dateFilter !== 'this-week') {
                      filters.setSelectedWeeks([]); // Clear week selection when selecting "This Week"
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
                      weekDrag.isDragging ? 'cursor-grabbing' : 'cursor-pointer'
                    }`}
                  >
                    {seasonWeeks.map((week) => {
                      const isPast = isWeekInPast(week.number, seasonWeeks);
                      const isSelected = filters.selectedWeeks.includes(week.number);
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
                          onMouseDown={(e) => weekDrag.handleWeekMouseDown(week.number, e)}
                          onMouseEnter={() => weekDrag.handleWeekMouseEnter(week.number)}
                          onMouseUp={() => weekDrag.handleWeekMouseUp(week.number)}
                          onTouchStart={(e) => {
                            e.preventDefault(); // Prevent mouse events from also firing
                            weekDrag.handleWeekTap(week.number);
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
              {(filters.selectedWeeks.length > 0 || filters.dateFilter !== 'all') && (
                <div className="mt-1 text-xs sm:text-sm text-gray-600 dark:text-gray-300">
                  Selected: {(() => {
                    if (filters.dateFilter === 'today') {
                      const today = new Date();
                      const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
                      const fullDate = today.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      });
                      return `Today, ${dayName}, ${fullDate}`;
                    } else if (filters.dateFilter === 'next') {
                      const now = new Date();
                      const timeString = now.toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                      });
                      return `Next events after ${timeString}`;
                    } else if (filters.dateFilter === 'this-week') {
                      if (currentWeekNumber === null) {
                        return 'This Week (Not in season)';
                      }

                      const currentWeek = seasonWeeks[currentWeekNumber - 1];
                      const startStr = currentWeek.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      const endStr = currentWeek.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                      return `This Week (${startStr} 12pm - ${endStr} 12pm)`;
                    } else if (filters.selectedWeeks.length === 1) {
                      const weekNum = filters.selectedWeeks[0];
                      const week = seasonWeeks[weekNum - 1];
                      const startStr = week.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      const endStr = week.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      return `Week ${weekNum} (${startStr} - ${endStr})`;
                    } else if (filters.selectedWeeks.length > 1) {
                      const startWeek = Math.min(...filters.selectedWeeks);
                      const endWeek = Math.max(...filters.selectedWeeks);
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
                    Locations {filters.selectedLocations.length > 0 && `(${filters.selectedLocations.length} selected)`}
                  </span>
                  {filters.recentLocations.length > 0 && (
                    <div className={`flex-1 min-w-0 pills-scroll-container ${locationScroll.scrollState.canScrollLeft ? 'scrolled-right' : ''} ${!locationScroll.scrollState.canScrollRight ? 'scrolled-to-end' : ''}`}>
                      <div
                        ref={locationScroll.scrollRef}
                        className="flex gap-2 pb-1 overflow-x-auto overflow-y-hidden scrollbar-hide pr-4"
                        onScroll={locationScroll.handleScroll}
                      >
                        {filters.recentLocations.map(location => (
                          <button
                            key={`recent-${location}`}
                            title={location} // Tooltip showing full name
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              filters.toggleLocation(location);
                            }}
                            className={`flex-shrink-0 px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-full text-xs font-medium transition-colors ${
                              filters.isLocationSelected(location)
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
                <div className={`filter-list-container mb-2 ${locationListScroll.scrollState.canScrollUp ? 'scrolled-down' : ''} ${locationListScroll.scrollState.canScrollDown ? 'can-scroll-down' : ''}`}>
                  <div
                    ref={locationListScroll.scrollRef}
                    className="max-h-24 sm:max-h-32 overflow-y-auto scrollable-list"
                    onScroll={locationListScroll.handleScroll}
                  >
                    <div className="flex flex-wrap gap-1 sm:gap-2">
                      {filters.availableLocations.map(location => (
                      <button
                        key={location}
                        title={location} // Tooltip showing full name
                        onClick={() => filters.toggleLocation(location)}
                        className={`px-1 py-0.5 sm:px-2 sm:py-1 rounded-full text-xs font-medium transition-colors ${
                          filters.isLocationSelected(location)
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        {getLocationDisplayName(location)}
                      </button>
                    ))}
                    </div>
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
                    Categories {filters.selectedCategoriesCount > 0 && `(${filters.selectedCategoriesCount} selected)`}
                  </span>
                  {filters.recentCategories.length > 0 && (
                    <div className={`flex-1 min-w-0 pills-scroll-container ${categoryScroll.scrollState.canScrollLeft ? 'scrolled-right' : ''} ${!categoryScroll.scrollState.canScrollRight ? 'scrolled-to-end' : ''}`}>
                      <div
                        ref={categoryScroll.scrollRef}
                        className="flex gap-2 pb-1 overflow-x-auto overflow-y-hidden scrollbar-hide pr-4"
                        onScroll={categoryScroll.handleScroll}
                      >
                        {filters.recentCategories.map(category => (
                          <button
                            key={`recent-${category}`}
                            title={category} // Tooltip showing full name
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              filters.toggleTag(category);
                            }}
                            className={`flex-shrink-0 px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-full text-xs font-medium transition-colors ${
                              filters.isTagSelected(category)
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
                <div className={`filter-list-container mb-2 ${categoryListScroll.scrollState.canScrollUp ? 'scrolled-down' : ''} ${categoryListScroll.scrollState.canScrollDown ? 'can-scroll-down' : ''}`}>
                  <div
                    ref={categoryListScroll.scrollRef}
                    className="max-h-24 sm:max-h-32 overflow-y-auto scrollable-list"
                    onScroll={categoryListScroll.handleScroll}
                  >
                    <div className="flex flex-wrap gap-1 sm:gap-2">
                      {filters.availableCategories
                        .filter(category => !category.startsWith('Week '))
                        .map(category => (
                      <button
                        key={category}
                        title={category} // Tooltip showing full name
                        onClick={() => filters.toggleTag(category)}
                        className={`px-1 py-0.5 sm:px-2 sm:py-1 rounded-full text-xs font-medium transition-colors ${
                          filters.isTagSelected(category)
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        {getCategoryDisplayName(category)}
                      </button>
                    ))}
                    </div>
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
                    const filteredCount = filteredEvents.length;
                    const totalCount = events.length;
                    const hasFilters = filters.hasFilters;

                    if (hasFilters) {
                      return `Events (${filteredCount}/${totalCount})`;
                    } else {
                      return `Events (${totalCount})`;
                    }
                  })()}
                </div>
                {filters.hasFilters && (
                  <button
                    onClick={() => filters.clearFilters()}
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
            ) : filteredEvents.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">🎭</div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No events found</h3>
                <p className="text-gray-600 dark:text-gray-200 mb-4">
                  Try adjusting your filters or search terms.
                </p>
              </div>
            ) : (
              <div className="space-y-4 sm:space-y-6">
                {groupedEvents.map((dayGroup) => (
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
                              {(event.description || (event.categories && event.categories.filter(cat => !cat.name.startsWith('Week ')).length > 0)) && (
                                <div className="mb-2">
                                  {filters.expandedDescriptions.has(event.id) ? (
                                    <div>
                                      <button
                                        onClick={() => filters.toggleDescription(event.id)}
                                        className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-xs font-medium flex items-center gap-1"
                                      >
                                        <span className="text-xs">▼</span> Show less
                                      </button>

                                      {/* Show description if it exists */}
                                      {event.description && (
                                        <p className="text-gray-600 dark:text-gray-300 text-sm mb-2">{event.description}</p>
                                      )}

                                      {/* Show all categories when expanded (excluding Week categories) */}
                                      <div className="mb-2 flex flex-wrap gap-1">
                                        {event.categories?.filter(cat => !cat.name.startsWith('Week ')).map((category, index) => (
                                          <button
                                            key={`${event.id}-category-${index}`}
                                            onClick={() => filters.toggleTag(category.name)}
                                            className={`px-1 py-0.5 sm:px-2 sm:py-1 rounded-full text-xs transition-colors cursor-pointer hover:opacity-80 ${
                                              filters.isTagSelected(category.name)
                                                ? 'bg-blue-600 text-white'
                                                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                                            }`}
                                          >
                                            {getCategoryDisplayName(category.name)}
                                          </button>
                                        ))}
                                      </div>

                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => filters.toggleDescription(event.id)}
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
              © 2026 Chautauqua Calendar by Bernie and Claude
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
