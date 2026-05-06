import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/preact';
import { EmailChangePanel, maskEmail, formatRemainingTime } from '../EmailChangePanel';
import * as api from '@/lib/publisherStatusApi';

describe('formatRemainingTime', () => {
  // Pin "now" so the assertions are deterministic; the function accepts an
  // explicit nowMs override exactly to make this test easy.
  const now = Date.parse('2026-05-05T12:00:00Z');

  it('formats a 23h59m delta as "23h 59m"', () => {
    expect(formatRemainingTime('2026-05-06T11:59:00Z', now)).toBe('23h 59m');
  });

  it('formats a 1h05m delta as "1h 5m"', () => {
    expect(formatRemainingTime('2026-05-05T13:05:00Z', now)).toBe('1h 5m');
  });

  it('drops the hours prefix when under an hour ("12m")', () => {
    expect(formatRemainingTime('2026-05-05T12:12:00Z', now)).toBe('12m');
  });

  it('renders "<1m" when there are seconds left but no full minutes', () => {
    expect(formatRemainingTime('2026-05-05T12:00:30Z', now)).toBe('<1m');
  });

  it('returns null for an already-expired timestamp', () => {
    expect(formatRemainingTime('2026-05-05T11:59:00Z', now)).toBeNull();
  });

  it('returns null for a malformed timestamp', () => {
    expect(formatRemainingTime('not-a-date', now)).toBeNull();
  });
});

describe('maskEmail', () => {
  it('masks the local part to first letter + ***', () => {
    expect(maskEmail('alice@example.com')).toBe('a***@example.com');
  });

  it('returns the input unchanged when no @ is present', () => {
    expect(maskEmail('not-an-email')).toBe('not-an-email');
  });

  it('handles empty local part defensively', () => {
    expect(maskEmail('@example.com')).toBe('@example.com');
  });
});

describe('EmailChangePanel — no pending change', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => cleanup());

  it('renders the contact email and a "Change email" button', () => {
    render(
      <EmailChangePanel
        contactEmail="alice@example.com"
        pendingEmailChange={null}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText('alice@example.com')).toBeTruthy();
    expect(screen.getByText('Change email')).toBeTruthy();
  });

  it('clicking "Change email" opens a modal with a new-email input', () => {
    render(
      <EmailChangePanel
        contactEmail="alice@example.com"
        pendingEmailChange={null}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Change email'));
    expect(screen.getByLabelText('New email')).toBeTruthy();
    expect(screen.getByText('Send confirmation link')).toBeTruthy();
  });

  it('submitting the modal calls requestEmailChange and invokes onChanged', async () => {
    const requestSpy = vi
      .spyOn(api, 'requestEmailChange')
      .mockResolvedValue(undefined);
    const onChanged = vi.fn();

    render(
      <EmailChangePanel
        contactEmail="alice@example.com"
        pendingEmailChange={null}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByText('Change email'));
    fireEvent.input(screen.getByLabelText('New email'), {
      target: { value: 'bob@example.com' },
    });
    fireEvent.click(screen.getByText('Send confirmation link'));
    await waitFor(() => expect(requestSpy).toHaveBeenCalledWith('bob@example.com'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('blocks submission when the new email matches the current address', async () => {
    const requestSpy = vi.spyOn(api, 'requestEmailChange').mockResolvedValue(undefined);
    render(
      <EmailChangePanel
        contactEmail="alice@example.com"
        pendingEmailChange={null}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Change email'));
    fireEvent.input(screen.getByLabelText('New email'), {
      target: { value: 'ALICE@example.com' }, // case differs but normalises
    });
    fireEvent.click(screen.getByText('Send confirmation link'));
    await waitFor(() =>
      expect(screen.getByText(/already your contact email/i)).toBeTruthy(),
    );
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('renders the backend error when requestEmailChange rejects', async () => {
    vi.spyOn(api, 'requestEmailChange').mockRejectedValue(
      new Error("We can't accept that email address."),
    );
    render(
      <EmailChangePanel
        contactEmail="alice@example.com"
        pendingEmailChange={null}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Change email'));
    fireEvent.input(screen.getByLabelText('New email'), {
      target: { value: 'bob@example.com' },
    });
    fireEvent.click(screen.getByText('Send confirmation link'));
    await waitFor(() => expect(screen.getByText(/can't accept/i)).toBeTruthy());
  });
});

describe('EmailChangePanel — pending change', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('renders the masked target address and a Cancel button', () => {
    render(
      <EmailChangePanel
        contactEmail="alice@example.com"
        pendingEmailChange={{
          newEmail: 'bob@example.com',
          expiresAt: '2026-05-06T12:00:00Z',
        }}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText('Email change pending verification')).toBeTruthy();
    expect(screen.getByText('b***@example.com')).toBeTruthy();
    expect(screen.getByText('Cancel change')).toBeTruthy();
  });

  it('renders the link-expires-in hint when expiresAt is in the future', () => {
    // Use a fixed Date.now() so the rendered "Xh Ym" string is deterministic.
    // 23 hours into the future from the pinned "now".
    const now = Date.parse('2026-05-05T12:00:00Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    render(
      <EmailChangePanel
        contactEmail="alice@example.com"
        pendingEmailChange={{
          newEmail: 'bob@example.com',
          expiresAt: '2026-05-06T11:30:00Z', // ~23h 30m later
        }}
        onChanged={vi.fn()}
      />,
    );
    // The banner copy is rendered as one text node; assert via the shared
    // pending paragraph element using a regex that tolerates the entity
    // (mdash) character expanding into different whitespace.
    const banner = screen.getByText(/Pending verification by/i);
    expect(banner.textContent).toMatch(/link expires in 23h 30m/i);
  });

  it('omits the link-expires-in hint when expiresAt is already past', () => {
    const now = Date.parse('2026-05-05T12:00:00Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    render(
      <EmailChangePanel
        contactEmail="alice@example.com"
        pendingEmailChange={{
          newEmail: 'bob@example.com',
          expiresAt: '2026-05-05T11:00:00Z', // 1h ago
        }}
        onChanged={vi.fn()}
      />,
    );
    const banner = screen.getByText(/Pending verification by/i);
    expect(banner.textContent).not.toMatch(/link expires in/i);
  });

  it('clicking Cancel calls cancelEmailChangeBySelf and invokes onChanged', async () => {
    const cancelSpy = vi
      .spyOn(api, 'cancelEmailChangeBySelf')
      .mockResolvedValue(undefined);
    const onChanged = vi.fn();
    render(
      <EmailChangePanel
        contactEmail="alice@example.com"
        pendingEmailChange={{
          newEmail: 'bob@example.com',
          expiresAt: '2026-05-06T12:00:00Z',
        }}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByText('Cancel change'));
    await waitFor(() => expect(cancelSpy).toHaveBeenCalled());
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('renders an error message when cancelEmailChangeBySelf rejects', async () => {
    vi.spyOn(api, 'cancelEmailChangeBySelf').mockRejectedValue(
      new Error('Network failure'),
    );
    render(
      <EmailChangePanel
        contactEmail="alice@example.com"
        pendingEmailChange={{
          newEmail: 'bob@example.com',
          expiresAt: '2026-05-06T12:00:00Z',
        }}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Cancel change'));
    await waitFor(() => expect(screen.getByText('Network failure')).toBeTruthy());
  });
});
