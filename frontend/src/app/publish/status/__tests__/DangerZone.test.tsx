import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/preact';
import { DangerZone } from '../DangerZone';
import * as api from '@/lib/publisherStatusApi';
import * as auth from '@/lib/publisherAuthClient';
import { PublisherSelfDisableError, type PublisherStatusRecord } from '@/lib/publisherStatusApi';

const baseRec: PublisherStatusRecord = {
  id: 'pub-acme',
  name: 'Acme',
  contactEmail: 'a@b.com',
  sourceUrl: 'https://example.com/feed.json',
  sourceType: 'json',
  trustLevel: 'review',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  applicationStatus: 'approved',
};

// jsdom's window.location is read-only; replace just the parts we touch.
function stubLocation() {
  const replace = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, replace },
  });
  return replace;
}

describe('DangerZone', () => {
  let originalLocation: Location;

  beforeEach(() => {
    originalLocation = window.location;
    vi.restoreAllMocks();
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    cleanup();
  });

  it('renders the danger-zone copy and a Disable button', () => {
    render(<DangerZone publisher={baseRec} />);
    expect(screen.getByText(/Danger zone/i)).toBeTruthy();
    // Copy must mention retraction so the user understands the consequence.
    expect(screen.getByText(/retract/i)).toBeTruthy();
    // Button to open the modal — distinct from the modal's Confirm button,
    // both share copy by design ("Disable my publisher").
    expect(screen.getAllByText(/Disable my publisher/i).length).toBeGreaterThan(0);
  });

  it('opens a confirmation modal that shows the slug to type', () => {
    render(<DangerZone publisher={baseRec} />);
    fireEvent.click(screen.getByText('Disable my publisher'));
    // Modal text mentions the slug; the slug itself is rendered in a code block.
    expect(screen.getByText(/type the publisher slug/i)).toBeTruthy();
    // The literal slug must appear (in the prompt text — `pub-acme`).
    expect(screen.getByText('pub-acme')).toBeTruthy();
  });

  it('confirm button is disabled until the input matches the slug exactly', () => {
    render(<DangerZone publisher={baseRec} />);
    fireEvent.click(screen.getByText('Disable my publisher'));

    const input = screen.getByLabelText('Confirmation slug') as HTMLInputElement;
    // Multiple matches: the outer button (text only) + the modal confirm
    // button. The modal confirm button is the LAST one — find it via the
    // dialog scoping.
    const dialog = screen.getByRole('dialog');
    const confirmBtn = Array.from(
      dialog.querySelectorAll('button'),
    ).find(b => /Disable my publisher/i.test(b.textContent ?? '')) as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();
    expect(confirmBtn.disabled).toBe(true);

    fireEvent.input(input, { target: { value: 'pub-acm' } });
    expect(confirmBtn.disabled).toBe(true);

    // Trailing space — should still be disabled (server enforces exact match).
    fireEvent.input(input, { target: { value: 'pub-acme ' } });
    expect(confirmBtn.disabled).toBe(true);

    fireEvent.input(input, { target: { value: 'pub-acme' } });
    expect(confirmBtn.disabled).toBe(false);
  });

  it('on a successful disable, clears session and redirects to /publish/', async () => {
    const replace = stubLocation();
    const apiSpy = vi.spyOn(api, 'selfDisablePublisher').mockResolvedValue({
      ok: true,
      emailedTo: 'a@b.com',
    });
    const clearSpy = vi.spyOn(auth, 'clearPublisherSession').mockImplementation(() => {});

    render(<DangerZone publisher={baseRec} />);
    fireEvent.click(screen.getByText('Disable my publisher'));
    const input = screen.getByLabelText('Confirmation slug') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'pub-acme' } });

    const dialog = screen.getByRole('dialog');
    const confirmBtn = Array.from(
      dialog.querySelectorAll('button'),
    ).find(b => /Disable my publisher/i.test(b.textContent ?? '')) as HTMLButtonElement;
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(apiSpy).toHaveBeenCalledWith('pub-acme'));
    await waitFor(() => expect(clearSpy).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith('/publish/');
  });

  it('renders a server error message when the API rejects (and does NOT redirect)', async () => {
    const replace = stubLocation();
    vi.spyOn(api, 'selfDisablePublisher').mockRejectedValue(
      new PublisherSelfDisableError('Too many disable attempts.', 429, null),
    );

    render(<DangerZone publisher={baseRec} />);
    fireEvent.click(screen.getByText('Disable my publisher'));
    const input = screen.getByLabelText('Confirmation slug') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'pub-acme' } });

    const dialog = screen.getByRole('dialog');
    const confirmBtn = Array.from(
      dialog.querySelectorAll('button'),
    ).find(b => /Disable my publisher/i.test(b.textContent ?? '')) as HTMLButtonElement;
    fireEvent.click(confirmBtn);

    await waitFor(() =>
      expect(screen.getByText(/Too many disable attempts/i)).toBeTruthy(),
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it('maps a confirm_mismatch server response to a slug-mismatch hint', async () => {
    stubLocation();
    vi.spyOn(api, 'selfDisablePublisher').mockRejectedValue(
      new PublisherSelfDisableError('mismatch', 400, 'confirm_mismatch'),
    );

    render(<DangerZone publisher={baseRec} />);
    fireEvent.click(screen.getByText('Disable my publisher'));
    const input = screen.getByLabelText('Confirmation slug') as HTMLInputElement;
    // Fill exactly so the client-side guard lets the click through; the
    // server-side rejection then drives the error rendering.
    fireEvent.input(input, { target: { value: 'pub-acme' } });

    const dialog = screen.getByRole('dialog');
    const confirmBtn = Array.from(
      dialog.querySelectorAll('button'),
    ).find(b => /Disable my publisher/i.test(b.textContent ?? '')) as HTMLButtonElement;
    fireEvent.click(confirmBtn);

    await waitFor(() =>
      expect(screen.getByText(/did not match/i)).toBeTruthy(),
    );
  });

  it('Cancel closes the modal without calling the API', () => {
    const apiSpy = vi.spyOn(api, 'selfDisablePublisher');
    render(<DangerZone publisher={baseRec} />);
    fireEvent.click(screen.getByText('Disable my publisher'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(apiSpy).not.toHaveBeenCalled();
  });
});
