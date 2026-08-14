import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

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

  // Collapsing the menu would unmount this anchor from inside its own click
  // handler, which can cancel the navigation to the App Store — so unlike the
  // quick links, this entry deliberately leaves the dropdown open.
  it('leaves the mobile dropdown open when its link is clicked', () => {
    available.mockReturnValue(true);
    render(<Header {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    const inDropdown = screen.getAllByRole('link', { name: 'Get the app' })[1];
    fireEvent.click(inDropdown);
    // Still two: the dropdown never collapsed, so its copy survived the click.
    expect(screen.getAllByRole('link', { name: 'Get the app' })).toHaveLength(2);
  });
});
