import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Home from '@/app/page';
import { installFetchMock, type FetchMock } from './helpers/fetchMock';
import { installIntersectionObserverMock } from '@/__tests__/helpers/intersectionObserver';
import { installResizeObserverMock } from '@/__tests__/helpers/resizeObserver';
import { getDefaultYear } from '@/lib/constants';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import { weekDayKeySpans, weekBandDestinations } from '@/lib/utils/weekBands';
import { addDays, dayKeyOf } from '@/lib/utils/dayWindow';
import { chqDateAt } from '@/lib/utils/chqTime';

/**
 * The first test that renders `page.tsx`.
 *
 * Every rule this file pins was previously enforced by nothing. The panel's
 * hooks were thoroughly tested in isolation and the composition was not, so
 * `page.tsx` shipped a defect that made the site nearly unusable in Chrome:
 * the filter card was removed from flow on scroll, which changed document
 * height above the reader, which scroll anchoring undid, which put the card
 * back — a loop that pinned the page to the top. 954 unit tests and every CI
 * check passed throughout.
 *
 * jsdom cannot reproduce that loop (no layout, no scroll anchoring), and no
 * jsdom test ever will. What it CAN pin is the composition the loop was made
 * of.
 *
 * #274 phase 3 changed what that composition is. The card used to be in-flow
 * content parked above the viewport on a negative sticky offset, with a
 * sentinel to notice it had gone and an `inert` treatment for the window in
 * which it was pinned out of sight and still Tab-reachable. It is now a
 * `position: fixed` overlay that is never in flow in any state, so all of that
 * is deleted and what remains to pin is the invariant itself: **the panel is
 * fixed whether it is open, closed or exiting, and the page carries no in-flow
 * filter card at all.** That is the single property a refactor would have to
 * break to bring the bug back.
 *
 * The browser harnesses remain the only thing that can see the bug itself —
 * `verify-filter-reveal` asserts document height is identical with the panel
 * open and closed, which is this invariant stated in the one place it can
 * actually be measured.
 */

// The year the PAGE will ask for, not the year it happens to be. The app's
// season turns over on October 1 (`getDefaultYear`), so from Oct 1 onward it
// requests next year's events — and a fixture dated with
// `new Date().getFullYear()` would then be a year adrift from the events the
// page is looking for, silently widening the navigable window across a
// year-long gap. Deriving it from the same function the app uses keeps this
// test saying the same thing on every day of the year.
const YEAR = getDefaultYear();

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
        // `Array<{ name: string }>`, per `Event` in lib/types — NOT a bare
        // string array. See the parse guard below for what that costs.
        categories: [{ name: 'Lecture' }],
      },
      {
        id: 'e2',
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
  // Installed for their side effect — stubbing the globals `page.tsx` and its
  // hooks construct on mount — and no longer captured. The handles existed to
  // drive the sentinel's IntersectionObserver and to assert WHICH element the
  // park offset observed; both went with the in-flow filter card (#274 phase
  // 3). Nothing here now needs to trigger an observation by hand.
  installIntersectionObserverMock();
  installResizeObserverMock();
  mock = installFetchMock({ allowUnhandled: true });
  mock.on('GET', /all-events-\d{4}\.json/, eventsPayload());
});

afterEach(() => {
  mock.uninstall();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

/**
 * The filter panel, found the way the accessibility tree finds it — the
 * element the header's Filters toggle names.
 *
 * That element is also the `position: fixed` one, deliberately: an earlier
 * shape put the positioning on an outer wrapper and left the card inside it
 * `static`, so this query read `static` and the invariant was invisible to
 * every check that resolved the panel by `aria-controls`.
 *
 * `[aria-label="Filters"]` is load-bearing, not decorative: `[aria-expanded]`
 * alone also matches the day rail's week-chooser trigger and the header's own
 * link menus. Phase 2 shipped that exact collision into two e2e suites; the
 * same lesson applies to every query for "the" control of a given ARIA shape.
 */
function card(): HTMLElement {
  const id = toggleButton()!.getAttribute('aria-controls')!;
  return document.getElementById(id) as HTMLElement;
}

/** The same element, named for the property being asserted about it. */
const overlay = card;

/**
 * The Filters funnel — in the SITE HEADER now, not on the day rail, and
 * present from the first paint rather than only once the reader has scrolled.
 */
const toggleButton = () =>
  document.querySelector('[data-site-header] button[aria-label="Filters"]') as HTMLButtonElement | null;

/** The day rail's own root, which is the sticky element now. */
const rail = () => document.querySelector('[data-day-rail]') as HTMLElement;

async function renderPage() {
  render(<Home />);
  // Waits for the first commit that has the rail in it. Deliberately NOT
  // described as "once events have loaded" any more, which is what it used to
  // say and was never true: the rail is built from the season's navigable
  // bounds, so it renders whether the feed brought anything back or not. That
  // wording is part of why an empty fixture went unnoticed here for so long.
  await waitFor(() => expect(document.querySelector('[data-day-rail]')).toBeTruthy());
}

describe('page.tsx — the filter panel as a fixed overlay', () => {
  // Guards the fixture against the app's October 1 season turnover directly,
  // rather than trusting both sides to call `getDefaultYear` forever. If the
  // page ever asks for a year these events are not dated in, the window this
  // file reasons about silently changes shape — so assert the coupling
  // instead of assuming it.
  it('requests the same season year the fixture is dated in', async () => {
    await renderPage();

    const requested = mock.calls(/all-events-/).map(r => new URL(r.url).pathname);

    expect(requested.length).toBeGreaterThan(0);
    expect(requested.every(p => p.endsWith(`all-events-${YEAR}.json`))).toBe(true);
  });

  // Asking for the right file is not the same as the app being able to read
  // it, and the difference is invisible from everything else in this suite.
  //
  // A fixture using a bare string array for `categories` throws before the
  // fetch result is ever stored. `useEventData` maps every raw event through
  // `decodeEventHtmlEntities` first (`useEventData.ts`, before `setEvents`),
  // and that reads `cat.name` — `undefined` on a string — then calls
  // `.toLowerCase()` on it while building `_tagsLowerSet`
  // (`eventHelpers.ts:63`, confirmed as the throw site by stack frame, not by
  // reading). The outer `catch` only logs, so `events` stays empty and the
  // page renders as though the feed were down.
  //
  // Every other assertion in this file still passed throughout, because they
  // are all about header geometry, which renders with or without events. This
  // file spent its life exercising a page that had none.
  //
  // The count comes from `ActiveFilters`, so it is the app's own reading of
  // how many events it holds. The denominator is pinned and the numerator is
  // not: the fixture is dated mid-season, so how many fall inside the default
  // scope depends on when the suite runs, but how many were LOADED does not.
  it('parses the fixture into the page, rather than silently loading none', async () => {
    await renderPage();

    await waitFor(() =>
      expect(screen.getByText(/^Events \(\d+\/2\)$/)).toBeInTheDocument()
    );
  });

  // THE invariant. Stated as a rule, in every state the panel has.
  //
  // The bug was `display: none` on an IN-FLOW card, which removed ~290px of
  // flow height above the reader and started the loop. A fixed element
  // contributes nothing to document height in any state, so hiding it is free
  // — the fix is not "never hide it", it is "never let it be in flow", and
  // this is what says so.
  it('is position:fixed whether closed, open, or exiting', async () => {
    await renderPage();

    // Closed.
    expect(overlay().className).toMatch(/\bfixed\b/);

    // Open.
    fireEvent.click(toggleButton()!);
    expect(overlay().className).toMatch(/\bfixed\b/);

    // Exiting — the panel is still mounted and painted while its transition
    // runs, which is the state the old code needed a frozen rect to survive.
    fireEvent.click(toggleButton()!);
    expect(overlay().className).toMatch(/\bfixed\b/);
  });

  // The corollary, and the thing an eye would notice: at the top of the page
  // there is no filter card. Search lives behind the funnel everywhere now,
  // which is the accepted cost of giving the list its space back.
  it('shows no filter card at the top of the page', async () => {
    await renderPage();

    expect(overlay().hasAttribute('hidden')).toBe(true);
    // In the DOM but not shown. `queryByLabelText` finds hidden nodes — it
    // does not filter on visibility — so asserting it is null would fail
    // against correct code and tempt the next reader to weaken it. `hidden`
    // on an ancestor is what `toBeVisible` walks the tree for.
    expect(screen.getByLabelText('Search events')).not.toBeVisible();
  });

  // And there is no sticky container wrapping a card and the rail together.
  // That element existed only to park the card; the rail is its own sticky
  // element now.
  it('has no in-flow filter header container at all', async () => {
    await renderPage();

    expect(document.querySelector('[data-filter-header]')).toBeNull();
  });

  // The funnel is in the header and is present immediately — no scrolling
  // required, because there is no in-flow card it would be redundant with.
  // Reachability from deep in the list comes from the header itself, which
  // returns on any upward flick (#272).
  it('offers the Filters funnel from the first paint, in the site header', async () => {
    await renderPage();

    const toggle = toggleButton();
    expect(toggle).toBeTruthy();
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-day-rail] button[aria-label="Filters"]')).toBeNull();
  });

  it('opens the panel, with the search field in it, when the funnel is pressed', async () => {
    await renderPage();

    fireEvent.click(toggleButton()!);

    expect(toggleButton()!.getAttribute('aria-expanded')).toBe('true');
    expect(overlay().hasAttribute('hidden')).toBe(false);
    expect(screen.getByLabelText('Search events')).toBeVisible();
    expect(toggleButton()!.getAttribute('aria-controls')).toBe(card().id);
  });

  // Closed is `display: none`, which takes the panel out of the tab order and
  // the accessibility tree for free. The `inert` treatment the parked card
  // needed is gone with the parking — and this is only safe BECAUSE the panel
  // was never in flow.
  it('needs no inert treatment while closed, because hiding it is free', async () => {
    await renderPage();

    expect(overlay().hasAttribute('hidden')).toBe(true);
    expect(card().hasAttribute('inert')).toBe(false);
  });

  // Mid-exit it is a decorative echo of a panel that has already closed:
  // visible for the ~200ms the transition runs, and beyond reach for all of
  // it. `inert` rather than `aria-hidden` alone, because `aria-hidden` leaves
  // a very real SearchBar in the tab order.
  it('puts the exiting panel beyond reach while its transition runs', async () => {
    await renderPage();
    fireEvent.click(toggleButton()!);
    expect(card().hasAttribute('inert')).toBe(false);

    fireEvent.click(toggleButton()!);

    expect(card().hasAttribute('inert')).toBe(true);
    expect(card().getAttribute('aria-hidden')).toBe('true');
  });

  // The panel hangs off the site header's bottom edge, and the rail sticks at
  // the same line — one expression, from one module, so they cannot be edited
  // apart and leave the panel floating away from the header it belongs to.
  it('hangs the panel and sticks the rail at the same line below the header', async () => {
    await renderPage();

    expect(overlay().style.top).toBe('var(--site-header-offset, 0px)');
    expect(rail().style.top).toBe('var(--site-header-offset, 0px)');
  });

  // #238: `position: sticky` is bounded by its element's containing block. A
  // wrapper `<div>` sized to fit only the rail BECOMES that containing block
  // and gives sticky zero travel — eleven green task reviews missed it once
  // already, and the wrapper that used to be here is exactly what this phase
  // deleted.
  it('sticks the rail on its own root, directly inside main', async () => {
    await renderPage();

    expect(rail().className).toMatch(/\bsticky\b/);
    expect(rail().parentElement?.tagName).toBe('MAIN');
  });
});

describe('page.tsx — a week band tap', () => {
  // `[data-chip][aria-current]` — the obvious thing to assert here — is not
  // usable as the "landed on the right day" signal: `useDayAnchor` derives it
  // from scroll position via `getBoundingClientRect`, which jsdom stubs to an
  // identical zero rect for every mounted section, so it always resolves to
  // the LAST section in the window regardless of which day was tapped.
  //
  // Instead this fixture puts one event a full week before the band's
  // destination and asserts its section is NOT pulled into the window by the
  // tap. `goToDay` only ever grows the window's edge to the exact target it is
  // given (`railTarget`), so a wire that passed the wrong day — e.g. the
  // rail's very first day, as step 6's falsification injects — would grow the
  // window past the earlier event too and this assertion would catch it.
  // Asserting only that *something* changed would not: an over-wide
  // expansion still contains the correct destination as a subset.
  it("expands the window to that week's destination day, and no further", async () => {
    const seasonWeeks = getChautauquaSeasonWeeks(YEAR);
    const spans = weekDayKeySpans(seasonWeeks);
    // Two days inside their weeks, not on a shared boundary Saturday — same
    // rule `weekBandSegments` uses to keep a tap unambiguous.
    const week1Day = addDays(spans[0].opening, 2);
    const week2Day = addDays(spans[1].opening, 2);
    // Week 8, well after the Aug 1 pin below and still inside the season —
    // exists ONLY so the year has an upcoming event at "now" (#274 phase 4
    // task 3, review round 2: `determineLandingState`'s rule 1 sends a
    // reader with no upcoming events to the off-season landing regardless of
    // the calendar, and with only the two past week1/week2 events this
    // fixture would otherwise land there instead of on the list this test
    // means to exercise). Its own day is never asserted on below.
    const laterDay = addDays(spans[7].opening, 2);

    mock.reset();
    mock.on('GET', /all-events-\d{4}\.json/, {
      data: [
        {
          id: 'w1', title: 'Week 1 Talk',
          startDate: `${week1Day}T10:00:00`, endDate: `${week1Day}T11:00:00`,
          location: 'Amphitheater', description: '', categories: [{ name: 'Lecture' }],
        },
        {
          id: 'w2', title: 'Week 2 Talk',
          startDate: `${week2Day}T10:00:00`, endDate: `${week2Day}T11:00:00`,
          location: 'Amphitheater', description: '', categories: [{ name: 'Lecture' }],
        },
        {
          id: 'w8', title: 'Week 8 Talk',
          startDate: `${laterDay}T10:00:00`, endDate: `${laterDay}T11:00:00`,
          location: 'Amphitheater', description: '', categories: [{ name: 'Lecture' }],
        },
      ],
    });

    // Read from the pure model rather than assumed: the same function
    // `page.tsx` itself calls — but not fed the same inputs page.tsx would
    // actually compute for this fixture. The real page also has the week 8
    // event added for #274 phase 4 task 3 (review round 2's landing fix, so
    // the year always has something upcoming at the pinned "now" below), so
    // its own `eventDays`/`countsByDay` carry a third entry this call omits.
    // Passing only the two days under test isolates week 2's destination
    // from that unrelated event without changing the answer for week 2
    // itself. All three fixture events fall inside the season regardless, so
    // `navigableBounds` would not widen past it here either way.
    const bounds = {
      startDay: dayKeyOf(seasonWeeks[0].start),
      endDay: dayKeyOf(seasonWeeks[seasonWeeks.length - 1].end),
    };
    const expected = weekBandDestinations({
      seasonWeeks,
      eventDays: [week1Day, week2Day],
      bounds,
      countsByDay: new Map([[week1Day, 1], [week2Day, 1]]),
    }).get(2);
    expect(expected?.dayKey).toBe(week2Day);

    // Pinned so the assertions hold regardless of which real-world day this
    // suite happens to run on — the "next" scope's own window otherwise
    // depends on it. Set after computing the fixture's days above, which are
    // real-time-independent by construction.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(chqDateAt(YEAR, 8, 1, 10));

    await renderPage();
    await waitFor(() => expect(screen.getByText(/^Events \(\d+\/3\)$/)).toBeInTheDocument());

    expect(document.querySelector(`[data-day-key="${week2Day}"]`)).toBeNull();
    expect(document.querySelector(`[data-day-key="${week1Day}"]`)).toBeNull();

    const band = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-week-band-button="2"]');
      expect(el?.getAttribute('aria-disabled')).toBeNull();
      return el!;
    });

    fireEvent.click(band);

    await waitFor(() =>
      expect(document.querySelector(`[data-day-key="${week2Day}"]`)).toBeInTheDocument()
    );
    // The window must not have grown any further back than week 2's own
    // destination — in particular not all the way to the rail's very first
    // day, a full week earlier, where the week 1 event lives.
    expect(document.querySelector(`[data-day-key="${week1Day}"]`)).toBeNull();
  });
});
