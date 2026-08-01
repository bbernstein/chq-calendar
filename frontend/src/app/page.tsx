import { useEffect, useMemo, useRef } from 'react';
import { useAvailableYears } from '@/hooks/useAvailableYears';
import { useSelectedYear } from '@/hooks/useSelectedYear';
import { useDebounce } from '@/hooks/useDebounce';
import { getChautauquaSeasonWeeks, getCurrentWeekNumber, getAdaptiveEndDate } from '@/lib/utils/dateHelpers';
import { groupEventsByDay } from '@/lib/utils/eventHelpers';
import { filterEvents, type FilterOptions } from '@/lib/utils/filterHelpers';
import { useFilterState } from '@/hooks/useFilterState';
import { useFavorites } from '@/hooks/useFavorites';
import { useHorizontalScroll, useVerticalScroll, useWeekDragSelection } from '@/hooks/useScrollState';
import { useEventData } from '@/hooks/useEventData';
import { useWeeklyThemes } from '@/hooks/useWeeklyThemes';
import { useArticleLinks } from '@/hooks/useArticleLinks';
import { GlobalEventDataProvider, useGlobalEventData } from '@/components/providers/GlobalEventDataProvider';
import { Header } from '@/components/layout/Header';
import { CountdownBanner } from '@/components/layout/CountdownBanner';
import { LoadingSpinner } from '@/components/layout/LoadingSpinner';
import { EmptyState } from '@/components/layout/EmptyState';
import { SearchBar } from '@/components/filters/SearchBar';
import { DateFilter } from '@/components/filters/DateFilter';
import { LocationFilter } from '@/components/filters/LocationFilter';
import { CategoryFilter } from '@/components/filters/CategoryFilter';
import { ActiveFilters } from '@/components/filters/ActiveFilters';
import { buildActiveChips } from '@/components/filters/buildActiveChips';
import { EventList } from '@/components/calendar/EventList';

function HomeContent() {
  const { years: availableYears, defaultYear } = useAvailableYears();
  const { selectedYear, setSelectedYear } = useSelectedYear({ years: availableYears, defaultYear });
  const globalEventData = useGlobalEventData();
  const seasonWeeks = useMemo(() => getChautauquaSeasonWeeks(selectedYear), [selectedYear]);
  const currentWeekNumber = useMemo(() => getCurrentWeekNumber(seasonWeeks), [seasonWeeks]);
  const filters = useFilterState();
  const favorites = useFavorites();
  const locationScroll = useHorizontalScroll();
  const categoryScroll = useHorizontalScroll();
  const locationListScroll = useVerticalScroll();
  const categoryListScroll = useVerticalScroll();
  const weekDrag = useWeekDragSelection(currentWeekNumber, filters.dateFilter, filters.setDateFilter, filters.selectedWeeks, filters.setSelectedWeeks);
  useEffect(() => {
    locationScroll.updateScrollState(); categoryScroll.updateScrollState();
    locationListScroll.updateScrollState(); categoryListScroll.updateScrollState();
  }, [filters.recentLocations, filters.recentCategories, filters.availableLocations, filters.availableCategories]);
  const { events, loading } = useEventData({ year: selectedYear, globalEventData, seasonWeeks, setAvailableCategories: filters.setAvailableCategories, setAvailableLocations: filters.setAvailableLocations });
  const { themes: weeklyThemes } = useWeeklyThemes(selectedYear);
  const { links: articleLinks } = useArticleLinks(selectedYear);
  const isCurrentYear = selectedYear === defaultYear;
  const prevYearRef = useRef(selectedYear);
  const pendingYearChangeRef = useRef(false);
  const initialLoadRef = useRef(true);
  useEffect(() => {
    if (prevYearRef.current !== selectedYear) {
      prevYearRef.current = selectedYear;
      pendingYearChangeRef.current = true;
      return;
    }
    // Reconcile once the new year's data has finished loading
    if (pendingYearChangeRef.current && !loading && events.length > 0) {
      filters.reconcileFilters(filters.availableCategories, filters.availableLocations, isCurrentYear);
      pendingYearChangeRef.current = false;
    }
    // On initial load with a non-current year, reconcile to clear time-relative filters
    // (localStorage may have restored dateFilter:'next' from a previous current-year session)
    // Mark initial load complete once loading finishes, regardless of event count,
    // to avoid stale ref causing double reconciliation on subsequent year switches.
    if (initialLoadRef.current && !loading) {
      initialLoadRef.current = false;
      if (!isCurrentYear && events.length > 0 && (filters.dateFilter === 'next' || filters.dateFilter === 'today' || filters.dateFilter === 'this-week')) {
        filters.reconcileFilters(filters.availableCategories, filters.availableLocations, false);
      }
    }
  }, [selectedYear, loading, events.length, filters.availableCategories, filters.availableLocations, isCurrentYear, filters.dateFilter, filters.reconcileFilters]);
  useEffect(() => {
    document.title = `Chautauqua Calendar | ${selectedYear} Season`;
  }, [selectedYear]);
  const debouncedSearch = useDebounce(filters.searchTerm, 200);
  const adaptiveEndDate = useMemo(() => {
    if (filters.dateFilter !== 'next' || !events.length) return undefined;
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const baseEnd = getAdaptiveEndDate(events, oneHourAgo, 50);
    if (filters.extraDays > 0) {
      const extended = new Date(baseEnd);
      extended.setDate(extended.getDate() + filters.extraDays);
      extended.setHours(23, 59, 59, 999);
      return extended;
    }
    return baseEnd;
  }, [filters.dateFilter, events, filters.extraDays]);
  const filterOpts: FilterOptions = useMemo(() => ({
    searchTerm: debouncedSearch, dateFilter: filters.dateFilter, selectedWeeks: filters.selectedWeeks,
    selectedTagsLowerSet: filters.selectedTagsLowerSet, selectedLocationsLowerSet: filters.selectedLocationsLowerSet,
    seasonWeeks, currentWeekNumber,
    showFavoritesOnly: filters.showFavoritesOnly,
    favoriteIds: favorites.favoriteIds,
    adaptiveEndDate,
  }), [debouncedSearch, filters.dateFilter, filters.selectedWeeks, filters.selectedTagsLowerSet, filters.selectedLocationsLowerSet, seasonWeeks, currentWeekNumber, filters.showFavoritesOnly, favorites.favoriteIds, adaptiveEndDate]);
  const filteredEvents = useMemo(() => filterEvents(events, filterOpts), [events, filterOpts]);
  const groupedEvents = useMemo(() => groupEventsByDay(filteredEvents, seasonWeeks), [filteredEvents, seasonWeeks]);
  const hasMoreDays = useMemo(() => {
    if (filters.dateFilter !== 'next' || !adaptiveEndDate || !events.length) return false;
    return events.some(e => new Date(e.startDate) > adaptiveEndDate);
  }, [filters.dateFilter, adaptiveEndDate, events]);
  const activeChips = useMemo(() => buildActiveChips({
    searchTerm: filters.searchTerm, setSearchTerm: filters.setSearchTerm,
    dateFilter: filters.dateFilter, setDateFilter: filters.setDateFilter,
    selectedWeeks: filters.selectedWeeks, setSelectedWeeks: filters.setSelectedWeeks,
    selectedLocations: filters.selectedLocations, toggleLocation: filters.toggleLocation,
    selectedTags: filters.selectedTags, toggleTag: filters.toggleTag,
    showFavoritesOnly: filters.showFavoritesOnly, toggleFavoritesOnly: filters.toggleFavoritesOnly,
  }), [
    filters.searchTerm, filters.setSearchTerm,
    filters.dateFilter, filters.setDateFilter,
    filters.selectedWeeks, filters.setSelectedWeeks,
    filters.selectedLocations, filters.toggleLocation,
    filters.selectedTags, filters.toggleTag,
    filters.showFavoritesOnly, filters.toggleFavoritesOnly,
  ]);
  const isThisWeekActive = filters.dateFilter === 'this-week' || (currentWeekNumber !== null && filters.selectedWeeks.length === 1 && filters.selectedWeeks[0] === currentWeekNumber);
  const isWeekHighlighted = (weekNumber: number, isSelected: boolean) => isSelected || (filters.dateFilter === 'this-week' && currentWeekNumber === weekNumber);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <Header
        selectedYear={selectedYear}
        availableYears={availableYears}
        defaultYear={defaultYear}
        onYearChange={setSelectedYear}
      />
      {selectedYear === defaultYear && <CountdownBanner seasonWeeks={seasonWeeks} />}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow mb-4 sm:mb-6">
          <div className="p-2 sm:p-4">
            <SearchBar value={filters.searchTerm} onChange={filters.setSearchTerm} />
            <DateFilter
              dateFilter={filters.dateFilter} setDateFilter={filters.setDateFilter}
              selectedWeeks={filters.selectedWeeks} setSelectedWeeks={filters.setSelectedWeeks}
              currentWeekNumber={currentWeekNumber} seasonWeeks={seasonWeeks}
              isThisWeekButtonActive={isThisWeekActive} weekDrag={weekDrag}
              isWeekHighlighted={isWeekHighlighted}
              showFavoritesOnly={filters.showFavoritesOnly}
              onToggleFavoritesOnly={filters.toggleFavoritesOnly}
              favoriteCount={favorites.favoriteCount}
              isCurrentYear={isCurrentYear}
              weeklyThemes={weeklyThemes}
            />
            <div className="space-y-3">
              <LocationFilter
                availableLocations={filters.availableLocations} selectedCount={filters.selectedLocations.length}
                recentLocations={filters.recentLocations} toggleLocation={filters.toggleLocation}
                isLocationSelected={filters.isLocationSelected}
                pillScroll={locationScroll} listScroll={locationListScroll}
              />
              <CategoryFilter
                availableCategories={filters.availableCategories} selectedCount={filters.selectedCategoriesCount}
                recentCategories={filters.recentCategories} toggleTag={filters.toggleTag}
                isTagSelected={filters.isTagSelected}
                pillScroll={categoryScroll} listScroll={categoryListScroll}
              />
            </div>
            <ActiveFilters
              filteredCount={filteredEvents.length}
              totalCount={events.length}
              hasFilters={filters.hasFilters}
              hasDateFilters={filters.hasDateFilters}
              hasNonDateFilters={filters.hasNonDateFilters}
              chips={activeChips}
              onClear={filters.clearFilters}
              onClearNonDateFilters={filters.clearNonDateFilters}
            />
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          <div className="p-4 sm:p-6">
            {loading ? <LoadingSpinner /> : filteredEvents.length === 0 ? <EmptyState /> : (
              <EventList groupedEvents={groupedEvents} expandedDescriptions={filters.expandedDescriptions}
                onToggleDescription={filters.toggleDescription} onToggleTag={filters.toggleTag} isTagSelected={filters.isTagSelected}
                favoriteIds={favorites.favoriteIds} onToggleFavorite={favorites.toggleFavorite}
                dateFilter={filters.dateFilter} onShowNextDay={filters.addExtraDay}
                hasMoreDays={hasMoreDays} weeklyThemes={weeklyThemes} articleLinks={articleLinks} />
            )}
          </div>
        </div>
      </main>
      <footer className="bg-gray-800 text-white mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center">
          <p className="text-gray-400">&copy; {new Date().getFullYear()} Chautauqua Calendar by Bernie</p>
          <p className="text-gray-500 text-sm mt-3 max-w-2xl mx-auto">
            CHQ Calendar is an independent app and is not affiliated with, endorsed by, or
            sponsored by Chautauqua Institution. Event information is drawn from publicly
            posted listings; chq.org remains the authoritative source.
          </p>
          <p className="text-gray-400 text-sm mt-3">
            <a href="/privacy" className="hover:text-white underline">Privacy</a>
            <span className="mx-2" aria-hidden="true">·</span>
            <a href="/support" className="hover:text-white underline">Support</a>
            <span className="mx-2" aria-hidden="true">·</span>
            <a href="/feedback" className="hover:text-white underline">Feedback</a>
          </p>
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
