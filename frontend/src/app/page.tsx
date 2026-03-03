import { useEffect, useMemo } from 'react';
import { ACTIVE_YEAR } from '@/lib/constants';
import { useDebounce } from '@/hooks/useDebounce';
import { getChautauquaSeasonWeeks, getCurrentWeekNumber, getAdaptiveEndDate } from '@/lib/utils/dateHelpers';
import { groupEventsByDay } from '@/lib/utils/eventHelpers';
import { filterEvents, type FilterOptions } from '@/lib/utils/filterHelpers';
import { useFilterState } from '@/hooks/useFilterState';
import { useFavorites } from '@/hooks/useFavorites';
import { useHorizontalScroll, useVerticalScroll, useWeekDragSelection } from '@/hooks/useScrollState';
import { useEventData } from '@/hooks/useEventData';
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
import { EventList } from '@/components/calendar/EventList';

function HomeContent() {
  const globalEventData = useGlobalEventData();
  const seasonWeeks = useMemo(() => getChautauquaSeasonWeeks(ACTIVE_YEAR), []);
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
  const { events, loading } = useEventData({ globalEventData, seasonWeeks, setAvailableCategories: filters.setAvailableCategories, setAvailableLocations: filters.setAvailableLocations });
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
  const isThisWeekActive = filters.dateFilter === 'this-week' || (currentWeekNumber !== null && filters.selectedWeeks.length === 1 && filters.selectedWeeks[0] === currentWeekNumber);
  const isWeekHighlighted = (weekNumber: number, isSelected: boolean) => isSelected || (filters.dateFilter === 'this-week' && currentWeekNumber === weekNumber);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <Header />
      <CountdownBanner seasonWeeks={seasonWeeks} />
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
            <ActiveFilters filteredCount={filteredEvents.length} totalCount={events.length} hasFilters={!!filters.hasFilters} onClear={filters.clearFilters} />
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          <div className="p-4 sm:p-6">
            {loading ? <LoadingSpinner /> : filteredEvents.length === 0 ? <EmptyState /> : (
              <EventList groupedEvents={groupedEvents} expandedDescriptions={filters.expandedDescriptions}
                onToggleDescription={filters.toggleDescription} onToggleTag={filters.toggleTag} isTagSelected={filters.isTagSelected}
                favoriteIds={favorites.favoriteIds} onToggleFavorite={favorites.toggleFavorite}
                dateFilter={filters.dateFilter} onShowNextDay={filters.addExtraDay}
                hasMoreDays={hasMoreDays} />
            )}
          </div>
        </div>
      </main>
      <footer className="bg-gray-800 text-white mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center">
          <p className="text-gray-400">© 2026 Chautauqua Calendar by Bernie and Claude</p>
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
