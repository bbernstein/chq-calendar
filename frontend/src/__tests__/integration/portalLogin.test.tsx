/**
 * Integration tests for /publish/login/ — publisher magic-link request.
 * Also covers the verify landing page at /publish/verify/.
 *
 * Pages:
 *  - frontend/src/app/publish/login/page.tsx — POST /api/publisher-auth/request
 *  - frontend/src/app/publish/verify/page.tsx — POST /api/publisher-auth/verify
 *                                              (or /api/publisher-apply/verify)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import PublishLoginPage from '@/app/publish/login/page';
import PublishVerifyPage from '@/app/publish/verify/page';
import { renderPage, installNavigationStub, type NavigationStub } from './helpers/render';
import { installFetchMock, type FetchMock } from './helpers/fetchMock';
import { logout, loginAsPublisher } from './helpers/auth';
import {
  PUBLISHER_EMAIL_KEY,
  PUBLISHER_ID_KEY,
  PUBLISHER_JWT_KEY,
} from '@/lib/publisherAuthClient';

describe('PublishLoginPage (integration)', () => {
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

  it('submits the email and renders the "check your inbox" success state', async () => {
    mock.on('POST', '/api/publisher-auth/request', { ok: true });

    renderPage(<PublishLoginPage />);
    fireEvent.input(screen.getByLabelText(/Email address/i), {
      target: { value: 'me@example.test' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: /Send sign-in link/i }).closest('form')!,
    );

    await waitFor(() => {
      expect(screen.getByText(/sign-in link is on its way/i)).toBeInTheDocument();
    });
    const calls = mock.calls('/api/publisher-auth/request');
    expect(calls).toHaveLength(1);
    expect(await calls[0].json()).toEqual({ email: 'me@example.test' });
  });

  it('renders the rate-limit message on 429', async () => {
    mock.on('POST', '/api/publisher-auth/request', () =>
      new Response(JSON.stringify({ error: 'Too many sign-in requests.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderPage(<PublishLoginPage />);
    fireEvent.input(screen.getByLabelText(/Email address/i), {
      target: { value: 'me@example.test' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: /Send sign-in link/i }).closest('form')!,
    );

    await waitFor(() => {
      expect(screen.getByText(/Too many sign-in requests/i)).toBeInTheDocument();
    });
  });

  it('redirects to /publish/status/ when an authenticated user lands on this page', async () => {
    // Use the shared helper rather than hand-rolling a JWT — it mirrors the
    // app's localStorage contract and synthesizes a valid `exp` claim.
    loginAsPublisher({ publisherId: 'pub-1', email: 'a@b.c' });

    renderPage(<PublishLoginPage />);
    await waitFor(() => {
      expect(nav.navigations()).toContain('/publish/status/');
    });
  });
});

describe('PublishVerifyPage (integration)', () => {
  let mock: FetchMock;
  let nav: NavigationStub;
  const originalSearch = window.location.search;

  beforeEach(() => {
    nav = installNavigationStub();
    mock = installFetchMock();
  });

  afterEach(() => {
    mock.uninstall();
    nav.uninstall();
    logout();
    // Restore the URL search via history (we change it per-test to feed the
    // page's URLSearchParams parsing).
    window.history.replaceState({}, '', window.location.pathname + originalSearch);
  });

  it('verifies a login-purpose token and writes the publisher session', async () => {
    window.history.replaceState({}, '', '/publish/verify/?token=abc&purpose=login');
    mock.on('POST', '/api/publisher-auth/verify', {
      jwt: 'jwt-here',
      publisherId: 'pub-test-1',
      email: 'me@example.test',
    });

    renderPage(<PublishVerifyPage />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Signed in/i })).toBeInTheDocument();
    });
    expect(localStorage.getItem(PUBLISHER_JWT_KEY)).toBe('jwt-here');
    expect(localStorage.getItem(PUBLISHER_ID_KEY)).toBe('pub-test-1');
    expect(localStorage.getItem(PUBLISHER_EMAIL_KEY)).toBe('me@example.test');
  });

  it('renders an error and writes no session when the token is invalid', async () => {
    window.history.replaceState({}, '', '/publish/verify/?token=bad&purpose=login');
    mock.on('POST', '/api/publisher-auth/verify', () =>
      new Response(JSON.stringify({ error: 'Invalid or expired token.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderPage(<PublishVerifyPage />);
    await waitFor(() => {
      expect(screen.getByText(/Couldn.t verify/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Invalid or expired token/i)).toBeInTheDocument();
    expect(localStorage.getItem(PUBLISHER_JWT_KEY)).toBeNull();
  });
});
