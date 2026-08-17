import { describe, expect, it, vi, afterEach } from 'vitest';
import { useCallback, useEffect, useState } from 'react';
import { render, fireEvent } from '@testing-library/preact';
import { railTarget, reachableTodayKey, shouldAbandonScroll, stepTargets } from '@/app/dayRailNavigation';
import { EventList } from '@/components/calendar/EventList';
import { useDayAnchor } from '@/hooks/useDayAnchor';
import { useFilterPanel } from '@/hooks/useFilterPanel';
import { daySectionElement, DAY_SECTION_ATTR } from '@/lib/utils/daySections';
import { installIntersectionObserverMock } from '@/__tests__/helpers/intersectionObserver';
import { installResizeObserverMock } from '@/__tests__/helpers/resizeObserver';
import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { Event } from '@/lib/types';

describe('railTarget', () => {
  const bounds = { startDay: '2026-06-27', endDay: '2026-08-30' };

  it('expands the start when the target is before the window', () => {
    expect(railTarget({ target: '2026-07-01', window: { startDay: '2026-07-04', endDay: '2026-07-09' }, bounds }))
      .toEqual({ expandStart: '2026-07-01', expandEnd: null, scrollTo: '2026-07-01' });
  });

  it('expands the end when the target is after the window', () => {
    expect(railTarget({ target: '2026-07-20', window: { startDay: '2026-07-04', endDay: '2026-07-09' }, bounds }))
      .toEqual({ expandStart: null, expandEnd: '2026-07-20', scrollTo: '2026-07-20' });
  });

  // D1: stepping scrolls if it can, and widens only if it must. A target
  // already inside the window is a scroll and nothing else — dispatching an
  // expansion for it would refilter the whole list for no reason and, worse,
  // mark the window "expanded" so the date chip starts naming a range the
  // reader never asked for.
  it('only scrolls when the target is already inside the window', () => {
    expect(railTarget({ target: '2026-07-06', window: { startDay: '2026-07-04', endDay: '2026-07-09' }, bounds }))
      .toEqual({ expandStart: null, expandEnd: null, scrollTo: '2026-07-06' });
  });

  it('refuses a target outside the navigable bounds', () => {
    expect(railTarget({ target: '2026-12-25', window: { startDay: '2026-07-04', endDay: '2026-07-09' }, bounds }))
      .toBeNull();
  });

  // Reachable for 'this-week' outside the season (a value this branch keeps
  // working from persisted localStorage), where the scope matches nothing at
  // all. The plan this used to return was inert by composition: `viewWindow`
  // returns null from `baseWindow` before it ever reads the expansion inputs,
  // so both expansions widened nothing, no section could mount, and the
  // pending scroll was left waiting on a day that could never appear.
  it('refuses a tap in a scope that matches nothing rather than planning an inert expansion', () => {
    expect(railTarget({ target: '2026-07-06', window: null, bounds })).toBeNull();
  });
});

describe('shouldAbandonScroll', () => {
  const w = { startDay: '2026-07-04', endDay: '2026-07-09' };

  // The bug this replaces: the guard read `dateWindow && covered`, which is
  // `null` — falsy — when there is no window, so nothing cleared and the
  // pending target survived every later commit. A scope change would then
  // re-run the effect and scroll the reader to a day they tapped under a
  // different scope.
  it('abandons a target when the scope matches nothing at all', () => {
    expect(shouldAbandonScroll('2026-07-06', null)).toBe(true);
  });

  it('abandons a target the window already covers — the day simply has no events', () => {
    expect(shouldAbandonScroll('2026-07-06', w)).toBe(true);
  });

  it('keeps waiting while the expansion has not landed yet', () => {
    expect(shouldAbandonScroll('2026-07-20', w)).toBe(false);
    expect(shouldAbandonScroll('2026-07-01', w)).toBe(false);
  });
});

describe('stepTargets', () => {
  // Every day with an event under the current non-date filters. 07-05 and
  // 07-08 have none — with ★ Favourites on, or any search or venue filter
  // that leaves gaps, that is the ordinary case rather than the exception.
  const eventDays = ['2026-07-04', '2026-07-06', '2026-07-07', '2026-07-10'];

  it('skips days with nothing on them rather than stepping one calendar day', () => {
    // A raw addDays(±1) from 07-06 targets 07-05 and 07-07. 07-05 mounts no
    // section, so the pending scroll gives up and the anchor — derived from
    // scroll position — never moves: pressing again recomputes the identical
    // dead target, with the chevron still enabled.
    expect(stepTargets('2026-07-06', eventDays))
      .toEqual({ prevDay: '2026-07-04', nextDay: '2026-07-07' });
  });

  it('steps from a day that is not itself an event day', () => {
    expect(stepTargets('2026-07-08', eventDays))
      .toEqual({ prevDay: '2026-07-07', nextDay: '2026-07-10' });
  });

  it('reports no target beyond either end', () => {
    expect(stepTargets('2026-07-04', eventDays).prevDay).toBeNull();
    expect(stepTargets('2026-07-10', eventDays).nextDay).toBeNull();
  });

  it('reports nothing reachable with no anchor or no event days', () => {
    expect(stepTargets(null, eventDays)).toEqual({ prevDay: null, nextDay: null });
    expect(stepTargets('2026-07-06', [])).toEqual({ prevDay: null, nextDay: null });
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

// 5 events/day, not 1: at 1/day, even 12 days would never reach the 50-event
// render batch (RENDER_BATCH_EVENTS in renderWindow.ts), so every day would
// already be mounted and the heavy tests below would prove nothing about
// revealing a day past the render window. See the identical note in
// EventList.test.tsx.
//
// 12 days, not 20: at 5/day the batch fills by day 10 (5*10 = 50), so day 12
// — the last day, and the shared fixture's navigation target — is genuinely
// left unmounted by the initial render, which is the only state these tests
// need. Going lower than 12 (or raising events/day) risks the target landing
// inside the fill instead of past it, which would make `revealDay` optional
// again — the exact trap an earlier 20-day/1-event version of this fixture
// fell into.
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
 * Reproduces the parent/child effect topology `goToDay -> revealDay ->
 * scrollToDay` depends on in `page.tsx`: a real `EventList` (whose
 * `revealDay` effect is a layout effect) under a real `useDayAnchor` (whose
 * `scrollToDay` reads the DOM), driven by the same DOM-based pending-scroll
 * effect `page.tsx` uses. Rendering the actual `page.tsx`/`HomeContent`
 * would require mocking event data, season weeks, favourites, article/
 * program links and every route it also imports — none of which this race
 * depends on. This harness keeps only the two components whose effect
 * ordering the bug lives in, wired together exactly as `page.tsx` wires them.
 *
 * `earlierKey`, when given, also wires up `EventList`'s own "Show earlier"
 * control — its upward-prepend settle hold is the second, independent
 * mechanism the arbitration test below needs alongside `useDayAnchor`'s.
 * `groupedEvents` is local state (not a plain passthrough prop) for exactly
 * that reason: `handleShowEarlier` needs somewhere to prepend into.
 *
 * `withFilterPanel`, when given, also mounts the real `useFilterPanel` —
 * toggle button and panel `<div>`, wired exactly like the minimal Harness in
 * `useFilterPanel.test.tsx` — for the dismissal-vs-navigation arbitration
 * test below, which needs a real gesture-dismiss listener (attached only
 * while the panel is `open`) alongside the real day-chip navigation.
 */
function Harness({ groupedEvents: initialGroups, earlierKey, withFilterPanel }: {
  groupedEvents: DayGroup[]; earlierKey?: string; withFilterPanel?: boolean;
}) {
  const [groupedEvents, setGroupedEvents] = useState(initialGroups);
  const filterPanel = useFilterPanel();
  const dayKeysList = groupedEvents.map(g => g.key);
  const bounds = { startDay: dayKeysList[0], endDay: dayKeysList[dayKeysList.length - 1] };
  const { scrollToDay, cancelHold } = useDayAnchor(dayKeysList);
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);

  const goToDay = useCallback((target: string) => {
    const plan = railTarget({ target, window: bounds, bounds });
    if (!plan) return;
    setPendingScroll(plan.scrollTo);
  }, [bounds.startDay, bounds.endDay]);

  const showEarlier = useCallback(() => {
    if (!earlierKey) return;
    // `page.tsx` cancels the rail hold here for the same reason it dispatches
    // the expansion here: this is the click, and the click is the reader
    // saying they want something else.
    cancelHold();
    setGroupedEvents(prev => [group(earlierKey, 1), ...prev]);
  }, [earlierKey, cancelHold]);

  useEffect(() => {
    if (!pendingScroll) return;
    if (daySectionElement(pendingScroll)) {
      setPendingScroll(null);
      scrollToDay(pendingScroll);
      return;
    }
    // The same give-up decision `page.tsx` makes, imported rather than
    // restated — a re-implementation here would prove nothing about the
    // page.
    if (shouldAbandonScroll(pendingScroll, bounds)) setPendingScroll(null);
  }, [pendingScroll, scrollToDay, bounds.startDay, bounds.endDay]);

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
      <EventList {...eventListBaseProps} groupedEvents={groupedEvents} resetKey="k"
        revealDay={pendingScroll}
        earlierDay={earlierKey ?? null}
        onShowEarlier={earlierKey ? showEarlier : undefined} />
    </div>
  );
}

describe('goToDay -> revealDay -> scrollToDay chain', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty('--day-rail-h');
  });

  // Explicit timeout: this is an integration test rendering a real
  // `EventList` + `useDayAnchor` through ~60 `EventCard`s (12 days x 5
  // events — see the fixture note on `makeGroups` above). Locally on Node 24
  // it runs in well under a second, but the default 5s budget is tight on a
  // loaded, 2-core CI runner running with coverage instrumentation and
  // parallel workers, which is exactly what timed this test out before the
  // fixture was shrunk.
  it('scrolls to a day beyond the current render window', { timeout: 15000 }, () => {
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
    // Precondition: day 12 genuinely starts outside the render window —
    // otherwise this test would pass whether or not `revealDay` works.
    expect(container.querySelector(`[${DAY_SECTION_ATTR}="2026-07-12"]`)).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Go' }));

    // Day 12's section now exists (revealDay mounted it) and scrollToDay ran
    // against it: top(0, jsdom's default) - stickyOffset(50) = -50.
    expect(container.querySelector(`[${DAY_SECTION_ATTR}="2026-07-12"]`)).not.toBeNull();
    expect(scrollBy).toHaveBeenCalledWith(0, -50);
  });
});

describe('settle arbitration: a rail navigation supersedes a pending prepend hold', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty('--day-rail-h');
  });

  // Reachable with no window expansion at all: "Show earlier" arms
  // EventList's own upward-prepend settle hold; before any wheel/touchstart/
  // keydown, a rail chip tap (a plain click) arms `useDayAnchor`'s hold on a
  // different day, without changing `groupedEvents`' identity. A single
  // shared `ResizeObserver` mock fires both installed observers on one
  // `trigger()` call — exactly as a real resize notifies every live
  // observer — so this reproduces the concurrent-fire race directly rather
  // than asserting about it from the side.
  // Explicit timeout: same integration-test cost as the chain test above
  // (~60 EventCards from a real EventList + useDayAnchor render), plus a
  // ResizeObserver mock and a second real render window. Comfortably under a
  // second locally on Node 24, but a loaded 2-core CI runner with coverage
  // instrumentation is a different machine, which is what timed this test
  // out before the fixture was shrunk from 20 days to 12.
  it('clears the stale prepend hold so only the rail correction survives a shared resize', { timeout: 15000 }, () => {
    installIntersectionObserverMock();
    const resize = installResizeObserverMock();
    document.documentElement.style.setProperty('--day-rail-h', '50px');
    const keys = Array.from({ length: 12 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);

    const { getByRole, container } = render(
      <Harness groupedEvents={makeGroups(keys)} earlierKey="2026-06-30" />
    );
    // Precondition: day 12 genuinely starts outside the render window — the
    // rail tap below has to be the thing that reveals it, or this test could
    // pass with `revealDay` doing nothing.
    expect(container.querySelector(`[${DAY_SECTION_ATTR}="2026-07-12"]`)).toBeNull();

    // Arm EventList's prepend hold.
    fireEvent.click(getByRole('button', { name: /show earlier/i }));
    // The reference day (2026-07-01) is held at whatever it measured — 0,
    // jsdom's unstubbed default — at arm time. Stubbed to a distinguishable
    // nonzero value now, simulating "content above it grew" the way the
    // settle hold exists to correct: if the hold survives to the shared
    // resize below, its reassert would recompute this and scroll by it.
    document.querySelector<HTMLElement>(`[${DAY_SECTION_ATTR}="2026-07-01"]`)!
      .getBoundingClientRect = () => ({ top: 300 }) as DOMRect;

    // Before any wheel/touchstart/keydown, a rail chip tap: same
    // `groupedEvents` identity (no window expansion needed for a target
    // already inside it), only `revealDay` changes.
    fireEvent.click(getByRole('button', { name: 'Go' }));
    scrollBy.mockClear();

    // One shared resize notifies both observers, exactly as the coordinator
    // described: EventList's (armed on 2026-07-01, if not cleared) and
    // useDayAnchor's (armed on 2026-07-12).
    resize.trigger();

    // Exactly one correction — the rail's: top(0, day 12's unstubbed
    // default) - stickyOffset(50) = -50. A second call, or a call with 300,
    // would mean the stale prepend hold fought it.
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith(0, -50);
  });

  // The same race in the other order, which nothing arbitrated: the rail
  // hold outlived the navigation that armed it (set up in a `useEffect(...,
  // [])`, cleared only by wheel/touchstart/keydown or its target leaving the
  // DOM), so a later "Show earlier" — a mouse click, which fires none of
  // those — armed the prepend correction alongside it. The prepend's own
  // height change is what fires the observers, so the rail's reassert then
  // cancelled the very correction this branch worked hardest to make exact.
  // Explicit timeout: this is the slowest test in the file (two Harness
  // interactions plus a shared resize, over the same ~60-card render as the
  // other two heavy tests above), and the one CI actually timed out on. See
  // the sibling comment above for why the default 5s is too tight on a
  // loaded 2-core runner.
  it('lets a later prepend keep its own correction, unfought by the rail hold', { timeout: 15000 }, () => {
    installIntersectionObserverMock();
    const resize = installResizeObserverMock();
    document.documentElement.style.setProperty('--day-rail-h', '50px');
    const keys = Array.from({ length: 12 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);

    const { getByRole, container } = render(
      <Harness groupedEvents={makeGroups(keys)} earlierKey="2026-06-30" />
    );
    // Precondition: day 12 genuinely starts outside the render window — the
    // rail tap below has to be the thing that reveals it, or this test could
    // pass with `revealDay` doing nothing.
    expect(container.querySelector(`[${DAY_SECTION_ATTR}="2026-07-12"]`)).toBeNull();

    // Arm useDayAnchor's hold on 2026-07-12 via a rail navigation.
    fireEvent.click(getByRole('button', { name: 'Go' }));
    // Then, with no intervening wheel/touchstart/keydown, prepend.
    fireEvent.click(getByRole('button', { name: /show earlier/i }));
    scrollBy.mockClear();

    // Content above the prepend's reference day (2026-07-01, held at its
    // arm-time top of 0) grew; the rail's stale target (2026-07-12) would
    // meanwhile compute 0 - 50 = -50 and drag the reader off it.
    document.querySelector<HTMLElement>(`[${DAY_SECTION_ATTR}="2026-07-01"]`)!
      .getBoundingClientRect = () => ({ top: 300 }) as DOMRect;
    resize.trigger();

    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith(0, 300);
  });
});

describe('arbitration: a day-chip tap dismisses the panel before it navigates', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty('--day-rail-h');
  });

  // A chip tap dismisses the panel AND navigates. Both correct scroll. If
  // they ran unordered the reader would land in neither place — exactly the
  // shape of the bug that cost the preceding branch a review round, when
  // useDayAnchor's hold and EventList's prepend settle both called scrollBy
  // on one shared resize (see the two tests above). The two reasons this
  // should hold by construction: Task 1's gesture listener is attached on
  // `mousedown` at capture phase, which is temporally earlier than the
  // chip's own `click` handler; and the panel's dismissal correction runs
  // synchronously in a `useLayoutEffect`, so it is committed before the
  // day-navigation `scrollBy` (driven by a plain `useEffect` one render
  // later, once `revealDay` has mounted the target section) ever measures
  // the DOM. This test exists to prove that rather than assume it.
  //
  // Explicit timeout: same integration-test cost as the three tests above
  // (~60 EventCards from a real EventList + useDayAnchor render), plus a
  // real `useFilterPanel` with its own effects and a window-level gesture
  // listener — at least as expensive as the tests that already carry this
  // guard. Comfortably under a second locally on Node 24, but that is not
  // the evidence that matters: a loaded, 2-core CI runner with coverage
  // instrumentation is what timed a test in this file out before its
  // fixture was shrunk, and this test renders the identical fixture.
  it('dismisses the panel before scrolling to the tapped day, not alongside it', { timeout: 15000 }, () => {
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
    // Precondition: day 12 genuinely starts outside the render window — the
    // chip tap below has to be the thing that reveals it, or this test could
    // pass with `revealDay` doing nothing.
    expect(container.querySelector(`[${DAY_SECTION_ATTR}="2026-07-12"]`)).toBeNull();

    // Arrange: the panel is open. (Day sections all read jsdom's default
    // zero top here, so `topmostVisibleDaySection` finds nothing >= the
    // rail's 50px threshold and this correction is a no-op — nothing to
    // clear from `order`.)
    const toggle = getByRole('button', { name: 'Filters' });
    fireEvent.click(toggle);
    expect(order).toEqual([]);

    // Track 2026-07-01 (the topmost mounted day section) against the
    // panel's own open/hidden class, the same way `useFilterPanel.test.tsx`
    // does — a stand-in for the real Chromium-measured drift a panel
    // leaving the layout produces, giving the dismissal's correction a
    // real, nonzero, distinguishable delta once the tap below closes it.
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

    // Assert the ORDER, not just that both happened: the panel's correction
    // must be recorded before the day-navigation scroll.
    expect(order).toEqual(['dismiss', 'navigate']);
  });
});
