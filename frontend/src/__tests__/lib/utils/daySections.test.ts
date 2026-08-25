import { describe, expect, it, afterEach } from 'vitest';
import { DAY_SECTION_ATTR, daySectionElement, daySectionTop, topChromeHeightPx, topmostVisibleDaySection } from '@/lib/utils/daySections';

function mount(keys: string[]) {
  document.body.innerHTML = keys
    .map(k => `<div ${DAY_SECTION_ATTR}="${k}"></div>`)
    .join('');
}

afterEach(() => { document.body.innerHTML = ''; });

describe('daySectionElement', () => {
  it('finds the section for a day key', () => {
    mount(['2026-06-27', '2026-06-28']);
    expect(daySectionElement('2026-06-28')?.getAttribute(DAY_SECTION_ATTR)).toBe('2026-06-28');
  });

  it('returns null for a day that is not mounted', () => {
    mount(['2026-06-27']);
    expect(daySectionElement('2026-06-28')).toBeNull();
  });

  // groupEventsByDay emits this key for an unparseable startDate. It must not
  // be able to break the selector — a thrown SyntaxError here would take the
  // whole list down rather than degrade one row.
  it('does not throw on the NaN key groupEventsByDay can emit', () => {
    mount(['NaN-NaN-NaN']);
    expect(daySectionElement('NaN-NaN-NaN')).not.toBeNull();
  });
});

describe('daySectionTop', () => {
  it('reports the viewport-relative top of a mounted section', () => {
    mount(['2026-06-27']);
    const el = daySectionElement('2026-06-27')!;
    // jsdom has no layout, so every rect is zero. Stub the one value under test.
    el.getBoundingClientRect = () => ({ top: 412 }) as DOMRect;
    expect(daySectionTop('2026-06-27')).toBe(412);
  });

  it('returns null when the section is not mounted', () => {
    mount([]);
    expect(daySectionTop('2026-06-27')).toBeNull();
  });
});

describe('topChromeHeightPx', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--day-rail-h');
    document.documentElement.style.removeProperty('--site-header-offset');
    document.documentElement.style.removeProperty('--site-header-offset-target');
  });

  it('reads the published rail height', () => {
    document.documentElement.style.setProperty('--day-rail-h', '56px');
    expect(topChromeHeightPx()).toBe(56);
  });

  it('is 0 when nothing has published a height yet', () => {
    expect(topChromeHeightPx()).toBe(0);
  });

  // The chrome at the top of the viewport is the rail PLUS the site header
  // whenever that header is revealed (#272). Everything that asks "is this
  // section hidden behind the chrome" — the rail's scrollspy, the filter
  // panel's scroll reference, a chip tap's landing position — is off by a
  // whole header otherwise, and only while the header is showing, which is
  // exactly when the reader is looking at it.
  it('includes the site header while it is revealed', () => {
    document.documentElement.style.setProperty('--day-rail-h', '56px');
    document.documentElement.style.setProperty('--site-header-offset-target', '48px');
    expect(topChromeHeightPx()).toBe(104);
  });

  it('is just the rail while the site header is hidden', () => {
    document.documentElement.style.setProperty('--day-rail-h', '56px');
    document.documentElement.style.setProperty('--site-header-offset-target', '0px');
    expect(topChromeHeightPx()).toBe(56);
  });

  // Reads the SETTLED offset, never the animated one.
  //
  // `--site-header-offset` transitions over 200ms, and every consumer of this
  // samples it on a scroll or a resize. The scroll that triggers a reveal
  // samples near the START of that transition and nothing fires when it
  // finishes, so the anchor and the rail highlight would keep a boundary
  // computed with the old chrome height until the reader scrolls again — long
  // enough to leave the wrong chip lit next to a day boundary.
  //
  // A logical question ("is this section behind the chrome") wants where the
  // chrome is going, not where it is mid-flight.
  it('ignores the animated offset, which is mid-flight for 200ms', () => {
    document.documentElement.style.setProperty('--day-rail-h', '56px');
    document.documentElement.style.setProperty('--site-header-offset-target', '48px');
    // The animation is a third of the way through. The answer must not be.
    document.documentElement.style.setProperty('--site-header-offset', '16px');
    expect(topChromeHeightPx()).toBe(104);
  });
});

describe('topmostVisibleDaySection', () => {
  it('picks the first section whose top has not yet passed the rail', () => {
    mount(['2026-06-27', '2026-06-28', '2026-06-29']);
    document.documentElement.style.setProperty('--day-rail-h', '40px');
    // 06-27 has already scrolled behind the rail; 06-28 is the first one
    // still clear of it.
    daySectionElement('2026-06-27')!.getBoundingClientRect = () => ({ top: 10 }) as DOMRect;
    daySectionElement('2026-06-28')!.getBoundingClientRect = () => ({ top: 40 }) as DOMRect;
    daySectionElement('2026-06-29')!.getBoundingClientRect = () => ({ top: 500 }) as DOMRect;

    expect(topmostVisibleDaySection()?.getAttribute(DAY_SECTION_ATTR)).toBe('2026-06-28');
  });

  it('returns null when no mounted section is clear of the rail', () => {
    mount(['2026-06-27']);
    document.documentElement.style.setProperty('--day-rail-h', '40px');
    daySectionElement('2026-06-27')!.getBoundingClientRect = () => ({ top: 10 }) as DOMRect;

    expect(topmostVisibleDaySection()).toBeNull();
  });

  it('returns null when nothing is mounted', () => {
    mount([]);
    expect(topmostVisibleDaySection()).toBeNull();
  });
});
