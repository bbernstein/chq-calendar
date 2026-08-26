import { describe, expect, it } from 'vitest';
import {
  belowHeaderTop, dayHeaderTop, filterPanelMaxHeight, siteHeaderTop,
} from '@/app/filterHeaderLayout';

// The rule these pin is the fix for a bug jsdom cannot reproduce: hiding the
// filter card removed ~290px of flow height above the reader, scroll
// anchoring subtracted that from `scrollY`, and the page could not be
// scrolled slowly at all — 2400px of wheel input advanced it 0px in both
// Chromium and WebKit. The panel is now `position: fixed` in both states, so
// the failure is unreachable rather than survived; these pin the geometry
// that overlay depends on, so a refactor that quietly puts the panel back in
// flow fails here rather than in production.
//
// What this file no longer tests, deliberately: `filterHeaderTop` and
// `filterCardParked`. Both existed only to park an in-flow card above the
// viewport and make it unreachable while parked, and both are deleted with
// the card's flow participation (#274 phase 3).

/**
 * The line the day rail sticks at and the filter panel hangs from — one
 * function for both, because they are the same line and must not be changed
 * apart.
 */
describe('belowHeaderTop', () => {
  // Exactly the offset, with no term of its own: the rail's top edge IS the
  // revealed header's bottom edge. Anything added here would open a gap
  // between the header and the rail, or slide the rail under it.
  it('is the site header offset exactly', () => {
    expect(belowHeaderTop()).toBe('var(--site-header-offset, 0px)');
  });

  // Before the reveal hook's first effect there is no value, and a header
  // that has not been measured is at `top: 0` — so the chrome below it
  // belongs at 0 too, not at a broken `calc()` the browser drops.
  it('degrades to the viewport top when nothing has been measured', () => {
    expect(belowHeaderTop()).toContain('--site-header-offset, 0px');
  });

  // The whole sticky stack is built from this one term, so a change to it
  // moves the rail, the panel and the day titles together rather than letting
  // them drift apart — a panel floating a few pixels off the header it hangs
  // from is cosmetic enough to ship unnoticed.
  //
  // Note what is NOT here: an `expect(belowHeaderTop()).toBe(belowHeaderTop())`
  // that used to sit above this line. Comparing a pure function to itself is a
  // tautology that cannot fail, and it read as though it were checking that
  // two consumers agree. They are consumers, not callers of each other, so
  // this file cannot see them both — `filterHeader.test.tsx` is where that is
  // actually checked, by asserting the rendered rail and the rendered panel
  // carry the same `style.top`.
  it('is the term the day headers are stacked on too', () => {
    expect(dayHeaderTop()).toContain(belowHeaderTop());
  });
});

/**
 * The panel's internal height cap. Unconditional now: the panel is always an
 * overlay, so there is no in-flow state in which the page itself scrolls past
 * it.
 */
describe('filterPanelMaxHeight', () => {
  it('caps the panel to the viewport below the revealed header', () => {
    expect(filterPanelMaxHeight()).toBe('calc(100dvh - var(--site-header-offset, 0px) - 1rem)');
  });

  // `dvh`, not `vh`, and the unit is the bug. `vh` on a phone resolves
  // against the LARGEST viewport — bottom browser chrome retracted — so a
  // panel capped in `vh` runs under that chrome whenever it is showing and
  // its last control cannot be reached. That is the exact failure the cap
  // exists to prevent, reintroduced one unit along.
  it('measures against the dynamic viewport, never the largest one', () => {
    expect(filterPanelMaxHeight()).toContain('100dvh');
    // Negated with a lookbehind rather than a plain `not.toContain('100vh')`,
    // which `100dvh` does not contain but which would also pass for a value
    // that never mentioned a viewport unit at all.
    expect(/(?<!d)100vh/.test(filterPanelMaxHeight())).toBe(false);
  });

  // Subtracts the header, so a revealed header shortens the panel rather than
  // pushing its bottom edge off screen. Falls back to the full viewport when
  // nothing has been measured, which is the safe direction: too short is
  // scrollable, too tall is unreachable.
  it('shortens by the revealed header and degrades to the full viewport', () => {
    expect(filterPanelMaxHeight()).toContain('- var(--site-header-offset, 0px)');
  });
});

/**
 * The site header's own park (#272). It lives beside `belowHeaderTop` because
 * the two have to compose: the site header's height is the term everything
 * below it adds, and a change to one that is not mirrored in the other leaves
 * the rail overlapping the header or floating below it.
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
