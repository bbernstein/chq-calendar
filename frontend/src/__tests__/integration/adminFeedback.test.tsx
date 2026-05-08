/**
 * Integration tests for /admin/feedback/ — feedback-detail modal a11y.
 *
 * Page: frontend/src/app/admin/feedback/page.tsx
 *
 * Locks in the conversion of the feedback-detail modal to <Modal>: it now has
 * role="dialog", aria-modal, aria-labelledby, and Esc closes. Before this
 * conversion the custom `fixed inset-0 ...` markup had none of those.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import AdminFeedbackPage from '@/app/admin/feedback/page';
import { renderPage, installNavigationStub, type NavigationStub } from './helpers/render';
import { installFetchMock, type FetchMock } from './helpers/fetchMock';
import { loginAsAdmin, logout } from './helpers/auth';

const SAMPLE_FEEDBACK = {
  id: 'fb-1',
  feedback: 'I love this calendar.',
  contactInfo: 'fan@example.test',
  timestamp: 1715000000000,
  createdAt: '2026-05-06T12:00:00.000Z',
  archived: false,
};

describe('AdminFeedbackPage — detail modal a11y', () => {
  let mock: FetchMock;
  let nav: NavigationStub;

  afterEach(() => {
    mock?.uninstall();
    nav?.uninstall();
    logout();
  });

  it('opens the detail modal with role=dialog and aria-labelledby', async () => {
    nav = installNavigationStub();
    mock = installFetchMock();
    loginAsAdmin();
    mock.on('GET', /\/admin\/api\/feedback$/, { feedbacks: [SAMPLE_FEEDBACK] });

    renderPage(<AdminFeedbackPage />);

    await waitFor(() => {
      expect(screen.getByText('I love this calendar.')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('I love this calendar.'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'feedback-detail-title');
  });

  it('closes the detail modal on Escape', async () => {
    nav = installNavigationStub();
    mock = installFetchMock();
    loginAsAdmin();
    mock.on('GET', /\/admin\/api\/feedback$/, { feedbacks: [SAMPLE_FEEDBACK] });

    renderPage(<AdminFeedbackPage />);

    await waitFor(() => {
      expect(screen.getByText('I love this calendar.')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('I love this calendar.'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
