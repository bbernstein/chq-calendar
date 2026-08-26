import { render, fireEvent } from '@testing-library/preact';
import { useState } from 'react';
import { EventListView } from '@/components/calendar/EventListView';
import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { Event } from '@/lib/types';

function event(id: string): Event {
  return {
    id, title: `Event ${id}`, startDate: '2026-07-04T10:00:00',
    location: 'Amphitheater', tags: [], categories: [],
  } as unknown as Event;
}

const GROUPS: DayGroup[] = [
  { key: '2026-07-04', baseLabel: 'Saturday, July 4, 2026', weekNumbers: [1], events: [event('a')] },
];

// Stable identities, exactly as `page.tsx` hands them down. Declared at module
// scope so nothing about the harness can make a prop change by accident — the
// test would then pass for the wrong reason.
const EXPANDED = new Set<string>();
const FAVOURITES = new Set<string>();
const NOOP = () => {};
const NEVER = () => false;

let themeLookups = 0;

/**
 * A render counter that needs no instrumentation inside the component.
 *
 * `WeekBadge` — a child of every day section — indexes `themes[weekNumber]`
 * during its render, and it is not memoized itself, so it renders exactly when
 * the list subtree renders. The Proxy counts those reads. Nothing in the
 * component tree knows it is being measured.
 */
const COUNTING_THEMES = new Proxy({} as Record<number, never>, {
  get(target, prop) { themeLookups += 1; return Reflect.get(target, prop); },
});

function Harness() {
  const [anchor, setAnchor] = useState(0);
  return (
    <div>
      <button type="button" onClick={() => setAnchor(a => a + 1)}>anchor {anchor}</button>
      <EventListView
        groups={GROUPS}
        expandedDescriptions={EXPANDED}
        onToggleDescription={NOOP}
        onToggleTag={NOOP}
        isTagSelected={NEVER}
        favoriteIds={FAVOURITES}
        onToggleFavorite={NOOP}
        weeklyThemes={COUNTING_THEMES}
      />
    </div>
  );
}

test('a scroll-derived state change in the parent does not re-render the list', () => {
  themeLookups = 0;
  const { container } = render(<Harness />);

  // The counter has to be observing something, or the assertion below is
  // vacuous — this is the guard against a test that can only pass.
  const afterMount = themeLookups;
  expect(afterMount).toBeGreaterThan(0);

  // Two parent state changes with every list prop unchanged. This is what a
  // scroll does: `useDayAnchor` moves `anchorDay` in `page.tsx` on a
  // rAF-throttled scroll listener, many times per gesture.
  //
  // `fireEvent`, not a raw `.click()`: preact batches re-renders into a
  // microtask by default, and `fireEvent` wraps the dispatch in `act()` to
  // flush that synchronously. A raw `.click()` leaves the update pending
  // when the assertion below runs, so the counter would not move either way
  // — a vacuous pass that isn't actually observing a render.
  const button = container.querySelector('button')!;
  fireEvent.click(button);
  fireEvent.click(button);

  expect(themeLookups).toBe(afterMount);
});

test('a real change to the list still re-renders it', () => {
  // The other half of the claim: a memo that never re-renders is a bug, not a
  // fix. Falsifying the test above by removing `memo` must not be the only way
  // to break this file.
  themeLookups = 0;
  const { rerender } = render(
    <EventListView
      groups={GROUPS}
      expandedDescriptions={EXPANDED}
      onToggleDescription={NOOP}
      onToggleTag={NOOP}
      isTagSelected={NEVER}
      favoriteIds={FAVOURITES}
      onToggleFavorite={NOOP}
      weeklyThemes={COUNTING_THEMES}
    />
  );
  const afterMount = themeLookups;

  const grown: DayGroup[] = [
    ...GROUPS,
    { key: '2026-07-05', baseLabel: 'Sunday, July 5, 2026', weekNumbers: [1], events: [event('b')] },
  ];
  rerender(
    <EventListView
      groups={grown}
      expandedDescriptions={EXPANDED}
      onToggleDescription={NOOP}
      onToggleTag={NOOP}
      isTagSelected={NEVER}
      favoriteIds={FAVOURITES}
      onToggleFavorite={NOOP}
      weeklyThemes={COUNTING_THEMES}
    />
  );

  expect(themeLookups).toBeGreaterThan(afterMount);
  expect(document.querySelectorAll('[data-day-key]')).toHaveLength(2);
});
