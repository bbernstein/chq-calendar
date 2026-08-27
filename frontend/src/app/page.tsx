import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAvailableYears } from '@/hooks/useAvailableYears';
import { useSelectedYear } from '@/hooks/useSelectedYear';
import { useDebounce } from '@/hooks/useDebounce';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import { parseEventDate } from '@/lib/utils/chqTime';
import { groupEventsByDay } from '@/lib/utils/eventHelpers';
import { filterEvents, type FilterOptions } from '@/lib/utils/filterHelpers';
import { navigableBounds, dayKeyOf, dayKeys, dayChips, eventCountsByDay, eventDayKeys } from '@/lib/utils/dayWindow';
import { weekBandDestinations, weekBandSegments } from '@/lib/utils/weekBands';
import { useFilterState } from '@/hooks/useFilterState';
import { useDayAnchor } from '@/hooks/useDayAnchor';
import { useDayRailHeight } from '@/hooks/useDayRailHeight';
import { useFilterPanel } from '@/hooks/useFilterPanel';
import { belowHeaderTop, filterPanelMaxHeight } from '@/app/filterHeaderLayout';
import { DayRail } from '@/components/calendar/DayRail';
import { railTarget, reachableTodayKey } from '@/app/dayRailNavigation';
import { useFavorites } from '@/hooks/useFavorites';
import { useHorizontalScroll, useVerticalScroll } from '@/hooks/useScrollState';
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
import { landingDayKey } from '@/lib/utils/landingDay';
import { useInitialLanding } from '@/hooks/useInitialLanding';
import { useLandingDismissal } from '@/hooks/useLandingDismissal';
import { SearchBar } from '@/components/filters/SearchBar';
import { LocationFilter } from '@/components/filters/LocationFilter';
import { CategoryFilter } from '@/components/filters/CategoryFilter';
import { ActiveFilters } from '@/components/filters/ActiveFilters';
import { buildActiveChips } from '@/components/filters/buildActiveChips';
import { FilterPanelCaret } from '@/components/filters/FilterPanelCaret';
import { EventListView } from '@/components/calendar/EventListView';

function HomeContent() {
  const { years: availableYears, defaultYear } = useAvailableYears();
  const { selectedYear, setSelectedYear } = useSelectedYear({ years: availableYears, defaultYear });
  const globalEventData = useGlobalEventData();
  const seasonWeeks = useMemo(() => getChautauquaSeasonWeeks(selectedYear), [selectedYear]);
  const filters = useFilterState();
  const favorites = useFavorites();
  const locationScroll = useHorizontalScroll();
  const categoryScroll = useHorizontalScroll();
  const locationListScroll = useVerticalScroll();
  const categoryListScroll = useVerticalScroll();
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
  // Reconcile the category and venue selections against the year that just
  // finished loading: a category or venue the new year does not have would
  // otherwise sit in the filter state matching nothing.
  //
  // There used to be a second branch here, for an initial load on a
  // non-current year, and it reconciled specifically when `dateFilter` held
  // one of the time-relative scopes — the whole point being to clear a
  // `'next'` restored from a previous current-year session. #274 phase 4
  // deleted the scopes, so that branch has no subject: the condition it
  // fired on cannot be written any more. Its incidental category/venue
  // reconciliation is not re-created unconditionally, because that would be
  // a new behaviour — silently dropping a reader's restored category on the
  // current year too, which this app has never done. A category the year
  // does not have still shows as a removable chip in `ActiveFilters`, and
  // every actual year *switch* is handled below.
  useEffect(() => {
    if (prevYearRef.current !== selectedYear) {
      prevYearRef.current = selectedYear;
      pendingYearChangeRef.current = true;
      return;
    }
    // Reconcile once the new year's data has finished loading
    if (pendingYearChangeRef.current && !loading && events.length > 0) {
      filters.reconcileFilters(filters.availableCategories, filters.availableLocations);
      pendingYearChangeRef.current = false;
    }
  }, [selectedYear, loading, events.length, filters.availableCategories, filters.availableLocations, filters.reconcileFilters]);
  useEffect(() => {
    document.title = `Chautauqua Calendar | ${selectedYear} Season`;
  }, [selectedYear]);
  const debouncedSearch = useDebounce(filters.searchTerm, 200);

  // The outer limit of everything navigation can reach: the season, widened
  // to contain any event outside it.
  const navBounds = useMemo(
    () => navigableBounds(seasonWeeks, events),
    [seasonWeeks, events]
  );

  // One filter pass, over the whole year. There is no date stage and no
  // second pass: the list used to be filtered twice — once through the
  // current scope's window for what to render, and once with the date stage
  // wide open for what navigation could reach — and the two collapse into
  // this one now that the rendered list *is* everything navigation reaches
  // (#274 phase 4).
  const filterOpts: FilterOptions = useMemo(() => ({
    // Trimmed, and that is load-bearing rather than tidy. `searchEvents`
    // early-returns everything for `''` but not for `'   '`, which is truthy:
    // it tokenises to no terms, every event scores zero, and the list comes
    // back empty. `hasFilters` trims (`useFilterState`), so with one space in
    // the box the reader would get an empty list with no chip, no "Show all
    // events" button and a header still reading the full count — a dead end
    // with no control to escape it. Both sides trim, or neither can.
    searchTerm: debouncedSearch.trim(),
    selectedTagsLowerSet: filters.selectedTagsLowerSet,
    selectedLocationsLowerSet: filters.selectedLocationsLowerSet,
    showFavoritesOnly: filters.showFavoritesOnly,
    favoriteIds: favorites.favoriteIds,
  }), [
    debouncedSearch, filters.selectedTagsLowerSet,
    filters.selectedLocationsLowerSet,
    filters.showFavoritesOnly, favorites.favoriteIds,
  ]);
  const filteredEvents = useMemo(() => filterEvents(events, filterOpts), [events, filterOpts]);

  // Whether the reader should see the landing instead of the list, and what
  // it should say. `events` rather than `filteredEvents` is the input on
  // purpose — see rule 3 in `determineLandingState`: a failed feed fetch
  // during the season must not be reported as "See you next season".
  //
  // `yearHasUpcomingEvents` — ports iOS's `upcomingDefaultCount > 0` rule:
  // does ANY event in the year's unfiltered set start at or after a graced
  // `now` (see below), rather than the bare `now`? This, not the season
  // calendar, is what makes `showLanding` safe to evaluate unconditionally
  // rather than only inside an empty-list branch.
  // Without it, both a published-but-not-yet-open next season (March, events
  // all in the future) and the live season's own last events (whenever they
  // fall later than `getChautauquaSeasonWeeks`' fixed nine-week calendar
  // window — #269's real Sep 1-10 shoulder) would wrongly resolve to
  // `pre-season` / `post-season` and hide a non-empty list behind the
  // landing. See `determineLandingState`'s own doc for why the calendar-only
  // version of this fix was tried and rejected.
  const landingState = useMemo(() => {
    const now = new Date();
    // One hour of grace, NOT the bare `now` `determineLandingState` itself
    // receives. Without it, in the hour after the season's final event
    // begins, this predicate would already have moved past that event's
    // start: `yearHasUpcomingEvents` would go false, `showLanding` true, and
    // the landing would cover a list containing a currently-running event —
    // "See you next season" while it is happening. The web's own `next`
    // scope used to open exactly this hour early, which is where the value
    // comes from; iOS's `.next` window still does
    // (`ViewWindow.swift`'s `now.addingTimeInterval(-3600)`), so this also
    // keeps the two apps' opinions of "is the season over" in sync, which is
    // the promise `determineLandingState`'s module header makes.
    const graceStart = new Date(now.getTime() - 60 * 60 * 1000);
    return determineLandingState({
      now,
      selectedYear,
      availableYears,
      yearHasEvents: events.length > 0,
      yearHasUpcomingEvents: events.some(e => parseEventDate(e.startDate) >= graceStart),
    });
  }, [selectedYear, availableYears, events]);

  // The landing's two ways forward. Both mirror iOS's `AppModel`.
  //
  // Previewing a future season is now nothing but a year change — it used to
  // also open the date scope right up, because `next`'s adaptive window had
  // nothing to adapt to that far ahead, and with no scopes the whole year is
  // listed already.
  //
  // Browsing the archive deliberately does NOT touch the year: the year on
  // screen is already the one that ended. What it changes is this
  // component's own mind about whether to keep showing the landing over it —
  // `browseArchiveSeason`'s only previous action was `setDateFilter('season')`,
  // and without a replacement the button would be visible, enabled, and do
  // nothing, leaving an archived-year landing with no way past it.
  //
  // Both halves of that dismissal — plain (`browseArchiveSeason`) and a rail
  // tap's own target (`dismissForDay`, consumed by `useInitialLanding` below)
  // — live in `useLandingDismissal` rather than local state here: see its own
  // doc for why. In short, a re-review found the year-reset it owns was
  // previously falsifiable only against a test's own hand-rolled copy of it,
  // never against production — pulling it into an importable unit fixes that.
  const { browsingArchive, dismissedLandingTarget, browseArchiveSeason, dismissForDay, clearDismissedTarget } =
    useLandingDismissal(selectedYear);

  const previewNextSeason = useCallback((year: number) => {
    setSelectedYear(year);
  }, [setSelectedYear]);

  // Out of season, the landing replaces the list — unless the reader has
  // narrowed the list themselves (they asked a question, and an answer of
  // "see you next season" is not one), or has already pressed past it with
  // "Browse the N season" (`browsingArchive`) or a rail control (`goToDay`,
  // which sets `browsingArchive` too — see below).
  //
  // Computed here, ahead of `navEventDays`/`goToDay`, rather than beside the
  // JSX that reads it: `goToDay` needs it to decide whether a tap is a plain
  // scroll or a dismiss-then-scroll.
  const showLanding =
    landingState.kind !== 'in-season' && !filters.hasFilters && !browsingArchive;

  // Every day that has a matching event. The rail names a day with none as a
  // fact rather than a destination, and the week band dims a week it cannot
  // reach — both read this.
  const navEventDays = useMemo(() => eventDayKeys(filteredEvents), [filteredEvents]);

  // How many, per day. Taken from the filtered events rather than from the
  // rendered day groups because the rail spans the whole navigable bounds
  // including days that group to nothing — `eventCountsByDay` gives every
  // such day a 0 without needing a group to exist for it.
  const navDayCounts = useMemo(() => eventCountsByDay(filteredEvents), [filteredEvents]);

  const groupedEvents = useMemo(() => groupEventsByDay(filteredEvents, seasonWeeks), [filteredEvents, seasonWeeks]);

  // Both counts under the filters describe events the app can actually place
  // on a day, not raw feed rows — so they agree with what is on screen.
  //
  // The two can differ, by any event with an unparseable `startDate`.
  // `filterEvents` has no date stage left to reject one (#274 phase 4): the
  // old `'all'` scope was a real MIN..MAX instant window, and every
  // comparison against `NaN` is false, so such a row never reached the list
  // under ANY scope. It reaches it now, and `groupEventsByDay` — the one
  // place that has to file an event under a day — is where it is dropped.
  // Counting `filteredEvents`/`events` instead would print "Events (1470)"
  // over 1,469 rendered rows.
  const renderedCount = useMemo(
    () => groupedEvents.reduce((n, g) => n + g.events.length, 0),
    [groupedEvents]
  );
  // The same rule over the unfiltered set, and the same one-line form
  // `navigableBounds`, `eventDayKeys` and `eventCountsByDay` already use.
  // Memoised on `events` alone, so it costs one parse pass per feed load and
  // nothing at all per filter change.
  const placeableTotal = useMemo(
    () => events.reduce(
      (n, e) => n + (Number.isNaN(parseEventDate(e.startDate).getTime()) ? 0 : 1),
      0
    ),
    [events]
  );

  // The rail spans the navigable bounds — the whole season, widened by any
  // event outside it — which is also exactly what the list below renders.
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

  // Every day the list renders. All of them mount in the commit that
  // produced `groupedEvents` — #274 phase 4 deleted first the render window
  // and then the view window, so there is no second, laggier list any more —
  // but a commit still has to land before the DOM reflects it, which is why
  // `useDayAnchor` walks this list defensively, skipping any key with no
  // section yet.
  const windowDayKeys = useMemo(() => groupedEvents.map(g => g.key), [groupedEvents]);
  const { anchorDay, scrollToDay } = useDayAnchor(windowDayKeys);
  const railRef = useDayRailHeight();

  // The day the reader is put in front of on load — see `landingDayKey`'s own
  // doc for the rule. `navEventDays` rather than a day count derived from
  // `groupedEvents`: the landing day has to be choosable before the list
  // ever renders (pre-season, `groupedEvents` may be empty while events for
  // a later month already exist), and `navEventDays` already gives exactly
  // "every day with a matching event" for the rail to read the same way.
  const landingDay = useMemo(() => landingDayKey({
    now: new Date(),
    isCurrentYear,
    eventDays: navEventDays,
    seasonStartDay: dayKeyOf(seasonWeeks[0].start),
    selectedYear,
  }), [isCurrentYear, navEventDays, seasonWeeks, selectedYear]);

  // Wraps `scrollToDay` so the override it was called for is consumed the
  // moment it resolves — task 6 fix round 1. Without this,
  // `dismissedLandingTarget` survived every commit after a successful rail
  // tap, for the rest of that year: harmless by itself (a re-arrival at the
  // same day is a no-op once `explicit` below has also latched `landedFor`),
  // but it meant the ONLY thing standing between a stale prior-year day key
  // and a fresh year's list was `useLandingDismissal`'s own year-reset — one
  // line, load-bearing, and (before fix round 1) never exercised by any test
  // that reached it through an actual rail tap.
  const scrollToDayForLanding = useCallback((key: string) => {
    scrollToDay(key);
    clearDismissedTarget();
  }, [scrollToDay, clearDismissedTarget]);

  useInitialLanding({
    // A rail control tapped while the landing was still up overrides the
    // load's own choice — see `goToDay` below for why. `null` once nothing
    // has overridden it, which is the common case.
    targetDay: dismissedLandingTarget ?? landingDay,
    year: selectedYear,
    listMounted: !showLanding && !loading && groupedEvents.length > 0,
    scrollToDay: scrollToDayForLanding,
    // A reader's own request, never this hook's own guess — see
    // `explicit`'s own doc comment on `useInitialLanding` for the two routes
    // (a scrolled landing page, a filter toggled on then off) that silently
    // swallowed a rail tap without it.
    explicit: dismissedLandingTarget !== null,
  });

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

  // Only when today is somewhere navigation can actually reach. Off-season
  // — most of the year — today sits outside `navBounds`, `railTarget`
  // refuses it, and an unclamped key would render a visible, enabled `⟳ Now`
  // that does nothing at all. Null removes the button instead, which is the
  // treatment the rail already gives an archived year.
  const todayKey = reachableTodayKey(isCurrentYear ? dayKeyOf(new Date()) : null, navBounds);

  const goToDay = useCallback((target: string) => {
    // Every day of the year is mounted, so a chip tap is a scroll and nothing
    // else. `railTarget` is down to a bounds check: a target outside the
    // navigable bounds has no section and never will.
    //
    // This used to be two steps across two commits — widen the view window,
    // then wait for the widened commit to mount the target before scrolling
    // to it — held together by a `pendingScroll` state and an effect that
    // had to decide, each commit, whether a missing section meant "not yet"
    // or "never". With nothing left to widen, both are gone.
    if (!railTarget(target, navBounds)) return;
    if (showLanding) {
      // The rail (chips, ⟳ Now, the week band) stays rendered while the
      // landing covers the list, so without this branch a tap here would be
      // silently inert: `scrollToDay` looks up the target's own DOM section,
      // and the list underneath the landing is not mounted, so there is
      // nothing to find. "Take me to that day" implies showing the day, so
      // dismiss the landing the same way "Browse this season" does
      // (`dismissForDay` sets `browsingArchive` too), and hand the target to
      // `useInitialLanding` (wired above with this as its override) to carry
      // out once the list actually mounts — the same "wait for the section
      // to exist" handling `landingDay` itself gets on a normal load.
      dismissForDay(target);
      return;
    }
    scrollToDay(target);
  }, [navBounds, scrollToDay, showLanding, dismissForDay]);

  // ⟳ Now is navigation, never a filter change: it scrolls to today and
  // touches no category, venue or search.
  const goToToday = useCallback(() => {
    if (todayKey) goToDay(todayKey);
  }, [todayKey, goToDay]);

  /**
   * A week band tap.
   *
   * Two lookups, deliberately separate: `WeekBandCell` has already asked the
   * *calendar* which week this day unambiguously means, and this asks the
   * *filters* which day of that week can actually be reached. `goToDay` then
   * does exactly what a chip tap does — a band tap is navigation, and it
   * changes no category, venue or search.
   */
  const goToWeek = useCallback((week: number) => {
    const destination = weekDestinations.get(week);
    if (destination) goToDay(destination.dayKey);
  }, [weekDestinations, goToDay]);

  const activeChips = useMemo(() => buildActiveChips({
    searchTerm: filters.searchTerm, setSearchTerm: filters.setSearchTerm,
    selectedLocations: filters.selectedLocations, toggleLocation: filters.toggleLocation,
    selectedTags: filters.selectedTags, toggleTag: filters.toggleTag,
    showFavoritesOnly: filters.showFavoritesOnly, toggleFavoritesOnly: filters.toggleFavoritesOnly,
  }), [
    filters.searchTerm, filters.setSearchTerm,
    filters.selectedLocations, filters.toggleLocation,
    filters.selectedTags, filters.toggleTag,
    filters.showFavoritesOnly, filters.toggleFavoritesOnly,
  ]);

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
          // One flag now. `hasFilters` used to be true on a default visit
          // (the default scope was `next`, which was a date filter), so the
          // dot needed a separate `hasNonDefaultFilters` to avoid being lit
          // for every reader before they touched anything. With the scopes
          // gone, `hasFilters` means exactly what the dot needs it to.
          hasActiveFilters: filters.hasFilters,
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
              // search, favourites, venues, categories, active chips —
              // exceeds the viewport, and uncapped its bottom
              // controls would be unreachable, reproducing the bug this feature
              // exists to fix one level down.
              style={{ maxHeight: filterPanelMaxHeight() }}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-y-auto"
            >
              <div className="p-2 sm:p-4">
                <SearchBar value={filters.searchTerm} onChange={filters.setSearchTerm} />
                {/*
                  The favourites toggle, rehoused. It used to sit on the
                  scope row inside `DateFilter`, sharing that row's button
                  styling because it shared its position — and when the
                  scopes went, it was the one control on that row that was
                  never a date filter at all. Label, title, `aria-pressed`
                  and `aria-label` are carried over verbatim; only where it
                  lives changed.
                */}
                <div className="mb-2 sm:mb-4">
                  <button
                    type="button"
                    onClick={filters.toggleFavoritesOnly}
                    title={favorites.favoriteCount > 0 ? 'Show favorited events only' : 'No favorites saved yet'}
                    aria-label={filters.showFavoritesOnly ? 'Stop showing favorites only' : 'Show favorites only'}
                    aria-pressed={filters.showFavoritesOnly}
                    className={`px-2 py-1 sm:px-4 sm:py-2 rounded-md border transition-all text-xs sm:text-sm whitespace-nowrap ${
                      filters.showFavoritesOnly
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-gray-600'
                    }`}
                  >
                    {`★ ${favorites.favoriteCount}`}
                  </button>
                </div>
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
                  filteredCount={renderedCount}
                  totalCount={placeableTotal}
                  hasFilters={filters.hasFilters}
                  chips={activeChips}
                  onClear={filters.clearFilters}
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
              As of this step the scope it depended on no longer exists at all.

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
            ) : groupedEvents.length === 0 ? (
              // `groupedEvents`, not `filteredEvents`: the two disagree when
              // every surviving row has an unparseable `startDate`, and the
              // list below would then render as a silent blank rather than
              // saying anything at all.
              <EmptyState />
            ) : (
              // `EventListView` directly: `EventList` was a pass-through
              // wrapper around it plus a "Show earlier" button, and with the
              // whole year listed there is no earlier to show.
              <div className="space-y-4 sm:space-y-6">
                <EventListView groups={groupedEvents} expandedDescriptions={filters.expandedDescriptions}
                  onToggleDescription={filters.toggleDescription} onToggleTag={filters.toggleTag} isTagSelected={filters.isTagSelected}
                  favoriteIds={favorites.favoriteIds} onToggleFavorite={favorites.toggleFavorite}
                  weeklyThemes={weeklyThemes} articleLinks={articleLinks} programLinks={programLinks} />
              </div>
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
