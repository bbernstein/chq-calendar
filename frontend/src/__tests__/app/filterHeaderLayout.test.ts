import { describe, expect, it } from 'vitest';
import { dayHeaderTop, filterCardParked, filterHeaderTop, siteHeaderTop } from '@/app/filterHeaderLayout';

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
    expect(filterHeaderTop({ overlaying: false }))
      .toBe('calc(var(--site-header-offset, 0px) - var(--filter-card-h, 0px))');
  });

  it('pins the header below the site header while the panel overlays the list', () => {
    expect(filterHeaderTop({ overlaying: true })).toBe('var(--site-header-offset, 0px)');
  });

  // The parked offset is what lets the card stay in flow. A `top` that never
  // goes negative means the card can only be got rid of by removing it from
  // flow, which is the bug.
  it('parks with a negative offset, never a zero or positive one', () => {
    const parked = filterHeaderTop({ overlaying: false });
    expect(parked).toContain('- var(--filter-card-h');
    expect(parked).not.toBe('0px');
    expect(parked).not.toBe('var(--site-header-offset, 0px)');
  });

  // #272: the site header reveals on scroll up, and the reader chose to have
  // the rail ride down below it rather than be covered by it. That is this
  // one additive term — and it is a CSS variable rather than a parameter on
  // purpose. Routing the reveal through React state would re-render the whole
  // calendar page on every flick; as a variable the reveal touches only
  // `Header`, and the rail follows without the page knowing anything happened.
  it('offsets both states by the revealed site header, in the same direction', () => {
    expect(filterHeaderTop({ overlaying: true })).toContain('var(--site-header-offset, 0px)');
    expect(filterHeaderTop({ overlaying: false })).toContain('var(--site-header-offset, 0px) -');
  });

  // The two surfaces must move as one. The variable is animated once, on
  // `:root`, so the header's own `top` and the rail's are the same value
  // every frame; anything that transitioned `top` here instead would also
  // animate the filter panel's reveal, which is choreographed separately.
  it('falls back to 0px for the site header offset, so a missing reveal parks as before', () => {
    expect(filterHeaderTop({ overlaying: false })).toContain('--site-header-offset, 0px');
    expect(filterHeaderTop({ overlaying: true })).toContain('--site-header-offset, 0px');
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

/**
 * The site header's own park (#272). It lives beside `filterHeaderTop`
 * because the two have to compose: the site header's height is the term the
 * filter header adds, and a change to one that is not mirrored in the other
 * leaves the rail overlapping the header or floating below it.
 */
describe('siteHeaderTop', () => {
  // Parked and revealed are the same expression evaluated at the two ends of
  // the offset: at `0px` it is `-headerH` (just above the viewport), at
  // `headerH` it is `0` (flush at the top edge). One expression means the two
  // states cannot drift apart, and it means the transition has a single
  // animated value rather than two that must agree every frame.
  it('parks the header above the viewport by exactly its own height', () => {
    expect(siteHeaderTop()).toBe('calc(var(--site-header-offset, 0px) - var(--site-header-h, 0px))');
  });

  // The negative park is what lets the header stay in flow. A `top` that
  // never goes negative can only hide the header by removing it from flow —
  // which is the scroll-anchoring loop this whole module exists to document.
  it('subtracts the header height, so the parked offset is negative', () => {
    expect(siteHeaderTop()).toContain('- var(--site-header-h');
  });

  // Before measurement both terms fall back to 0px, which evaluates to
  // `top: 0` — a header pinned at the viewport top. Shown is the safe
  // default; a wrong sign here would park an unmeasured header out of reach
  // with no way to bring it back.
  it('degrades to a shown header when nothing has been measured yet', () => {
    expect(siteHeaderTop()).toContain('--site-header-offset, 0px');
    expect(siteHeaderTop()).toContain('--site-header-h, 0px');
  });
});

/**
 * Where a day section's own sticky title comes to rest.
 *
 * Third in the stack, and the one that is easiest to forget. It has to clear
 * everything above it — and "everything above it" grew by the site header
 * when #272 made that header reachable from anywhere.
 */
describe('dayHeaderTop', () => {
  // Measured before this existed, at 320px and at 200% text zoom, by
  // `verify-rail`'s check 12: rail bottom 112, day header top 64. The title
  // stuck a whole site-header too high, behind a rail that outranks it
  // (`z-20` against `z-10`), so it slid underneath and vanished — every time
  // the reader scrolled up.
  it('clears the site header as well as the rail', () => {
    expect(dayHeaderTop()).toBe('calc(var(--site-header-offset, 0px) + var(--day-rail-h, 0px))');
  });

  // Both fall back to 0px, which is the pre-#272 `top: var(--day-rail-h)`
  // when the header is hidden and an ordinary `top: 0` before anything is
  // measured.
  it('degrades to the rail height alone, then to zero', () => {
    expect(dayHeaderTop()).toContain('--site-header-offset, 0px');
    expect(dayHeaderTop()).toContain('--day-rail-h, 0px');
  });
});
