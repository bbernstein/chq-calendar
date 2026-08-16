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

  it('still mounts more loaded days on a page that cannot scroll', () => {
    // The scrollable-page guard belongs to the expensive step only. Without
    // this case, an implementation that wrapped BOTH steps in the guard would
    // pass every other test in this file, because they all force a scrollable
    // page — and the list would refuse to grow into days it had already
    // loaded whenever the viewport was taller than the content.
    setPageScrollable(false);
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();

    io.trigger();

    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();
  });

  it('re-anchors on a filter change even when the day groups are rebuilt', () => {
    // The existing reset test reuses the same array reference, so it cannot
    // tell a derived anchor from an effect-synchronised one. Neither can this
    // one, in the end: `rerender` runs inside `act`, which flushes effects
    // before returning, so the extra frame an effect would paint is invisible
    // here. What this DOES pin is that re-anchoring survives the realistic
    // shape of a filter change — a brand-new array whose surviving day keys
    // overlap the old anchor — which is the state that makes the effect
    // version misbehave in a browser.
    //
    // The frame itself is verified in the browser pass, not here.
    const groups = [group('2026-07-05', 60), group('2026-07-06', 20)];
    const { rerender } = render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    io.trigger();
    expect(screen.getByText('Day 2026-07-06')).toBeInTheDocument();

    const rebuilt = [group('2026-07-05', 60), group('2026-07-06', 20)];
    rerender(<EventListWindowed {...baseProps} resetKey="k2" groupedEvents={rebuilt} />);

    expect(screen.queryByText('Day 2026-07-06')).not.toBeInTheDocument();
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

describe('EventListWindowed — showing earlier days', () => {
  let io: ReturnType<typeof installIntersectionObserverMock>;

  beforeEach(() => {
    io = installIntersectionObserverMock();
    setPageScrollable(true);
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0, writable: true });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  /** Layout is simulated: jsdom measures nothing, so the test sets the heights. */
  function setScrollHeight(px: number) {
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: px });
  }

  it('offers the earlier control only when there is an earlier day', () => {
    const groups = [group('2026-07-05', 10)];
    const { rerender } = render(<EventListWindowed {...baseProps} groupedEvents={groups} />);
    expect(screen.queryByRole('button', { name: /Show earlier/ })).not.toBeInTheDocument();

    rerender(<EventListWindowed {...baseProps} groupedEvents={groups} earlierDay="2026-07-03" onShowEarlier={noop} />);
    expect(screen.getByRole('button', { name: /Show earlier/ })).toBeInTheDocument();
  });

  it('names the day it will show, never just "earlier"', () => {
    render(
      <EventListWindowed {...baseProps} groupedEvents={[group('2026-07-05', 10)]}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );
    const button = screen.getByRole('button', { name: /Show earlier/ });
    expect(button).toHaveTextContent('Show earlier (Friday, Jul 3)');
    expect(button).toHaveAttribute('aria-label', 'Show earlier events, Friday, Jul 3');
  });

  it('calls onShowEarlier when clicked', () => {
    const onShowEarlier = vi.fn();
    render(
      <EventListWindowed {...baseProps} groupedEvents={[group('2026-07-05', 10)]}
        earlierDay="2026-07-03" onShowEarlier={onShowEarlier} />
    );
    screen.getByRole('button', { name: /Show earlier/ }).click();
    expect(onShowEarlier).toHaveBeenCalledTimes(1);
  });

  it('restores scroll position across the prepend', () => {
    const groups = [group('2026-07-05', 10)];
    setScrollHeight(2000);
    (window as unknown as { scrollY: number }).scrollY = 900;

    const { rerender } = render(
      <EventListWindowed {...baseProps} groupedEvents={groups}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );
    screen.getByRole('button', { name: /Show earlier/ }).click();

    // The page grows by 600px above the reader's position.
    setScrollHeight(2600);
    rerender(
      <EventListWindowed {...baseProps} groupedEvents={[group('2026-07-03', 8), ...groups]}
        earlierDay="2026-07-02" onShowEarlier={noop} />
    );

    expect(window.scrollTo).toHaveBeenCalledWith(0, 1500);
  });

  it('does not touch scroll position on an ordinary re-render', () => {
    const groups = [group('2026-07-05', 10)];
    setScrollHeight(2000);
    const { rerender } = render(
      <EventListWindowed {...baseProps} groupedEvents={groups}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );

    setScrollHeight(2600);
    rerender(
      <EventListWindowed {...baseProps} groupedEvents={[...groups, group('2026-07-06', 5)]}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );

    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('corrects scroll only once per click', () => {
    const groups = [group('2026-07-05', 10)];
    setScrollHeight(2000);
    (window as unknown as { scrollY: number }).scrollY = 900;
    const { rerender } = render(
      <EventListWindowed {...baseProps} groupedEvents={groups}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );
    screen.getByRole('button', { name: /Show earlier/ }).click();

    setScrollHeight(2600);
    const prepended = [group('2026-07-03', 8), ...groups];
    rerender(<EventListWindowed {...baseProps} groupedEvents={prepended} earlierDay="2026-07-02" onShowEarlier={noop} />);
    setScrollHeight(3000);
    rerender(<EventListWindowed {...baseProps} groupedEvents={[...prepended, group('2026-07-06', 5)]} earlierDay="2026-07-02" onShowEarlier={noop} />);

    expect(window.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('forgets a pending correction when the filters change under it', () => {
    const groups = [group('2026-07-05', 10)];
    setScrollHeight(2000);
    const { rerender } = render(
      <EventListWindowed {...baseProps} groupedEvents={groups}
        earlierDay="2026-07-03" onShowEarlier={noop} />
    );
    screen.getByRole('button', { name: /Show earlier/ }).click();

    setScrollHeight(2600);
    rerender(
      <EventListWindowed {...baseProps} resetKey="k2" groupedEvents={[group('2026-08-01', 4)]}
        earlierDay={null} />
    );

    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
