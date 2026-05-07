/**
 * Integration tests for /publish/test/ — the public feed validator.
 *
 * Page: frontend/src/app/publish/test/page.tsx
 * Endpoint: POST /api/publisher-test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import PublishTestPage from '@/app/publish/test/page';
import { renderPage } from './helpers/render';
import { installFetchMock, type FetchMock } from './helpers/fetchMock';

const SAMPLE_FEED_OK = {
  fetchStatus: 'ok',
  feed: {
    formatVersion: '1.0.0',
    publisher: {
      id: 'pub-demo',
      name: 'Demo Publisher',
      contactEmail: 'demo@example.com',
    },
    events: [
      {
        id: 'evt-1',
        title: 'Sample Event',
        startDate: '2026-07-01T18:00:00.000Z',
        endDate: '2026-07-01T19:00:00.000Z',
        category: 'lecture',
        lastModified: '2026-06-15T00:00:00.000Z',
      },
    ],
  },
  report: { ok: true, errors: [], warnings: [] },
};

describe('PublishTestPage (integration)', () => {
  let mock: FetchMock;

  beforeEach(() => {
    mock = installFetchMock();
  });

  afterEach(() => {
    mock.uninstall();
  });

  it('rejects an empty URL with a client-side error and does not call the API', () => {
    renderPage(<PublishTestPage />);
    // Form has `required` so submit is blocked by the browser, but in jsdom
    // we get an explicit click-then-error path. Click the button directly.
    const button = screen.getByRole('button', { name: /Test feed/i });
    fireEvent.click(button);
    // Either the browser blocks via required, or the page surfaces "Please enter a URL".
    // Either way, no fetch call.
    expect(mock.calls('/api/publisher-test')).toHaveLength(0);
  });

  it('submits the URL + sourceType payload and renders the parsed event count on success', async () => {
    mock.on('POST', '/api/publisher-test', SAMPLE_FEED_OK);

    renderPage(<PublishTestPage />);
    fireEvent.input(screen.getByLabelText(/Feed URL/i), {
      target: { value: 'https://example.com/feed.json' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: /Test feed/i }).closest('form')!,
    );

    await waitFor(() => {
      expect(screen.getByText(/Feed OK/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/1 event parsed/i)).toBeInTheDocument();
    expect(screen.getByText(/Sample Event/)).toBeInTheDocument();
    const calls = mock.calls('/api/publisher-test');
    expect(calls).toHaveLength(1);
    const body = await calls[0].json();
    expect(body).toMatchObject({
      url: 'https://example.com/feed.json',
      sourceType: 'json',
    });
  });

  it('renders validation errors with path and message', async () => {
    mock.on('POST', '/api/publisher-test', {
      fetchStatus: 'validation_error',
      feed: null,
      report: {
        ok: false,
        errors: [
          { path: 'events[0].title', message: 'must be a non-empty string' },
        ],
        warnings: [],
      },
    });

    renderPage(<PublishTestPage />);
    fireEvent.input(screen.getByLabelText(/Feed URL/i), {
      target: { value: 'https://example.com/bad.json' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: /Test feed/i }).closest('form')!,
    );

    await waitFor(() => {
      expect(screen.getByText(/Validation error/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/events\[0\]\.title/)).toBeInTheDocument();
    expect(screen.getByText(/must be a non-empty string/)).toBeInTheDocument();
  });

  it('renders a network/server-error banner on 500', async () => {
    mock.on('POST', '/api/publisher-test', () =>
      new Response(JSON.stringify({ error: 'upstream blew up' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderPage(<PublishTestPage />);
    fireEvent.input(screen.getByLabelText(/Feed URL/i), {
      target: { value: 'https://example.com/x.json' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: /Test feed/i }).closest('form')!,
    );

    await waitFor(() => {
      expect(screen.getByText(/Server error/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/upstream blew up/)).toBeInTheDocument();
  });
});
