import { render } from '@testing-library/preact';
import { EventListView } from '@/components/calendar/EventListView';
import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { Event } from '@/lib/types';

function event(id: string): Event {
  return {
    id, title: `Event ${id}`, startDate: '2026-07-04T10:00:00',
    location: 'Amphitheater', tags: [], categories: [],
  } as unknown as Event;
}

// Two day groups with DIFFERENT event counts — 1 and 3 — so the two
// `containIntrinsicSize` values differ and a hardcoded constant cannot pass.
const GROUPS: DayGroup[] = [
  { key: '2026-07-04', baseLabel: 'Saturday, July 4, 2026', weekNumbers: [1], events: [event('a')] },
  {
    key: '2026-07-05',
    baseLabel: 'Sunday, July 5, 2026',
    weekNumbers: [1],
    events: [event('b'), event('c'), event('d')],
  },
];

const EXPANDED = new Set<string>();
const FAVOURITES = new Set<string>();
const NOOP = () => {};
const NEVER = () => false;

test('each day section skips its own layout off screen, sized by its event count', () => {
  const { container } = render(
    <EventListView
      groups={GROUPS}
      expandedDescriptions={EXPANDED}
      onToggleDescription={NOOP}
      onToggleTag={NOOP}
      isTagSelected={NEVER}
      favoriteIds={FAVOURITES}
      onToggleFavorite={NOOP}
    />
  );
  const one = container.querySelector('[data-day-key="2026-07-04"]') as HTMLElement;
  const two = container.querySelector('[data-day-key="2026-07-05"]') as HTMLElement;

  expect(one.style.contentVisibility).toBe('auto');
  expect(two.style.contentVisibility).toBe('auto');

  // `auto` in the keyword position, so the browser remembers the real size
  // once it has rendered the section — without it, every section re-collapses
  // to the estimate the moment it leaves the viewport.
  expect(one.style.containIntrinsicSize).toBe(`auto ${44 + 1 * 92}px`);
  expect(two.style.containIntrinsicSize).toBe(`auto ${44 + 3 * 92}px`);

  // The property that was already there must survive.
  expect(one.style.scrollMarginTop).not.toBe('');
});
