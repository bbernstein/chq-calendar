import { describe, expect, it, afterEach } from 'vitest';
import { pressIsOnScrollbar } from '@/lib/scrollGestures';

/**
 * The one branch in this module the browser leg cannot exercise.
 *
 * A press in the scrollbar track pages the view, and it fires no wheel, no
 * key, no touch and no `mousemove` — so without it, that standard way of
 * scrolling never reaches the header at all. Detecting it means asking
 * whether the pointer was in the scrollbar gutter.
 *
 * The gutter does not exist everywhere, which is why this is tested here and
 * not in `verify-header-reveal.mjs`. Measured in headless Chromium:
 * `document.documentElement.clientWidth` is 900 and `innerWidth` is 900 —
 * overlay scrollbars, no gutter, and a press at `innerWidth - 5` lands on the
 * page and scrolls nothing. macOS is the same by default. So the browser
 * suite can never reach this, and the predicate is kept pure and pinned here
 * instead of being left as the module's one unguarded branch.
 *
 * It cannot produce a false positive: a gutter only has width when a classic
 * scrollbar is occupying it.
 */

const viewport = ({ clientWidth = 880, clientHeight = 680, innerWidth = 900, innerHeight = 700 }) => {
  Object.defineProperty(document.documentElement, 'clientWidth', { value: clientWidth, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: clientHeight, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: innerWidth, configurable: true, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true, writable: true });
};

const press = (clientX: number, clientY: number, button = 0) =>
  ({ clientX, clientY, button }) as MouseEvent;

afterEach(() => { viewport({ clientWidth: 0, clientHeight: 0, innerWidth: 1024, innerHeight: 768 }); });

describe('pressIsOnScrollbar', () => {
  it('recognises a press in the vertical scrollbar gutter', () => {
    viewport({});
    expect(pressIsOnScrollbar(press(890, 300))).toBe(true);
  });

  it('recognises a press in the horizontal scrollbar gutter', () => {
    viewport({});
    expect(pressIsOnScrollbar(press(300, 690))).toBe(true);
  });

  it('does not recognise a press inside the content area', () => {
    viewport({});
    expect(pressIsOnScrollbar(press(300, 300))).toBe(false);
  });

  // The boundary itself belongs to the content: `clientWidth` is the first
  // pixel the gutter starts AFTER.
  it('treats the last content pixel as content', () => {
    viewport({});
    expect(pressIsOnScrollbar(press(879, 300))).toBe(false);
  });

  // Overlay scrollbars — macOS, and headless Chromium — leave no gutter at
  // all, so nothing is ever in one and this correctly finds nothing.
  it('finds no gutter when the scrollbars are overlaid', () => {
    viewport({ clientWidth: 900, clientHeight: 700 });
    expect(pressIsOnScrollbar(press(895, 300))).toBe(false);
  });

  // A right-click in the gutter opens the scrollbar's context menu; it does
  // not page the view.
  it('ignores a press that is not the primary button', () => {
    viewport({});
    expect(pressIsOnScrollbar(press(890, 300, 2))).toBe(false);
  });

  // A document with no measured content box reports `clientWidth: 0`, which
  // read literally puts the entire page "past the content" — so every press
  // anywhere would arm a gesture that scrolled nothing. jsdom does exactly
  // this, and three unrelated tests failed the moment the predicate landed
  // without the guard.
  it('finds no gutter in a document that has not been laid out', () => {
    viewport({ clientWidth: 0, clientHeight: 0 });
    expect(pressIsOnScrollbar(press(300, 300))).toBe(false);
    expect(pressIsOnScrollbar(press(890, 690))).toBe(false);
  });
});
