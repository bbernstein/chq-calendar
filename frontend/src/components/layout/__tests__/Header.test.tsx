import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { Header } from '../Header';

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
  it('renders the Questions button in the desktop nav linking to questions.chq.org', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<Header {...defaultProps} />);

    // Only the desktop nav is rendered up front; the mobile dropdown is
    // gated behind the "More" toggle, so exactly one Questions button exists.
    const questions = screen.getByRole('button', { name: 'Questions' });
    fireEvent.click(questions);
    expect(openSpy).toHaveBeenCalledWith('https://questions.chq.org/', '_blank', 'noopener,noreferrer');
  });

  it('renders the Questions button in the mobile dropdown', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<Header {...defaultProps} />);

    // Open the mobile "More" dropdown to reveal its copy of the links.
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    const questions = screen.getAllByRole('button', { name: 'Questions' });
    // Desktop + mobile copies are both present once the dropdown is open.
    expect(questions).toHaveLength(2);

    fireEvent.click(questions[1]);
    expect(openSpy).toHaveBeenCalledWith('https://questions.chq.org/', '_blank', 'noopener,noreferrer');
  });

  it('renders the Bus & Tram Tracker button in the desktop nav', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<Header {...defaultProps} />);

    const tracker = screen.getByRole('button', { name: 'Bus & Tram Tracker' });
    fireEvent.click(tracker);
    expect(openSpy).toHaveBeenCalledWith('https://busandtramtracker.chq.org', '_blank', 'noopener,noreferrer');
  });

  it('renders the Bus & Tram Tracker button in the mobile dropdown', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<Header {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    const trackers = screen.getAllByRole('button', { name: 'Bus & Tram Tracker' });
    expect(trackers).toHaveLength(2);

    fireEvent.click(trackers[1]);
    expect(openSpy).toHaveBeenCalledWith('https://busandtramtracker.chq.org', '_blank', 'noopener,noreferrer');
  });
});
