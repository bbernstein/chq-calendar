import { describe, it, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { EventList } from '@/components/calendar/EventList';
import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { Event } from '@/lib/types';

function group(key: string, count: number): DayGroup {
  const events = Array.from({ length: count }, (_, i) => ({
    id: `${key}-${i}`,
    title: `Event ${key}-${i}`,
    startDate: new Date(`${key}T12:00:00`).toISOString(),
    endDate: new Date(`${key}T13:00:00`).toISOString(),
  } as Event));
  return { key, baseLabel: `Day ${key}`, weekNumbers: [], events };
}

/**
 * The brief's fixture helper. Deliberately does NOT derive event dates from
 * `key` the way `group` above does — `key` here runs past 31 for a 40-day
 * fixture (`2026-07-40` and beyond), which is not a parseable calendar date
 * and would throw building `Event.startDate`. `EventListView` never reads an
 * event's date to decide what to render (only `DayGroup.key`/`baseLabel` for
 * the section itself), so a fixed, always-valid date is enough.
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
const baseProps = {
  expandedDescriptions: new Set<string>(),
  onToggleDescription: noop,
  onToggleTag: noop,
  isTagSelected: () => false,
  favoriteIds: new Set<string>(),
  onToggleFavorite: noop,
};

/** The props `EventListView` needs, handed down through `EventList` unchanged. */
const viewProps = baseProps;

describe('EventList', () => {
  test('every day group the caller hands down is mounted, however many there are', () => {
    const groups = Array.from({ length: 40 }, (_, i) => dayGroup(`2026-07-${String(i + 1).padStart(2, '0')}`, 8));
    const { container } = render(<EventList groupedEvents={groups} {...viewProps} />);
    expect(container.querySelectorAll('[data-day-key]')).toHaveLength(40);
    expect(container.querySelectorAll('[data-event-id]')).toHaveLength(320);
  });

  test('there is no growth sentinel to observe', () => {
    const groups = Array.from({ length: 40 }, (_, i) => dayGroup(`2026-07-${String(i + 1).padStart(2, '0')}`, 8));
    const { container } = render(<EventList groupedEvents={groups} {...viewProps} />);
    expect(container.querySelector('[data-testid="event-list-sentinel"]')).toBeNull();
  });

  it('renders nothing for no groups', () => {
    const { container } = render(<EventList {...baseProps} groupedEvents={[]} />);
    expect(container.querySelectorAll('.event-card')).toHaveLength(0);
  });
});

describe('EventList — showing earlier days', () => {
  it('offers the earlier control only when there is an earlier day', () => {
    const groups = [group('2026-07-05', 10)];
    const { rerender } = render(<EventList {...baseProps} groupedEvents={groups} />);
    expect(screen.queryByRole('button', { name: /Show earlier/ })).not.toBeInTheDocument();

    rerender(<EventList {...baseProps} groupedEvents={groups} earlierDay="2026-07-03" onShowEarlier={noop} />);
    expect(screen.getByRole('button', { name: /Show earlier/ })).toBeInTheDocument();
  });

  it('names the day it will show, never just "earlier"', () => {
    render(
      <EventList {...baseProps} groupedEvents={[group('2026-07-05', 10)]}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );
    // The visible text is the accessible name — no aria-label duplicating
    // (and drifting from) it. WCAG 2.5.3 Label in Name: a speech-input user
    // reading the screen must be able to say what they see.
    const button = screen.getByRole('button', { name: 'Show earlier (Friday, Jul 3)' });
    expect(button).toHaveTextContent('Show earlier (Friday, Jul 3)');
    expect(button).not.toHaveAttribute('aria-label');
  });

  it('calls onShowEarlier when clicked', () => {
    const onShowEarlier = vi.fn();
    render(
      <EventList {...baseProps} groupedEvents={[group('2026-07-05', 10)]}
        earlierDay="2026-07-03" onShowEarlier={onShowEarlier} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Show earlier/ }));
    expect(onShowEarlier).toHaveBeenCalledTimes(1);
  });
});
