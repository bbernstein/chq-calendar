import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAvailableYears } from '@/hooks/useAvailableYears';
import { useSelectedYear } from '@/hooks/useSelectedYear';
import { useDebounce } from '@/hooks/useDebounce';
import { getChautauquaSeasonWeeks, getCurrentWeekNumber, getAdaptiveEndDate } from '@/lib/utils/dateHelpers';
import { groupEventsByDay } from '@/lib/utils/eventHelpers';
import { filterEvents, type FilterOptions } from '@/lib/utils/filterHelpers';
import { navigableBounds, viewWindow, dayKeyOf, dayKeys, dayChips, eventCountsByDay, eventDayKeys, navigationTargets } from '@/lib/utils/dayWindow';
import { renderResetKey } from '@/lib/utils/renderWindow';
import { daySectionElement } from '@/lib/utils/daySections';
import { useFilterState } from '@/hooks/useFilterState';
import { useDayAnchor } from '@/hooks/useDayAnchor';
import { useDayRailHeight } from '@/hooks/useDayRailHeight';
import { useScrolledPastFilters } from '@/hooks/useScrolledPastFilters';
import { useFilterCardHeight } from '@/hooks/useFilterCardHeight';
import { useElementOutOfView } from '@/hooks/useElementOutOfView';
import { useFilterPanel } from '@/hooks/useFilterPanel';
import { filterCardParked, filterHeaderTop } from '@/app/filterHeaderLayout';
import { DayRail } from '@/components/calendar/DayRail';
import { railTarget, reachableTodayKey, shouldAbandonScroll, stepTargets } from '@/app/dayRailNavigation';
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

  // Why the default screen is empty, when it is. Only consulted in the empty
  // branch below. `events` rather than `filteredEvents` is the input on
  // purpose — see rule 3 in `determineLandingState`: a failed feed fetch
  // during the season must not be reported as "See you next season".
  const landingState = useMemo(
    () => determineLandingState({
      now: new Date(),
      selectedYear,
      availableYears,
      yearHasEvents: events.length > 0,
    }),
    [selectedYear, availableYears, events]
  );

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
  const railChips = useMemo(
    () => dayChips(dayKeys(navBounds.startDay, navBounds.endDay), navDayCounts),
    [navBounds, navDayCounts]
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

  // "Reach the filters after you've scrolled" — a Filters toggle on the
  // sticky rail reveals the existing filter card in place, over the list,
  // instead of the reader scrolling back to the top of a list that can grow
  // past 9,000px. `scrolled` is deliberately its own mechanism
  // (IntersectionObserver on a sentinel), not a reuse of `useDayAnchor`'s
  // scroll listener — see `useScrolledPastFilters` for why coupling them
  // would be a mistake. Note for anyone extending this: the toggle button is
  // a `mousedown` like any other DOM element, and `useDayAnchor`'s hold
  // cancels on `mousedown` — that's fine and expected (the same as clicking
  // any other rail control), not a bug to chase.
  const { scrolled: filtersScrolledPast, sentinelRef: filtersSentinelRef } = useScrolledPastFilters();
  const {
    open: filtersOpen, toggle: toggleFiltersPanel, panelId: filtersPanelId, panelRef: filtersPanelRef,
    toggleRef: filtersToggleRef, exiting: filtersExiting, exitRect: filtersExitRect,
    exitScrolledPast: filtersExitScrolledPast,
  } = useFilterPanel({ scrolledPast: filtersScrolledPast });
  // The exit animation only makes sense once the panel has actually left
  // in-flow content — at the top of the page (`!filtersScrolledPast`) the
  // panel is unconditionally shown regardless of `open` (see the className
  // below), so a stray gesture-dismiss while scrolled back to the top with a
  // stale `filtersOpen` must not fix the panel to a rect and animate it away
  // from a position the reader can still see it occupying.
  //
  // `filtersExitScrolledPast`, not a live `filtersScrolledPast` read: the
  // hook freezes the value at the instant the exit begins, in the same batch
  // as `exiting` and `exitRect`. Two reasons, both explained at length in
  // `useFilterPanel`'s "Exit animation" doc — the exit's own `scrollBy` can
  // recross the sentinel mid-animation and drop the ghost out of `fixed`,
  // and anything derived one commit later renders this first frame
  // `display: none`, which a CSS transition cannot start from.
  const filtersExitingVisible = filtersExiting && filtersExitScrolledPast && filtersExitRect !== null;
  // The panel only needs to cap its own height and scroll internally while
  // it is acting as an overlay over the list — at the top of the page it is
  // ordinary in-flow content and the page itself scrolls past it, same as
  // before this feature existed. `filtersExitingVisible` (not raw
  // `filtersExiting`, and not ANDed with a live `filtersScrolledPast`)
  // counts as overlaying too, for the same reason it drives the fixed
  // positioning above: the rect it freezes to was measured while this same
  // cap applied, dropping the cap — or losing it mid-exit to the identical
  // IO race described above — would change the box's own height out from
  // under the frozen rect.
  const filtersPanelOverlaying = (filtersScrolledPast && filtersOpen) || filtersExitingVisible;
  // Parked above the viewport on the header's negative `top`, or animating
  // away as a fixed-position ghost — either way in the DOM but beyond the
  // reader's reach, so out of the tab order and the accessibility tree.
  //
  // `cardOutOfView` asks the card itself rather than reusing
  // `filtersScrolledPast`. The sentinel that drives `scrolledPast` sits below
  // the whole header, so it reports the card gone a rail-height after it
  // actually went — and in that window the card was pinned out of sight and
  // still Tab-reachable. See `useElementOutOfView` for why the sentinel
  // cannot simply be moved to the card's own bottom edge.
  const { outOfView: filtersCardOutOfView, ref: filtersCardViewRef } = useElementOutOfView();
  const filtersCardBeyondReach = filtersExitingVisible || filterCardParked({
    outOfView: filtersCardOutOfView, open: filtersOpen, exitingVisible: filtersExitingVisible,
  });
  // The header container's observer, not the card's. `--filter-card-h` has to
  // re-publish when the card's MARGIN changes at a breakpoint, and
  // `ResizeObserver` never reports a margin — but the container's own height
  // is card + margin + rail, so it changes whenever any of them does. See
  // `useFilterCardHeight`.
  const filtersCardHeightRef = useFilterCardHeight();
  // Two observers on the card itself: `useFilterPanel` needs the node to read
  // its rect and test focus containment, and `inert` needs to know whether
  // the card is still on screen. Both are stable callback refs, so merging
  // them in a `useCallback` keeps them from tearing down on every render.
  const filtersCardRef = useCallback((el: HTMLElement | null) => {
    filtersPanelRef(el);
    filtersCardViewRef(el);
  }, [filtersPanelRef, filtersCardViewRef]);

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

  // The chevrons move to the nearest day that has something on it, not to
  // the adjacent calendar day. A calendar step onto an empty day mounts no
  // section, so the pending scroll gives up and `anchorDay` — derived from
  // scroll position — never moves; pressing again recomputes the same dead
  // target, with the chevron still enabled. Reachability is also what
  // enables/disables them, so the control and its label agree.
  const { prevDay, nextDay } = useMemo(
    () => stepTargets(anchorDay, navEventDays),
    [anchorDay, navEventDays]
  );

  const stepDay = useCallback((delta: -1 | 1) => {
    const target = delta === -1 ? prevDay : nextDay;
    if (target) goToDay(target);
  }, [prevDay, nextDay, goToDay]);

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
        {/*
          One sticky container wrapping the filter card and the rail, in
          that order — the reveal-in-place from
          docs/superpowers/specs/2026-08-16-web-filter-reveal-design.md.
          `z-30`, above the rail's own `z-20` and the day headers' `z-10`
          (EventListView), so the revealed panel paints over both rather
          than being hidden behind either.

          `top` is negative whenever the panel is not overlaying the list —
          the header rides up by exactly the filter card's measured height
          and pins there, parking the card just above the viewport with the
          rail flush against the top edge. The card is deliberately NOT
          taken out of flow: doing that changed document height above the
          reader, which scroll anchoring then undid, and the page became
          impossible to scroll slowly in either Chromium or WebKit. See
          `filterHeaderLayout.ts` for the measured failure and why the
          geometry — not the browser — was the root cause.
        */}
        <div
          data-filter-header
          ref={filtersCardHeightRef}
          className="sticky z-30"
          style={{ top: filterHeaderTop({ overlaying: filtersPanelOverlaying }) }}
        >
          <div
            id={filtersPanelId}
            data-filter-card
            ref={filtersCardRef}
            className={`bg-white dark:bg-gray-800 rounded-lg mb-4 sm:mb-6 ${
              // D4: a heavier, bottom-weighted shadow only while the panel is
              // behaving like the page header it now visually replaces — the
              // "reads as sitting above the list" cue only means something
              // once it's actually stacked over the list rather than sitting
              // in flow at the top of the page, where the ordinary card
              // `shadow` below already applies.
              filtersPanelOverlaying ? 'shadow-lg' : 'shadow'
            } ${
              // Capped and internally scrollable only while acting as an
              // overlay over the list. On a 390×844 phone this block —
              // search, four scopes, a nine-week strip, venues, categories,
              // active chips — can exceed the viewport; uncapped, its bottom
              // controls would be unreachable, reproducing the bug this
              // feature exists to fix one level down.
              filtersPanelOverlaying ? 'max-h-[70vh] overflow-y-auto' : ''
            } ${
              // The exit transition itself — see globals.css. Applied only
              // once the element has switched to `position: fixed` below;
              // adding it any earlier would animate the in-flow panel.
              filtersExitingVisible ? 'filter-panel-exit' : ''
            }`}
            style={filtersExitingVisible ? {
              // Switches this same element (no DOM clone) from in-flow to
              // `position: fixed` at the exact rect it just occupied, so the
              // in-flow placeholder disappears in the same commit the fixed
              // one appears — nothing above the list relayouts to make room,
              // and nothing here shifts before the transition starts sliding
              // it away. `top`/`left` are viewport-relative, which is what
              // `getBoundingClientRect` returns and exactly what `position:
              // fixed` coordinates need. `width`/`height` are pinned too, so
              // leaving flow doesn't let the box's own size change (e.g. an
              // internal-scroll cap being lifted) before it starts sliding.
              position: 'fixed',
              top: `${filtersExitRect!.top}px`,
              left: `${filtersExitRect!.left}px`,
              width: `${filtersExitRect!.width}px`,
              height: `${filtersExitRect!.height}px`,
            } : undefined}
            // Two states put this element beyond the reader's reach while it
            // is still in the DOM, and both need the same treatment.
            //
            // Exiting: a fixed-position echo of a panel that has already, in
            // this same commit, stopped being the real filter block (`open`
            // is false and the in-flow slot is empty) — decorative for the
            // ~200ms it takes to visually finish leaving.
            //
            // Parked: scrolled past with the panel closed, riding above the
            // viewport on the header's negative `top`. It is still in flow —
            // that is the whole point, see `filterHeaderLayout.ts` — so
            // without this a keyboard reader would Tab straight into it and
            // the browser would scroll the header back down to show them the
            // focused control, throwing them to the top of the page mid-read.
            // `display: none` used to cover this for free.
            //
            // `inert` rather than `aria-hidden` alone: `aria-hidden` hides it
            // from the accessibility tree but leaves its very real
            // SearchBar and filter controls in the tab order.
            aria-hidden={filtersCardBeyondReach ? 'true' : undefined}
            inert={filtersCardBeyondReach || undefined}
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
              D4: the caret only while the panel is behaving like the page
              header (revealed over the list) — at the top of the page this
              is just the ordinary in-flow filter card, and a "Hide filters"
              control there would close nothing a reader could see happen
              (`filtersOpen` only ever becomes true via the rail's toggle,
              which itself only exists once `filtersScrolledPast`).
              Mounted INSIDE this element (a sibling of the padded content
              div, but still a descendant of the `filtersPanelRef` node) so
              `useFilterPanel`'s `isExempt` already spares it — see
              FilterPanelCaret's own doc comment for why placement matters
              here beyond layout. `onClose` reuses the same `toggle` the
              rail's own Filters button calls; the design lists the caret and
              the Filters toggle as two separate dismissers, not two
              implementations.
            */}
            {filtersPanelOverlaying && <FilterPanelCaret onClose={toggleFiltersPanel} />}
          </div>
          <DayRail
            chips={railChips}
            anchorDay={anchorDay}
            // The same array `useDayAnchor` walks, so the rail's continuous
            // highlight and this hook's discrete anchor resolve identical
            // input through the same `resolveAnchor`.
            windowDayKeys={windowDayKeys}
            prevDay={prevDay}
            nextDay={nextDay}
            // Off-season 'this-week' restored from localStorage resolves to no
            // window at all, and `railTarget` refuses every tap in that state.
            // The rail hides rather than offering ~64 fully-labelled chips that
            // cannot move the list.
            scopeHasWindow={dateWindow !== null}
            todayKey={todayKey}
            onSelectDay={goToDay}
            onStepDay={stepDay}
            onGoToToday={goToToday}
            rootRef={railRef}
            filtersToggle={{
              open: filtersOpen,
              onToggle: toggleFiltersPanel,
              panelId: filtersPanelId,
              visible: filtersScrolledPast,
              toggleRef: filtersToggleRef,
              // `hasNonDefaultFilters`, NOT `hasFilters`. `hasFilters` is
              // true on a default visit (the default scope is `next`, which
              // is a date filter), so the dot would be lit for every reader
              // before they touched anything — an indicator that is always
              // on communicates nothing, which is the opposite of the job
              // the design gives it. See `useFilterState` for what "default"
              // means per year.
              hasActiveFilters: filters.hasNonDefaultFilters,
            }}
          />
        </div>
        {/*
          Zero-height, marking where the sticky header's flow space ENDS.
          Once it scrolls above the viewport the whole header — filter card,
          gap and rail — has gone by, so the card is certainly parked out of
          sight and the rail's Filters toggle is the only way back to it.
          That is the "scrolled" signal.

          Below the header rather than above it, which is load-bearing in two
          ways. It is the honest reading of the signal (above the header, it
          fired 64px in, while the card was still half on screen — and the
          card is what `filterCardParked` then makes `inert`). And it is what
          keeps the signal stable while the exit animation runs: the panel
          goes `position: fixed` mid-exit, so the header briefly loses the
          card's height, and a sentinel below moves up by exactly the amount
          scroll anchoring subtracts from `scrollY` — leaving its own viewport
          position unchanged. Above the header it would not move, and the
          signal would flip underneath its own animation.

          `aria-hidden`: it carries no content, and screen readers walking
          `<main>` by node would otherwise announce a meaningless empty
          element.
        */}
        <div ref={filtersSentinelRef} aria-hidden="true" />
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          <div className="p-4 sm:p-6">
            {loading ? <LoadingSpinner /> : filteredEvents.length === 0 ? (
              /*
                `hasNonDefaultFilters`, NOT `hasFilters`: the app starts on
                the `next` scope, which is a date filter, so `hasFilters` is
                true before the reader touches anything and the landing would
                never show. See `useFilterState` for what "default" means per
                year — note it counts `all` as a default too, since that is
                the archived year's own starting scope.

                The consequence is deliberate: a reader on "All Year" with
                zero results gets the landing rather than "No events found".
                That can only happen when the year genuinely has no events —
                an announced-but-empty next season, say — where the countdown
                is the better screen.
              */
              landingState.kind !== 'in-season' && !filters.hasNonDefaultFilters ? (
                <OffSeasonLanding
                  state={landingState}
                  onPreviewNextSeason={previewNextSeason}
                  onBrowseArchiveSeason={browseArchiveSeason}
                />
              ) : <EmptyState />
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
