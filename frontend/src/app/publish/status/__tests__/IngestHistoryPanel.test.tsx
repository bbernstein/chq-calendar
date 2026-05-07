import { render, screen, waitFor } from '@testing-library/preact';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { IngestHistoryPanel } from '../IngestHistoryPanel';

vi.mock('@/lib/publisherStatusApi', () => ({
  getPublisherRuns: vi.fn(),
}));

import { getPublisherRuns } from '@/lib/publisherStatusApi';

describe('IngestHistoryPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  test('renders empty state when no runs', async () => {
    (getPublisherRuns as any).mockResolvedValue([]);
    render(<IngestHistoryPanel />);
    await waitFor(() => expect(screen.getByText(/No ingest runs yet/i)).toBeInTheDocument());
  });

  test('renders OK run with counts (+12 ~3 -1)', async () => {
    (getPublisherRuns as any).mockResolvedValue([
      { publisherId: 'p1', runAt: '2026-05-06T12:00:00Z', status: 'ok', counts: { added: 12, updated: 3, retracted: 1, unchanged: 5 }, triggeredBy: 'schedule' },
    ]);
    render(<IngestHistoryPanel />);
    await waitFor(() => expect(screen.getByText(/\+12/)).toBeInTheDocument());
    expect(screen.getByText(/~3/)).toBeInTheDocument();
    expect(screen.getByText(/-1/)).toBeInTheDocument();
  });

  test('renders failure run with status badge and message', async () => {
    (getPublisherRuns as any).mockResolvedValue([
      { publisherId: 'p1', runAt: '2026-05-06T12:00:00Z', status: 'parse_error', message: 'unexpected token }', triggeredBy: 'schedule' },
    ]);
    render(<IngestHistoryPanel />);
    await waitFor(() => expect(screen.getByText(/unexpected token/)).toBeInTheDocument());
    expect(screen.getByText(/parse error/i)).toBeInTheDocument();
  });

  test('renders threshold_halt with amber/warning styling and reason', async () => {
    (getPublisherRuns as any).mockResolvedValue([
      { publisherId: 'p1', runAt: '2026-05-06T12:00:00Z', status: 'threshold_halt', message: 'Would remove 12 of 20 future events', triggeredBy: 'schedule' },
    ]);
    render(<IngestHistoryPanel />);
    await waitFor(() => expect(screen.getByText(/threshold halt|halt/i)).toBeInTheDocument());
    expect(screen.getByText(/Would remove 12/)).toBeInTheDocument();
  });

  test('renders error state on API failure', async () => {
    (getPublisherRuns as any).mockRejectedValue(new Error('boom'));
    render(<IngestHistoryPanel />);
    await waitFor(() => expect(screen.getByText(/Failed to load|Error/i)).toBeInTheDocument());
  });

  test('shows triggered-by label', async () => {
    (getPublisherRuns as any).mockResolvedValue([
      { publisherId: 'p1', runAt: '2026-05-06T12:00:00Z', status: 'ok', counts: { added: 0, updated: 0, retracted: 0, unchanged: 5 }, triggeredBy: 'publisher-fetch-now' },
    ]);
    render(<IngestHistoryPanel />);
    await waitFor(() => expect(screen.getByText(/publisher-fetch-now/i)).toBeInTheDocument());
  });
});
