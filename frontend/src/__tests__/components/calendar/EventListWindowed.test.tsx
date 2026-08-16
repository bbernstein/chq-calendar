import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { EventListWindowed } from '@/components/calendar/EventListWindowed';
import { installIntersectionObserverMock } from '@/__tests__/helpers/intersectionObserver';
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

const noop = () => {};
const baseProps = {
  expandedDescriptions: new Set<string>(),
  onToggleDescription: noop,
  onToggleTag: noop,
  isTagSelected: () => false,
  favoriteIds: new Set<string>(),
  onToggleFavorite: noop,
  resetKey: 'k1',
};

/** jsdom reports zero layout; the component only auto-expands a scrollable page. */
function setPageScrollable(scrollable: boolean) {
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    value: scrollable ? 5000 : 100,
  });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
}

describe('EventListWindowed', () => {
  let io: ReturnType<typeof installIntersectionObserverMock>;

  beforeEach(() => {
    io = installIntersectionObserverMock();
    setPageScrollable(true);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders whole days, filling to at least one batch of events', () => {
    const groups = [group('2026-07-05', 20), group('2026-07-06', 20), group('2026-07-07', 20), group('2026-07-08', 20)];
    render(<EventListWindowed {...baseProps} groupedEvents={groups} />);

    // 20 + 20 + 20 = 60 >= 50 → three whole days, never a partial one.
    expect(screen.getByText('Day 2026-07-07')).toBeInTheDocument();
    expect(screen.getByText('Event 2026-07-07-19')).toBeInTheDocument();
    expect(screen.queryByText('Day 2026-07-08')).not.toBeInTheDocument();
  });

  it('never splits a day across the render edge', () => {
    const groups = [group('2026-07-05', 80), group('2026-07-06', 5)];
    render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    expect(screen.getByText('Event 2026-07-05-79')).toBeInTheDocument();
    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();
  });

  it('extends the render window by whole days when the sentinel intersects', () => {
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20), group('2026-07-07', 40)];
    render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();

    io.trigger();

    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
    expect(screen.getByText('Day 2026-07-07')).toBeInTheDocument();
  });

  it('does not call onExpandEnd while loaded days remain', () => {
    const onExpandEnd = vi.fn();
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    render(<EventListWindowed {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={onExpandEnd} />);

    io.trigger();

    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
    expect(onExpandEnd).not.toHaveBeenCalled();
  });

  it('asks the page to expand the view window once the loaded days run out', () => {
    const onExpandEnd = vi.fn();
    const groups = [group('2026-07-05', 10)];
    render(<EventListWindowed {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={onExpandEnd} />);

    io.trigger();

    expect(onExpandEnd).toHaveBeenCalledTimes(1);
  });

  it('renders no sentinel when there is nothing left in either window', () => {
    const groups = [group('2026-07-05', 10)];
    const { container } = render(
      <EventListWindowed {...baseProps} groupedEvents={groups} canExpandEnd={false} />
    );
    expect(container.querySelector('[data-testid="event-list-sentinel"]')).toBeNull();
  });

  it('does not auto-expand a page that cannot scroll', () => {
    // Content shorter than the viewport means the reader never scrolled past
    // anything. Auto-expanding here would silently turn a three-event
    // "Today" into "Today and tomorrow" before the reader touched a thing.
    setPageScrollable(false);
    const onExpandEnd = vi.fn();
    render(<EventListWindowed {...baseProps} groupedEvents={[group('2026-07-05', 3)]} canExpandEnd onExpandEnd={onExpandEnd} />);

    io.trigger();

    expect(onExpandEnd).not.toHaveBeenCalled();
  });

  it('ignores a non-intersecting report', () => {
    const onExpandEnd = vi.fn();
    render(<EventListWindowed {...baseProps} groupedEvents={[group('2026-07-05', 3)]} canExpandEnd onExpandEnd={onExpandEnd} />);

    io.trigger(false);

    expect(onExpandEnd).not.toHaveBeenCalled();
  });

  it('keeps the rendered days when the window grows at the end', () => {
    const groups = [group('2026-07-05', 60)];
    const { rerender } = render(<EventListWindowed {...baseProps} groupedEvents={groups} canExpandEnd onExpandEnd={noop} />);
    const grown = [...groups, group('2026-07-06', 20)];

    rerender(<EventListWindowed {...baseProps} groupedEvents={grown} canExpandEnd onExpandEnd={noop} />);

    // The appended day is not mounted until the sentinel asks for it, and
    // the day already on screen is untouched — no reset, no jump.
    expect(screen.getByText('Day 2026-07-05')).toBeInTheDocument();
    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();

    io.trigger();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
  });

  it('keeps the rendered tail when earlier days are prepended', () => {
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    const { rerender } = render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    io.trigger();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();

    rerender(<EventListWindowed {...baseProps} groupedEvents={[group('2026-07-03', 10), ...groups]} />);

    expect(screen.getByText('Day 2026-07-03')).toBeInTheDocument();
    expect(screen.getByText('Day 2026-07-05')).toBeInTheDocument();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
  });

  it('resets the render window when the non-window filters change', () => {
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    const { rerender } = render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    io.trigger();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();

    rerender(<EventListWindowed {...baseProps} resetKey="k2" groupedEvents={groups} />);

    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();
  });

  it('renders nothing for no groups and asks for no expansion', () => {
    const onExpandEnd = vi.fn();
    const { container } = render(
      <EventListWindowed {...baseProps} groupedEvents={[]} canExpandEnd onExpandEnd={onExpandEnd} />
    );
    expect(container.querySelectorAll('.event-card')).toHaveLength(0);
    expect(onExpandEnd).not.toHaveBeenCalled();
  });
});
