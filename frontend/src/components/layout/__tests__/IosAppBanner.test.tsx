import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

const { shouldShow, snooze, launch } = vi.hoisted(() => ({
  shouldShow: vi.fn(),
  snooze: vi.fn(),
  launch: vi.fn(() => vi.fn()),
}));

vi.mock('@/lib/iosPromo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/iosPromo')>();
  return { ...actual, shouldShowPromoBanner: shouldShow, snoozePromo: snooze, launchApp: launch };
});

import { IosAppBanner } from '../IosAppBanner';
import { APP_STORE_URL } from '@/app/about/aboutContent';

beforeEach(() => {
  shouldShow.mockReset();
  snooze.mockReset();
  launch.mockReset();
  launch.mockReturnValue(vi.fn());
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
    const link = screen.getByRole('link', { name: 'App Store' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(APP_STORE_URL);
    expect(APP_STORE_URL).not.toBe('');
  });

  it('"Open in app" launches the app, snoozes, and hides the banner', () => {
    shouldShow.mockReturnValue(true);
    const { container } = render(<IosAppBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Open in app' }));
    expect(launch).toHaveBeenCalledTimes(1);
    expect(snooze).toHaveBeenCalledTimes(1);
    expect(container.firstChild).toBeNull();
  });

  it('dismiss snoozes and hides without launching', () => {
    shouldShow.mockReturnValue(true);
    const { container } = render(<IosAppBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(snooze).toHaveBeenCalledTimes(1);
    expect(launch).not.toHaveBeenCalled();
    expect(container.firstChild).toBeNull();
  });
});
