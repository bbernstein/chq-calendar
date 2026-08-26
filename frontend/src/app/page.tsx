import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAvailableYears } from '@/hooks/useAvailableYears';
import { useSelectedYear } from '@/hooks/useSelectedYear';
import { useDebounce } from '@/hooks/useDebounce';
import { getChautauquaSeasonWeeks, getCurrentWeekNumber, getAdaptiveEndDate } from '@/lib/utils/dateHelpers';
import { parseEventDate } from '@/lib/utils/chqTime';
import { groupEventsByDay } from '@/lib/utils/eventHelpers';
import { filterEvents, type FilterOptions } from '@/lib/utils/filterHelpers';
import { navigableBounds, viewWindow, dayKeyOf, dayKeys, dayChips, eventCountsByDay, eventDayKeys, navigationTargets } from '@/lib/utils/dayWindow';
import { weekBandDestinations, weekBandSegments } from '@/lib/utils/weekBands';
import { renderResetKey } from '@/lib/utils/renderWindow';
import { daySectionElement } from '@/lib/utils/daySections';
import { useFilterState } from '@/hooks/useFilterState';
import { useDayAnchor } from '@/hooks/useDayAnchor';
import { useDayRailHeight } from '@/hooks/useDayRailHeight';
import { useFilterPanel } from '@/hooks/useFilterPanel';
import { belowHeaderTop, filterPanelMaxHeight } from '@/app/filterHeaderLayout';
import { DayRail } from '@/components/calendar/DayRail';
import { railTarget, reachableTodayKey, shouldAbandonScroll } from '@/app/dayRailNavigation';
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
import { OffSeasonLanding } from '@/components/layout/OffSeasonLanding';
import { determineLandingState } from '@/lib/utils/landingState';
import { SearchBar } from '@/components/filters/SearchBar';
import { DateFilter } from '@/components/filters/DateFilter';
import { LocationFilter } from '@/components/filters/LocationFilter';
import { CategoryFilter } from '@/components/filters/CategoryFilter';
import { ActiveFilters } from '@/components/filters/ActiveFilters';
import { buildActiveChips } from '@/components/filters/buildActiveChips';
import { FilterPanelCaret } from '@/components/filters/FilterPanelCaret';
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

  // Whether the reader should see the landing instead of the list, and what
  // it should say. `events` rather than `filteredEvents` is the input on
  // purpose — see rule 3 in `determineLandingState`: a failed feed fetch
  // during the season must not be reported as "See you next season".
  //
  // `yearHasUpcomingEvents` — ports iOS's `upcomingDefaultCount > 0` rule:
  // does ANY event in the year's unfiltered set start at or after `now`?
  // This, not the season calendar, is what makes `showLanding` safe to
  // evaluate unconditionally rather than only inside an empty-list branch.
  // Without it, both a published-but-not-yet-open next season (March,
  // `dateFilter: 'next'`, events all in the future) and the live season's own
  // last events (whenever they fall later than `getChautauquaSeasonWeeks`'
  // fixed nine-week calendar window — #269's real Sep 1-10 shoulder) would
  // wrongly resolve to `pre-season` / `post-season` and hide a non-empty list
  // behind the landing. See `determineLandingState`'s own doc for why the
  // calendar-only version of this fix was tried and rejected.
  const landingState = useMemo(() => {
    const now = new Date();
    return determineLandingState({
      now,
      selectedYear,
      availableYears,
      yearHasEvents: events.length > 0,
      yearHasUpcomingEvents: events.some(e => parseEventDate(e.startDate) >= now),
    });
  }, [selectedYear, availableYears, events]);

  // The landing's two ways forward. Both mirror iOS's `AppModel`: previewing
  // opens the date scope right up, because `next`'s adaptive window has
  // nothing to adapt to that far ahead; browsing the archive deliberately
  // does NOT touch the year, since the year on screen is already the one
  // that ended.
  const previewNextSeason = useCallback((year: number) => {
    setSelectedYear(year);
    filters.setDateFilter('all');
  }, [setSelectedYear, filters.setDateFilter]);

  const browseArchiveSeason = useCallback(() => {
    filters.setDateFilter('season');
  }, [filters.setDateFilter]);

  // Everything the *non-date* filters admit, anywhere in the navigable
  // bounds — the same filter re-run with the date stage wide open. This is
  // what navigation is allowed to reach: search, category, venue, week and
  // favourites all constrain where stepping can go, but the current scope
  // does not, because escaping the scope's own edge is the point.
  const navMatchingEvents = useMemo(() => {
    const unbounded = viewWindow({
      dateFilter: 'all', seasonWeeks, currentWeekNumber, now: new Date(),
      bounds: navBounds, expandedStartDay: null, expandedEndDay: null,
    });
    return filterEvents(events, { ...nonDateFilterOpts, viewWindow: unbounded });
  }, [events, nonDateFilterOpts, seasonWeeks, currentWeekNumber, navBounds]);

  // Every day that has one — the set navigation steps through, so a step
  // always lands on a day that will actually render something.
  const navEventDays = useMemo(() => eventDayKeys(navMatchingEvents), [navMatchingEvents]);

  // How many, per day. Fed to the rail rather than counts taken from the
  // rendered day groups: the rail spans the navigable bounds, so counting
  // only what the current scope rendered would mark every day outside the
  // scope "no events" and make the rail a readout of the filter it exists to
  // navigate past.
  const navDayCounts = useMemo(() => eventCountsByDay(navMatchingEvents), [navMatchingEvents]);

  const { earlierDay, laterDay } = useMemo(
    () => navigationTargets(navEventDays, dateWindow),
    [navEventDays, dateWindow]
  );

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
  // Hoisted out of `railChips` because the week band needs the same list, and
  // in the same order: the band's segments are matched to chips by index.
  const railDayKeys = useMemo(
    () => dayKeys(navBounds.startDay, navBounds.endDay),
    [navBounds]
  );

  const railChips = useMemo(
    () => dayChips(railDayKeys, navDayCounts),
    [railDayKeys, navDayCounts]
  );

  // The band's segmentation depends only on the calendar, so it survives every
  // filter change untouched.
  const bandSegments = useMemo(
    () => weekBandSegments(railDayKeys, seasonWeeks),
    [railDayKeys, seasonWeeks]
  );

  // Reachability depends on the filters, so it does not. Kept separate from
  // the segments for exactly that reason.
  const weekDestinations = useMemo(
    () => weekBandDestinations({
      seasonWeeks, eventDays: navEventDays, bounds: navBounds, countsByDay: navDayCounts,
    }),
    [seasonWeeks, navEventDays, navBounds, navDayCounts]
  );

  // Every day the *view* window produced, not the render window's mounted
  // subset — `useDayAnchor` walks this list and skips any key with no DOM
  // section yet, so naming it "rendered" here would claim something this
  // value cannot promise. (The mixup this exact name invited is why the
  // pending-scroll effect below now checks the DOM directly instead of
  // trusting `groupedEvents` membership as a proxy for "mounted".)
  const windowDayKeys = useMemo(() => groupedEvents.map(g => g.key), [groupedEvents]);
  const { anchorDay, scrollToDay, cancelHold } = useDayAnchor(windowDayKeys);
  const railRef = useDayRailHeight();

  // The filter panel. A fixed overlay hanging off the site header's bottom
  // edge, opened by the funnel that lives in the header (#274 phase 3) — the
  // header returns on any upward flick (#272), so the filters are one small
  // gesture from anywhere in a list that can run past 9,000px.
  //
  // **The panel is never in flow, in either state.** That invariant, and the
  // measured scroll-anchoring failure that produced it, are in
  // `filterHeaderLayout.ts`. Everything this block used to contain —
  // measuring the card's height to park the sticky header by it, a sentinel
  // to notice the card had gone, the card's own visibility for `inert`, and a
  // frozen rect to choreograph the switch out of flow on the way out —
  // existed only to manage an in-flow card and is gone with it.
  //
  // Note for anyone extending this: the toggle button is a `mousedown` like
  // any other DOM element, and `useDayAnchor`'s hold cancels on `mousedown` —
  // that's fine and expected, not a bug to chase.
  const {
    open: filtersOpen, toggle: toggleFiltersPanel, panelId: filtersPanelId,
    panelRef: filtersPanelRef, toggleRef: filtersToggleRef, exiting: filtersExiting,
  } = useFilterPanel();

  // Declared here rather than beside `expandEnd` above, where it would read
  // more naturally: it needs `cancelHold`, and a `const` referenced before
  // its declaration is a TDZ ReferenceError.
  const showEarlier = useCallback(() => {
    if (!earlierDay) return;
    // Explicit reader intent supersedes a pending rail hold, in BOTH
    // directions. `EventList`'s `revealDay` effect already drops its prepend
    // hold when a rail navigation starts; this is the mirror that was
    // missing. Without it the prepend's height change fires
    // `useDayAnchor`'s ResizeObserver, whose reassert yanks the old rail
    // target back and cancels the prepend correction — and a mouse click on
    // "Show earlier" fires none of the wheel/touch/key gestures that would
    // otherwise have ended the hold.
    cancelHold();
    filters.expandWindowStart(earlierDay);
  }, [earlierDay, cancelHold, filters.expandWindowStart]);

  // Only when today is somewhere navigation can actually reach. Off-season
  // — most of the year — today sits outside `navBounds`, `railTarget`
  // refuses it, and an unclamped key would render a visible, enabled `⟳ Now`
  // that does nothing at all. Null removes the button instead, which is the
  // treatment the rail already gives an archived year.
  const todayKey = reachableTodayKey(isCurrentYear ? dayKeyOf(new Date()) : null, navBounds);

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
    // No section for it yet, and only one of the reasons is worth waiting
    // for — `shouldAbandonScroll` owns that call. Note that a `null`
    // `dateWindow` must abandon rather than wait: writing this as
    // `dateWindow && covered` made the whole expression `null` in that case,
    // so nothing cleared, and the pending target survived to hijack a later
    // commit — exactly what this branch exists to prevent.
    if (shouldAbandonScroll(pendingScroll, dateWindow)) setPendingScroll(null);
  }, [pendingScroll, dateWindow, scrollToDay]);

  // ⟳ Now is navigation, never a filter change: it widens the window to
  // contain today if it has to, and touches no scope, week, category or
  // search.
  const goToToday = useCallback(() => {
    if (todayKey) goToDay(todayKey);
  }, [todayKey, goToDay]);

  /**
   * A week band tap.
   *
   * Two lookups, deliberately separate: `WeekBandCell` has already asked the
   * *calendar* which week this day unambiguously means, and this asks the
   * *filters* which day of that week can actually be reached. `goToDay` then
   * does what a chip tap does, expansion included — a band tap is navigation,
   * and it changes no scope, week, category or search.
   */
  const goToWeek = useCallback((week: number) => {
    const destination = weekDestinations.get(week);
    if (destination) goToDay(destination.dayKey);
  }, [weekDestinations, goToDay]);

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

  // `hasNonDefaultFilters`, not `hasFilters`: the app still starts on the
  // `next` scope until task 5 deletes it, and `hasFilters` is therefore true
  // before the reader touches anything. Task 5 collapses the two.
  const showLanding = landingState.kind !== 'in-season' && !filters.hasNonDefaultFilters;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <Header
        selectedYear={selectedYear}
        availableYears={availableYears}
        defaultYear={defaultYear}
        onYearChange={setSelectedYear}
        filtersToggle={{
          open: filtersOpen,
          onToggle: toggleFiltersPanel,
          panelId: filtersPanelId,
          toggleRef: filtersToggleRef,
          // `hasNonDefaultFilters`, NOT `hasFilters`. `hasFilters` is true on
          // a default visit (the default scope is `next`, which is a date
          // filter), so the dot would be lit for every reader before they
          // touched anything — an indicator that is always on communicates
          // nothing, which is the opposite of the job the design gives it.
          // See `useFilterState` for what "default" means per year.
          hasActiveFilters: filters.hasNonDefaultFilters,
        }}
      />
      <IosAppBanner />
      {selectedYear === defaultYear && <CountdownBanner seasonWeeks={seasonWeeks} />}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        {/*
          The filter panel: a FIXED overlay hanging off the site header's
          bottom edge, in every state.

          It is never in flow — not open, not closed, not mid-exit — and that
          is the invariant the whole of #274 phase 3 turns on. An earlier
          version made it in-flow content and took it out of flow on scroll,
          which changed document height above the reader, which scroll
          anchoring undid, and the page could not be scrolled slowly at all in
          either Chromium or WebKit. `filterHeaderLayout.ts` carries the
          measurement and the reasoning; the short version is that a fixed
          panel contributes nothing to document height ever, so the failure is
          unreachable rather than survived.

          `z-30`: above the rail's `z-20` and the day headers' `z-10`
          (EventListView), below the site header's `z-40` — the panel hangs
          from the header, so the header paints over it.
        */}
        <div
          id={filtersPanelId}
          data-filter-card
          ref={filtersPanelRef}
          // `left-0 right-0` plus `<main>`'s own `px-*` and (below)
          // `max-w-7xl mx-auto`, copied, so the overlay lands on the content
          // column at every breakpoint without measuring anything.
          //
          // The positioned element is the one `aria-controls` names, and that
          // is deliberate rather than incidental. An earlier shape put
          // `position: fixed` on an outer wrapper and the id on the white card
          // inside it — which left the card `position: static`, so every
          // check that resolves the panel the way the accessibility tree does
          // (`aria-controls` → `getElementById`) read `static` and could not
          // see the invariant at all. Found by the browser pass; no unit test
          // could have. One element carries the id, the ref, the position and
          // the exit.
          className={`fixed left-0 right-0 z-30 px-4 sm:px-6 lg:px-8 ${
            // The exit transition — see globals.css. Nothing has to be
            // choreographed around it: the element was already
            // `position: fixed`, so the class alone is the whole exit.
            filtersExiting ? 'filter-panel-exit' : ''
          }`}
          style={{ top: belowHeaderTop() }}
          // `display: none` while closed, which takes the panel out of the tab
          // order and the accessibility tree for free. That is safe here
          // precisely BECAUSE it was never in flow: hiding an IN-FLOW card is
          // what removed ~290px above the reader and made the page
          // unscrollable — see `filterHeaderLayout.ts`.
          hidden={!filtersOpen && !filtersExiting}
          // Mid-exit the panel is a decorative echo of one that has already
          // closed (`filtersOpen` is false and focus has already been
          // returned) — visible for the ~200ms the transition runs, and beyond
          // the reader's reach for all of it.
          //
          // `inert` rather than `aria-hidden` alone: `aria-hidden` hides it
          // from the accessibility tree but leaves its very real SearchBar and
          // filter controls in the tab order.
          aria-hidden={filtersExiting ? 'true' : undefined}
          inert={filtersExiting || undefined}
        >
          <div className="max-w-7xl mx-auto">
            <div
              data-filter-panel-box
              // Capped and internally scrollable unconditionally: the panel is
              // always an overlay, so there is no in-flow state in which the
              // page itself scrolls past it. On a 390x844 phone this block —
              // search, four scopes, a nine-week strip, venues, categories,
              // active chips — exceeds the viewport, and uncapped its bottom
              // controls would be unreachable, reproducing the bug this feature
              // exists to fix one level down.
              style={{ maxHeight: filterPanelMaxHeight() }}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-y-auto"
            >
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
              {/*
                D4's drawer affordance, unconditional now: the panel is always
                an overlay, so there is no state in which "Hide filters" would
                close nothing the reader can see happen.

                Mounted INSIDE this element (a sibling of the padded content
                div, but still a descendant of the `filtersPanelRef` node) so
                `useFilterPanel`'s `isExempt` already spares it — see
                FilterPanelCaret's own doc comment for why placement matters
                here beyond layout. `onClose` reuses the same `toggle` the
                header's Filters button calls; the design lists the caret and
                the Filters toggle as two separate dismissers, not two
                implementations.
              */}
              <FilterPanelCaret onClose={toggleFiltersPanel} />
            </div>
          </div>
        </div>

        <DayRail
          chips={railChips}
          anchorDay={anchorDay}
          // The same array `useDayAnchor` walks, so the rail's continuous
          // highlight and this hook's discrete anchor resolve identical
          // input through the same `resolveAnchor`.
          windowDayKeys={windowDayKeys}
          // Off-season 'this-week' restored from localStorage resolves to no
          // window at all, and `railTarget` refuses every tap in that state.
          // The rail hides rather than offering ~64 fully-labelled chips that
          // cannot move the list.
          scopeHasWindow={dateWindow !== null}
          todayKey={todayKey}
          onSelectDay={goToDay}
          onGoToToday={goToToday}
          bandSegments={bandSegments}
          weekDestinations={weekDestinations}
          onSelectWeek={goToWeek}
          // The chooser's grid shows every week of the SEASON, which is not
          // the same set as the band's segments: `navigableBounds` can start
          // or end mid-season, and a week with no segment must still appear
          // in the grid (dimmed, from `weekDestinations`) rather than vanish.
          seasonWeeks={seasonWeeks}
          weekThemes={weeklyThemes}
          rootRef={railRef}
        />
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          <div className="p-4 sm:p-6">
            {/*
              Out of season with no filters, the reader gets the landing INSTEAD of the
              list — a stated branch, not a side effect of an empty result set.

              It used to be the latter: `dateFilter: 'next'` yielded nothing out of
              season, so the empty-list branch fired and the landing appeared. Phase 4
              lists the whole year, so the list is never empty out of season and that
              mechanism would have removed the landing (#269) with no test failing.

              `EmptyState` keeps its own, different job: a filter that matches nothing.
            */}
            {loading ? (
              <LoadingSpinner />
            ) : showLanding ? (
              <OffSeasonLanding
                state={landingState}
                onPreviewNextSeason={previewNextSeason}
                onBrowseArchiveSeason={browseArchiveSeason}
              />
            ) : filteredEvents.length === 0 ? (
              <EmptyState />
            ) : (
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
