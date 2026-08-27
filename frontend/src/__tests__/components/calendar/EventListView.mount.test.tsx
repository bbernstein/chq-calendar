import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { EventListView } from '@/components/calendar/EventListView';
import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { Event } from '@/lib/types';

/**
 * The list mounts everything it is given, and observes nothing.
 *
 * These two tests are the statement of the contract #274 phase 4 replaced the
 * render window with, and they are the only place it is stated. They were
 * written against `EventList` when phase 4's task 4 deleted the window; task 5
 * then deleted `EventList` itself — a pass-through wrapper plus a "Show
 * earlier" button — and the contract survived the wrapper untouched. They are
 * retargeted at `EventListView`, which is what `page.tsx` renders directly
 * now, rather than deleted with the file they happened to live in.
 *
 * What they catch: someone reintroducing a virtualized list — a sentinel, an
 * `IntersectionObserver` and an initial-fill slice — to "fix" a scroll cost
 * that was measured and found not to be the DOM's size. Nothing else in the
 * suite would fail: the integration tests mount two or three day sections, so
 * an initial slice of ten would look identical.
 */

/**
 * Deliberately does NOT derive event dates from `key`: `key` runs past 31 for
 * a 40-day fixture (`2026-07-40` and beyond), which is not a parseable
 * calendar date and would throw building `Event.startDate`. `EventListView`
 * never reads an event's date to decide what to render — only `DayGroup.key`
 * and `baseLabel` for the section itself — so a fixed, always-valid date is
 * enough.
 */
function dayGroup(key: string, count: number): DayGroup {
  const events = Array.from({ length: count }, (_, i) => ({
    id: `${key}-${i}`,
    title: `Event ${key}-${i}`,
    startDate: '2026-01-01T12:00:00.000Z',
    endDate: '2026-01-01T13:00:00.000Z',
  } as Event));
  return { key, baseLabel: key, weekNumbers: [1], events };
}

const noop = () => {};
const viewProps = {
  expandedDescriptions: new Set<string>(),
  onToggleDescription: noop,
  onToggleTag: noop,
  isTagSelected: () => false,
  favoriteIds: new Set<string>(),
  onToggleFavorite: noop,
};

function fortyGroups(): DayGroup[] {
  return Array.from({ length: 40 }, (_, i) =>
    dayGroup(`2026-07-${String(i + 1).padStart(2, '0')}`, 8));
}

describe('EventListView mounts the whole list', () => {
  test('every day group the caller hands down is mounted, however many there are', () => {
    const { container } = render(<EventListView groups={fortyGroups()} {...viewProps} />);
    expect(container.querySelectorAll('[data-day-key]')).toHaveLength(40);
    expect(container.querySelectorAll('[data-event-id]')).toHaveLength(320);
  });

  test('there is no growth sentinel to observe', () => {
    const { container } = render(<EventListView groups={fortyGroups()} {...viewProps} />);
    expect(container.querySelector('[data-testid="event-list-sentinel"]')).toBeNull();
  });

  test('renders nothing for no groups', () => {
    const { container } = render(<EventListView groups={[]} {...viewProps} />);
    expect(container.querySelectorAll('[data-day-key]')).toHaveLength(0);
  });
});
