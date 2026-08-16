import { describe, expect, it, vi, afterEach } from 'vitest';
import { useCallback, useEffect, useState } from 'react';
import { render, fireEvent } from '@testing-library/preact';
import { railTarget } from '@/app/dayRailNavigation';
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

  it('handles a null window by expanding both edges to the target', () => {
    // Reachable for 'this-week' outside the season, where the scope matches
    // nothing at all and there is no window to compare against.
    expect(railTarget({ target: '2026-07-06', window: null, bounds }))
      .toEqual({ expandStart: '2026-07-06', expandEnd: '2026-07-06', scrollTo: '2026-07-06' });
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
 */
function Harness({ groupedEvents }: { groupedEvents: DayGroup[] }) {
  const dayKeysList = groupedEvents.map(g => g.key);
  const bounds = { startDay: dayKeysList[0], endDay: dayKeysList[dayKeysList.length - 1] };
  const { scrollToDay } = useDayAnchor(dayKeysList);
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);

  const goToDay = useCallback((target: string) => {
    const plan = railTarget({ target, window: bounds, bounds });
    if (!plan) return;
    setPendingScroll(plan.scrollTo);
  }, [bounds.startDay, bounds.endDay]);

  useEffect(() => {
    if (!pendingScroll) return;
    if (daySectionElement(pendingScroll)) {
      setPendingScroll(null);
      scrollToDay(pendingScroll);
      return;
    }
    const covered = pendingScroll >= bounds.startDay && pendingScroll <= bounds.endDay;
    if (covered) setPendingScroll(null);
  }, [pendingScroll, scrollToDay, bounds.startDay, bounds.endDay]);

  return (
    <div>
      <button type="button" onClick={() => goToDay('2026-07-20')}>Go</button>
      <EventList {...eventListBaseProps} groupedEvents={groupedEvents} resetKey="k" revealDay={pendingScroll} />
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
