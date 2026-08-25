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
const HEIGHT = '--site-header-h';

const offset = () => document.documentElement.style.getPropertyValue(OFFSET);
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

/** A gesture, dispatched where the hook listens for it. */
const gesture = (type: string, init: object = {}) => act(() => {
  const Ctor = type === 'keydown' ? KeyboardEvent : type.startsWith('touch') ? Event : MouseEvent;
  window.dispatchEvent(new Ctor(type, { bubbles: true, ...init }));
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
  act(() => { window.dispatchEvent(new WheelEvent('wheel', { bubbles: true })); });
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
  document.documentElement.style.removeProperty(OFFSET);
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

  // Focusable is not the same as activated-by-Space. `WeekBadge` and the modal
  // container both carry a `tabIndex` and both scroll the page on Space, so a
  // rule keyed on focusability rather than on behaviour would be wrong about
  // the platform, not merely cautious.
  it('counts Space on an element that is focusable but not activated by it', () => {
    const { result } = mount();
    scrollTo(30_000);
    expect(result.current.revealed).toBe(false);
    jumpTo(12_929);
    advance(GESTURE_WINDOW_MS + 1);

    keyOn(el('<span tabindex="0">Wk 5/6</span>'), ' ');
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
