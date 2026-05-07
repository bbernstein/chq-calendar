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

  it('clicking Reject reveals textarea and Confirm reject button', () => {
    render(
      <PendingEventCard
        event={makeEvent()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByPlaceholderText(/Why was this rejected/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm reject' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('Confirm reject with non-empty reason calls onReject with reason', () => {
    const onReject = vi.fn();
    render(
      <PendingEventCard
        event={makeEvent()}
        onApprove={vi.fn()}
        onReject={onReject}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    fireEvent.input(screen.getByPlaceholderText(/Why was this rejected/), {
      target: { value: 'duplicate' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reject' }));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledWith('pub-123', 'evt-456', 'duplicate');
  });

  it('Confirm reject with empty textarea calls onReject with empty reason', () => {
    const onReject = vi.fn();
    render(
      <PendingEventCard
        event={makeEvent()}
        onApprove={vi.fn()}
        onReject={onReject}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    // Leave textarea empty
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reject' }));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledWith('pub-123', 'evt-456', '');
  });

  it('Cancel button hides the textarea without calling onReject', () => {
    const onReject = vi.fn();
    render(
      <PendingEventCard
        event={makeEvent()}
        onApprove={vi.fn()}
        onReject={onReject}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByPlaceholderText(/Why was this rejected/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByPlaceholderText(/Why was this rejected/)).toBeNull();
    expect(onReject).not.toHaveBeenCalled();
  });

  it('Approve button is disabled and does not fire handler when disabled=true', () => {
    const onApprove = vi.fn();
    render(
      <PendingEventCard
        event={makeEvent()}
        onApprove={onApprove}
        onReject={vi.fn()}
        disabled={true}
      />,
    );

    const approveBtn = screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement;
    expect(approveBtn.disabled).toBe(true);
    fireEvent.click(approveBtn);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('Reject button is disabled when disabled=true', () => {
    render(
      <PendingEventCard
        event={makeEvent()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        disabled={true}
      />,
    );
    const rejectBtn = screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement;
    expect(rejectBtn.disabled).toBe(true);
  });
});
