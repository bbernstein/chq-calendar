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
  it('is parked once the card itself has left the viewport with the panel closed', () => {
    expect(filterCardParked({ outOfView: true, open: false, exitingVisible: false })).toBe(true);
  });

  it('is not parked while the card is on screen', () => {
    expect(filterCardParked({ outOfView: false, open: false, exitingVisible: false })).toBe(false);
  });

  // Reachable while open is the entire point of the toggle: an open panel
  // that is `inert` is a panel the reader can see and cannot use. `open`
  // wins even if the observer has not yet reported the card back in view —
  // its callback lands a frame later than the state that revealed it.
  it('is not parked while the panel is open, whatever the observer last said', () => {
    expect(filterCardParked({ outOfView: true, open: true, exitingVisible: false })).toBe(false);
  });

  // Mid-exit the panel is `position: fixed`, not parked. It still ends up
  // beyond reach — page.tsx ORs the two — but by a different route, and
  // conflating them here would hide which one is driving.
  it('is not parked while the exit animation is running', () => {
    expect(filterCardParked({ outOfView: true, open: false, exitingVisible: true })).toBe(false);
  });

  // Partly on screen is still reachable: mid-slide the reader can see the
  // card and must be able to use it.
  it('is not parked while the card is only partly scrolled away', () => {
    expect(filterCardParked({ outOfView: false, open: true, exitingVisible: false })).toBe(false);
  });
});
