// The /privacy page is a hard requirement for App Store submission
// (App Store Connect will not accept a build without a Privacy Policy
// URL). These tests pin the claims Apple's privacy questionnaire is
// answered with, so the page can't drift away from the nutrition label.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import PrivacyPage from '@/app/privacy/page';

describe('PrivacyPage', () => {
  it('renders a privacy policy heading', () => {
    render(<PrivacyPage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/privacy/i);
  });

  it('states that no accounts, analytics, or tracking are used', () => {
    render(<PrivacyPage />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/no account/i);
    expect(text).toMatch(/analytics/i);
    expect(text).toMatch(/tracking/i);
  });

  it('explains that calendar access is write-only', () => {
    render(<PrivacyPage />);
    expect(document.body.textContent ?? '').toMatch(/write-only/i);
  });

  it('carries the unaffiliated disclaimer', () => {
    render(<PrivacyPage />);
    expect(document.body.textContent ?? '').toMatch(/not affiliated with, endorsed by, or sponsored by Chautauqua Institution/);
  });

  it('links to the support page', () => {
    render(<PrivacyPage />);
    const link = screen.getByRole('link', { name: /support/i });
    expect(link.getAttribute('href')).toBe('/support');
  });
});
