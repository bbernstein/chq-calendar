import { describe, expect, it } from 'vitest';
import { filterCardParked, filterHeaderTop } from '@/app/filterHeaderLayout';

// The rule these pin is the fix for a bug jsdom cannot reproduce: hiding the
// filter card removed ~290px of flow height above the reader, scroll
// anchoring subtracted that from `scrollY`, and the page could not be
// scrolled slowly at all — 2400px of wheel input advanced it 0px in both
// Chromium and WebKit. The browser probe in
// `.superpowers/sdd/.../probes/probe-negative-top.mjs` is what measures
// that; these pin the decision the fix turns on, so a refactor that quietly
// restores "collapse by removing it from flow" fails here rather than in
// production.
describe('filterHeaderTop', () => {
  it('parks the header by the filter card height when the panel is not overlaying', () => {
    expect(filterHeaderTop({ overlaying: false })).toBe('calc(-1 * var(--filter-card-h, 0px))');
  });

  it('pins the header at the viewport top while the panel overlays the list', () => {
    expect(filterHeaderTop({ overlaying: true })).toBe('0px');
  });

  // The parked offset is what lets the card stay in flow. A `top` that never
  // goes negative means the card can only be got rid of by removing it from
  // flow, which is the bug.
  it('parks with a negative offset, never a zero or positive one', () => {
    const parked = filterHeaderTop({ overlaying: false });
    expect(parked).toMatch(/^calc\(-1 \* var\(--filter-card-h/);
    expect(parked).not.toBe('0px');
  });

  // A missing measurement (no ResizeObserver, a render before mount) has to
  // degrade to an ordinary top-0 sticky header, not to a broken `calc()`
  // that the browser drops — which would leave `top` unset and the header
  // static.
  it('falls back to 0px inside the calc when the measurement is missing', () => {
    expect(filterHeaderTop({ overlaying: false })).toContain('--filter-card-h, 0px');
  });
});

describe('filterCardParked', () => {
  it('is parked once the reader has scrolled past it with the panel closed', () => {
    expect(filterCardParked({ scrolledPast: true, open: false, exitingVisible: false })).toBe(true);
  });

  it('is not parked at the top of the page, where it is ordinary in-flow content', () => {
    expect(filterCardParked({ scrolledPast: false, open: false, exitingVisible: false })).toBe(false);
  });

  // Reachable while open is the entire point of the toggle: an open panel
  // that is `inert` is a panel the reader can see and cannot use.
  it('is not parked while the panel is open over the list', () => {
    expect(filterCardParked({ scrolledPast: true, open: true, exitingVisible: false })).toBe(false);
  });

  // Mid-exit the panel is `position: fixed`, not parked. It still ends up
  // beyond reach — page.tsx ORs the two — but by a different route, and
  // conflating them here would hide which one is driving.
  it('is not parked while the exit animation is running', () => {
    expect(filterCardParked({ scrolledPast: true, open: false, exitingVisible: true })).toBe(false);
  });

  // A stale `open` left over from scrolling back up must not park the card
  // at the top of the page, where the reader can plainly see it.
  it('is not parked at the top of the page even with a stale open flag', () => {
    expect(filterCardParked({ scrolledPast: false, open: true, exitingVisible: false })).toBe(false);
  });
});
