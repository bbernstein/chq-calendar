import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact';

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

// Tailwind's `hidden lg:flex` / `lg:hidden` are CSS, so both clusters are in
// the DOM under jsdom and queries have to be scoped to one of them.
const desktop = () => screen.getByTestId('header-desktop');
const mobile = () => screen.getByTestId('header-mobile');

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

  it('appears in the desktop "Chautauqua" menu on eligible devices, linking to the App Store', () => {
    available.mockReturnValue(true);
    render(<Header {...props} />);
    // #228 moved the promo inside the menu, so it is collapsed until opened.
    fireEvent.click(within(desktop()).getByRole('button', { name: /Chautauqua/ }));
    const link = within(desktop()).getByRole('link', { name: 'Get the app' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(APP_STORE_URL);
    expect(link.getAttribute('href')).not.toContain('chqcal://');
  });

  it('appears in the mobile dropdown on eligible devices', () => {
    available.mockReturnValue(true);
    render(<Header {...props} />);
    fireEvent.click(within(mobile()).getByRole('button', { name: /More/ }));
    // The desktop menu is closed, so the dropdown's copy is the only one.
    expect(screen.getAllByRole('link', { name: 'Get the app' })).toHaveLength(1);
  });

  // Collapsing the menu during the click would unmount this anchor from inside
  // its own click handler, which can cancel the navigation to the App Store.
  // HeaderMenu defers the close for every item; this pins it for the promo,
  // the entry the workaround was originally written for.
  it('keeps the dropdown open through the click, then closes it', async () => {
    available.mockReturnValue(true);
    render(<Header {...props} />);
    fireEvent.click(within(mobile()).getByRole('button', { name: /More/ }));
    const inDropdown = within(mobile()).getByRole('link', { name: 'Get the app' });
    fireEvent.click(inDropdown);
    // Still mounted: the dropdown had not collapsed by the time the click resolved.
    expect(within(mobile()).getByRole('link', { name: 'Get the app' })).toBeInTheDocument();
    await waitFor(() => {
      expect(within(mobile()).queryByRole('link', { name: 'Get the app' })).toBeNull();
    });
  });
});
