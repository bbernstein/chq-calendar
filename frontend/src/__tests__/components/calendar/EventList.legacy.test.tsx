import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { EventList } from '@/components/calendar/EventList';
import { installIntersectionObserverMock } from '@/__tests__/helpers/intersectionObserver';
import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { Event } from '@/lib/types';

function group(key: string, label: string, count: number, hour = 12): DayGroup {
  const events = Array.from({ length: count }, (_, i) => ({
    id: `${key}-${i}`,
    title: `Event ${key}-${i}`,
    startDate: new Date(`${key}T${String(hour).padStart(2, '0')}:00:00`).toISOString(),
    endDate: new Date(`${key}T${String(hour + 1).padStart(2, '0')}:00:00`).toISOString(),
  } as Event));
  return { key, baseLabel: label, weekNumbers: [], events };
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

describe('EventList (legacy path, flag off)', () => {
  let io: ReturnType<typeof installIntersectionObserverMock>;

  beforeEach(() => { io = installIntersectionObserverMock(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders day headers and the first 50 events', () => {
    const groups = [group('2026-07-05', 'Sunday, July 5, 2026', 30), group('2026-07-06', 'Monday, July 6, 2026', 30)];
    render(<EventList {...baseProps} groupedEvents={groups} dateFilter="all" />);

    expect(screen.getByText('Sunday, July 5, 2026')).toBeInTheDocument();
    expect(screen.getByText('Event 2026-07-05-0')).toBeInTheDocument();
    expect(screen.getByText('Event 2026-07-06-19')).toBeInTheDocument();
    // 51st event onwards is not mounted.
    expect(screen.queryByText('Event 2026-07-06-20')).not.toBeInTheDocument();
    expect(screen.getByText('Loading more events...')).toBeInTheDocument();
  });

  it('loads another 50 events when the sentinel intersects', () => {
    const groups = [group('2026-07-05', 'Sunday, July 5, 2026', 120)];
    render(<EventList {...baseProps} groupedEvents={groups} dateFilter="all" />);
    expect(screen.queryByText('Event 2026-07-05-50')).not.toBeInTheDocument();

    io.trigger();

    expect(screen.getByText('Event 2026-07-05-50')).toBeInTheDocument();
    expect(screen.getByText('Event 2026-07-05-99')).toBeInTheDocument();
    expect(screen.queryByText('Event 2026-07-05-100')).not.toBeInTheDocument();
  });

  it('drops the sentinel once everything is mounted', () => {
    const groups = [group('2026-07-05', 'Sunday, July 5, 2026', 10)];
    render(<EventList {...baseProps} groupedEvents={groups} dateFilter="all" />);
    expect(screen.queryByText('Loading more events...')).not.toBeInTheDocument();
  });

  it('resets to the first 50 when the grouped events change', () => {
    const groups = [group('2026-07-05', 'Sunday, July 5, 2026', 120)];
    const { rerender } = render(<EventList {...baseProps} groupedEvents={groups} dateFilter="all" />);
    io.trigger();
    expect(screen.getByText('Event 2026-07-05-50')).toBeInTheDocument();

    rerender(<EventList {...baseProps} groupedEvents={[...groups]} dateFilter="all" />);

    expect(screen.queryByText('Event 2026-07-05-50')).not.toBeInTheDocument();
  });

  it('offers "Show next day" only under the next scope, fully scrolled, with more days', () => {
    const groups = [group('2026-07-05', 'Sunday, July 5, 2026', 3)];
    const onShowNextDay = vi.fn();
    const { rerender } = render(
      <EventList {...baseProps} groupedEvents={groups} dateFilter="next"
        hasMoreDays onShowNextDay={onShowNextDay} />
    );
    const button = screen.getByRole('button', { name: /Show next day/ });
    expect(button).toHaveTextContent('Show next day (Monday, Jul 6)');

    rerender(
      <EventList {...baseProps} groupedEvents={groups} dateFilter="all"
        hasMoreDays onShowNextDay={onShowNextDay} />
    );
    expect(screen.queryByRole('button', { name: /Show next day/ })).not.toBeInTheDocument();

    rerender(
      <EventList {...baseProps} groupedEvents={groups} dateFilter="next"
        hasMoreDays={false} onShowNextDay={onShowNextDay} />
    );
    expect(screen.queryByRole('button', { name: /Show next day/ })).not.toBeInTheDocument();
  });

  it('renders nothing but an empty container for no groups', () => {
    const { container } = render(<EventList {...baseProps} groupedEvents={[]} dateFilter="all" />);
    expect(container.querySelectorAll('.event-card')).toHaveLength(0);
    expect(screen.queryByText('Loading more events...')).not.toBeInTheDocument();
  });
});
