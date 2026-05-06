/**
 * Integration tests for /publish/status/ — the publisher portal.
 *
 * Page: frontend/src/app/publish/status/page.tsx
 *
 * Covers:
 *  - Unauth redirect to /publish/login/
 *  - Status load (GET /api/publisher-status)
 *  - Profile name edit (PATCH /api/publisher-profile)
 *  - Email-change request (POST /api/publisher-email-change)
 *  - Pause/resume (POST /api/publisher-pause, /api/publisher-resume)
 *  - Fetch-now (POST /api/publisher-fetch-now)
 *  - Self-disable typed-confirm (POST /api/publisher-disable)
 *  - Form-submission regression (pins react→preact/compat alias from CLAUDE.md)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import PublishStatusPage from '@/app/publish/status/page';
import { renderPage, installNavigationStub, type NavigationStub } from './helpers/render';
import { installFetchMock, type FetchMock } from './helpers/fetchMock';
import { loginAsPublisher, logout } from './helpers/auth';

const SAMPLE_PUBLISHER = {
  id: 'pub-test-1',
  name: 'Test Publisher',
  contactEmail: 'pub@example.test',
  sourceUrl: 'https://example.com/feed.json',
  sourceType: 'json' as const,
  trustLevel: 'review' as const,
  enabled: true,
  paused: false,
  createdAt: '2026-04-01T12:00:00.000Z',
  applicationStatus: 'approved' as const,
  organization: 'Acme',
  lastFetchedAt: '2026-05-06T12:00:00.000Z',
  lastFetchStatus: 'ok' as const,
};

describe('PublishStatusPage (integration)', () => {
  let mock: FetchMock;
  let nav: NavigationStub;

  beforeEach(() => {
    nav = installNavigationStub();
    mock = installFetchMock();
  });

  afterEach(() => {
    mock.uninstall();
    nav.uninstall();
    logout();
  });

  it('redirects to /publish/login/ when there is no publisher session', async () => {
    renderPage(<PublishStatusPage />);
    await waitFor(() => {
      expect(nav.navigations()).toContain('/publish/login/');
    });
    // Should NOT have called the API.
    expect(mock.calls('/api/publisher-status')).toHaveLength(0);
  });

  it('loads and renders the publisher record on mount', async () => {
    loginAsPublisher();
    mock.on('GET', '/api/publisher-status', { publisher: SAMPLE_PUBLISHER });

    renderPage(<PublishStatusPage />);

    await waitFor(() => {
      expect(screen.getByText(/Publisher details/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Test Publisher')).toBeInTheDocument();
    expect(screen.getByText('pub-test-1')).toBeInTheDocument();
    expect(screen.getByText(/Approved/)).toBeInTheDocument();
  });

  it('PATCHes /api/publisher-profile when the publisher edits the Name field', async () => {
    loginAsPublisher();
    mock.on('GET', '/api/publisher-status', { publisher: SAMPLE_PUBLISHER });
    mock.on('PATCH', '/api/publisher-profile', {
      publisher: { ...SAMPLE_PUBLISHER, name: 'New Publisher Name' },
    });

    renderPage(<PublishStatusPage />);
    await waitFor(() => {
      expect(screen.getByText('Test Publisher')).toBeInTheDocument();
    });
    // Click the pencil for the Name field
    fireEvent.click(screen.getByRole('button', { name: /Edit Name/i }));
    // Then the input becomes labeled "Name"
    fireEvent.input(screen.getByLabelText(/^Name$/), {
      target: { value: 'New Publisher Name' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => {
      expect(screen.getByText('New Publisher Name')).toBeInTheDocument();
    });
    const calls = mock.calls('/api/publisher-profile');
    expect(calls).toHaveLength(1);
    expect(await calls[0].json()).toEqual({ name: 'New Publisher Name' });
  });

  it('opens the change-email modal and POSTs /api/publisher-email-change on submit', async () => {
    loginAsPublisher();
    mock.on('GET', '/api/publisher-status', { publisher: SAMPLE_PUBLISHER });
    mock.on('POST', '/api/publisher-email-change', { ok: true });

    renderPage(<PublishStatusPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Change email/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Change email/i }));

    const dialog = screen.getByRole('dialog');
    fireEvent.input(within(dialog).getByLabelText(/New email/i), {
      target: { value: 'new-pub@example.test' },
    });
    // Submit the form (regression test for the react→preact/compat alias —
    // if onChange/onInput normalisation breaks this submit silently fails).
    fireEvent.submit(within(dialog).getByRole('button', { name: /Send confirmation link/i }).closest('form')!);

    await waitFor(() => {
      const calls = mock.calls('/api/publisher-email-change');
      expect(calls).toHaveLength(1);
    });
    const body = await mock.calls('/api/publisher-email-change')[0].json();
    expect(body).toEqual({ newEmail: 'new-pub@example.test' });
  });

  it('pauses the publisher via POST /api/publisher-pause when the user confirms', async () => {
    loginAsPublisher();
    mock.on('GET', '/api/publisher-status', { publisher: SAMPLE_PUBLISHER });
    mock.on('POST', '/api/publisher-pause', {
      publisher: { ...SAMPLE_PUBLISHER, paused: true },
    });

    renderPage(<PublishStatusPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Pause fetches/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Pause fetches/i }));
    // Confirm modal
    fireEvent.click(screen.getByRole('button', { name: /Pause anyway/i }));

    await waitFor(() => {
      expect(mock.calls('/api/publisher-pause')).toHaveLength(1);
    });
  });

  it('triggers an immediate fetch via POST /api/publisher-fetch-now', async () => {
    loginAsPublisher();
    mock.on('GET', '/api/publisher-status', { publisher: SAMPLE_PUBLISHER });
    mock.on('POST', '/api/publisher-fetch-now', { acceptedAt: '2026-05-06T13:00:00.000Z' });

    renderPage(<PublishStatusPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Fetch now$/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /^Fetch now$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Fetch queued/i)).toBeInTheDocument();
    });
    expect(mock.calls('/api/publisher-fetch-now')).toHaveLength(1);
  });

  it('keeps the self-disable Confirm button disabled until the typed slug matches; then POSTs /api/publisher-disable and navigates away', async () => {
    loginAsPublisher();
    mock.on('GET', '/api/publisher-status', { publisher: SAMPLE_PUBLISHER });
    mock.on('POST', '/api/publisher-disable', {
      ok: true,
      emailedTo: 'pub@example.test',
    });

    renderPage(<PublishStatusPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Disable my publisher/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Disable my publisher/i }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /Disable my publisher/i });
    expect(confirm).toBeDisabled();
    // Wrong slug — still disabled
    fireEvent.input(within(dialog).getByLabelText(/Confirmation slug/i), {
      target: { value: 'pub-wrong' },
    });
    expect(confirm).toBeDisabled();
    // Right slug — enabled
    fireEvent.input(within(dialog).getByLabelText(/Confirmation slug/i), {
      target: { value: SAMPLE_PUBLISHER.id },
    });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(mock.calls('/api/publisher-disable')).toHaveLength(1);
    });
    await waitFor(() => {
      expect(nav.navigations()).toContain('/publish/');
    });
  });

  it('surfaces a top-level error when /api/publisher-status returns 500', async () => {
    loginAsPublisher();
    mock.on('GET', '/api/publisher-status', () =>
      new Response(JSON.stringify({ error: 'database is on fire' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderPage(<PublishStatusPage />);
    await waitFor(() => {
      expect(screen.getByText(/Could not load your status/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/database is on fire/i)).toBeInTheDocument();
  });
});
