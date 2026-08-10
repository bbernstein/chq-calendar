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

  // Fix round 1: the page originally claimed CDN logs are "not used for
  // tracking, advertising, or profiling" — false, per
  // infrastructure/traffic-analytics.tf's cf_visitor_key derivation and the
  // returning-visitor Athena queries. The page must not deny profiling.
  it('does not deny that server-side traffic measurement is a form of profiling', () => {
    render(<PrivacyPage />);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/not\s+used\s+for\s+tracking,?\s+advertising,?\s+or\s+profiling/i);
    expect(text).not.toMatch(/not\s+profiling/i);
  });

  it('discloses that IP addresses and user-agents are measured and retained 90 days', () => {
    render(<PrivacyPage />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/ip address/i);
    expect(text).toMatch(/user-agent/i);
    expect(text).toMatch(/90 days/i);
  });

  it('discloses aggregate visitor measurement is not used for advertising and is not sold or shared', () => {
    render(<PrivacyPage />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/not used for advertising/i);
    expect(text).toMatch(/(sold or shared|shared or sold)/i);
  });
});
