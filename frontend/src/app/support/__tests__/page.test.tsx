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

  // Fix round 2 (PR #149 final review): this page is App Store Connect's
  // Support URL — the reviewer opens it — and it originally claimed "no
  // accounts, no analytics, and no tracking," flatly contradicting the App
  // Privacy declaration (Usage Data -> Product Interaction), the /privacy
  // page's "How We Measure Site Traffic" section, and reviewNotes. It must
  // not repeat that blanket claim, and must point to /privacy for the
  // actual traffic-measurement details instead of hedging with "(if any)".
  it('does not make a blanket no-analytics or no-tracking claim', () => {
    render(<SupportPage />);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/no analytics/i);
    expect(text).not.toMatch(/no tracking/i);
    expect(text).not.toMatch(/\(if any\)/i);
  });

  it('points to the privacy policy for how traffic is measured', () => {
    render(<SupportPage />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/aggregate traffic/i);
    expect(text).toMatch(/privacy policy/i);
  });
});
