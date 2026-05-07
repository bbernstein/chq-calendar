import { render, screen, waitFor } from '@testing-library/preact';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { PublisherEventsPanel } from '../PublisherEventsPanel';

vi.mock('@/lib/publisherStatusApi', () => ({ getPublisherEvents: vi.fn() }));
import { getPublisherEvents } from '@/lib/publisherStatusApi';

describe('PublisherEventsPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  test('empty state', async () => {
    (getPublisherEvents as any).mockResolvedValue([]);
    render(<PublisherEventsPanel />);
    await waitFor(() => expect(screen.getByText(/No events ingested yet/i)).toBeInTheDocument());
  });

  test('renders all three states with badges', async () => {
    (getPublisherEvents as any).mockResolvedValue([
      { eventId: 'a', title: 'Concert', startDate: '2030-07-01T18:00:00Z', endDate: '2030-07-01T20:00:00Z', state: 'published', updatedAt: 'x' },
      { eventId: 'b', title: 'Lecture', startDate: '2030-07-02T18:00:00Z', endDate: '2030-07-02T19:00:00Z', state: 'pending', updatedAt: 'x' },
      { eventId: 'c', title: 'Panel', startDate: '2030-07-03T18:00:00Z', endDate: '2030-07-03T19:00:00Z', state: 'rejected', rejectionReason: 'duplicate', rejectedAt: '2026-05-05T10:00:00Z', updatedAt: 'x' },
    ]);
    render(<PublisherEventsPanel />);
    await waitFor(() => expect(screen.getByText(/Concert/)).toBeInTheDocument());
    expect(screen.getByText(/Published/i)).toBeInTheDocument();
    expect(screen.getByText(/Pending review/i)).toBeInTheDocument();
    expect(screen.getByText(/Rejected/i)).toBeInTheDocument();
    expect(screen.getByText(/duplicate/)).toBeInTheDocument();
  });

  test('rejected without reason shows "Removed by admin." generic line', async () => {
    (getPublisherEvents as any).mockResolvedValue([
      { eventId: 'c', title: 'Panel', startDate: '2030-07-03T18:00:00Z', endDate: '2030-07-03T19:00:00Z', state: 'rejected', updatedAt: 'x' },
    ]);
    render(<PublisherEventsPanel />);
    await waitFor(() => expect(screen.getByText(/Removed by admin/i)).toBeInTheDocument());
  });

  test('error state', async () => {
    (getPublisherEvents as any).mockRejectedValue(new Error('boom'));
    render(<PublisherEventsPanel />);
    await waitFor(() => expect(screen.getByText(/Failed to load|Error/i)).toBeInTheDocument());
  });
});
