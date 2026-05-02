import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { PendingEventCard } from '../../../app/admin/publisher-events/PendingEventCard';
import type { PendingEvent } from '@/lib/adminPublisherApi';

function makeEvent(overrides: Partial<PendingEvent> = {}): PendingEvent {
  return {
    publisherId: 'pub-123',
    eventId: 'evt-456',
    startDate: '2026-07-01T10:00:00Z',
    endDate: '2026-07-01T12:00:00Z',
    lastModified: '2026-05-01T00:00:00Z',
    payload: {
      title: 'Summer Concert',
      startDate: '2026-07-01T10:00:00Z',
      endDate: '2026-07-01T12:00:00Z',
      category: 'Music',
      sourcePublisherId: 'pub-123',
      sourcePublisherName: 'Chautauqua Arts',
    },
    state: 'pending',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

describe('PendingEventCard', () => {
  it('renders event title', () => {
    render(
      <PendingEventCard
        event={makeEvent()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText('Summer Concert')).toBeTruthy();
  });

  it('renders the source publisher name', () => {
    render(
      <PendingEventCard
        event={makeEvent()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText(/Chautauqua Arts/)).toBeTruthy();
  });

  it('clicking Approve calls onApprove with publisherId and eventId', () => {
    const onApprove = vi.fn();
    render(
      <PendingEventCard
        event={makeEvent()}
        onApprove={onApprove}
        onReject={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledWith('pub-123', 'evt-456');
  });

  it('clicking Reject calls onReject with publisherId and eventId', () => {
    const onReject = vi.fn();
    render(
      <PendingEventCard
        event={makeEvent()}
        onApprove={vi.fn()}
        onReject={onReject}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledWith('pub-123', 'evt-456');
  });

  it('both buttons are disabled and clicks do not fire handlers when disabled=true', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(
      <PendingEventCard
        event={makeEvent()}
        onApprove={onApprove}
        onReject={onReject}
        disabled={true}
      />,
    );

    const approveBtn = screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement;
    const rejectBtn = screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement;

    expect(approveBtn.disabled).toBe(true);
    expect(rejectBtn.disabled).toBe(true);

    fireEvent.click(approveBtn);
    fireEvent.click(rejectBtn);

    expect(onApprove).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });
});
