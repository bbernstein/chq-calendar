import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Home from '@/app/page';
import { installFetchMock, type FetchMock } from './helpers/fetchMock';
import { installIntersectionObserverMock } from '@/__tests__/helpers/intersectionObserver';
import { installResizeObserverMock } from '@/__tests__/helpers/resizeObserver';
import { getDefaultYear } from '@/lib/constants';

/**
 * The one case where starring MUST re-filter the year.
 *
 * `page.tsx` gates the favourites `Set` out of `filterOpts` while
 * favourites-only is off, because `useFavorites` hands back a new `Set` on
 * every star and that identity change alone was re-running `filterEvents`
 * and `groupEventsByDay` over 1,687 events — measured at 340ms of blocked
 * main thread per star, for an answer that could not change.
 *
 * It cannot change *while the gate is shut*. With favourites-only ON the
 * membership of the list is exactly the favourites set, so the same star
 * that was free a moment ago now decides what the reader can see. This file
 * is the guard on that half: gate on anything coarser than
 * `showFavoritesOnly` — memoise the ternary, key it on `favoriteCount`
 * (which is unchanged by a swap of one favourite for another), freeze it
 * once the panel is open — and a reader in favourites-only stops seeing
 * their own edits.
 *
 * Falsified before being trusted: with `favoriteIds` forced to `undefined`
 * unconditionally, `filterEvents` short-circuits to `[]` and the first case
 * below fails on the day sections never appearing; with the gate keyed on
 * `favoriteCount`, the last case fails with the emptied day still on screen.
 */

const YEAR = getDefaultYear();

/**
 * Two days, and the first has two events on it. The pair on July 6 is what
 * makes the last case an assertion about a DAY rather than about a card: the
 * section has to survive losing one favourite and disappear on losing the
 * other, which is a statement about `groupEventsByDay` having re-run.
 */
function eventsPayload() {
  return {
    data: [
      {
        id: 'e1',
        title: 'Morning Lecture',
        startDate: `${YEAR}-07-06T10:45:00`,
        endDate: `${YEAR}-07-06T11:45:00`,
        location: 'Amphitheater',
        description: 'A lecture.',
        categories: [{ name: 'Lecture' }],
      },
      {
        id: 'e2',
        title: 'Afternoon Reading',
        startDate: `${YEAR}-07-06T14:00:00`,
        endDate: `${YEAR}-07-06T15:00:00`,
        location: 'Hall of Philosophy',
        description: 'A reading.',
        categories: [{ name: 'Literary' }],
      },
      {
        id: 'e3',
        title: 'Evening Concert',
        startDate: `${YEAR}-07-07T20:15:00`,
        endDate: `${YEAR}-07-07T22:00:00`,
        location: 'Amphitheater',
        description: 'A concert.',
        categories: [{ name: 'Music' }],
      },
    ],
  };
}

let mock: FetchMock;

beforeEach(() => {
  localStorage.clear();
  // `useSelectedYear` writes the chosen year into the URL with
  // `history.replaceState`, and jsdom carries the URL across tests in a file.
  window.history.replaceState({}, '', '/');
  // Mid-season, so the list is on screen at all. Out of season `showLanding`
  // covers it with `OffSeasonLanding` and there are no day sections to assert
  // about — which is what this file did on the day it was written (Aug 27,
  // past the 2026 season's last week) before the clock was pinned.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(YEAR, 6, 6, 9, 0, 0));
  installIntersectionObserverMock();
  installResizeObserverMock();
  mock = installFetchMock({ allowUnhandled: true });
  mock.on('GET', /years\.json/, { years: [YEAR - 1, YEAR, YEAR + 1], defaultYear: YEAR, generated: '' });
  mock.on('GET', /all-events-\d{4}\.json/, eventsPayload());
  mock.on('GET', /weekly-themes/, { data: [] });
  mock.on('GET', /article-links-\d{4}\.json/, { data: [] });
  mock.on('GET', /program-links-\d{4}\.json/, { data: [] });
});

afterEach(() => {
  mock.uninstall();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

const daySections = () =>
  [...document.querySelectorAll('[data-day-key]')].map(el => el.getAttribute('data-day-key'));

/**
 * The star on the card whose title is `title`.
 *
 * Resolved through the card rather than by label alone: every unstarred card
 * carries an identical "Add to favorites" label, so a bare `getAllByLabelText`
 * index would silently follow the list's order instead of naming a target.
 */
function starOn(title: string): HTMLButtonElement {
  const card = screen.getByText(title).closest('[data-event-id]');
  if (!card) throw new Error(`no card for "${title}"`);
  const star = card.querySelector(
    'button[aria-label="Add to favorites"], button[aria-label="Remove from favorites"]'
  );
  if (!star) throw new Error(`no star on the card for "${title}"`);
  return star as HTMLButtonElement;
}

const favoritesOnlyToggle = () =>
  screen.getByLabelText(/^(Show favorites only|Stop showing favorites only)$/) as HTMLButtonElement;

async function renderPage() {
  render(<Home />);
  // The list, not merely the rail: the rail renders from the season calendar
  // whether the feed brought anything back or not, so waiting on it would
  // pass against an empty fixture.
  await waitFor(() => expect(daySections().length).toBe(2));
}

describe('page.tsx — favourites-only re-filters on every star', () => {
  it('requests the same season year the fixture is dated in', async () => {
    await renderPage();
    const asked = mock.calls(/all-events-\d{4}\.json/).map(r => r.url);
    expect(asked.some(u => u.includes(`all-events-${YEAR}.json`))).toBe(true);
  });

  it('shows only the starred events once favourites-only is on', async () => {
    await renderPage();

    // `fireEvent`, not `.click()`: preact batches, and a raw DOM click leaves
    // the re-render unflushed for the assertion that follows it.
    fireEvent.click(starOn('Morning Lecture'));
    fireEvent.click(starOn('Evening Concert'));
    fireEvent.click(favoritesOnlyToggle());

    await waitFor(() => expect(screen.queryByText('Afternoon Reading')).toBeNull());
    expect(screen.getByText('Morning Lecture')).toBeTruthy();
    expect(screen.getByText('Evening Concert')).toBeTruthy();
    expect(daySections()).toEqual([`${YEAR}-07-06`, `${YEAR}-07-07`]);
  });

  // There is deliberately no "starring ADDS a day" case here. Inside
  // favourites-only the only cards on screen are already favourites, so there
  // is no un-starred event to star: the add direction is unreachable from
  // this mode, and a test that reached for it would have to synthesise a
  // control the reader does not have. The un-star direction below is the one
  // a reader can actually take, and it exercises the same re-filter.
  it('drops the day when its last favourite is un-starred', async () => {
    await renderPage();

    fireEvent.click(starOn('Morning Lecture'));
    fireEvent.click(starOn('Afternoon Reading'));
    fireEvent.click(starOn('Evening Concert'));
    fireEvent.click(favoritesOnlyToggle());
    await waitFor(() => expect(daySections()).toEqual([`${YEAR}-07-06`, `${YEAR}-07-07`]));

    // One of July 6's two: the day must SURVIVE this.
    fireEvent.click(starOn('Morning Lecture'));
    await waitFor(() => expect(screen.queryByText('Morning Lecture')).toBeNull());
    expect(daySections()).toEqual([`${YEAR}-07-06`, `${YEAR}-07-07`]);

    // July 7's only one: the day must GO.
    fireEvent.click(starOn('Evening Concert'));
    await waitFor(() => expect(daySections()).toEqual([`${YEAR}-07-06`]));
    expect(screen.queryByText('Evening Concert')).toBeNull();
    expect(screen.getByText('Afternoon Reading')).toBeTruthy();
  });
});
