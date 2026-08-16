import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAvailableYears } from '@/hooks/useAvailableYears';
import { useSelectedYear } from '@/hooks/useSelectedYear';
import { useDebounce } from '@/hooks/useDebounce';
import { getChautauquaSeasonWeeks, getCurrentWeekNumber, getAdaptiveEndDate } from '@/lib/utils/dateHelpers';
import { groupEventsByDay } from '@/lib/utils/eventHelpers';
import { filterEvents, type FilterOptions } from '@/lib/utils/filterHelpers';
import { navigableBounds, viewWindow, addDays, dayKeyOf, dayKeys, dayChips, eventCountsByDay, eventDayKeys, navigationTargets } from '@/lib/utils/dayWindow';
import { renderResetKey } from '@/lib/utils/renderWindow';
import { daySectionElement } from '@/lib/utils/daySections';
import { useFilterState } from '@/hooks/useFilterState';
import { useDayAnchor } from '@/hooks/useDayAnchor';
import { useDayRailHeight } from '@/hooks/useDayRailHeight';
import { DayRail } from '@/components/calendar/DayRail';
import { railTarget } from '@/app/dayRailNavigation';
import { useFavorites } from '@/hooks/useFavorites';
import { useHorizontalScroll, useVerticalScroll, useWeekDragSelection } from '@/hooks/useScrollState';
import { useEventData } from '@/hooks/useEventData';
import { useWeeklyThemes } from '@/hooks/useWeeklyThemes';
import { useArticleLinks } from '@/hooks/useArticleLinks';
import { useProgramLinks } from '@/hooks/useProgramLinks';
import { GlobalEventDataProvider, useGlobalEventData } from '@/components/providers/GlobalEventDataProvider';
import { Header } from '@/components/layout/Header';
import { CountdownBanner } from '@/components/layout/CountdownBanner';
import { IosAppBanner } from '@/components/layout/IosAppBanner';
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
  const { links: programLinks } = useProgramLinks(selectedYear);
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
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return getAdaptiveEndDate(events, oneHourAgo, 50);
  }, [filters.dateFilter, events]);

  // The outer limit of everything navigation can reach: the season, widened
  // to contain any event outside it.
  const navBounds = useMemo(
    () => navigableBounds(seasonWeeks, events),
    [seasonWeeks, events]
  );

  // The single date filter. Every scope reduces to this range, and so does
  // however far the user has navigated past the scope's own edge.
  const dateWindow = useMemo(
    () =>
      viewWindow({
        dateFilter: filters.dateFilter,
        seasonWeeks,
        currentWeekNumber,
        now: new Date(),
        adaptiveEndDate,
        bounds: navBounds,
        expandedStartDay: filters.windowStartDay,
        expandedEndDay: filters.windowEndDay,
      }),
    [
      filters.dateFilter, seasonWeeks, currentWeekNumber, adaptiveEndDate,
      navBounds, filters.windowStartDay, filters.windowEndDay,
    ]
  );

  // Everything except the date stage. Split out so the navigation targets
  // below can re-run the identical filter with the date stage wide open,
  // without recomputing on every window expansion.
  const nonDateFilterOpts = useMemo(() => ({
    searchTerm: debouncedSearch,
    selectedWeeks: filters.selectedWeeks,
    selectedTagsLowerSet: filters.selectedTagsLowerSet,
    selectedLocationsLowerSet: filters.selectedLocationsLowerSet,
    seasonWeeks,
    showFavoritesOnly: filters.showFavoritesOnly,
    favoriteIds: favorites.favoriteIds,
  }), [
    debouncedSearch, filters.selectedWeeks, filters.selectedTagsLowerSet,
    filters.selectedLocationsLowerSet, seasonWeeks,
    filters.showFavoritesOnly, favorites.favoriteIds,
  ]);

  const filterOpts: FilterOptions = useMemo(
    () => ({ ...nonDateFilterOpts, viewWindow: dateWindow }),
    [nonDateFilterOpts, dateWindow]
  );
  const filteredEvents = useMemo(() => filterEvents(events, filterOpts), [events, filterOpts]);

  // Every day that has an event under the *non-date* filters — the set
  // navigation steps through. Derived by re-running the same filter with the
  // date stage wide open, so search, category, venue, week and favourites
  // all constrain where stepping can go, and a step always lands on a day
  // that will actually render something.
  const navEventDays = useMemo(() => {
    const unbounded = viewWindow({
      dateFilter: 'all', seasonWeeks, currentWeekNumber, now: new Date(),
      bounds: navBounds, expandedStartDay: null, expandedEndDay: null,
    });
    return eventDayKeys(filterEvents(events, { ...nonDateFilterOpts, viewWindow: unbounded }));
  }, [events, nonDateFilterOpts, seasonWeeks, currentWeekNumber, navBounds]);

  const { earlierDay, laterDay } = useMemo(
    () => navigationTargets(navEventDays, dateWindow),
    [navEventDays, dateWindow]
  );

  const showEarlier = useCallback(() => {
    if (earlierDay) filters.expandWindowStart(earlierDay);
  }, [earlierDay, filters.expandWindowStart]);

  const expandEnd = useCallback(() => {
    if (laterDay) filters.expandWindowEnd(laterDay);
  }, [laterDay, filters.expandWindowEnd]);

  // What the render window resets on. The window fields are deliberately
  // not part of it.
  const listResetKey = useMemo(() => renderResetKey({
    searchTerm: debouncedSearch,
    selectedTags: filters.selectedTags,
    selectedLocations: filters.selectedLocations,
    showFavoritesOnly: filters.showFavoritesOnly,
    favoriteCount: favorites.favoriteCount,
    dateFilter: filters.dateFilter,
    selectedWeeks: filters.selectedWeeks,
    year: selectedYear,
  }), [
    debouncedSearch, filters.selectedTags, filters.selectedLocations,
    filters.showFavoritesOnly, favorites.favoriteCount, filters.dateFilter,
    filters.selectedWeeks, selectedYear,
  ]);

  const groupedEvents = useMemo(() => groupEventsByDay(filteredEvents, seasonWeeks), [filteredEvents, seasonWeeks]);

  // The rail spans the navigable bounds, independent of the current scope:
  // it is a navigation surface, not a filter readout, so in Today scope it
  // still shows the week around you.
  const railChips = useMemo(
    () => dayChips(dayKeys(navBounds.startDay, navBounds.endDay), eventCountsByDay(groupedEvents)),
    [navBounds, groupedEvents]
  );

  // Every day the *view* window produced, not the render window's mounted
  // subset — `useDayAnchor` walks this list and skips any key with no DOM
  // section yet, so naming it "rendered" here would claim something this
  // value cannot promise. (The mixup this exact name invited is why the
  // pending-scroll effect below now checks the DOM directly instead of
  // trusting `groupedEvents` membership as a proxy for "mounted".)
  const windowDayKeys = useMemo(() => groupedEvents.map(g => g.key), [groupedEvents]);
  const { anchorDay, scrollToDay } = useDayAnchor(windowDayKeys);
  const railRef = useDayRailHeight();

  const todayKey = isCurrentYear ? dayKeyOf(new Date()) : null;

  // Expanding, then scrolling, is deliberately three steps, and each waits on
  // the one before: the reducer widens the *view* window (it never knows about
  // scroll position), `revealDay` makes the *render* window mount that far,
  // and only then can we scroll to a node that exists. `pendingScroll` is
  // state rather than a ref precisely because it has to drive `revealDay` as
  // a prop — a ref would not re-render the list.
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);

  const goToDay = useCallback((target: string) => {
    const plan = railTarget({ target, window: dateWindow, bounds: navBounds });
    if (!plan) return;
    if (plan.expandStart) filters.expandWindowStart(plan.expandStart);
    if (plan.expandEnd) filters.expandWindowEnd(plan.expandEnd);
    // Set it even when no expansion was needed: the day is inside the view
    // window but may still be past the render window's current reach, and
    // `revealDay` is what closes that gap. The effect below scrolls and
    // clears on the very next commit if the node is already there.
    setPendingScroll(plan.scrollTo);
  }, [dateWindow, navBounds, filters.expandWindowStart, filters.expandWindowEnd]);

  useEffect(() => {
    if (!pendingScroll) return;
    // Checking the DOM node directly, not `groupedEvents` membership: the
    // render window is what EventList's `revealDay` layout effect grows, and
    // "the day is in the view window" does not mean "the day has a mounted
    // section" — those are the two windows this whole feature exists to keep
    // separate. `revealDay`'s effect is a layout effect specifically so that
    // by the time THIS passive effect runs, any growth it triggered has
    // already committed — see the comment on that effect for why the
    // ordering guarantee holds.
    if (daySectionElement(pendingScroll)) {
      setPendingScroll(null);
      scrollToDay(pendingScroll);
      return;
    }
    // No section for it yet. Two very different reasons, and only one is
    // worth waiting for.
    //
    // If the view window already covers the target, the day simply has no
    // matching events — an empty day under the current filters, which never
    // gets a section mounted at all. That is not a failure; it is what "the
    // rail moves by calendar day" means. Give up, or the pending target would
    // survive forever and hijack a later commit.
    //
    // If the window does not cover it yet, the expansion dispatched above has
    // not landed in this commit. Keep waiting — the next one will have it.
    const covered = dateWindow
      && pendingScroll >= dateWindow.startDay && pendingScroll <= dateWindow.endDay;
    if (covered) setPendingScroll(null);
  }, [pendingScroll, dateWindow, scrollToDay]);

  const stepDay = useCallback((delta: -1 | 1) => {
    if (!anchorDay) return;
    goToDay(addDays(anchorDay, delta));
  }, [anchorDay, goToDay]);

  // ⟳ Now is navigation, never a filter change: it widens the window to
  // contain today if it has to, and touches no scope, week, category or
  // search.
  const goToToday = useCallback(() => {
    if (todayKey) goToDay(todayKey);
  }, [todayKey, goToDay]);

  const activeChips = useMemo(() => buildActiveChips({
    searchTerm: filters.searchTerm, setSearchTerm: filters.setSearchTerm,
    dateFilter: filters.dateFilter, setDateFilter: filters.setDateFilter,
    selectedWeeks: filters.selectedWeeks, setSelectedWeeks: filters.setSelectedWeeks,
    selectedLocations: filters.selectedLocations, toggleLocation: filters.toggleLocation,
    selectedTags: filters.selectedTags, toggleTag: filters.toggleTag,
    showFavoritesOnly: filters.showFavoritesOnly, toggleFavoritesOnly: filters.toggleFavoritesOnly,
    viewWindow: dateWindow,
    windowExpanded: filters.windowStartDay !== null || filters.windowEndDay !== null,
    resetWindow: filters.resetWindow,
  }), [
    filters.searchTerm, filters.setSearchTerm,
    filters.dateFilter, filters.setDateFilter,
    filters.selectedWeeks, filters.setSelectedWeeks,
    filters.selectedLocations, filters.toggleLocation,
    filters.selectedTags, filters.toggleTag,
    filters.showFavoritesOnly, filters.toggleFavoritesOnly,
    dateWindow, filters.windowStartDay, filters.windowEndDay, filters.resetWindow,
  ]);
  const isWeekHighlighted = (weekNumber: number, isSelected: boolean) => isSelected || (filters.dateFilter === 'this-week' && currentWeekNumber === weekNumber);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <Header
        selectedYear={selectedYear}
        availableYears={availableYears}
        defaultYear={defaultYear}
        onYearChange={setSelectedYear}
      />
      <IosAppBanner />
      {selectedYear === defaultYear && <CountdownBanner seasonWeeks={seasonWeeks} />}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow mb-4 sm:mb-6">
          <div className="p-2 sm:p-4">
            <SearchBar value={filters.searchTerm} onChange={filters.setSearchTerm} />
            <DateFilter
              dateFilter={filters.dateFilter} setDateFilter={filters.setDateFilter}
              selectedWeeks={filters.selectedWeeks} setSelectedWeeks={filters.setSelectedWeeks}
              seasonWeeks={seasonWeeks}
              weekDrag={weekDrag}
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
        <DayRail
          chips={railChips}
          anchorDay={anchorDay}
          todayKey={todayKey}
          onSelectDay={goToDay}
          onStepDay={stepDay}
          onGoToToday={goToToday}
          rootRef={railRef}
        />
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          <div className="p-4 sm:p-6">
            {loading ? <LoadingSpinner /> : filteredEvents.length === 0 ? <EmptyState /> : (
              <EventList groupedEvents={groupedEvents} expandedDescriptions={filters.expandedDescriptions}
                onToggleDescription={filters.toggleDescription} onToggleTag={filters.toggleTag} isTagSelected={filters.isTagSelected}
                favoriteIds={favorites.favoriteIds} onToggleFavorite={favorites.toggleFavorite}
                weeklyThemes={weeklyThemes} articleLinks={articleLinks} programLinks={programLinks}
                resetKey={listResetKey}
                earlierDay={earlierDay}
                onShowEarlier={showEarlier}
                canExpandEnd={!!laterDay}
                onExpandEnd={expandEnd}
                revealDay={pendingScroll} />
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
            <a href="/about" className="hover:text-white underline">Guide</a>
            <span className="mx-2" aria-hidden="true">·</span>
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
