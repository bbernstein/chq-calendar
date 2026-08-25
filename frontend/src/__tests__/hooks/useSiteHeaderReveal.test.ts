import { describe, expect, it, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useSiteHeaderReveal } from '@/hooks/useSiteHeaderReveal';
import { scrollWindowBy } from '@/lib/programmaticScroll';
import { REVEAL_THRESHOLD } from '@/lib/siteHeaderReveal';
import { installResizeObserverMock } from '@/__tests__/helpers/resizeObserver';

/**
 * The wiring between the reveal rule and the page (#272): where the decision
 * is published, what a programmatic jump does to it, and what is torn down on
 * unmount.
 *
 * The rule itself is pinned in `lib/siteHeaderReveal.test.ts` and the
 * geometry in `e2e/verify-header-reveal.mjs`. What is only reachable here is
 * that the decision reaches CSS at all, and that it reaches CSS *without*
 * going through the page — the offset is a custom property precisely so a
 * flick of the wrist does not re-render 1,470 events.
 */

const OFFSET = '--site-header-offset';
const HEIGHT = '--site-header-h';

const offset = () => document.documentElement.style.getPropertyValue(OFFSET);
const height = () => document.documentElement.style.getPropertyValue(HEIGHT);

/**
 * A scroll the browser made on its own: the position moves and no gesture
 * precedes it. Anchoring corrections, restored positions, anchor jumps.
 */
const browserScrollTo = (y: number) => act(() => {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
  window.dispatchEvent(new Event('scroll'));
});

/**
 * A scroll the READER made: the gesture that drives it, then the scroll it
 * produces. Which is what a wheel tick, a touch drag and a scrollbar drag all
 * look like from here.
 */
const scrollTo = (y: number) => {
  act(() => { window.dispatchEvent(new WheelEvent('wheel', { bubbles: true })); });
  browserScrollTo(y);
};

/** Get to "deep in the list with the header showing", the interesting state. */
const reveal = (result: { current: { revealed: boolean } }) => {
  scrollTo(30_000);
  scrollTo(6_080);
  if (!result.current.revealed) throw new Error('setup failed: header did not reveal');
};

/** A header element of a given height, since jsdom measures everything as 0. */
const headerEl = (h: number) => {
  const el = document.createElement('header');
  el.getBoundingClientRect = () => ({ height: h }) as DOMRect;
  document.body.append(el);
  return el;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty(OFFSET);
  document.documentElement.style.removeProperty(HEIGHT);
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
  document.body.innerHTML = '';
});

/** Mount the hook with a measured header attached. */
const mount = (h = 72) => {
  installResizeObserverMock();
  const rendered = renderHook(() => useSiteHeaderReveal());
  act(() => { rendered.result.current.headerRef(headerEl(h)); });
  return rendered;
};

describe('useSiteHeaderReveal', () => {
  it('starts revealed, with the header at its full height', () => {
    const { result } = mount();
    expect(result.current.revealed).toBe(true);
    expect(offset()).toBe(`var(${HEIGHT}, 0px)`);
  });

  it('publishes the measured header height', () => {
    mount(88);
    expect(height()).toBe('88px');
  });

  it('collapses the offset to zero once the reader scrolls down past the threshold', () => {
    const { result } = mount();
    scrollTo(1_000);
    expect(result.current.revealed).toBe(false);
    expect(offset()).toBe('0px');
  });

  it('restores the offset on a small scroll back up', () => {
    const { result } = mount();
    scrollTo(1_000);
    scrollTo(1_000 - REVEAL_THRESHOLD - 1);
    expect(result.current.revealed).toBe(true);
    expect(offset()).toBe(`var(${HEIGHT}, 0px)`);
  });

  // The header's own height is the top zone: within it the header's natural
  // position is still on screen, and a sticky element cannot be parked above
  // a position it has not reached. Marking it hidden there would make a
  // header the reader can see `inert`.
  it('stays revealed scrolling down inside the header height', () => {
    const { result } = mount(72);
    scrollTo(60);
    expect(result.current.revealed).toBe(true);
  });

  it('hides once the reader is past the header height', () => {
    const { result } = mount(72);
    scrollTo(200);
    expect(result.current.revealed).toBe(false);
  });

  // The acceptance criterion this exists for: tapping a day chip on the rail
  // jumps the document by tens of thousands of pixels, and must not flash the
  // header in.
  it('does not reveal when the app scrolls the document itself', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);

    vi.spyOn(window, 'scrollBy').mockImplementation((() => {
      Object.defineProperty(window, 'scrollY', { value: 1_200, configurable: true, writable: true });
    }) as typeof window.scrollBy);
    act(() => { scrollWindowBy(-28_800); });
    // The scroll event the jump provokes arrives a frame later.
    scrollTo(1_200);

    expect(result.current.revealed).toBe(false);
  });

  // A resync must not freeze the header: the reader's very next gesture,
  // measured from the new baseline, works with nothing to wait for.
  //
  // The gesture is required rather than incidental. A jump also opens a settle
  // (see the suite below), so a bare scroll after one is the browser finishing
  // its own reaction and decides nothing — this asserts the other half, that
  // the settle costs the reader no delay at all once they touch the page.
  it('responds to the reader\'s first gesture after a programmatic jump', () => {
    const { result } = mount();
    scrollTo(30_000);
    vi.spyOn(window, 'scrollBy').mockImplementation((() => {
      Object.defineProperty(window, 'scrollY', { value: 1_200, configurable: true, writable: true });
    }) as typeof window.scrollBy);
    act(() => { scrollWindowBy(-28_800); });

    act(() => { window.dispatchEvent(new WheelEvent('wheel', { bubbles: true })); });
    scrollTo(1_200 - REVEAL_THRESHOLD - 1);
    expect(result.current.revealed).toBe(true);
  });

  it('stops listening once unmounted', () => {
    const { unmount } = mount();
    unmount();
    scrollTo(1_000);
    expect(offset()).not.toBe('0px');
  });
});

/**
 * A scroll with no gesture behind it is not the reader scrolling.
 *
 * The app's own scrolls announce themselves, so the baseline can be resynced
 * for those. What cannot announce itself is what the BROWSER does in reaction
 * to a layout change we made without scrolling at all. Measured in WebKit:
 * opening the filter panel from the rail with the header revealed,
 * `topmostVisibleDaySection()` found no section to anchor to, so
 * `useFilterPanel` captured no reference, corrected nothing and announced
 * nothing — and WebKit's scroll anchoring then moved the page 44px by itself.
 * The header hid on a tap nobody scrolled.
 *
 * Chasing that by making every layout-changing site announce is a guard that
 * has to be remembered at each new site. Requiring a gesture is a guard that
 * holds for sites nobody has written yet.
 */
describe('useSiteHeaderReveal — scrolls nobody asked for', () => {
  it('ignores a scroll with no gesture behind it', () => {
    const { result } = mount();
    reveal(result);

    // WebKit's scroll anchoring after the filter panel was inserted: 44px,
    // nearly twice the threshold, and no gesture anywhere near it.
    browserScrollTo(6_124);

    expect(result.current.revealed).toBe(true);
  });

  it('still decides when the reader is the one scrolling', () => {
    const { result } = mount();
    reveal(result);

    scrollTo(6_124);

    expect(result.current.revealed).toBe(false);
  });

  // The baseline still has to follow, or the reader's next real scroll is
  // measured against a position the page left some time ago.
  it('keeps the baseline current across a scroll it ignored', () => {
    const { result } = mount();
    reveal(result);
    browserScrollTo(6_124);

    scrollTo(6_124 + REVEAL_THRESHOLD);
    expect(result.current.revealed).toBe(false);
  });
});

/**
 * Which gestures count as the reader scrolling.
 *
 * The set is not obvious and each exclusion was paid for. Measured in WebKit
 * against a real rail chip tap: the page landed at y=12,929 and the browser's
 * own scroll anchoring pulled it back to 12,807 as the render window mounted
 * day sections above the reader — 122px, five times the reveal threshold, a
 * fifth of a second after a tap nobody scrolled. Chromium made no such
 * correction. The press that set all that off is a `mousedown`, so a set that
 * counted presses would have handed that correction a gesture's authority.
 */
describe('useSiteHeaderReveal — which gestures count as scrolling', () => {
  /** Jump the document to `y` through the announcing helper. */
  const jumpTo = (y: number) => {
    vi.spyOn(window, 'scrollBy').mockImplementation((() => {
      Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
    }) as typeof window.scrollBy);
    act(() => { scrollWindowBy(y - window.scrollY); });
  };

  const gesture = (type: string, init: object = {}) => act(() => {
    window.dispatchEvent(new (type === 'keydown' ? KeyboardEvent : type.startsWith('touch') ? Event : MouseEvent)(type, { bubbles: true, ...init }));
  });

  it('ignores the browser correcting the page after a jump', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);

    jumpTo(12_929);
    // WebKit's scroll anchoring, 122px up. Nobody scrolled.
    browserScrollTo(12_807);

    expect(result.current.revealed).toBe(false);
  });

  it('counts a wheel', () => {
    const { result } = mount();
    scrollTo(30_000);
    // Pinned, not assumed: without it the wheel case asserts the same value
    // as its own untested premise and passes on code where nothing counts.
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    browserScrollTo(12_807);

    gesture('wheel');
    browserScrollTo(12_807 - REVEAL_THRESHOLD - 1);
    expect(result.current.revealed).toBe(true);
  });

  it('counts a touch drag', () => {
    const { result } = mount();
    scrollTo(30_000);
    // Pinned, not assumed: without it the wheel case asserts the same value
    // as its own untested premise and passes on code where nothing counts.
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);

    gesture('touchmove');
    browserScrollTo(12_929 - REVEAL_THRESHOLD - 1);
    expect(result.current.revealed).toBe(true);
  });

  it('counts a scrolling keypress', () => {
    const { result } = mount();
    scrollTo(30_000);
    // Pinned, not assumed: without it the wheel case asserts the same value
    // as its own untested premise and passes on code where nothing counts.
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);

    gesture('keydown', { key: 'PageUp' });
    browserScrollTo(12_929 - REVEAL_THRESHOLD - 1);
    expect(result.current.revealed).toBe(true);
  });

  // A scrollbar drag is the one way to scroll that fires no wheel, no touch
  // and no key. It is a `mousemove` with the button still held — which is why
  // the button state is checked rather than the event type.
  it('counts a scrollbar drag — a pointer moving with its button held', () => {
    const { result } = mount();
    scrollTo(30_000);
    // Pinned, not assumed: without it the wheel case asserts the same value
    // as its own untested premise and passes on code where nothing counts.
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);

    gesture('mousemove', { buttons: 1 });
    browserScrollTo(12_929 - REVEAL_THRESHOLD - 1);
    expect(result.current.revealed).toBe(true);
  });

  // Typing is not scrolling. The listener is on `window` with `capture: true`,
  // so every keystroke on the page reaches it — including the ones going into
  // the search box, which re-filters the list and changes its height by
  // thousands of pixels above the reader. The browser corrects for that, and
  // an unfiltered `keydown` would hand each of those corrections the authority
  // of a gesture: type three letters, watch the header appear.
  //
  // `useDismissOnScrollGesture` already had to make exactly this distinction,
  // for exactly this reason ("typing into the panel's own search field would
  // otherwise close it"), so the set is now shared rather than reasoned out a
  // second time.
  it('does not count a keystroke that scrolls nothing', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);

    gesture('keydown', { key: 'a' });
    browserScrollTo(12_807);

    expect(result.current.revealed).toBe(false);
  });

  it('does not count Tab, which moves focus rather than the page', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);

    gesture('keydown', { key: 'Tab' });
    browserScrollTo(12_807);

    expect(result.current.revealed).toBe(false);
  });

  // The pointer moving across the page is not a scroll, and counting it would
  // reopen the hole: the reader's cursor drifts a pixel after a chip tap and
  // the browser's correction is admitted right behind it.
  it('does not count a pointer moving with no button held', () => {
    const { result } = mount();
    scrollTo(30_000);
    // Pinned, not assumed: without it the wheel case asserts the same value
    // as its own untested premise and passes on code where nothing counts.
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);

    gesture('mousemove', { buttons: 0 });
    browserScrollTo(12_807);
    expect(result.current.revealed).toBe(false);
  });

  // `mousedown` is deliberately NOT in the gesture set, and neither is
  // `touchstart` — the difference from `useDayAnchor`'s otherwise identical
  // cancel set. A press is not a scroll: it moves nothing. And every rail chip
  // tap is a press, milliseconds before the jump whose fallout must not be
  // mistaken for the reader.
  it('does not count a press, which scrolls nothing', () => {
    const { result } = mount();
    scrollTo(30_000);
    // Pinned, not assumed: without it the wheel case asserts the same value
    // as its own untested premise and passes on code where nothing counts.
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);

    gesture('mousedown');
    browserScrollTo(12_807);

    expect(result.current.revealed).toBe(false);
  });

  // Ignoring a scroll must still move the baseline. Leaving it at
  // where the jump LANDED means every later delta is measured against a
  // position the page has not been at since — so the reader's next small
  // scroll down is read as a large scroll up, and the header reveals when they
  // asked it to hide. The exact WebKit numbers: landed 12,929, corrected to
  // 12,807, and a 24px scroll down from there is a 98px scroll UP against the
  // stale baseline.
  it('keeps the baseline current through a jump it ignored', () => {
    const { result } = mount();
    scrollTo(30_000);
    // Pinned, not assumed: without it the wheel case asserts the same value
    // as its own untested premise and passes on code where nothing counts.
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    browserScrollTo(12_807);

    gesture('wheel');
    browserScrollTo(12_807 + REVEAL_THRESHOLD);
    expect(result.current.revealed).toBe(false);
  });
});
