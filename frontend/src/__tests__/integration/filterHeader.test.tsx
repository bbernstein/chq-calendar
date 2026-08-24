import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Home from '@/app/page';
import { installFetchMock, type FetchMock } from './helpers/fetchMock';
import { installIntersectionObserverMock } from '@/__tests__/helpers/intersectionObserver';
import { installResizeObserverMock } from '@/__tests__/helpers/resizeObserver';
import { getDefaultYear } from '@/lib/constants';

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
 * of: that the card is never taken out of flow, that the header parks by a
 * negative offset instead, that the sentinel sits below the header, and that
 * the card is `inert` exactly when it is out of reach. Those are the pieces a
 * refactor would have to break to bring the bug back, and until now a
 * refactor could break every one of them with the suite still green.
 *
 * The browser harnesses remain the only thing that can see the bug itself.
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
let io: ReturnType<typeof installIntersectionObserverMock>;
let ro: ReturnType<typeof installResizeObserverMock>;

beforeEach(() => {
  localStorage.clear();
  io = installIntersectionObserverMock();
  ro = installResizeObserverMock();
  mock = installFetchMock({ allowUnhandled: true });
  mock.on('GET', /all-events-\d{4}\.json/, eventsPayload());
});

afterEach(() => {
  mock.uninstall();
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** The sticky container holding the filter card and the rail. */
const header = () => document.querySelector('[data-filter-header]') as HTMLElement;

/**
 * The filter card, found the way the accessibility tree finds it — the
 * element the Filters toggle names. When the toggle is not rendered yet
 * (top of the page), fall back to the card that owns the search field.
 */
function card(): HTMLElement {
  const toggle = document.querySelector('[data-day-rail] button[aria-expanded]');
  const id = toggle?.getAttribute('aria-controls');
  if (id) return document.getElementById(id) as HTMLElement;
  return header().querySelector('div[id]') as HTMLElement;
}

/** The zero-height sentinel that drives the "scrolled past" signal. */
const sentinel = () =>
  document.querySelector('main > div[aria-hidden="true"]') as HTMLElement;

const toggleButton = () =>
  document.querySelector('[data-day-rail] button[aria-expanded]') as HTMLButtonElement | null;

async function renderPage() {
  render(<Home />);
  // Waits for the first commit that has the header in it. Deliberately NOT
  // described as "once events have loaded" any more, which is what it used to
  // say and was never true: the rail is built from the season's navigable
  // bounds, so it renders whether the feed brought anything back or not. That
  // wording is part of why an empty fixture went unnoticed here for so long.
  await waitFor(() => expect(document.querySelector('[data-day-rail]')).toBeTruthy());
}

/** Put the reader past the header: the card has left, and so has the rail. */
function scrollPastHeader() {
  io.triggerFor(card(), false);
  io.triggerFor(sentinel(), false);
}

describe('page.tsx — the sticky filter header', () => {
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
  // `useEventData` derives categories via `event.categories.map(c => c.name)`.
  // A fixture using a bare string array yields `undefined`, `normalizeTag`
  // then calls `.toLowerCase()` on it, and the whole parse throws into a
  // `catch` that only logs — so `events` stays empty and the page renders as
  // though the feed were down. Every other assertion in this file still
  // passed, because they are all about header geometry, which renders with or
  // without events. This file spent its life exercising a page that had none.
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

  it('renders the filter card in flow at the top of the page, with no toggle', async () => {
    await renderPage();

    expect(card()).toBeInTheDocument();
    expect(screen.getByLabelText('Search events')).toBeVisible();
    // No toggle at the top: the controls are already there.
    expect(toggleButton()).toBeNull();
  });

  // The bug, stated as a rule. `display: none` on the card is what removed
  // ~290px of flow height above the reader and started the loop.
  it('never removes the filter card from flow, in any scroll state', async () => {
    await renderPage();
    const notInFlow = () => {
      const el = card();
      return el.classList.contains('hidden') || el.style.display === 'none';
    };

    expect(notInFlow()).toBe(false);

    scrollPastHeader();
    expect(notInFlow()).toBe(false);

    fireEvent.click(toggleButton()!);
    expect(notInFlow()).toBe(false);
  });

  // The card leaves by riding up on the header's negative offset instead.
  it('parks the header by the measured card offset when the panel is not overlaying', async () => {
    await renderPage();

    expect(header().style.top).toBe('calc(-1 * var(--filter-card-h, 0px))');

    scrollPastHeader();
    expect(header().style.top).toBe('calc(-1 * var(--filter-card-h, 0px))');
  });

  it('pins the header at the viewport top while the panel is open over the list', async () => {
    await renderPage();
    scrollPastHeader();

    fireEvent.click(toggleButton()!);

    expect(header().style.top).toBe('0px');
  });

  // Below, not above. Above the header the sentinel stops moving with the
  // height the exit animation temporarily removes, and the signal flips
  // underneath its own animation.
  it('places the scroll sentinel after the sticky header, not before it', async () => {
    await renderPage();

    const position = header().compareDocumentPosition(sentinel());

    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // A parked card is still in flow and still focusable. Without `inert` a
  // keyboard reader Tabs into it, and the browser cannot scroll a pinned
  // sticky element into view — it chases the position instead.
  it('makes the parked card inert and hidden from screen readers', async () => {
    await renderPage();
    expect(card().hasAttribute('inert')).toBe(false);

    scrollPastHeader();

    expect(card().hasAttribute('inert')).toBe(true);
    expect(card().getAttribute('aria-hidden')).toBe('true');
  });

  // Driven by the card's own visibility, not by the sentinel below the whole
  // header — which reports the card gone a rail-height after it went.
  it('keeps the card reachable while it is still partly on screen', async () => {
    await renderPage();

    // The reader has scrolled past the header's foot, but the card itself is
    // still intersecting the viewport.
    io.triggerFor(sentinel(), false);
    io.triggerFor(card(), true);

    expect(card().hasAttribute('inert')).toBe(false);
  });

  it('makes the card reachable again when the panel is opened', async () => {
    await renderPage();
    scrollPastHeader();
    expect(card().hasAttribute('inert')).toBe(true);

    fireEvent.click(toggleButton()!);

    expect(card().hasAttribute('inert')).toBe(false);
    expect(card().getAttribute('aria-hidden')).toBeNull();
  });

  // WHERE the height observer is attached is the fix, not just what it
  // measures. `--filter-card-h` must re-publish when the card's margin
  // changes at a breakpoint, and `ResizeObserver` never reports a margin —
  // so an observer on the card would never fire and the rail would park off
  // the viewport's top edge. The container's height is card + margin + rail,
  // so it changes whenever any of them does.
  it('observes the header container for the park offset, not the card', async () => {
    await renderPage();

    expect(ro.isObserving(header())).toBe(true);
    expect(ro.isObserving(card())).toBe(false);
  });

  it('shows the Filters toggle only once the reader has scrolled past the header', async () => {
    await renderPage();
    expect(toggleButton()).toBeNull();

    scrollPastHeader();

    const toggle = toggleButton();
    expect(toggle).toBeTruthy();
    expect(toggle!.getAttribute('aria-label')).toBe('Filters');
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
    expect(toggle!.getAttribute('aria-controls')).toBe(card().id);
  });
});
