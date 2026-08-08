import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { AboutLayout } from './AboutLayout';
import { DISCLAIMER } from './aboutContent';

describe('AboutLayout', () => {
  it('renders the page title and children', () => {
    render(<AboutLayout title="Guide" current="overview"><p>Body copy</p></AboutLayout>);
    expect(screen.getByRole('heading', { name: 'Guide', level: 1 })).toBeTruthy();
    expect(screen.getByText('Body copy')).toBeTruthy();
  });

  it('renders the optional subtitle', () => {
    render(<AboutLayout title="Guide" subtitle="How it works" current="overview"><p>x</p></AboutLayout>);
    expect(screen.getByText('How it works')).toBeTruthy();
  });

  it('links to all three guide pages plus support', () => {
    render(<AboutLayout title="Guide" current="overview"><p>x</p></AboutLayout>);
    const hrefs = Array.from(document.querySelectorAll('nav a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/about', '/about/iphone', '/about/web', '/support']));
  });

  it('marks the current page for assistive tech', () => {
    render(<AboutLayout title="Guide" current="ios"><p>x</p></AboutLayout>);
    expect(screen.getByRole('link', { current: 'page' }).getAttribute('href')).toBe('/about/iphone');
  });

  it('renders the canonical disclaimer in the footer', () => {
    render(<AboutLayout title="Guide" current="overview"><p>x</p></AboutLayout>);
    expect(document.body.textContent?.replace(/\s+/g, ' ')).toContain(DISCLAIMER);
  });

  it('links to feedback and privacy from the footer', () => {
    render(<AboutLayout title="Guide" current="overview"><p>x</p></AboutLayout>);
    const hrefs = Array.from(document.querySelectorAll('footer a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/privacy', '/support', '/feedback']));
  });
});
