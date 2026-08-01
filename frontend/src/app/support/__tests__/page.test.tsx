// The /support page satisfies App Store Connect's required Support URL.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import SupportPage from '@/app/support/page';

describe('SupportPage', () => {
  it('renders a support heading', () => {
    render(<SupportPage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/support/i);
  });

  it('links to the feedback form for reporting problems', () => {
    render(<SupportPage />);
    const link = screen.getByRole('link', { name: /feedback/i });
    expect(link.getAttribute('href')).toBe('/feedback');
  });

  it('links to the privacy policy', () => {
    render(<SupportPage />);
    const link = screen.getByRole('link', { name: /privacy/i });
    expect(link.getAttribute('href')).toBe('/privacy');
  });

  it('carries the unaffiliated disclaimer', () => {
    render(<SupportPage />);
    expect(document.body.textContent ?? '').toMatch(/not affiliated with, endorsed by, or sponsored by Chautauqua Institution/);
  });

  it('points users to chq.org as the authoritative source', () => {
    render(<SupportPage />);
    expect(document.body.textContent ?? '').toMatch(/chq\.org/);
  });
});
