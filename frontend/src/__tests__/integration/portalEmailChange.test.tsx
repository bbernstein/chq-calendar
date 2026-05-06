/**
 * Integration tests for the email-change verify and cancel landing pages.
 *
 * Pages:
 *  - frontend/src/app/publish/email-change/verify/page.tsx
 *      GET /api/publisher-email-change/verify?token=...
 *      kind=ok + newEmail   → window.location.replace('/publish/login/?email=&reason=email-changed')
 *      kind=ok no newEmail  → renders "Email change verified"
 *      kind=expired/...     → renders error
 *  - frontend/src/app/publish/email-change/cancel/page.tsx
 *      GET /api/publisher-email-change/cancel?token=...
 *      kind=ok              → renders "Email change cancelled"
 *      kind=expired/...     → renders error
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';
import PublishEmailChangeVerifyPage from '@/app/publish/email-change/verify/page';
import PublishEmailChangeCancelPage from '@/app/publish/email-change/cancel/page';
import { renderPage, installNavigationStub, type NavigationStub } from './helpers/render';
import { installFetchMock, type FetchMock } from './helpers/fetchMock';

describe('PublishEmailChangeVerifyPage (integration)', () => {
  let mock: FetchMock;
  let nav: NavigationStub;

  beforeEach(() => {
    nav = installNavigationStub();
    mock = installFetchMock();
  });

  afterEach(() => {
    mock.uninstall();
    nav.uninstall();
    window.history.replaceState({}, '', '/');
  });

  it('verifies a token and redirects to /publish/login/ with prefilled email', async () => {
    window.history.replaceState({}, '', '/publish/email-change/verify/?token=tok-abc');
    mock.on('GET', /\/api\/publisher-email-change\/verify/, {
      kind: 'ok',
      newEmail: 'new@example.test',
    });

    renderPage(<PublishEmailChangeVerifyPage />);

    await waitFor(() => {
      const navs = nav.navigations();
      expect(navs.some(u => u.includes('/publish/login/'))).toBe(true);
    });
    const target = nav.navigations().find(u => u.includes('/publish/login/'))!;
    expect(target).toContain('email=new%40example.test');
    expect(target).toContain('reason=email-changed');

    const calls = mock.calls(/\/api\/publisher-email-change\/verify/);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('token=tok-abc');
  });

  it('renders an error and does not navigate when the token is expired', async () => {
    window.history.replaceState({}, '', '/publish/email-change/verify/?token=bad');
    mock.on('GET', /\/api\/publisher-email-change\/verify/, {
      kind: 'expired',
    });

    renderPage(<PublishEmailChangeVerifyPage />);

    await waitFor(() => {
      expect(screen.getByText(/Couldn.t confirm/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/expired/i)).toBeInTheDocument();
    expect(nav.navigations()).toHaveLength(0);
  });
});

describe('PublishEmailChangeCancelPage (integration)', () => {
  let mock: FetchMock;
  let nav: NavigationStub;

  beforeEach(() => {
    nav = installNavigationStub();
    mock = installFetchMock();
  });

  afterEach(() => {
    mock.uninstall();
    nav.uninstall();
    window.history.replaceState({}, '', '/');
  });

  it('cancels the pending change and renders the success page', async () => {
    window.history.replaceState({}, '', '/publish/email-change/cancel/?token=cancel-tok');
    mock.on('GET', /\/api\/publisher-email-change\/cancel/, {
      kind: 'ok',
      lockedUntil: '2026-06-01T00:00:00.000Z',
    });

    renderPage(<PublishEmailChangeCancelPage />);

    await waitFor(() => {
      expect(screen.getByText(/Email change cancelled/i)).toBeInTheDocument();
    });
    const calls = mock.calls(/\/api\/publisher-email-change\/cancel/);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('token=cancel-tok');
  });
});
