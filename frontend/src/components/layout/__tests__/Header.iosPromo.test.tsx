import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';

const { available } = vi.hoisted(() => ({
  available: vi.fn(),
}));

vi.mock('@/lib/iosPromo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/iosPromo')>();
  return { ...actual, isAppPromoAvailable: available };
});

import { Header } from '../Header';
import { APP_STORE_URL } from '@/lib/constants';

const props = { selectedYear: 2026, availableYears: [2026], defaultYear: 2026, onYearChange: () => {} };

beforeEach(() => {
  available.mockReset();
});

afterEach(() => { vi.restoreAllMocks(); });

describe('Header "Get the app" affordance', () => {
  it('is absent on ineligible devices', () => {
    available.mockReturnValue(false);
    render(<Header {...props} />);
    expect(screen.queryByRole('link', { name: 'Get the app' })).toBeNull();
  });

  it('appears in the desktop nav on eligible devices, linking to the App Store', () => {
    available.mockReturnValue(true);
    render(<Header {...props} />);
    // Desktop nav link (the mobile dropdown is collapsed until "More").
    const link = screen.getByRole('link', { name: 'Get the app' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(APP_STORE_URL);
    expect(link.getAttribute('href')).not.toContain('chqcal://');
  });

  it('appears in the mobile dropdown on eligible devices', () => {
    available.mockReturnValue(true);
    render(<Header {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    // One in the desktop nav, one in the now-open dropdown.
    expect(screen.getAllByRole('link', { name: 'Get the app' })).toHaveLength(2);
  });

  // Collapsing the menu during the click would unmount this anchor from inside
  // its own click handler, which can cancel the navigation to the App Store.
  // Unlike the quick links, this entry closes on the next task instead.
  it('keeps the dropdown open through the click, then closes it', async () => {
    available.mockReturnValue(true);
    render(<Header {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    const inDropdown = screen.getAllByRole('link', { name: 'Get the app' })[1];
    fireEvent.click(inDropdown);
    // Still two: the dropdown had not collapsed by the time the click resolved.
    expect(screen.getAllByRole('link', { name: 'Get the app' })).toHaveLength(2);
    // Only the desktop-nav copy survives once the deferred close runs.
    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: 'Get the app' })).toHaveLength(1);
    });
  });
});
