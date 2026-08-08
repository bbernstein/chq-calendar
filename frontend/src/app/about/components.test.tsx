import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { Screenshot } from './Screenshot';
import { ScenarioBlock } from './Scenario';
import { FeatureReference } from './FeatureReference';
import { PlatformCard } from './PlatformCard';
import type { Feature, PlatformInfo, Scenario, ScreenshotRef } from './aboutContent';

const shot: ScreenshotRef = { base: 'ios-07-my-day', alt: 'My Day timeline', width: 840, height: 1825 };

describe('Screenshot', () => {
  it('builds a srcset from the two prepared widths', () => {
    render(<Screenshot shot={shot} widths={[420, 840]} />);
    const img = screen.getByAltText('My Day timeline') as HTMLImageElement;
    expect(img.getAttribute('srcset')).toBe(
      '/about/ios-07-my-day-420.webp 420w, /about/ios-07-my-day-840.webp 840w'
    );
    expect(img.getAttribute('src')).toBe('/about/ios-07-my-day-840.webp');
  });

  it('sets intrinsic dimensions so the page does not shift as images load', () => {
    render(<Screenshot shot={shot} widths={[420, 840]} />);
    const img = screen.getByAltText('My Day timeline');
    expect(img.getAttribute('width')).toBe('840');
    expect(img.getAttribute('height')).toBe('1825');
  });

  it('lazy-loads by default and eagerly when marked priority', () => {
    const { unmount } = render(<Screenshot shot={shot} widths={[420, 840]} />);
    expect(screen.getByAltText('My Day timeline').getAttribute('loading')).toBe('lazy');
    unmount();
    render(<Screenshot shot={shot} widths={[420, 840]} priority />);
    expect(screen.getByAltText('My Day timeline').getAttribute('loading')).toBe('eager');
  });
});

describe('ScenarioBlock', () => {
  const scenario: Scenario = {
    id: 's1', title: 'Plan your day',
    body: ['First paragraph.', 'Second paragraph.'],
    screenshot: shot,
  };

  it('renders the title and every paragraph', () => {
    render(<ScenarioBlock scenario={scenario} widths={[420, 840]} />);
    expect(screen.getByRole('heading', { name: 'Plan your day', level: 2 })).toBeTruthy();
    expect(screen.getByText('First paragraph.')).toBeTruthy();
    expect(screen.getByText('Second paragraph.')).toBeTruthy();
  });

  it('renders the screenshot when present', () => {
    render(<ScenarioBlock scenario={scenario} widths={[420, 840]} />);
    expect(screen.getByAltText('My Day timeline')).toBeTruthy();
  });

  it('omits the image entirely when the scenario has no screenshot', () => {
    render(<ScenarioBlock scenario={{ ...scenario, screenshot: undefined }} widths={[420, 840]} />);
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('FeatureReference', () => {
  const features: Feature[] = [
    { id: 'f1', group: 'Alpha', title: 'One', blurb: 'First feature.' },
    { id: 'f2', group: 'Alpha', title: 'Two', blurb: 'Second feature.', notObvious: true },
    { id: 'f3', group: 'Beta', title: 'Three', blurb: 'Third feature.' },
  ];

  it('renders a section per group with its heading', () => {
    render(<FeatureReference features={features} heading="Every feature" />);
    expect(screen.getByRole('heading', { name: 'Every feature', level: 2 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Alpha', level: 3 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Beta', level: 3 })).toBeTruthy();
  });

  it('renders every feature title and blurb', () => {
    render(<FeatureReference features={features} heading="Every feature" />);
    for (const f of features) {
      expect(screen.getByText(f.title), f.id).toBeTruthy();
      expect(screen.getByText(f.blurb), f.id).toBeTruthy();
    }
  });

  it('tags each feature with its id so page tests can assert coverage', () => {
    render(<FeatureReference features={features} heading="Every feature" />);
    expect(document.querySelector('[data-feature-id="f2"]')).toBeTruthy();
  });

  it('marks the non-obvious features', () => {
    render(<FeatureReference features={features} heading="Every feature" />);
    const marked = document.querySelectorAll('[data-not-obvious="true"]');
    expect(marked).toHaveLength(1);
    expect(marked[0].getAttribute('data-feature-id')).toBe('f2');
  });
});

describe('PlatformCard', () => {
  const platform: PlatformInfo = {
    id: 'web', name: 'Web', tagline: 'In any browser.',
    guideHref: '/about/web', ctaHref: '/', ctaLabel: 'Open the calendar',
  };

  it('links to the guide and the call to action', () => {
    render(<PlatformCard platform={platform} />);
    expect(screen.getByRole('link', { name: 'Open the calendar' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: /Web guide/ }).getAttribute('href')).toBe('/about/web');
  });

  it('renders the CTA as disabled text when there is no destination yet', () => {
    render(<PlatformCard platform={{ ...platform, ctaHref: '', ctaLabel: 'Coming to the App Store' }} />);
    expect(screen.queryByRole('link', { name: 'Coming to the App Store' })).toBeNull();
    expect(screen.getByText('Coming to the App Store')).toBeTruthy();
  });
});
