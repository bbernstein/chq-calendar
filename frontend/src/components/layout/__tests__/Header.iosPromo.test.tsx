import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

const { available, launch } = vi.hoisted(() => ({
  available: vi.fn(),
  launch: vi.fn(() => vi.fn()),
}));

vi.mock('@/lib/iosPromo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/iosPromo')>();
  return { ...actual, isAppLaunchAvailable: available, launchApp: launch };
});

import { Header } from '../Header';

const props = { selectedYear: 2026, availableYears: [2026], defaultYear: 2026, onYearChange: () => {} };

beforeEach(() => {
  available.mockReset();
  launch.mockReset();
  launch.mockReturnValue(vi.fn());
});

afterEach(() => { vi.restoreAllMocks(); });

describe('Header "Open in app" affordance', () => {
  it('is absent on ineligible devices', () => {
    available.mockReturnValue(false);
    render(<Header {...props} />);
    expect(screen.queryByRole('button', { name: 'Open in app' })).toBeNull();
  });

  it('appears in the desktop nav on eligible devices and launches the app', () => {
    available.mockReturnValue(true);
    render(<Header {...props} />);
    // Desktop nav button (the mobile dropdown is collapsed until "More").
    fireEvent.click(screen.getByRole('button', { name: 'Open in app' }));
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('appears in the mobile dropdown on eligible devices', () => {
    available.mockReturnValue(true);
    render(<Header {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    // One in the desktop nav, one in the now-open dropdown.
    expect(screen.getAllByRole('button', { name: 'Open in app' })).toHaveLength(2);
  });
});
