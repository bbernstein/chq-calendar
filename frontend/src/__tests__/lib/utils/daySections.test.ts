import { describe, expect, it, afterEach } from 'vitest';
import { DAY_SECTION_ATTR, daySectionElement, daySectionTop, dayRailHeightPx, topmostVisibleDaySection } from '@/lib/utils/daySections';

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

describe('dayRailHeightPx', () => {
  afterEach(() => { document.documentElement.style.removeProperty('--day-rail-h'); });

  it('reads the published rail height', () => {
    document.documentElement.style.setProperty('--day-rail-h', '56px');
    expect(dayRailHeightPx()).toBe(56);
  });

  it('is 0 when nothing has published a height yet', () => {
    expect(dayRailHeightPx()).toBe(0);
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
