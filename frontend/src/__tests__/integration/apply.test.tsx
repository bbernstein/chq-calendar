/**
 * Integration tests for /publish/apply/ — the publisher application form.
 *
 * Page: frontend/src/app/publish/apply/page.tsx
 * Endpoint: POST /api/publisher-apply/request
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import PublishApplyPage from '@/app/publish/apply/page';
import { renderPage } from './helpers/render';
import { installFetchMock, type FetchMock } from './helpers/fetchMock';

describe('PublishApplyPage (integration)', () => {
  let mock: FetchMock;

  beforeEach(() => {
    mock = installFetchMock();
  });

  afterEach(() => {
    mock.uninstall();
  });

  // VITE_RECAPTCHA_SITE_KEY is unset in tests, so the captcha layer is
  // skipped — see the comment block in apply/page.tsx for why submitting
  // without a token is fine in non-prod.

  it('renders all required fields and the submit button', () => {
    renderPage(<PublishApplyPage />);
    expect(screen.getByPlaceholderText(/Athenaeum Hotel/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/you@example.com/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/example.com\/events.json/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Send verification email/i }),
    ).toBeInTheDocument();
  });

  it('submits the form payload to /api/publisher-apply/request and shows success state', async () => {
    mock.on('POST', '/api/publisher-apply/request', { ok: true });

    renderPage(<PublishApplyPage />);
    fireEvent.input(screen.getByPlaceholderText(/Athenaeum Hotel/i), {
      target: { value: 'Test Venue' },
    });
    fireEvent.input(screen.getByPlaceholderText(/you@example.com/i), {
      target: { value: 'me@example.com' },
    });
    fireEvent.input(screen.getByPlaceholderText(/example.com\/events.json/i), {
      target: { value: 'https://example.com/events.json' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: /Send verification email/i }).closest('form')!,
    );

    await waitFor(() => {
      expect(screen.getByText(/Check your email/i)).toBeInTheDocument();
    });
    const calls = mock.calls('/api/publisher-apply/request');
    expect(calls).toHaveLength(1);
    const body = await calls[0].json();
    expect(body).toMatchObject({
      name: 'Test Venue',
      email: 'me@example.com',
      sourceUrl: 'https://example.com/events.json',
      sourceType: 'json',
    });
  });

  it('renders an inline field error when the server returns one (e.g. EmailAlreadyInUse)', async () => {
    mock.on('POST', '/api/publisher-apply/request', {
      status: 400,
      body: { error: 'Email already in use', field: 'email' },
    });
    // The fetchMock helper accepts a function for nuanced statuses:
    mock.reset();
    mock.on('POST', '/api/publisher-apply/request', () =>
      new Response(JSON.stringify({ error: 'Email already in use', field: 'email' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderPage(<PublishApplyPage />);
    fireEvent.input(screen.getByPlaceholderText(/Athenaeum Hotel/i), {
      target: { value: 'X' },
    });
    fireEvent.input(screen.getByPlaceholderText(/you@example.com/i), {
      target: { value: 'taken@example.com' },
    });
    fireEvent.input(screen.getByPlaceholderText(/example.com\/events.json/i), {
      target: { value: 'https://example.com/events.json' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: /Send verification email/i }).closest('form')!,
    );

    await waitFor(() => {
      expect(screen.getByText(/Email already in use/i)).toBeInTheDocument();
    });
    // Error state stays editable — submit button must not be permanently disabled.
    expect(
      screen.getByRole('button', { name: /Send verification email/i }),
    ).not.toBeDisabled();
  });

  it('renders a top-level error when the server returns a non-field error', async () => {
    mock.on('POST', '/api/publisher-apply/request', () =>
      new Response(JSON.stringify({ error: 'Validation failed' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderPage(<PublishApplyPage />);
    fireEvent.input(screen.getByPlaceholderText(/Athenaeum Hotel/i), {
      target: { value: 'X' },
    });
    fireEvent.input(screen.getByPlaceholderText(/you@example.com/i), {
      target: { value: 'me@example.com' },
    });
    fireEvent.input(screen.getByPlaceholderText(/example.com\/events.json/i), {
      target: { value: 'https://example.com/x.json' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: /Send verification email/i }).closest('form')!,
    );

    await waitFor(() => {
      expect(screen.getByText(/Validation failed/)).toBeInTheDocument();
    });
  });

  it('renders the rate-limit message on 429', async () => {
    mock.on('POST', '/api/publisher-apply/request', () =>
      new Response(JSON.stringify({ error: 'Too many applications, slow down.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderPage(<PublishApplyPage />);
    fireEvent.input(screen.getByPlaceholderText(/Athenaeum Hotel/i), {
      target: { value: 'X' },
    });
    fireEvent.input(screen.getByPlaceholderText(/you@example.com/i), {
      target: { value: 'me@example.com' },
    });
    fireEvent.input(screen.getByPlaceholderText(/example.com\/events.json/i), {
      target: { value: 'https://example.com/x.json' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: /Send verification email/i }).closest('form')!,
    );

    await waitFor(() => {
      expect(screen.getByText(/Too many applications/i)).toBeInTheDocument();
    });
  });

  it('disables the submit button while the request is in flight', async () => {
    // TS's flow analyzer narrows `resolveNet` to `null` at the call site below
    // (the closure mutation is invisible to it), so use a type variable that
    // explicitly preserves the function-or-null union via the indirect ref.
    const resolverRef: { current: (() => void) | null } = { current: null };
    mock.on('POST', '/api/publisher-apply/request', () => {
      return new Promise<Response>(resolve => {
        resolverRef.current = () =>
          resolve(
            new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
      });
    });

    renderPage(<PublishApplyPage />);
    fireEvent.input(screen.getByPlaceholderText(/Athenaeum Hotel/i), {
      target: { value: 'X' },
    });
    fireEvent.input(screen.getByPlaceholderText(/you@example.com/i), {
      target: { value: 'me@example.com' },
    });
    fireEvent.input(screen.getByPlaceholderText(/example.com\/events.json/i), {
      target: { value: 'https://example.com/x.json' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: /Send verification email/i }).closest('form')!,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Sending/i })).toBeDisabled();
    });
    resolverRef.current?.();
    await waitFor(() => {
      expect(screen.getByText(/Check your email/i)).toBeInTheDocument();
    });
  });
});
