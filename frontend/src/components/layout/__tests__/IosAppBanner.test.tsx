import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';

const { shouldShow, snooze } = vi.hoisted(() => ({
  shouldShow: vi.fn(),
  snooze: vi.fn(),
}));

vi.mock('@/lib/iosPromo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/iosPromo')>();
  return { ...actual, shouldShowPromoBanner: shouldShow, snoozePromo: snooze };
});

import { IosAppBanner } from '../IosAppBanner';
import { APP_STORE_URL } from '@/lib/constants';

beforeEach(() => {
  shouldShow.mockReset();
  snooze.mockReset();
});

afterEach(() => { vi.restoreAllMocks(); });

describe('IosAppBanner', () => {
  it('renders nothing when the promo should not show', () => {
    shouldShow.mockReturnValue(false);
    const { container } = render(<IosAppBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the prompt and a live App Store link when eligible', () => {
    shouldShow.mockReturnValue(true);
    render(<IosAppBanner />);
    expect(screen.getByText(/Get the CHQ Calendar app/)).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Get the app' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(APP_STORE_URL);
    expect(APP_STORE_URL).not.toBe('');
  });

  // The CTA must stay a plain link: navigating to the app's chqcal:// scheme
  // instead raises Safari's "the address is invalid" alert for every visitor
  // who doesn't have the app — the banner's whole audience.
  it('points the CTA straight at the App Store, not a custom scheme', () => {
    shouldShow.mockReturnValue(true);
    render(<IosAppBanner />);
    const link = screen.getByRole('link', { name: 'Get the app' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')?.startsWith('https://apps.apple.com/')).toBe(true);
    expect(link.getAttribute('href')).not.toContain('chqcal://');
  });

  // The CTA snoozes but must NOT unmount itself during the click: removing the
  // anchor from inside its own click handler can cancel the navigation to the
  // App Store. It hides on the next task instead, so a user returning from the
  // App Store (iOS keeps this page loaded) doesn't see a banner they acted on.
  it('taking the CTA snoozes, leaves the link to navigate, then hides', async () => {
    shouldShow.mockReturnValue(true);
    const { container } = render(<IosAppBanner />);
    fireEvent.click(screen.getByRole('link', { name: 'Get the app' }));
    expect(snooze).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Get the app' })).toBeTruthy();
    await waitFor(() => { expect(container.firstChild).toBeNull(); });
  });

  it('dismiss snoozes and hides the banner', () => {
    shouldShow.mockReturnValue(true);
    const { container } = render(<IosAppBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(snooze).toHaveBeenCalledTimes(1);
    expect(container.firstChild).toBeNull();
  });
});
