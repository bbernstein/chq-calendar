import { render, fireEvent } from '@testing-library/preact';
import { useState, useCallback } from 'react';
import { EventListView } from '@/components/calendar/EventListView';
import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { Event } from '@/lib/types';

/**
 * The card-level half of `EventListView.memo.test.tsx`.
 *
 * That file proves the *list* is not re-rendered by a parent state change that
 * leaves its props alone — a scroll. This one proves the *cards* are not
 * re-rendered by a change to a list prop that concerns exactly one of them —
 * a star, an expansion. With the whole year mounted (1,687 cards, #274 phase
 * 4) the difference is the whole cost of starring one event.
 *
 * Same counting technique, one level down: a Proxy that counts a property read
 * during render, so nothing in the component tree knows it is measured.
 *
 * The counted property is `startDate` and that is load-bearing. `EventListView`
 * reads `event.id` from every event on every one of its own renders — for the
 * key, for `expandedDescriptions.has`, for `favoriteIds.has`, for the two
 * sidecar lookups — so counting `id` would move for every card whether the
 * cards re-rendered or not, and the assertion below could never fail. Only
 * `EventCard` reads `startDate`, and it reads it to run
 * `parseEventDate`/`formatChqTime`, which is the work this memo exists to
 * avoid.
 */
const reads: Record<string, number> = {};

function countingEvent(id: string): Event {
  reads[id] = 0;
  const target = {
    id,
    title: `Event ${id}`,
    startDate: '2026-07-04T10:00:00',
    location: 'Amphitheater',
    description: 'Something to expand.',
    tags: [],
    categories: [],
  };
  return new Proxy(target, {
    get(t, prop, recv) {
      if (prop === 'startDate') reads[id] += 1;
      return Reflect.get(t, prop, recv);
    },
  }) as unknown as Event;
}

const A = countingEvent('a');
const B = countingEvent('b');
const C = countingEvent('c');

const GROUPS: DayGroup[] = [
  { key: '2026-07-04', baseLabel: 'Saturday, July 4, 2026', weekNumbers: [1], events: [A, B, C] },
];

const NOOP = () => {};
const NEVER = () => false;

/**
 * Holds the two Sets the way `page.tsx` does — replaced wholesale on every
 * toggle, with `useCallback`-stable togglers. The point of the test is that
 * this shape, unchanged, no longer costs every card a render.
 */
function Harness() {
  const [favouriteIds, setFavouriteIds] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggleFavourite = useCallback((id: string) => {
    setFavouriteIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const toggleDescription = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  return (
    <EventListView
      groups={GROUPS}
      expandedDescriptions={expanded}
      onToggleDescription={toggleDescription}
      onToggleTag={NOOP}
      isTagSelected={NEVER}
      favoriteIds={favouriteIds}
      onToggleFavorite={toggleFavourite}
    />
  );
}

function starOf(id: string): HTMLElement {
  const card = document.querySelector(`[data-event-id="${id}"]`)!;
  return card.querySelector('button[aria-label="Add to favorites"]') as HTMLElement;
}
function titleOf(id: string): HTMLElement {
  const card = document.querySelector(`[data-event-id="${id}"]`)!;
  return card.querySelector('h4 button') as HTMLElement;
}

beforeEach(() => {
  reads.a = 0; reads.b = 0; reads.c = 0;
});

test('starring one event does not re-render the other cards', () => {
  render(<Harness />);

  // The counters have to be observing something, or every assertion below is
  // vacuous. This is the guard against a test that can only pass.
  expect(reads.a).toBeGreaterThan(0);
  expect(reads.b).toBeGreaterThan(0);
  const afterMount = { ...reads };

  // `fireEvent`, not a raw `.click()`: preact batches re-renders into a
  // microtask, and `@testing-library/preact` wraps `fireEvent` in `act()` to
  // flush it synchronously. A raw `.click()` leaves the update pending when
  // the assertions run, so no counter moves either way — a vacuous pass.
  fireEvent.click(starOf('a'));

  // The starred card did re-render — it has to, its star changed. Without
  // this, removing the memo entirely and never rendering anything again would
  // also satisfy the assertions below.
  expect(reads.a).toBeGreaterThan(afterMount.a);
  expect(document.querySelector('[data-event-id="a"] button[aria-label="Remove from favorites"]')).not.toBeNull();

  // The other two did not.
  expect(reads.b).toBe(afterMount.b);
  expect(reads.c).toBe(afterMount.c);
});

test('expanding one description does not re-render the other cards', () => {
  render(<Harness />);
  expect(reads.b).toBeGreaterThan(0);
  const afterMount = { ...reads };

  fireEvent.click(titleOf('b'));

  expect(reads.b).toBeGreaterThan(afterMount.b);
  expect(document.querySelector('[data-event-id="b"] #event-details-b')).not.toBeNull();

  expect(reads.a).toBe(afterMount.a);
  expect(reads.c).toBe(afterMount.c);
});
