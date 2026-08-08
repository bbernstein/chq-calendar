import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import AboutPage from './page';
import AboutIphonePage from './iphone/page';
import AboutWebPage from './web/page';
import {
  IOS_FEATURES, WEB_FEATURES, SHARED_HIGHLIGHTS,
  IOS_SCENARIOS, WEB_SCENARIOS, PLATFORMS,
} from './aboutContent';

describe('/about top page', () => {
  it('offers a card for every platform', () => {
    render(<AboutPage />);
    for (const p of PLATFORMS) {
      expect(screen.getByRole('heading', { name: p.name, level: 3 }), p.id).toBeTruthy();
    }
  });

  it('renders every shared highlight', () => {
    render(<AboutPage />);
    for (const f of SHARED_HIGHLIGHTS) {
      expect(document.querySelector(`[data-feature-id="${f.id}"]`), f.id).toBeTruthy();
    }
  });

  it('points at support and feedback for help', () => {
    render(<AboutPage />);
    const hrefs = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/support', '/feedback']));
  });
});

describe('/about/iphone', () => {
  it('renders every iOS scenario', () => {
    render(<AboutIphonePage />);
    for (const s of IOS_SCENARIOS) {
      expect(screen.getByRole('heading', { name: s.title, level: 2 }), s.id).toBeTruthy();
    }
  });

  // The point of the whole content-as-data design: a feature we ship but
  // forget to document fails here rather than shipping a stale guide.
  it('documents every iOS feature', () => {
    render(<AboutIphonePage />);
    for (const f of IOS_FEATURES) {
      expect(document.querySelector(`[data-feature-id="${f.id}"]`), `undocumented: ${f.id}`).toBeTruthy();
    }
  });

  it('does not leak web-only features onto the iOS page', () => {
    render(<AboutIphonePage />);
    expect(document.querySelector('[data-feature-id="web-webcal"]')).toBeNull();
  });

  it('cross-links to the web guide', () => {
    render(<AboutIphonePage />);
    const hrefs = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/about/web');
  });
});

describe('/about/web', () => {
  it('renders every web scenario', () => {
    render(<AboutWebPage />);
    for (const s of WEB_SCENARIOS) {
      expect(screen.getByRole('heading', { name: s.title, level: 2 }), s.id).toBeTruthy();
    }
  });

  it('documents every web feature', () => {
    render(<AboutWebPage />);
    for (const f of WEB_FEATURES) {
      expect(document.querySelector(`[data-feature-id="${f.id}"]`), `undocumented: ${f.id}`).toBeTruthy();
    }
  });

  it('does not leak iOS-only features onto the web page', () => {
    render(<AboutWebPage />);
    expect(document.querySelector('[data-feature-id="ios-widget-next"]')).toBeNull();
  });

  it('cross-links to the iOS guide', () => {
    render(<AboutWebPage />);
    const hrefs = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/about/iphone');
  });
});
