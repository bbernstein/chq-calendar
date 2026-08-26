import { render, screen, waitFor, fireEvent } from '@testing-library/preact';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Home from '@/app/page';
import { installFetchMock, type FetchMock } from './helpers/fetchMock';
import { installIntersectionObserverMock } from '@/__tests__/helpers/intersectionObserver';
import { installResizeObserverMock } from '@/__tests__/helpers/resizeObserver';
import { chqDateAt } from '@/lib/utils/chqTime';

/**
 * The branch #269 is about: with no events left in the default window, does
 * the reader get a screen that explains why, or "No events found"?
 *
 * The clock is pinned per-test rather than derived from the real date. Every
 * case here is a statement about a specific point in the season, and a suite
 * whose answers changed with the calendar would be exactly the defect this
 * feature fixes.
 */
const SEASON_YEAR = 2026;

function eventsPayload() {
  return {
    data: [
      {
        id: 'e1',
        title: 'Morning Lecture',
        startDate: `${SEASON_YEAR}-07-06T10:45:00`,
        endDate: `${SEASON_YEAR}-07-06T11:45:00`,
        location: 'Amphitheater',
        description: 'A lecture.',
        // `Array<{ name: string }>`, per `Event` in lib/types. A bare string
        // array makes `useEventData` throw on `cat.name` while parsing, which
        // it swallows into a console.error — events stay empty and the page
        // renders as though the feed were down. Silent, and it cost a
        // debugging session.
        categories: [{ name: 'Lecture' }],
      },
      {
        id: 'e2',
        title: 'Evening Concert',
        startDate: `${SEASON_YEAR}-07-07T20:15:00`,
        endDate: `${SEASON_YEAR}-07-07T22:00:00`,
        location: 'Amphitheater',
        description: 'A concert.',
        categories: [{ name: 'Music' }],
      },
    ],
  };
}

let mock: FetchMock;

function pin(now: Date) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(now);
}

beforeEach(() => {
  localStorage.clear();
  // Installed for their side effect only — jsdom has neither observer, and
  // page.tsx's hooks construct both on mount. Nothing here drives them, so
  // unlike filterHeader.test.tsx the handles are not kept.
  installIntersectionObserverMock();
  installResizeObserverMock();
  mock = installFetchMock({ allowUnhandled: true });
  mock.on('GET', /years\.json/, { years: [2025, 2026, 2027], defaultYear: 2026, generated: '' });
  mock.on('GET', /all-events-\d{4}\.json/, eventsPayload());
  // The sidecars. Routed explicitly rather than left to `allowUnhandled`, so
  // a genuinely missing route still shows up as noise worth reading.
  mock.on('GET', /weekly-themes/, { data: [] });
  mock.on('GET', /article-links-\d{4}\.json/, { data: [] });
  mock.on('GET', /program-links-\d{4}\.json/, { data: [] });
  mock.on('GET', /publisher-events-\d{4}\.json/, { data: [] });
});

afterEach(() => {
  vi.useRealTimers();
  mock.uninstall();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function renderPage() {
  render(<Home />);
  await waitFor(() =>
    expect(document.querySelector('[data-day-rail]')).toBeTruthy()
  );
}

describe('page.tsx — the off-season landing', () => {
  it('explains the empty screen after the season has ended', async () => {
    pin(chqDateAt(2026, 9, 15, 10));
    await renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('off-season-landing')).toBeInTheDocument()
    );
    expect(screen.getByRole('heading', { name: 'See you next season' })).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
  });

  // Pre-season is reachable when the year has no events upcoming relative
  // to `now` — NOT the same thing as an empty feed (2026-08-26 review round
  // 2: real production data carries events dated before the season's own
  // calendar start — the 2026 feed has entries in January, February and
  // May), and not an artefact of this fixture either. `determineLandingState`'s
  // rule 1 asks the year's own events directly — does any of them start at
  // or after the same graced instant the `next` scope's own window uses
  // (not the bare `now`)? — so a published season resolves to `in-season`
  // regardless of the calendar, whatever the feed's other, already-past
  // entries say. This test's `all-events-\d{4}\.json` → `{ data: [] }` mock
  // is simply the easiest way to guarantee no upcoming events, not the only
  // way to reach pre-season; a March visit against the season's real,
  // published events would see `in-season` and the list. The countdown
  // belongs to the window between a year being announced in the manifest and
  // its programme going up, which is exactly when a visitor has nothing else
  // to be told.
  it('counts down before an announced season has been published', async () => {
    mock.reset();
    mock.on('GET', /years\.json/, { years: [2026, 2027], defaultYear: 2026, generated: '' });
    mock.on('GET', /all-events-\d{4}\.json/, { data: [] });
    pin(chqDateAt(2026, 3, 1, 10));
    render(<Home />);

    await waitFor(() =>
      expect(screen.getByTestId('off-season-landing')).toBeInTheDocument()
    );
    expect(screen.getByRole('heading', { name: 'Almost showtime' })).toBeInTheDocument();
    expect(screen.getByTestId('off-season-countdown').textContent)
      .toMatch(/^The 2026 season begins June \d{1,2}$/);
  });

  // The same empty feed, six weeks later: past the season start, "no data" is
  // the honest reading and the generic empty state is the honest screen. The
  // only difference between this and the test above is the clock, which is
  // the whole of rule 1 versus rule 3 in `determineLandingState`.
  it('does not count down once that same empty year has opened', async () => {
    mock.reset();
    mock.on('GET', /years\.json/, { years: [2026, 2027], defaultYear: 2026, generated: '' });
    mock.on('GET', /all-events-\d{4}\.json/, { data: [] });
    pin(chqDateAt(2026, 8, 1, 10));
    render(<Home />);

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
    expect(screen.queryByTestId('off-season-landing')).not.toBeInTheDocument();
  });

  // The case a naive implementation gets wrong. "Try adjusting your filters"
  // is true advice here and "See you next season" is not — the reader's own
  // search is why the list is empty.
  it('keeps the generic empty state when the READER emptied the list', async () => {
    pin(chqDateAt(2026, 9, 15, 10));
    localStorage.setItem('chq-calendar-user-state', JSON.stringify({
      dateFilter: 'all', searchTerm: 'zzzznothingmatchesthis',
      selectedTags: [], selectedLocations: [], selectedWeeks: [],
      expandedDescriptions: [], recentLocations: [], recentCategories: [],
      showFavoritesOnly: false, lastSaved: Date.now(),
    }));
    await renderPage();

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
    expect(screen.queryByTestId('off-season-landing')).not.toBeInTheDocument();
  });

  // Rule 3 from landingState.ts, reaching the screen. A July visitor whose
  // feed failed must never be told the season is over.
  it('keeps the generic empty state when the feed came back empty mid-season', async () => {
    mock.reset();
    mock.on('GET', /years\.json/, { years: [2026], defaultYear: 2026, generated: '' });
    mock.on('GET', /all-events-\d{4}\.json/, { data: [] });
    pin(chqDateAt(2026, 7, 15, 10));
    render(<Home />);

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
    expect(screen.queryByTestId('off-season-landing')).not.toBeInTheDocument();
  });

  it('shows the list, and no landing, when the window has events', async () => {
    pin(chqDateAt(2026, 7, 5, 10));
    await renderPage();

    await waitFor(() =>
      expect(document.querySelectorAll('[data-day-key]').length).toBeGreaterThan(0)
    );
    expect(screen.queryByTestId('off-season-landing')).not.toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
  });

  // #274 phase 4 task 3, review round 2: `yearHasUpcomingEvents` must give
  // the `next` scope's own one-hour grace to "is anything upcoming" (the
  // same grace `viewWindow`'s `next` case gives its own window start —
  // dayWindow.ts's "One hour of grace so an event that has just begun is
  // still 'next'"), not compare against the bare `now`. Without it, a
  // reader who visits within an hour of the season's FINAL event starting
  // gets the landing covering a list that still contains that event running
  // live — the same #269 shoulder, one hour wide. This event is the year's
  // only one and started 30 minutes before the pinned clock.
  it("stays in-season for the hour after the year's last event has started", async () => {
    mock.reset();
    mock.on('GET', /years\.json/, { years: [2025, 2026, 2027], defaultYear: 2026, generated: '' });
    mock.on('GET', /all-events-\d{4}\.json/, {
      data: [{
        id: 'closing', title: 'Closing Address',
        startDate: '2026-08-20T15:00:00', endDate: '2026-08-20T16:00:00',
        location: 'Amphitheater', description: '', categories: [{ name: 'Lecture' }],
      }],
    });
    pin(chqDateAt(2026, 8, 20, 15, 30));
    await renderPage();

    await waitFor(() =>
      expect(document.querySelectorAll('[data-day-key]').length).toBeGreaterThan(0)
    );
    expect(screen.queryByTestId('off-season-landing')).not.toBeInTheDocument();
  });

  // Same shape and the same growth driver as the test below it — mount, then
  // click through to a second full render — so it gets the same budget. It
  // measured 493ms before the band and 710ms after, which is comfortable
  // today; it is raised now rather than after it starts flaking, because the
  // rail's element count tracks the navigable range and production data spans
  // far more of the year than this fixture does.
  it('browsing the archive puts the season on screen', { timeout: 15000 }, async () => {
    pin(chqDateAt(2026, 9, 15, 10));
    await renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('off-season-landing')).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: 'Browse the 2026 season' }));

    await waitFor(() =>
      expect(document.querySelectorAll('[data-day-key]').length).toBeGreaterThan(0)
    );
    expect(screen.queryByTestId('off-season-landing')).not.toBeInTheDocument();
  });

  // Explicit timeout, following the four in `dayRailIntegration.test.tsx`.
  // This is the most expensive test in the suite: it mounts the whole page,
  // then drives a *year switch*, which fetches a second season and re-renders
  // the entire list and rail against it — two full page loads in one test.
  //
  // Measured locally with coverage on, as CI runs it: 1173ms before the #274
  // week band, 1766ms after. The band puts one segment above every day chip,
  // so the rail's element count grows with the navigable range — that is the
  // structural alignment the design rests on, not a regression to tune away.
  // (Most of the 1.5x is the per-day column wrapper; only about a third is
  // `WeekBandCell` itself, measured by stubbing it out.)
  //
  // CI runs ~3x slower than that on a loaded 2-core runner with coverage
  // instrumentation, which put this test at roughly two thirds of the default
  // 5s budget *before* the band and over it after. 15s is the same headroom
  // the day-rail integration tests already take. The budget was always wrong
  // for this test; the band is only what made that visible.
  // The phase 4 world, reachable today by seeding the widest scope: a
  // post-season visit with a full feed. The list is NOT empty, and the
  // landing must still be what the reader sees — a stated branch ahead of
  // the deletion that removes date filtering (#274 phase 4), rather than a
  // side effect of an empty result set that phase 4 would otherwise erase
  // silently.
  it('the landing shows out of season even when the year has events to list', async () => {
    localStorage.setItem('chq-calendar-user-state', JSON.stringify({
      dateFilter: 'all', searchTerm: '',
      selectedTags: [], selectedLocations: [], selectedWeeks: [],
      expandedDescriptions: [], recentLocations: [], recentCategories: [],
      showFavoritesOnly: false, lastSaved: Date.now(),
    }));
    pin(chqDateAt(2026, 9, 20, 10));
    render(<Home />);

    await waitFor(() =>
      expect(screen.getByTestId('off-season-landing')).toBeInTheDocument()
    );
    expect(document.querySelectorAll('[data-day-key]')).toHaveLength(0);
  });

  it('previewing next season switches the year and opens the date scope', { timeout: 15000 }, async () => {
    pin(chqDateAt(2026, 9, 15, 10));
    await renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('off-season-landing')).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: 'Preview the 2027 season' }));

    await waitFor(() => {
      const requested = mock.calls(/all-events-/).map(r => new URL(r.url).pathname);
      expect(requested.some(p => p.endsWith('all-events-2027.json'))).toBe(true);
    });
    // The scope buttons live inside the filter panel, which is a fixed
    // overlay and `display: none` while closed (#274 phase 3) — so they are
    // out of the accessibility tree until the reader opens it, and
    // `getByRole` correctly cannot see them. Opening the panel is what a
    // reader would do to check the scope, and it is what this has to do to
    // assert on it.
    // By role, not `document.querySelector(...)!` — the funnel is a real
    // accessible control, so a role query fails with "unable to find a button
    // named Filters" instead of a null-deref if the markup moves.
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'All Year' }).getAttribute('aria-pressed')
      ).toBe('true')
    );
  });
});
