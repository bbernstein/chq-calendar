import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useSiteHeaderReveal, GESTURE_WINDOW_MS } from '@/hooks/useSiteHeaderReveal';
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
const TARGET = '--site-header-offset-target';
const HEIGHT = '--site-header-h';

const offset = () => document.documentElement.style.getPropertyValue(OFFSET);
const offsetTarget = () => document.documentElement.style.getPropertyValue(TARGET);
const height = () => document.documentElement.style.getPropertyValue(HEIGHT);

/**
 * One frame of a gesture already in flight: a scroll with no NEW gesture
 * behind it and no time elapsed. WebKit delivers a single wheel tick as
 * several of these.
 */
const frameScrollTo = (y: number) => act(() => {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
  window.dispatchEvent(new Event('scroll'));
});

/**
 * The clock the hook reads.
 *
 * Stubbed rather than waited on: the rule is "a gesture is still live for
 * `GESTURE_WINDOW_MS`", and a test that proved that by sleeping would be both
 * slow and a coin toss on a loaded machine.
 */
let clockMs = 0;
const advance = (ms: number) => { clockMs += ms; };

beforeEach(() => {
  clockMs = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clockMs);
});

/**
 * A gesture, dispatched where the hook listens for it.
 *
 * A wheel carries a `deltaY` unless the caller says otherwise, because a real
 * one always does — and a fake without it is a horizontal wheel, which the
 * hook is right to ignore.
 */
const gesture = (type: string, init: object = {}) => act(() => {
  const Ctor = type === 'keydown' ? KeyboardEvent : type.startsWith('touch') ? Event : MouseEvent;
  const defaults = type === 'wheel' ? { deltaY: 1 } : {};
  window.dispatchEvent(new Ctor(type, { bubbles: true, ...defaults, ...init }));
});

/**
 * A keypress FROM a particular element, so the listener sees a real target.
 *
 * Which key it is settles almost nothing on its own: Space scrolls the page
 * from the document, types a character in a field, and activates a focused
 * button. Only the target separates those.
 */
const keyOn = (el: Element, key: string) => act(() => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
});

/** An element in the document, to press keys from. */
const el = (html: string) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  return host.firstElementChild!;
};

/** Give an element a real box, since jsdom measures everything as 0. */
const sized = (el: Element, scrollHeight: number, clientHeight: number) => {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
};

/**
 * An element that scrolls on its own, like the filter panel — which is
 * `max-h-[70vh] overflow-y-auto` whenever it overlays the list.
 */
const nestedScroller = ({ scrollTop = 150 } = {}) => {
  const box = document.createElement('div');
  box.style.overflowY = 'auto';
  sized(box, 900, 300);
  Object.defineProperty(box, 'scrollTop', { value: scrollTop, configurable: true, writable: true });
  const inner = document.createElement('div');
  box.append(inner);
  document.body.append(box);
  return inner;
};

/**
 * A tall element that is NOT a scroller — an ordinary day section, taller than
 * the viewport with the default `overflow: visible`. Nearly everything the
 * reader wheels over is one of these.
 */
const tallOrdinaryContent = () => {
  const box = document.createElement('div');
  sized(box, 900, 300);
  const inner = document.createElement('div');
  box.append(inner);
  document.body.append(box);
  return inner;
};

/** A pointer gesture dispatched FROM a particular element. */
const gestureOn = (from: Element, type: string, init: object = {}) => act(() => {
  const Ctor = type === 'wheel' ? WheelEvent : type.startsWith('touch') ? Event : MouseEvent;
  from.dispatchEvent(new Ctor(type, { bubbles: true, ...init }));
});

/** Press, move, and stay held — a drag in progress, from `from`. */
const dragFrom = (from: Element, buttons = 1) => {
  gestureOn(from, 'mousedown', { button: buttons === 1 ? 0 : 2, buttons });
  gestureOn(from, 'mousemove', { buttons });
};

/** Jump the document to `y` through the announcing helper. */
const jumpTo = (y: number) => {
  vi.spyOn(window, 'scrollBy').mockImplementation((() => {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
  }) as typeof window.scrollBy);
  act(() => { scrollWindowBy(y - window.scrollY); });
};

/**
 * A scroll the browser made on its own: the position moves and no gesture
 * precedes it. Anchoring corrections, restored positions, anchor jumps.
 *
 * The clock is advanced past the gesture window first, because "no gesture
 * behind it" is a statement about time. A browser correction that genuinely
 * lands inside the window after a real gesture IS admitted — that is the
 * documented cost of the window, not something these tests should pretend
 * away.
 */
const browserScrollTo = (y: number) => {
  advance(GESTURE_WINDOW_MS + 1);
  frameScrollTo(y);
};

/**
 * A scroll the READER made: the gesture that drives it, then the scroll it
 * produces. Which is what a wheel tick, a touch drag and a scrollbar drag all
 * look like from here.
 */
const scrollTo = (y: number) => {
  const deltaY = y - window.scrollY;
  act(() => { window.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY })); });
  frameScrollTo(y);
};

/** Get to "deep in the list with the header showing", the interesting state. */
const reveal = (result: { current: { revealed: boolean } }) => {
  scrollTo(30_000);
  scrollTo(6_080);
  if (!result.current.revealed) throw new Error('setup failed: header did not reveal');
};

/**
 * A header element whose measured height can change, since jsdom measures
 * everything as 0 and text zoom is one of the things being tested.
 */
const headerEl = (h: number) => {
  let height = h;
  const el = document.createElement('header');
  el.getBoundingClientRect = () => ({ height }) as DOMRect;
  document.body.append(el);
  return { el, grow: (to: number) => { height = to; } };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty('overflow-y');
  document.body.style.removeProperty('overflow-y');
  document.documentElement.style.removeProperty(OFFSET);
  document.documentElement.style.removeProperty(TARGET);
  document.documentElement.style.removeProperty(HEIGHT);
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
  document.body.innerHTML = '';
});

/** Mount the hook with a measured header attached. */
const mount = (h = 72) => {
  const observer = installResizeObserverMock();
  const rendered = renderHook(() => useSiteHeaderReveal());
  const header = headerEl(h);
  act(() => { rendered.result.current.headerRef(header.el); });
  /** Text zoom, a breakpoint — anything that changes the header's height. */
  const growHeaderTo = (to: number) => { header.grow(to); observer.trigger(); };
  return { ...rendered, growHeaderTo };
};

describe('useSiteHeaderReveal', () => {
  it('starts revealed, with the header at its full height', () => {
    const { result } = mount();
    expect(result.current.revealed).toBe(true);
    expect(offset()).toBe(`var(${HEIGHT}, 0px)`);
  });

  // The settled twin of the animated offset, and the ONLY thing
  // `topChromeHeightPx` reads. Without this write the reader of that property
  // measures a chrome height of zero and the rail's scrollspy is quietly wrong
  // by a whole header — the two halves of the fix have to be pinned together
  // or either can be removed without a test noticing.
  it('publishes a settled offset for anything that measures rather than paints', () => {
    const { result } = mount(72);
    expect(offsetTarget()).toBe('72px');

    scrollTo(1_000);
    expect(result.current.revealed).toBe(false);
    expect(offsetTarget()).toBe('0px');

    scrollTo(1_000 - REVEAL_THRESHOLD - 1);
    expect(offsetTarget()).toBe('72px');
  });

  // A literal, so unlike the animated offset it does not follow
  // `--site-header-h` on its own — text zoom has to rewrite it.
  it('rewrites the settled offset when the header is re-measured', () => {
    const { growHeaderTo } = mount(72);
    expect(offsetTarget()).toBe('72px');

    growHeaderTo(120);

    expect(offsetTarget()).toBe('120px');
  });

  // And rewrites it to the height the header is ACTUALLY at. The re-measure
  // runs from a callback captured on first render, which cannot read state —
  // so a mirror of the decision that stopped being updated would republish a
  // revealed header's height onto a hidden one, and the rail's scrollspy would
  // hold a boundary a whole header too tall.
  it('rewrites it to zero when the header is re-measured while hidden', () => {
    const { result, growHeaderTo } = mount(72);
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    expect(offsetTarget()).toBe('0px');

    growHeaderTo(120);

    expect(offsetTarget()).toBe('0px');
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
/**
 * One gesture, several frames.
 *
 * WebKit on Linux delivers a single wheel tick as an animation rather than a
 * jump. Traced in CI over 40 ticks of 60px: `115 → 120 → 230`, i.e. +5 then
 * +110 for one tick, and `839 → 840 → 959` for another. A rule that let a
 * gesture decide only its FIRST scroll therefore threw away the rest of that
 * gesture's own movement — the accumulator saw +5 where the reader had asked
 * for +120, never reached the threshold, and the header did not hide at all.
 * Chromium delivers one clean frame per tick and showed none of this.
 */
describe('useSiteHeaderReveal — one gesture, several frames', () => {
  it('keeps deciding across every frame the gesture scrolls over', () => {
    const { result } = mount();
    scrollTo(1_000);
    expect(result.current.revealed).toBe(false);

    // One wheel up, delivered as -5 then the rest — the CI trace's shape.
    gesture('wheel');
    frameScrollTo(1_000 - 5);
    frameScrollTo(1_000 - 110);

    expect(result.current.revealed).toBe(true);
  });

  // The mirror: the frames must accumulate, not each be judged alone. Neither
  // of these two clears the threshold by itself.
  it('accumulates across frames rather than judging each one alone', () => {
    const { result } = mount();
    scrollTo(1_000);
    expect(result.current.revealed).toBe(false);

    gesture('wheel');
    frameScrollTo(1_000 - 15);
    frameScrollTo(1_000 - 30);

    expect(result.current.revealed).toBe(true);
  });
});

describe('useSiteHeaderReveal — scrolls nobody asked for', () => {
  // A window is a judgement, and the tests above express "past the window"
  // symbolically, so they hold for any value of it — including absurd ones.
  // These bounds are the judgement: long enough to cover a smooth-scroll
  // animation (WebKit delivers one wheel tick over several frames), short
  // enough that a gesture cannot lend its authority to a browser correction
  // arriving much later.
  it('keeps a gesture live for about as long as a scroll animation lasts', () => {
    expect(GESTURE_WINDOW_MS).toBeGreaterThanOrEqual(250);
    expect(GESTURE_WINDOW_MS).toBeLessThanOrEqual(600);
  });

  // The hole the window opens, and the settle closes. A reader who scrolls and
  // then taps a rail chip inside the same window would otherwise hand the
  // browser's reaction to that tap the authority of their wheel — the exact
  // 122px WebKit correction this suite exists for, arriving 200ms after a real
  // gesture instead of in isolation.
  it('ignores a correction after a jump the reader triggered while still scrolling', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);

    // No clock advance: the wheel above is still live when the tap lands.
    jumpTo(12_929);
    frameScrollTo(12_807);

    expect(result.current.revealed).toBe(false);
  });

  // And the settle must not outlast the reader's patience: their next gesture
  // takes control back with nothing to wait for.
  it('hands control back at the reader\'s next gesture after such a jump', () => {
    const { result } = mount();
    scrollTo(30_000);
    jumpTo(12_929);
    frameScrollTo(12_807);

    gesture('wheel');
    frameScrollTo(12_807 - REVEAL_THRESHOLD - 1);
    expect(result.current.revealed).toBe(true);
  });

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
/**
 * The top zone is a fact about where the header IS, not a decision about
 * where it should be.
 *
 * A sticky header cannot be parked above a position the page has not reached,
 * so inside the top zone it is on screen whatever the state says. Getting that
 * wrong does not merely look odd: a visible header marked `inert` and
 * `aria-hidden` is one a keyboard reader cannot reach and a screen reader will
 * not announce.
 *
 * Reproduced in Chromium before the fix, in three steps a reader can take:
 * search until the list is empty (document 8,401px → 1,049px, `scrollY`
 * clamped 5,436 → 205), then let the viewport grow — a rotation to landscape,
 * or browser chrome collapsing — so the document is shorter than the viewport
 * and the browser clamps `scrollY` to 0. Measured at that point: header
 * `top: 0, bottom: 48`, fully on screen, `inert: true, aria-hidden: "true"`.
 * Not one of those scrolls had a gesture behind it.
 */
describe('useSiteHeaderReveal — the top zone is not negotiable', () => {
  it('reveals when a scroll it would otherwise ignore lands in the top zone', () => {
    const { result } = mount(72);
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);

    // The browser clamping `scrollY` because the document got shorter.
    browserScrollTo(0);

    expect(result.current.revealed).toBe(true);
  });

  // Outside the top zone an ignored scroll must still decide nothing — the
  // fix must not become "any scroll reveals".
  it('still ignores a gestureless scroll that lands below the top zone', () => {
    const { result } = mount(72);
    scrollTo(30_000);

    browserScrollTo(30_000 - 500);

    expect(result.current.revealed).toBe(false);
  });

  // The measurement is observed precisely so text zoom is handled, and a
  // header that grows around the reader's position enters the top zone
  // without anything scrolling at all.
  it('reveals when the header grows around the reader, with no scroll at all', () => {
    const { result, growHeaderTo } = mount(72);
    scrollTo(100);
    expect(result.current.revealed).toBe(false);

    // Text zoom: 72px of header becomes 120px, and y=100 is now inside it.
    // Nothing scrolled, so nothing would otherwise re-run the decision.
    growHeaderTo(120);

    expect(result.current.revealed).toBe(true);
  });
});

describe('useSiteHeaderReveal — which gestures count as scrolling', () => {
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
    frameScrollTo(12_807 - REVEAL_THRESHOLD - 1);
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
    frameScrollTo(12_929 - REVEAL_THRESHOLD - 1);
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
    frameScrollTo(12_929 - REVEAL_THRESHOLD - 1);
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
    frameScrollTo(12_929 - REVEAL_THRESHOLD - 1);
    expect(result.current.revealed).toBe(true);
  });

  // A gesture is only the reader scrolling THE PAGE. The filter panel is its
  // own scroller (`max-h-[70vh] overflow-y-auto` whenever it overlays the
  // list), so a wheel inside it moves the panel and not the window — and then
  // picking a venue reflows the list, whose gestureless correction would
  // inherit authority this hook otherwise refuses it. `useFilterPanel` already
  // exempts gestures inside the panel for the mirror-image reason.
  it('does not count a wheel consumed by a scroller inside the page', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    advance(GESTURE_WINDOW_MS + 1);

    gestureOn(nestedScroller(), 'wheel', { deltaY: -80 });
    frameScrollTo(12_807);

    expect(result.current.revealed).toBe(false);
  });

  it('does not count a touch drag consumed by a scroller inside the page', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    advance(GESTURE_WINDOW_MS + 1);

    gestureOn(nestedScroller(), 'touchmove');
    frameScrollTo(12_807);

    expect(result.current.revealed).toBe(false);
  });

  // The day rail scrolls horizontally. A wheel that moves it sideways is not
  // the reader moving the page up or down.
  it('does not count a wheel with no vertical component', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    advance(GESTURE_WINDOW_MS + 1);

    gestureOn(el('<div>the day rail</div>'), 'wheel', { deltaX: -120, deltaY: 0 });
    frameScrollTo(12_807);

    expect(result.current.revealed).toBe(false);
  });

  // Height alone does not make a scroller. Nearly every element the reader
  // wheels over is taller than its own box — a day section, the list, the page
  // container — and all of them scroll the PAGE. A rule that looked only at
  // the box would classify every gesture as nested and the header would never
  // respond to anything again.
  it('counts a wheel over content that is merely tall, not scrollable', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    advance(GESTURE_WINDOW_MS + 1);

    gestureOn(tallOrdinaryContent(), 'wheel', { deltaY: -80 });
    frameScrollTo(12_929 - REVEAL_THRESHOLD - 1);

    expect(result.current.revealed).toBe(true);
  });

  // Declaring `overflow-y: auto` does not make an element a scroller either —
  // it has to actually overflow. The filter panel's own venue and category
  // lists carry that overflow and frequently do not fill it (a narrow search,
  // a short season), and a wheel over a list with nothing to scroll moves the
  // page.
  it('counts a wheel over a scroller with nothing to scroll', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    advance(GESTURE_WINDOW_MS + 1);

    const box = document.createElement('div');
    box.style.overflowY = 'auto';
    sized(box, 300, 300);
    const inner = document.createElement('div');
    box.append(inner);
    document.body.append(box);

    gestureOn(inner, 'wheel', { deltaY: -80 });
    frameScrollTo(12_929 - REVEAL_THRESHOLD - 1);

    expect(result.current.revealed).toBe(true);
  });

  // The document's own scrollers are the page, not something nested in it.
  // Reachable the day a stylesheet puts `overflow-y: auto` on `html` or
  // `body`, which is a common enough thing to do that the guard should not
  // depend on nobody ever doing it here.
  it('counts a wheel over the page even if the document itself is a scroller', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    advance(GESTURE_WINDOW_MS + 1);

    document.documentElement.style.overflowY = 'auto';
    sized(document.documentElement, 9_000, 800);
    document.body.style.overflowY = 'auto';
    sized(document.body, 9_000, 800);

    gestureOn(el('<div>an event card</div>'), 'wheel', { deltaY: -80 });
    frameScrollTo(12_929 - REVEAL_THRESHOLD - 1);

    expect(result.current.revealed).toBe(true);
  });

  // A scroller only consumes a wheel it can still act on. With the filter
  // panel already at its top, every further upward tick over it CHAINS to the
  // document and moves `window` — so rejecting all of them left the header
  // unable to reveal at all until the pointer left the panel. The earlier
  // comment here called that "the last few pixels of such a gesture", which
  // understated it: at a boundary it is every tick, indefinitely.
  it('counts a wheel that chains past a scroller already at its top', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    advance(GESTURE_WINDOW_MS + 1);

    gestureOn(nestedScroller({ scrollTop: 0 }), 'wheel', { deltaY: -80 });
    frameScrollTo(12_929 - REVEAL_THRESHOLD - 1);

    expect(result.current.revealed).toBe(true);
  });

  it('counts a wheel that chains past a scroller already at its bottom', () => {
    const { result } = mount();
    scrollTo(1_000);
    expect(result.current.revealed).toBe(false);
    scrollTo(1_000 - 200);
    expect(result.current.revealed).toBe(true);
    advance(GESTURE_WINDOW_MS + 1);

    // 900 content, 300 viewport — 600 is the bottom.
    gestureOn(nestedScroller({ scrollTop: 600 }), 'wheel', { deltaY: 80 });
    frameScrollTo(800 + REVEAL_THRESHOLD + 1);

    expect(result.current.revealed).toBe(false);
  });

  // Mid-scroll it really does consume the wheel, and must still be ignored.
  it('does not count a wheel a scroller can still act on', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    advance(GESTURE_WINDOW_MS + 1);

    gestureOn(nestedScroller({ scrollTop: 150 }), 'wheel', { deltaY: -80 });
    frameScrollTo(12_807);

    expect(result.current.revealed).toBe(false);
  });

  // And the case none of that may break: a wheel over ordinary page content,
  // which is what scrolls the page.
  it('counts a wheel over ordinary page content', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    advance(GESTURE_WINDOW_MS + 1);

    gestureOn(el('<div>an event card</div>'), 'wheel', { deltaY: -80 });
    frameScrollTo(12_929 - REVEAL_THRESHOLD - 1);

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

    // Let the setup's own wheel expire first, or the scroll below is driven by
    // THAT gesture and this test says nothing about the one it names.
    advance(GESTURE_WINDOW_MS + 1);
    gesture('keydown', { key: 'a' });
    frameScrollTo(12_807);

    expect(result.current.revealed).toBe(false);
  });

  it('does not count Tab, which moves focus rather than the page', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);

    // Let the setup's own wheel expire first, or the scroll below is driven by
    // THAT gesture and this test says nothing about the one it names.
    advance(GESTURE_WINDOW_MS + 1);
    gesture('keydown', { key: 'Tab' });
    frameScrollTo(12_807);

    expect(result.current.revealed).toBe(false);
  });

  // Which key it is settles almost nothing on its own. Space scrolls the page
  // from the document, types a character in a field, and activates a focused
  // button — three different things behind one `e.key`. The consequence is the
  // same one round 1 was about: typing a space in the search box refilters the
  // list, the browser corrects for the height change, and inside the gesture
  // window that correction inherits the authority of a keystroke that scrolled
  // nothing. "brass band" would flip the header on the space.
  it('does not count Space typed into a text field', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    advance(GESTURE_WINDOW_MS + 1);

    keyOn(el('<input type="text" />'), ' ');
    frameScrollTo(12_807);

    expect(result.current.revealed).toBe(false);
  });

  // Space on a focused control activates it. The rail's own Filters button is
  // reachable by keyboard, and pressing it inserts the panel — a layout change
  // above the reader, not a scroll.
  it('does not count Space activating a focused button', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    advance(GESTURE_WINDOW_MS + 1);

    keyOn(el('<button type="button">Filters</button>'), ' ');
    frameScrollTo(12_807);

    expect(result.current.revealed).toBe(false);
  });

  // Arrows move the caret in a field rather than the page.
  it('does not count an arrow key moving the caret in a text field', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    advance(GESTURE_WINDOW_MS + 1);

    keyOn(el('<input type="text" />'), 'ArrowUp');
    frameScrollTo(12_807);

    expect(result.current.revealed).toBe(false);
  });

  // A native link is activated with Enter, not Space — Space on a focused link
  // scrolls the page. Treating links as Space-activated rejected a real
  // keyboard scroll, so the header would not respond for a reader tabbing
  // through the header's own links and then pressing Space.
  it('counts Space on a focused link, which scrolls rather than activating', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    advance(GESTURE_WINDOW_MS + 1);

    keyOn(el('<a href="/about">About</a>'), ' ');
    frameScrollTo(12_929 - REVEAL_THRESHOLD - 1);

    expect(result.current.revealed).toBe(true);
  });

  // The day rail intercepts `Home` (`DayRail.tsx`), calls `preventDefault()`
  // and only moves focus to today's chip — it never scrolls the page. The
  // filter panel already special-cases this exact interaction in its own
  // `isExempt`, so classifying it as a page scroll here would leave the two
  // consumers disagreeing about the same keypress.
  it('does not count Home on a day-rail chip, which only moves focus', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    advance(GESTURE_WINDOW_MS + 1);

    keyOn(el('<button data-chip="2026-08-24">24</button>'), 'Home');
    frameScrollTo(12_807);

    expect(result.current.revealed).toBe(false);
  });

  // `PageDown` with focus parked on a chip really is a page scroll — the rail
  // does not intercept it. `useFilterPanel`'s exemption says so in as many
  // words, and narrowing more than the rail actually consumes would be
  // guessing rather than matching it.
  it('counts PageDown on a chip, which the rail does not intercept', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    advance(GESTURE_WINDOW_MS + 1);

    keyOn(el('<button data-chip="2026-08-24">24</button>'), 'PageUp');
    frameScrollTo(12_929 - REVEAL_THRESHOLD - 1);

    expect(result.current.revealed).toBe(true);
  });

  // Focusable is not the same as activated-by-Space. `Modal`'s container is the
  // real instance — `role="dialog"`, `tabIndex={-1}`, and an `onKeyDown` that
  // handles only Escape and Tab — so Space there scrolls the page, and a rule
  // keyed on focusability rather than on behaviour would be wrong about the
  // platform, not merely cautious.
  //
  // `WeekBadge` looks like the same case and is not: it sets `role="button"`
  // alongside `tabIndex={0}` and calls `preventDefault()` on Space, so the
  // `[role="button"]` match already covers it. Naming it here would have made
  // this comment a plausible, checkable claim that happened to be false.
  it('counts Space on an element that is focusable but not activated by it', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    advance(GESTURE_WINDOW_MS + 1);

    keyOn(el('<div role="dialog" tabindex="-1">a dialog</div>'), ' ');
    frameScrollTo(12_929 - REVEAL_THRESHOLD - 1);

    expect(result.current.revealed).toBe(true);
  });

  // And the case all of that must not break: the same key, pressed with focus
  // on the page rather than in a control, really is the reader scrolling.
  it('counts Space pressed on the page itself', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    advance(GESTURE_WINDOW_MS + 1);

    keyOn(el('<div>a day section</div>'), ' ');
    frameScrollTo(12_929 - REVEAL_THRESHOLD - 1);

    expect(result.current.revealed).toBe(true);
  });

  // A drag is only a scrollbar drag if it started somewhere a drag scrolls.
  //
  // The week-range selector is the concrete case: pressing a week button and
  // dragging across its neighbours refilters the list on every `mouseenter`,
  // which changes the document's height under the reader — and the browser's
  // correction for that would be admitted as reader-driven because the drag
  // was emitting `mousemove` with a button held the whole time. The header
  // moves while the reader is picking weeks.
  it('does not count a drag that began on a control', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    advance(GESTURE_WINDOW_MS + 1);

    dragFrom(el('<button type="button">Wk 5</button>'));
    frameScrollTo(12_807);

    expect(result.current.revealed).toBe(false);
  });

  // A drag over ordinary content is a text selection, and dragging a selection
  // past the edge of the viewport really does scroll the page.
  it('counts a drag that began on ordinary content', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    advance(GESTURE_WINDOW_MS + 1);

    dragFrom(el('<p>an event description</p>'));
    frameScrollTo(12_929 - REVEAL_THRESHOLD - 1);

    expect(result.current.revealed).toBe(true);
  });

  // `buttons` is a bitmask, so the old `!== 0` admitted right- and
  // middle-button drags too. Neither scrolls anything.
  it('does not count a secondary-button drag', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    advance(GESTURE_WINDOW_MS + 1);

    dragFrom(el('<p>an event description</p>'), 2);
    frameScrollTo(12_807);

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

    // Let the setup's own wheel expire first, or the scroll below is driven by
    // THAT gesture and this test says nothing about the one it names.
    advance(GESTURE_WINDOW_MS + 1);
    gesture('mousemove', { buttons: 0 });
    frameScrollTo(12_807);
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

    // Let the setup's own wheel expire first, or the scroll below is driven by
    // THAT gesture and this test says nothing about the one it names.
    advance(GESTURE_WINDOW_MS + 1);
    gesture('mousedown');
    frameScrollTo(12_807);

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
    frameScrollTo(12_807 + REVEAL_THRESHOLD);
    expect(result.current.revealed).toBe(false);
  });
});
