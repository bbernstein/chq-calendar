/// <reference types="vitest/globals" />
import { render, screen } from '@testing-library/preact';
import { EventCard } from '@/components/calendar/EventCard';
import type { Event } from '@/lib/types';

function baseEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'e',
    title: 'Test',
    startDate: '2026-07-04T18:00:00Z',
    endDate: '2026-07-04T19:00:00Z',
    ...overrides,
  };
}

const noopProps = {
  index: 0,
  isExpanded: false,
  onToggleDescription: () => {},
  onToggleTag: () => {},
  isTagSelected: () => false,
  isFavorite: false,
  onToggleFavorite: () => {},
  onDownloadICS: () => {},
};

describe('EventCard publisher attribution and status', () => {
  it('renders the publisher attribution when sourcePublisherName is present', () => {
    render(<EventCard event={baseEvent({ sourcePublisherName: 'Source Pub' })} {...noopProps} />);
    expect(screen.getByText(/Source Pub/)).toBeInTheDocument();
  });

  it('renders the Cancelled badge and strike-through title when status=cancelled', () => {
    render(
      <EventCard
        event={baseEvent({ sourcePublisherName: 'Source Pub', status: 'cancelled' })}
        {...noopProps}
      />,
    );
    expect(screen.getByText(/Cancelled/i)).toBeInTheDocument();
    const title = screen.getByText('Test');
    expect(title.className).toMatch(/line-through/);
  });

  it('renders the Rescheduled badge when status=rescheduled', () => {
    render(
      <EventCard
        event={baseEvent({ sourcePublisherName: 'Source Pub', status: 'rescheduled' })}
        {...noopProps}
      />,
    );
    expect(screen.getByText(/Rescheduled/i)).toBeInTheDocument();
  });

  it('renders nothing publisher-related for a primary event', () => {
    render(<EventCard event={baseEvent()} {...noopProps} />);
    expect(screen.queryByText(/^via /)).toBeNull();
    expect(screen.queryByText(/Cancelled/i)).toBeNull();
    expect(screen.queryByText(/Rescheduled/i)).toBeNull();
  });

  it('never makes the title a link, even when url is set', () => {
    render(<EventCard event={baseEvent({ url: 'https://example.com/event' })} {...noopProps} />);
    expect(screen.queryByRole('link', { name: /Test/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Test/ })).toBeInTheDocument();
  });

  it('keeps the panel and its link available when status=cancelled and url is set', () => {
    render(
      <EventCard
        event={baseEvent({ url: 'https://example.com/event', status: 'cancelled' })}
        {...noopProps}
        isExpanded={true}
      />,
    );
    expect(screen.getByRole('button', { name: /Test/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open event page/ })).toBeInTheDocument();
  });

  it('keeps the panel and its link available when status=rescheduled and url is set', () => {
    render(
      <EventCard
        event={baseEvent({ url: 'https://example.com/event', status: 'rescheduled' })}
        {...noopProps}
        isExpanded={true}
      />,
    );
    expect(screen.getByRole('link', { name: /Open event page/ })).toBeInTheDocument();
  });
});
