import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { Header } from '../Header';
import { quickLinks } from '@/lib/quickLinks';

// Global cleanup runs from frontend/src/__tests__/setup.ts (afterEach hook).

const defaultProps = {
  selectedYear: 2026,
  availableYears: [2026],
  defaultYear: 2026,
  onYearChange: () => {},
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Header navigation', () => {
  // The header is driven by shared/links.json (also consumed by the iOS
  // app), so every entry must appear in both the desktop nav and the
  // mobile dropdown, opening its webPath when one is set (Feedback stays
  // a same-site relative link) and its absolute url otherwise.
  it.each(quickLinks)('desktop nav opens $title from shared/links.json', (link) => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<Header {...defaultProps} />);

    // Only the desktop nav is rendered up front; the mobile dropdown is
    // gated behind the "More" toggle, so exactly one button exists here.
    fireEvent.click(screen.getByRole('button', { name: link.title }));
    expect(openSpy).toHaveBeenCalledWith(link.webPath ?? link.url, '_blank', 'noopener,noreferrer');
  });

  it.each(quickLinks)('mobile dropdown opens $title from shared/links.json', (link) => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<Header {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    const buttons = screen.getAllByRole('button', { name: link.title });
    expect(buttons).toHaveLength(2);

    fireEvent.click(buttons[1]);
    expect(openSpy).toHaveBeenCalledWith(link.webPath ?? link.url, '_blank', 'noopener,noreferrer');
  });

  it('closes the mobile dropdown after a link is opened', () => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<Header {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Chautauqua Fund' })[1]);
    expect(screen.getAllByRole('button', { name: 'Chautauqua Fund' })).toHaveLength(1);
  });
});
