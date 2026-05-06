// Page-level wiring test for /publish/status/. We mock the API client and
// auth helpers so the page renders without hitting localStorage / network.
//
// The aim isn't to retest the API client itself (that's covered separately)
// — it's to verify that the page connects EditableField + SourceEditPanel
// to patchPublisherProfile / previewPublisherFeed correctly, and that
// pending/rejected applicants don't see the edit affordances.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';

vi.mock('@/lib/publisherStatusApi', () => ({
  getPublisherStatus: vi.fn(),
  patchPublisherProfile: vi.fn(),
  previewPublisherFeed: vi.fn(),
}));
vi.mock('@/lib/publisherAuthClient', () => ({
  isPublisherAuthenticated: () => true,
  getPublisherSession: () => ({
    jwt: 'test-jwt',
    publisherId: 'pub-1',
    email: 'pub@example.com',
  }),
  clearPublisherSession: vi.fn(),
}));

import * as api from '@/lib/publisherStatusApi';
import PublishStatusPage from '@/app/publish/status/page';
import type { PublisherStatusRecord } from '@/lib/publisherStatusApi';

function makeRecord(overrides: Partial<PublisherStatusRecord> = {}): PublisherStatusRecord {
  return {
    id: 'pub-1',
    name: 'Old Name',
    contactEmail: 'pub@example.com',
    sourceUrl: 'https://example.com/feed.json',
    sourceType: 'json',
    trustLevel: 'review',
    enabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    applicationStatus: 'approved',
    ...overrides,
  };
}

describe('PublishStatusPage — Phase 2 profile wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the EditableField for Name on an approved publisher', async () => {
    (api.getPublisherStatus as ReturnType<typeof vi.fn>).mockResolvedValue(makeRecord());
    render(<PublishStatusPage />);
    await waitFor(() => expect(screen.getByText('Old Name')).toBeTruthy());
    expect(screen.getByLabelText('Edit Name')).toBeTruthy();
  });

  it('does NOT render edit affordances for pending applicants', async () => {
    (api.getPublisherStatus as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeRecord({ applicationStatus: 'pending' }),
    );
    render(<PublishStatusPage />);
    await waitFor(() => expect(screen.getByText('Old Name')).toBeTruthy());
    expect(screen.queryByLabelText('Edit Name')).toBeNull();
    expect(screen.queryByLabelText('Edit source')).toBeNull();
  });

  it('does NOT render edit affordances for rejected applicants', async () => {
    (api.getPublisherStatus as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeRecord({ applicationStatus: 'rejected', rejectionReason: 'no thanks' }),
    );
    render(<PublishStatusPage />);
    await waitFor(() => expect(screen.getByText('Old Name')).toBeTruthy());
    expect(screen.queryByLabelText('Edit Name')).toBeNull();
  });

  it('saving a new Name calls patchPublisherProfile and re-renders with the response', async () => {
    (api.getPublisherStatus as ReturnType<typeof vi.fn>).mockResolvedValue(makeRecord());
    (api.patchPublisherProfile as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeRecord({ name: 'New Name' }),
    );
    render(<PublishStatusPage />);
    await waitFor(() => expect(screen.getByText('Old Name')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Edit Name'));
    fireEvent.input(screen.getByLabelText('Name'), {
      target: { value: 'New Name' },
    });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(api.patchPublisherProfile).toHaveBeenCalledWith({ name: 'New Name' }),
    );
    await waitFor(() => expect(screen.getByText('New Name')).toBeTruthy());
  });

  it('clicking the Edit-source pencil opens the SourceEditPanel; Cancel hides it', async () => {
    (api.getPublisherStatus as ReturnType<typeof vi.fn>).mockResolvedValue(makeRecord());
    render(<PublishStatusPage />);
    await waitFor(() => expect(screen.getByLabelText('Edit source')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Edit source'));
    expect(screen.getByText('Edit source', { selector: 'h3' })).toBeTruthy();
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() =>
      expect(screen.queryByText('Edit source', { selector: 'h3' })).toBeNull(),
    );
  });

  it('saving a new source dispatches patchPublisherProfile with sourceUrl + sourceType', async () => {
    (api.getPublisherStatus as ReturnType<typeof vi.fn>).mockResolvedValue(makeRecord());
    (api.previewPublisherFeed as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      summary: 'Validated 1 event.',
    });
    (api.patchPublisherProfile as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeRecord({ sourceUrl: 'https://other.example/feed.json', sourceType: 'html' }),
    );
    render(<PublishStatusPage />);
    await waitFor(() => expect(screen.getByLabelText('Edit source')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Edit source'));
    fireEvent.input(screen.getByLabelText('Source URL'), {
      target: { value: 'https://other.example/feed.json' },
    });
    fireEvent.click(screen.getByLabelText('HTML'));
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() => expect(screen.getByText('Preview passed')).toBeTruthy());
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(api.patchPublisherProfile).toHaveBeenCalledWith({
        sourceUrl: 'https://other.example/feed.json',
        sourceType: 'html',
      }),
    );
  });
});
