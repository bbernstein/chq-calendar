import { describe, expect, it, vi, afterEach } from 'vitest';
import { useCallback, useState } from 'react';
import { render, fireEvent } from '@testing-library/preact';
import { railTarget, reachableTodayKey } from '@/app/dayRailNavigation';
import { EventListView } from '@/components/calendar/EventListView';
import { useDayAnchor } from '@/hooks/useDayAnchor';
import { useFilterPanel } from '@/hooks/useFilterPanel';
import { DAY_SECTION_ATTR } from '@/lib/utils/daySections';
import { installIntersectionObserverMock } from '@/__tests__/helpers/intersectionObserver';
import { installResizeObserverMock } from '@/__tests__/helpers/resizeObserver';
import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { Event } from '@/lib/types';

describe('railTarget', () => {
  const bounds = { startDay: '2026-06-27', endDay: '2026-08-30' };

  // D1: a chip tap is a scroll. Every day inside the bounds is mounted, so
  // there is nothing to widen and nothing to wait for — the expansion plan
  // this used to return, and the `shouldAbandonScroll` guard that decided
  // whether a missing section meant "not yet" or "never", went with the view
  // window (#274 phase 4).
  it('returns the target when it is inside the navigable bounds', () => {
    expect(railTarget('2026-07-06', bounds)).toBe('2026-07-06');
  });

  it('keeps a target sitting exactly on either bound', () => {
    expect(railTarget('2026-06-27', bounds)).toBe('2026-06-27');
    expect(railTarget('2026-08-30', bounds)).toBe('2026-08-30');
  });

  // Such a day has no section and never will, so a "successful" tap would
  // scroll nowhere with no feedback.
  it('refuses a target outside the navigable bounds', () => {
    expect(railTarget('2026-12-25', bounds)).toBeNull();
    expect(railTarget('2026-01-05', bounds)).toBeNull();
  });
});

describe('reachableTodayKey', () => {
  const bounds = { startDay: '2026-06-27', endDay: '2026-08-30' };

  it('keeps today while it is inside the navigable bounds', () => {
    expect(reachableTodayKey('2026-07-06', bounds)).toBe('2026-07-06');
  });

  // For roughly ten months of the year today is outside the season, so
  // `railTarget` refuses it — a non-null key there renders a visible,
  // enabled `⟳ Now` that does nothing when pressed, with no feedback.
  it('drops an off-season today, so ⟳ Now is absent rather than inert', () => {
    expect(reachableTodayKey('2026-02-14', bounds)).toBeNull();
    expect(reachableTodayKey('2026-11-30', bounds)).toBeNull();
  });

  it('stays null on an archived year', () => {
    expect(reachableTodayKey(null, bounds)).toBeNull();
  });

  it('keeps a today sitting exactly on either bound', () => {
    expect(reachableTodayKey('2026-06-27', bounds)).toBe('2026-06-27');
    expect(reachableTodayKey('2026-08-30', bounds)).toBe('2026-08-30');
  });
});

function group(key: string, count: number): DayGroup {
  const events = Array.from({ length: count }, (_, i) => ({
    id: `${key}-${i}`,
    title: `Event ${key}-${i}`,
    startDate: new Date(`${key}T12:00:00`).toISOString(),
    endDate: new Date(`${key}T13:00:00`).toISOString(),
  } as Event));
  return { key, baseLabel: `Day ${key}`, weekNumbers: [], events };
}

// 12 days and 5 events/day: no longer load-bearing for "is the target
// mounted yet" (#274 phase 4 deleted the render window that question used to
// be about — every day mounts in the same commit now, regardless of count),
// but kept as the shared shape the tests below were built against: the
// fixture's navigation target is day 12, the last of these, and ~60
// `EventCard`s is the size the file's timeout comments already account for.
function makeGroups(keys: string[]): DayGroup[] {
  return keys.map(k => group(k, 5));
}

const noop = () => {};
const eventListBaseProps = {
  expandedDescriptions: new Set<string>(),
  onToggleDescription: noop,
  onToggleTag: noop,
  isTagSelected: () => false,
  favoriteIds: new Set<string>(),
  onToggleFavorite: noop,
};

/**
 * Reproduces the wiring `goToDay -> scrollToDay` depends on in `page.tsx`: a
 * real list of day sections under a real `useDayAnchor` (whose `scrollToDay`
 * reads the DOM), navigated through the same `railTarget` bounds check.
 * Rendering the actual `page.tsx`/`HomeContent` would require mocking event
 * data, season weeks, favourites, article/program links and every route it
 * also imports — none of which this wiring depends on.
 *
 * `groupedEvents` is local state rather than a plain passthrough prop so a
 * test can still change the list under the hook if it needs to.
 *
 * `withFilterPanel`, when given, also mounts the real `useFilterPanel` —
 * toggle button and panel `<div>`, wired exactly like the minimal Harness in
 * `useFilterPanel.test.tsx` — for the dismissal-vs-navigation composition
 * test below, which needs a real gesture-dismiss listener (attached only
 * while the panel is `open`) alongside the real day-chip navigation.
 */
function Harness({ groupedEvents: initialGroups, withFilterPanel }: {
  groupedEvents: DayGroup[]; withFilterPanel?: boolean;
}) {
  const [groupedEvents] = useState(initialGroups);
  // No argument: the panel is a fixed overlay in every state now (#274 phase
  // 3), so there is no "has the reader scrolled past the card yet" question
  // for the hook to answer.
  const filterPanel = useFilterPanel();
  const dayKeysList = groupedEvents.map(g => g.key);
  const bounds = { startDay: dayKeysList[0], endDay: dayKeysList[dayKeysList.length - 1] };
  const { scrollToDay } = useDayAnchor(dayKeysList);

  const goToDay = useCallback((target: string) => {
    if (railTarget(target, bounds)) scrollToDay(target);
  }, [bounds.startDay, bounds.endDay, scrollToDay]);

  return (
    <div>
      {withFilterPanel && (
        <button ref={filterPanel.toggleRef} type="button" onClick={filterPanel.toggle}
          aria-expanded={filterPanel.open} aria-controls={filterPanel.panelId}>
          Filters
        </button>
      )}
      {withFilterPanel && (
        <div id={filterPanel.panelId} ref={filterPanel.panelRef} className={filterPanel.open ? '' : 'hidden'}>
          <input aria-label="Search" />
        </div>
      )}
      <button type="button" onClick={() => goToDay('2026-07-12')}>Go</button>
      <div className="space-y-4 sm:space-y-6">
        <EventListView {...eventListBaseProps} groups={groupedEvents} />
      </div>
    </div>
  );
}

describe('goToDay -> scrollToDay chain', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty('--day-rail-h');
  });

  // Explicit timeout: this is an integration test rendering a real
  // `EventListView` + `useDayAnchor` through ~60 `EventCard`s (12 days x 5
  // events — see the fixture note on `makeGroups` above). Locally on Node 24
  // it runs in well under a second, but the default 5s budget is tight on a
  // loaded, 2-core CI runner running with coverage instrumentation and
  // parallel workers, which is exactly what timed this test out before the
  // fixture was shrunk.
  it('scrolls to the target day, mounted in the same commit as every other day the window produced', { timeout: 15000 }, () => {
    installIntersectionObserverMock();
    // useDayAnchor's settle effect constructs a ResizeObserver on every
    // mount now, whether or not this test ever triggers a resize.
    installResizeObserverMock();
    // jsdom reports 0 for every element's top, so a real (nonzero) sticky
    // offset is what makes the scrollBy assertion below distinguishable
    // from "delta happened to be 0" rather than "scrollToDay never ran".
    document.documentElement.style.setProperty('--day-rail-h', '50px');
    const keys = Array.from({ length: 12 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);

    const { getByRole, container } = render(<Harness groupedEvents={makeGroups(keys)} />);
    // #274 phase 4 deleted the render window: day 12's section is already
    // mounted here, on the very first render, along with every other day —
    // there is no separate window left for a click to grow.
    expect(container.querySelector(`[${DAY_SECTION_ATTR}="2026-07-12"]`)).not.toBeNull();

    fireEvent.click(getByRole('button', { name: 'Go' }));

    // scrollToDay still ran against it: top(0, jsdom's default) -
    // stickyOffset(50) = -50.
    expect(scrollBy).toHaveBeenCalledWith(0, -50);
  });
});

// The `describe('cancelHold: ...')` block that used to sit here is gone with
// its subject. It pinned an arbitration between `EventList`'s own
// upward-prepend settle hold and `useDayAnchor`'s; #274 phase 4 deleted the
// first half with the render window, and then deleted `cancelHold` itself
// along with `showEarlier`, `expandWindowStart`/`expandWindowEnd` and the
// view window — every path that could insert a day above the reader. There is
// no prepend left for a hold to fight.

describe('composition: a day-chip tap dismisses the panel and still navigates', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty('--day-rail-h');
  });

  // A chip tap dismisses the panel AND navigates. Only ONE of them corrects
  // scroll now, and that is the point of the test.
  //
  // Until #274 phase 3 both did: the panel was in-flow content, so closing it
  // removed real height above the reader and `useFilterPanel` corrected for
  // it, racing `useDayAnchor`'s own correction on the same tap. Two
  // mechanisms calling `scrollBy` on one interaction is the exact bug shape
  // that cost the preceding branch a review round (see the two tests above),
  // so the composition was pinned as "both, once each, dismissal first".
  //
  // The panel is a fixed overlay now, so closing it changes no layout and it
  // corrects nothing. The race is gone by construction rather than by
  // ordering, and this test is what says so: the dismissal must contribute NO
  // `scrollBy`, and the navigation must still contribute exactly its own.
  //
  // The day section is still rigged to "move" with the panel's open/hidden
  // class — the drift a real Chromium build measured back when the panel was
  // in flow. That is deliberate and adversarial: it is the input under which
  // the old code demonstrably corrected, so a correction re-added anywhere in
  // this composition shows up here as an extra entry rather than as nothing.
  //
  // Explicit timeout: same integration-test cost as the three tests above
  // (~60 EventCards from a real EventListView + useDayAnchor render), plus a
  // real `useFilterPanel` with its own effects and a window-level gesture
  // listener — at least as expensive as the tests that already carry this
  // guard. Comfortably under a second locally on Node 24, but that is not
  // the evidence that matters: a loaded, 2-core CI runner with coverage
  // instrumentation is what timed a test in this file out before its
  // fixture was shrunk, and this test renders the identical fixture.
  it('dismisses without correcting scroll, and still navigates', { timeout: 15000 }, () => {
    installIntersectionObserverMock();
    installResizeObserverMock();
    document.documentElement.style.setProperty('--day-rail-h', '50px');
    const keys = Array.from({ length: 12 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);

    // Two independent, distinguishable corrections share one global
    // `scrollBy` — label each call by its delta rather than by call site, so
    // the assertion below is about order, not merely that both happened.
    // -50 is the day-navigation delta this file already establishes
    // elsewhere (top(0, jsdom's default) - stickyOffset(50)); anything else
    // is the panel's own correction.
    const order: string[] = [];
    const scrollBy = vi.fn((_x: number, dy: number) => {
      order.push(dy === -50 ? 'navigate' : 'dismiss');
    });
    vi.stubGlobal('scrollBy', scrollBy);

    const { getByRole, container } = render(
      <Harness groupedEvents={makeGroups(keys)} withFilterPanel />
    );
    // #274 phase 4 deleted the render window: day 12's section is already
    // mounted on the very first render, along with every other day.
    expect(container.querySelector(`[${DAY_SECTION_ATTR}="2026-07-12"]`)).not.toBeNull();

    // Arrange: the panel is open. Opening it must already correct nothing.
    const toggle = getByRole('button', { name: 'Filters' });
    fireEvent.click(toggle);
    expect(order).toEqual([]);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    // Track 2026-07-01 (the topmost mounted day section) against the panel's
    // own open/hidden class, the same way `useFilterPanel.test.tsx` does —
    // the Chromium-measured drift an in-flow panel used to produce. It is
    // what a re-added correction would fire on, and it is nonzero and
    // distinguishable from the navigation's own -50.
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    document.querySelector<HTMLElement>(`[${DAY_SECTION_ATTR}="2026-07-01"]`)!
      .getBoundingClientRect = () => ({ top: panel.classList.contains('hidden') ? 236 : 517 }) as DOMRect;

    // Act: tap the chip. A real tap is two separate DOM events, mousedown
    // then click — not one — and the gesture hook listens only for the
    // former. Firing them as two separate `fireEvent` calls is what makes
    // this a genuine two-correction race rather than an artifact of test
    // wiring: each is a real, independently-committed interaction, exactly
    // as a browser dispatches them.
    const chip = getByRole('button', { name: 'Go' });
    fireEvent.mouseDown(chip);
    fireEvent.click(chip);

    // The panel closed, the list navigated, and the ONLY scroll correction
    // was the navigation's. A 'dismiss' entry here means something is
    // correcting for a height change that no longer happens.
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(order).toEqual(['navigate']);
  });
});
