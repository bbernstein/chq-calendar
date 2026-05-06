/**
 * Integration tests for /admin/publishers/ — admin publisher management.
 *
 * Page: frontend/src/app/admin/publishers/page.tsx
 *
 * Covers:
 *  - Unauth → redirect to /admin/login/ (in non-localhost contexts)
 *  - Authed → GET /admin/api/publishers + /admin/api/publisher-applications/pending
 *    populates table + pending list
 *  - Approve a pending application → POST .../approve → row moves
 *  - Reject a pending application → inline reason + POST .../reject
 *  - Run-ingest → POST /admin/api/publishers/run-ingest → button transitions to
 *    "Running…" and disables
 *  - Toggle pause → PATCH /admin/api/publishers/:id with { paused: true }
 *  - Toggle disable → PATCH /admin/api/publishers/:id with { enabled: false, paused: false }
 *  - Last-fetch detail row renders status badge + lastFetchMessage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import AdminPublishersPage from '@/app/admin/publishers/page';
import { renderPage, installNavigationStub, type NavigationStub } from './helpers/render';
import { installFetchMock, type FetchMock } from './helpers/fetchMock';
import { loginAsAdmin, logout } from './helpers/auth';

const SAMPLE_PUBLISHER = {
  id: 'pub-1',
  name: 'Active Publisher',
  contactEmail: 'pub@example.test',
  sourceUrl: 'https://example.com/feed.json',
  sourceType: 'json' as const,
  trustLevel: 'review' as const,
  enabled: true,
  paused: false,
  applicationStatus: 'approved' as const,
  createdAt: '2026-04-01T00:00:00.000Z',
  lastFetchedAt: '2026-05-06T10:00:00.000Z',
  lastFetchStatus: 'parse_error' as const,
  lastFetchMessage: 'Sample parse error',
};

const SAMPLE_PENDING = {
  id: 'pub-2',
  name: 'Pending Publisher',
  contactEmail: 'pending@example.test',
  sourceUrl: 'https://example.com/pending.json',
  sourceType: 'json' as const,
  trustLevel: 'review' as const,
  enabled: false,
  paused: false,
  applicationStatus: 'pending' as const,
  createdAt: '2026-05-01T00:00:00.000Z',
};

describe('AdminPublishersPage (integration)', () => {
  let mock: FetchMock;
  let nav: NavigationStub;

  afterEach(() => {
    mock?.uninstall();
    nav?.uninstall();
    logout();
  });

  it('redirects to /admin/login/ when no admin session is present (non-localhost)', async () => {
    nav = installNavigationStub({ hostname: 'admin.example.com' });
    mock = installFetchMock();
    // No loginAsAdmin — useAdminAuth should redirect.

    renderPage(<AdminPublishersPage />);

    await waitFor(() => {
      expect(nav.navigations()).toContain('/admin/login/');
    });
    // Should NOT have called any admin API.
    expect(mock.calls(/\/admin\/api\//)).toHaveLength(0);
  });

  it('loads and renders the publisher list and pending applications when authenticated', async () => {
    nav = installNavigationStub();
    mock = installFetchMock();
    loginAsAdmin();
    mock.on('GET', /\/admin\/api\/publishers$/, { publishers: [SAMPLE_PUBLISHER] });
    mock.on('GET', /\/admin\/api\/publisher-applications\/pending$/, {
      applications: [SAMPLE_PENDING],
    });

    renderPage(<AdminPublishersPage />);

    await waitFor(() => {
      expect(screen.getByText('Active Publisher')).toBeInTheDocument();
    });
    // Pending applications section renders the pending row separately.
    expect(screen.getByText('Pending Publisher')).toBeInTheDocument();
    // Last-fetch status badge + message render.
    expect(screen.getByText('parse_error')).toBeInTheDocument();
    expect(screen.getByText('Sample parse error')).toBeInTheDocument();
  });

  it('approves a pending application by POSTing to .../approve', async () => {
    nav = installNavigationStub();
    mock = installFetchMock();
    loginAsAdmin();
    mock.on('GET', /\/admin\/api\/publishers$/, { publishers: [] });
    mock.on('GET', /\/admin\/api\/publisher-applications\/pending$/, {
      applications: [SAMPLE_PENDING],
    });
    mock.on('POST', /\/admin\/api\/publisher-applications\/pub-2\/approve$/, {
      publisher: { ...SAMPLE_PENDING, applicationStatus: 'approved' },
    });

    renderPage(<AdminPublishersPage />);
    await waitFor(() => {
      expect(screen.getByText('Pending Publisher')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Approve$/i }));

    await waitFor(() => {
      const calls = mock.calls(/publisher-applications\/pub-2\/approve/);
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe('POST');
    });
  });

  it('rejects a pending application by POSTing the reason', async () => {
    nav = installNavigationStub();
    mock = installFetchMock();
    loginAsAdmin();
    mock.on('GET', /\/admin\/api\/publishers$/, { publishers: [] });
    mock.on('GET', /\/admin\/api\/publisher-applications\/pending$/, {
      applications: [SAMPLE_PENDING],
    });
    mock.on('POST', /\/admin\/api\/publisher-applications\/pub-2\/reject$/, {
      publisher: { ...SAMPLE_PENDING, applicationStatus: 'rejected' },
    });

    renderPage(<AdminPublishersPage />);
    await waitFor(() => {
      expect(screen.getByText('Pending Publisher')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Reject$/i }));
    // The Reject inline form should appear with a textarea + a confirm button.
    const textarea = await screen.findByRole('textbox');
    fireEvent.input(textarea, { target: { value: 'Spam application' } });
    // Click the confirm button (the second "Reject"-labeled one).
    const buttons = screen.getAllByRole('button', { name: /reject/i });
    // The last "Reject" button is the inline confirm.
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => {
      const calls = mock.calls(/publisher-applications\/pub-2\/reject/);
      expect(calls).toHaveLength(1);
    });
    const body = await mock.calls(/publisher-applications\/pub-2\/reject/)[0].json();
    expect(body).toEqual({ reason: 'Spam application' });
  });

  it('triggers run-ingest and disables the button while it is running', async () => {
    nav = installNavigationStub();
    mock = installFetchMock();
    loginAsAdmin();
    mock.on('GET', /\/admin\/api\/publishers$/, { publishers: [SAMPLE_PUBLISHER] });
    mock.on('GET', /\/admin\/api\/publisher-applications\/pending$/, { applications: [] });
    mock.on('POST', /\/admin\/api\/publishers\/run-ingest$/, {
      triggeredAt: '2026-05-06T11:00:00.000Z',
    });

    renderPage(<AdminPublishersPage />);
    await waitFor(() => {
      expect(screen.getByText('Active Publisher')).toBeInTheDocument();
    });

    const button = screen.getByRole('button', { name: /Run ingest now/i });
    fireEvent.click(button);

    await waitFor(() => {
      const calls = mock.calls(/\/publishers\/run-ingest/);
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe('POST');
    });
    // Button transitions to "Running…" and is disabled.
    await waitFor(() => {
      const running = screen.getByRole('button', { name: /Running/i });
      expect(running).toBeDisabled();
    });
  });

  it('pauses an enabled publisher via PATCH { paused: true }', async () => {
    nav = installNavigationStub();
    mock = installFetchMock();
    loginAsAdmin();
    mock.on('GET', /\/admin\/api\/publishers$/, { publishers: [SAMPLE_PUBLISHER] });
    mock.on('GET', /\/admin\/api\/publisher-applications\/pending$/, { applications: [] });
    mock.on('PATCH', /\/admin\/api\/publishers\/pub-1$/, {
      publisher: { ...SAMPLE_PUBLISHER, paused: true },
    });

    renderPage(<AdminPublishersPage />);
    await waitFor(() => {
      expect(screen.getByText('Active Publisher')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Pause Active Publisher$/i }));

    await waitFor(() => {
      const calls = mock.calls(/\/admin\/api\/publishers\/pub-1$/);
      const patches = calls.filter(c => c.method === 'PATCH');
      expect(patches).toHaveLength(1);
    });
    const patch = mock
      .calls(/\/admin\/api\/publishers\/pub-1$/)
      .find(c => c.method === 'PATCH')!;
    expect(await patch.json()).toEqual({ paused: true });
  });

  it('disables an enabled publisher via PATCH { enabled: false, paused: false }', async () => {
    nav = installNavigationStub();
    mock = installFetchMock();
    loginAsAdmin();
    mock.on('GET', /\/admin\/api\/publishers$/, { publishers: [SAMPLE_PUBLISHER] });
    mock.on('GET', /\/admin\/api\/publisher-applications\/pending$/, { applications: [] });
    mock.on('PATCH', /\/admin\/api\/publishers\/pub-1$/, {
      publisher: { ...SAMPLE_PUBLISHER, enabled: false, paused: false },
    });

    renderPage(<AdminPublishersPage />);
    await waitFor(() => {
      expect(screen.getByText('Active Publisher')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Disable Active Publisher$/i }));

    await waitFor(() => {
      const patches = mock
        .calls(/\/admin\/api\/publishers\/pub-1$/)
        .filter(c => c.method === 'PATCH');
      expect(patches).toHaveLength(1);
    });
    const patch = mock
      .calls(/\/admin\/api\/publishers\/pub-1$/)
      .find(c => c.method === 'PATCH')!;
    expect(await patch.json()).toEqual({ enabled: false, paused: false });
  });

  it('opens the delete confirmation modal and POSTs DELETE on confirm', async () => {
    nav = installNavigationStub();
    mock = installFetchMock();
    loginAsAdmin();
    mock.on('GET', /\/admin\/api\/publishers$/, { publishers: [SAMPLE_PUBLISHER] });
    mock.on('GET', /\/admin\/api\/publisher-applications\/pending$/, { applications: [] });
    mock.on('DELETE', /\/admin\/api\/publishers\/pub-1$/, { deletedEvents: 5 });

    renderPage(<AdminPublishersPage />);
    await waitFor(() => {
      expect(screen.getByText('Active Publisher')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Delete Active Publisher$/i }));

    // Modal renders.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Delete publisher\?/i)).toBeInTheDocument();

    // Confirm.
    fireEvent.click(within(dialog).getByRole('button', { name: /^Delete$/i }));

    await waitFor(() => {
      const deletes = mock
        .calls(/\/admin\/api\/publishers\/pub-1$/)
        .filter(c => c.method === 'DELETE');
      expect(deletes).toHaveLength(1);
    });
  });
});
