import { describe, expect, it, vi, afterEach } from 'vitest';
import { useCallback, useEffect, useState } from 'react';
import { render, fireEvent } from '@testing-library/preact';
import { railTarget, reachableTodayKey, shouldAbandonScroll, stepTargets } from '@/app/dayRailNavigation';
import { EventList } from '@/components/calendar/EventList';
import { useDayAnchor } from '@/hooks/useDayAnchor';
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

// 5 events/day, not 1: at 1/day, 20 days never reaches the 50-event render
// batch, so every day would already be mounted and the test would prove
// nothing about revealing a day past the render window. See the identical
// note in EventList.test.tsx.
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
 */
function Harness({ groupedEvents: initialGroups, earlierKey }: { groupedEvents: DayGroup[]; earlierKey?: string }) {
  const [groupedEvents, setGroupedEvents] = useState(initialGroups);
  const dayKeysList = groupedEvents.map(g => g.key);
  const bounds = { startDay: dayKeysList[0], endDay: dayKeysList[dayKeysList.length - 1] };
  const { scrollToDay } = useDayAnchor(dayKeysList);
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);

  const goToDay = useCallback((target: string) => {
    const plan = railTarget({ target, window: bounds, bounds });
    if (!plan) return;
    setPendingScroll(plan.scrollTo);
  }, [bounds.startDay, bounds.endDay]);

  const showEarlier = useCallback(() => {
    if (!earlierKey) return;
    setGroupedEvents(prev => [group(earlierKey, 1), ...prev]);
  }, [earlierKey]);

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
      <button type="button" onClick={() => goToDay('2026-07-20')}>Go</button>
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

  it('scrolls to a day beyond the current render window', () => {
    installIntersectionObserverMock();
    // useDayAnchor's settle effect constructs a ResizeObserver on every
    // mount now, whether or not this test ever triggers a resize.
    installResizeObserverMock();
    // jsdom reports 0 for every element's top, so a real (nonzero) sticky
    // offset is what makes the scrollBy assertion below distinguishable
    // from "delta happened to be 0" rather than "scrollToDay never ran".
    document.documentElement.style.setProperty('--day-rail-h', '50px');
    const keys = Array.from({ length: 20 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);

    const { getByRole, container } = render(<Harness groupedEvents={makeGroups(keys)} />);
    // Precondition: day 20 genuinely starts outside the render window —
    // otherwise this test would pass whether or not `revealDay` works.
    expect(container.querySelector(`[${DAY_SECTION_ATTR}="2026-07-20"]`)).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Go' }));

    // Day 20's section now exists (revealDay mounted it) and scrollToDay ran
    // against it: top(0, jsdom's default) - stickyOffset(50) = -50.
    expect(container.querySelector(`[${DAY_SECTION_ATTR}="2026-07-20"]`)).not.toBeNull();
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
  it('clears the stale prepend hold so only the rail correction survives a shared resize', () => {
    installIntersectionObserverMock();
    const resize = installResizeObserverMock();
    document.documentElement.style.setProperty('--day-rail-h', '50px');
    const keys = Array.from({ length: 20 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);

    const { getByRole } = render(
      <Harness groupedEvents={makeGroups(keys)} earlierKey="2026-06-30" />
    );

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
    // useDayAnchor's (armed on 2026-07-20).
    resize.trigger();

    // Exactly one correction — the rail's: top(0, day 20's unstubbed
    // default) - stickyOffset(50) = -50. A second call, or a call with 300,
    // would mean the stale prepend hold fought it.
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith(0, -50);
  });
});
