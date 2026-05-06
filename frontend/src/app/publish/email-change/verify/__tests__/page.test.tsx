/**
 * Wiring tests for /publish/email-change/verify/.
 *
 * Focus is on the redirect contract: we MUST NOT redirect to
 * /publish/login/?email=&reason=email-changed when the backend returns
 * `kind: 'ok'` without a usable `newEmail`. That banner would tell the
 * user "you just changed to <empty>" and prefill a blank sign-in form.
 *
 * The happy path (proper newEmail → location.replace) is also covered to
 * lock in the contract direction so a future refactor can't silently
 * regress it back to "always redirect".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/preact';

import PublishEmailChangeVerifyPage from '@/app/publish/email-change/verify/page';

// Capture window.location.replace calls without actually navigating jsdom.
const originalLocation = window.location;

function installLocationStub(search: string): { replaceMock: ReturnType<typeof vi.fn> } {
  const replaceMock = vi.fn();
  // jsdom's location is read-only; redefine for the test.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...originalLocation,
      search,
      pathname: '/publish/email-change/verify/',
      replace: replaceMock,
    },
  });
  return { replaceMock };
}

function restoreLocation(): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
}

function mockFetchOnce(body: unknown, ok = true): void {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fetchMock);
}

describe('PublishEmailChangeVerifyPage — malformed ok responses', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    restoreLocation();
  });

  it('does NOT redirect when the backend returns ok without newEmail', async () => {
    const { replaceMock } = installLocationStub('?token=tok-abc');
    mockFetchOnce({ kind: 'ok' }); // missing newEmail

    render(<PublishEmailChangeVerifyPage />);

    await waitFor(() => {
      expect(screen.getByText(/email change verified/i)).toBeTruthy();
    });
    expect(replaceMock).not.toHaveBeenCalled();
    // And specifically: never with a blank `?email=`.
    expect(replaceMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/email=&/),
    );
  });

  it('does NOT redirect when the backend returns ok with an empty-string newEmail', async () => {
    const { replaceMock } = installLocationStub('?token=tok-abc');
    mockFetchOnce({ kind: 'ok', newEmail: '' });

    render(<PublishEmailChangeVerifyPage />);

    await waitFor(() => {
      expect(screen.getByText(/email change verified/i)).toBeTruthy();
    });
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('does NOT redirect when the backend returns ok with a non-string newEmail', async () => {
    const { replaceMock } = installLocationStub('?token=tok-abc');
    mockFetchOnce({ kind: 'ok', newEmail: 42 });

    render(<PublishEmailChangeVerifyPage />);

    await waitFor(() => {
      expect(screen.getByText(/email change verified/i)).toBeTruthy();
    });
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('redirects with the new email when the backend returns a valid ok payload', async () => {
    const { replaceMock } = installLocationStub('?token=tok-abc');
    mockFetchOnce({ kind: 'ok', newEmail: 'new@example.com' });

    render(<PublishEmailChangeVerifyPage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalled();
    });
    const target = String(replaceMock.mock.calls[0][0]);
    expect(target).toContain('/publish/login/');
    expect(target).toContain('email=new%40example.com');
    expect(target).toContain('reason=email-changed');
  });
});
