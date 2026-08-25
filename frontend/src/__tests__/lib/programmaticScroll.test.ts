import { afterEach, describe, expect, it, vi } from 'vitest';
import { onProgrammaticScroll, scrollWindowBy } from '@/lib/programmaticScroll';

/**
 * The app scrolls the document itself in five places, and #272's header must
 * not read any of them as the reader scrolling up. What makes that possible
 * is that the jump announces itself — and announces itself *after* the
 * position has already moved, so a subscriber resyncing its baseline reads
 * the post-jump position rather than the one it is about to leave.
 */

const unsubscribes: Array<() => void> = [];

const subscribe = (fn: () => void) => {
  const off = onProgrammaticScroll(fn);
  unsubscribes.push(off);
  return off;
};

/** Replace `window.scrollBy` with one that actually moves `scrollY`. */
const stubScrollBy = () => {
  const calls: number[] = [];
  vi.spyOn(window, 'scrollBy').mockImplementation(((_x: number, y: number) => {
    calls.push(y);
    Object.defineProperty(window, 'scrollY', { value: window.scrollY + y, configurable: true, writable: true });
  }) as typeof window.scrollBy);
  return calls;
};

afterEach(() => {
  while (unsubscribes.length) unsubscribes.pop()!();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
});

describe('scrollWindowBy', () => {
  it('scrolls the window by the delta', () => {
    const calls = stubScrollBy();
    scrollWindowBy(240);
    expect(calls).toEqual([240]);
  });

  it('announces the scroll to subscribers', () => {
    stubScrollBy();
    const seen = vi.fn();
    subscribe(seen);
    scrollWindowBy(240);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  // The ordering is the entire mechanism. A subscriber that resyncs its
  // baseline needs the position the jump LANDED on; told beforehand it would
  // record the position the jump is about to leave, and the scroll event that
  // arrives a frame later would then look like the whole jump — exactly the
  // rail-tap flash the announcement exists to prevent.
  it('announces only after the position has already moved', () => {
    stubScrollBy();
    Object.defineProperty(window, 'scrollY', { value: 1_000, configurable: true, writable: true });
    let seenAt = -1;
    subscribe(() => { seenAt = window.scrollY; });
    scrollWindowBy(240);
    expect(seenAt).toBe(1_240);
  });

  // Every call site guarded `delta !== 0` for itself before this helper
  // existed. The guard moved here so five copies cannot drift.
  it('does not scroll when the delta is zero', () => {
    const calls = stubScrollBy();
    scrollWindowBy(0);
    expect(calls).toEqual([]);
  });

  // A zero delta still announces, and this is the opposite of what it looks
  // like. Measured in Chromium, opening the filter panel from the rail with
  // the header revealed: the panel's insertion changed layout above the
  // reader, Chromium's own scroll anchoring corrected +44px BEFORE our
  // `useLayoutEffect` ran, our correction therefore computed a delta of 0 —
  // and the announcement it skipped was the one that would have told the
  // header that the +44px scroll about to be reported was not the reader.
  // The header hid on a tap that nobody scrolled. WebKit does not anchor
  // there, computed +44 itself, and behaved correctly throughout.
  //
  // So a delta of zero does not mean "nothing happened". It means the app
  // laid out again and needed no correction — often precisely because the
  // browser had already made one.
  it('announces even when the correction it computed was zero', () => {
    stubScrollBy();
    const seen = vi.fn();
    subscribe(seen);
    scrollWindowBy(0);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('announces to every subscriber', () => {
    stubScrollBy();
    const first = vi.fn();
    const second = vi.fn();
    subscribe(first);
    subscribe(second);
    scrollWindowBy(240);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops announcing to a subscriber that has unsubscribed', () => {
    stubScrollBy();
    const seen = vi.fn();
    subscribe(seen)();
    scrollWindowBy(240);
    expect(seen).not.toHaveBeenCalled();
  });
});
