import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/preact';
import { IngestControls } from '../IngestControls';
import * as api from '@/lib/publisherStatusApi';
import { PublisherFetchNowError, type PublisherStatusRecord } from '@/lib/publisherStatusApi';

const baseRec: PublisherStatusRecord = {
  id: 'pub-1',
  name: 'Test',
  contactEmail: 'a@b.com',
  sourceUrl: 'https://example.com/feed.json',
  sourceType: 'json',
  trustLevel: 'review',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  applicationStatus: 'approved',
};

describe('IngestControls', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => cleanup());

  it('shows "active" copy and a Pause button when not paused', () => {
    render(<IngestControls publisher={baseRec} onChanged={vi.fn()} />);
    expect(screen.getByText(/your feed is/i).textContent).toMatch(/active/i);
    expect(screen.getByText('Pause fetches')).toBeTruthy();
    expect(screen.queryByText('Resume fetches')).toBeNull();
    expect(screen.getByText('Fetch now')).toBeTruthy();
  });

  it('shows "paused" copy and a Resume button when paused', () => {
    render(
      <IngestControls
        publisher={{ ...baseRec, paused: true }}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText(/your feed is/i).textContent).toMatch(/paused/i);
    expect(screen.getByText('Resume fetches')).toBeTruthy();
    expect(screen.queryByText('Pause fetches')).toBeNull();
  });

  it('pause button opens a confirmation modal explaining events stay live', async () => {
    render(<IngestControls publisher={baseRec} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText('Pause fetches'));
    await waitFor(() =>
      expect(screen.getByText(/Pause fetches\?/i)).toBeTruthy(),
    );
    expect(screen.getByText(/Pausing stops new fetches/i)).toBeTruthy();
    expect(screen.getByText(/events stay live/i)).toBeTruthy();
    expect(screen.getByText('Pause anyway')).toBeTruthy();
  });

  it('confirming the pause modal calls pausePublisher and onChanged', async () => {
    const pauseSpy = vi.spyOn(api, 'pausePublisher').mockResolvedValue({
      ...baseRec,
      paused: true,
    });
    const onChanged = vi.fn();

    render(<IngestControls publisher={baseRec} onChanged={onChanged} />);
    fireEvent.click(screen.getByText('Pause fetches'));
    fireEvent.click(screen.getByText('Pause anyway'));

    await waitFor(() => expect(pauseSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('cancelling the pause modal does NOT call pausePublisher', async () => {
    const pauseSpy = vi.spyOn(api, 'pausePublisher').mockResolvedValue(baseRec);
    render(<IngestControls publisher={baseRec} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText('Pause fetches'));
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() =>
      expect(screen.queryByText('Pause anyway')).toBeNull(),
    );
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it('resume button is one-click (no modal) and calls resumePublisher + onChanged', async () => {
    const resumeSpy = vi.spyOn(api, 'resumePublisher').mockResolvedValue({
      ...baseRec,
      paused: false,
    });
    const onChanged = vi.fn();

    render(
      <IngestControls
        publisher={{ ...baseRec, paused: true }}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByText('Resume fetches'));
    // No modal should appear — direct call.
    expect(screen.queryByText('Resume anyway')).toBeNull();
    await waitFor(() => expect(resumeSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('fetch-now success shows the queued info message', async () => {
    vi.spyOn(api, 'triggerFetchNow').mockResolvedValue({
      acceptedAt: '2026-05-05T12:00:00.000Z',
    });
    render(<IngestControls publisher={baseRec} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText('Fetch now'));
    await waitFor(() =>
      expect(screen.getByText(/Fetch queued/i)).toBeTruthy(),
    );
  });

  it('fetch-now 429 disables the button with a countdown that decrements over time', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(api, 'triggerFetchNow').mockRejectedValue(
        new PublisherFetchNowError('rate-limited', 429, 3),
      );
      render(<IngestControls publisher={baseRec} onChanged={vi.fn()} />);
      fireEvent.click(screen.getByText('Fetch now'));
      // Allow the rejected promise to settle.
      await act(async () => {
        await Promise.resolve();
      });
      // Initial label.
      expect(screen.getByText(/Try again in 3s/i)).toBeTruthy();
      // The button is disabled — querying by role is the most robust check.
      const btn = screen.getByText(/Try again in 3s/i).closest('button');
      expect(btn).not.toBeNull();
      expect((btn as HTMLButtonElement).disabled).toBe(true);

      // Advance 1s — countdown ticks.
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByText(/Try again in 2s/i)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
