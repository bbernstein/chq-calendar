import { describe, expect, it } from 'vitest';
import {
  REVEAL_THRESHOLD,
  initialHeaderReveal,
  nextHeaderReveal,
  resyncHeaderReveal,
  type HeaderRevealState,
} from '@/lib/siteHeaderReveal';

/**
 * The show/hide decision for the site header (#272), as a pure function of
 * scroll position — direction, threshold, and the top of the document.
 *
 * It is pure because the browser cannot be asked these questions cheaply and
 * jsdom cannot be asked them at all: there is no layout, no compositor and no
 * scroll anchoring. What is testable here is the *rule*, and the rule is
 * where the flicker bugs live. The geometry that the rule drives is covered
 * by `e2e/verify-header-reveal.mjs`.
 */

/** Feed a run of scroll positions through the reducer. */
const scrollThrough = (
  from: HeaderRevealState,
  positions: number[],
  opts?: { threshold?: number; topZone?: number },
) => positions.reduce((state, y) => nextHeaderReveal(state, y, opts), from);

describe('nextHeaderReveal', () => {
  // Deep in the document, header already hidden. The state most of these
  // cases start from, since the top of the page is a special case of its own.
  const deepAndHidden: HeaderRevealState = { revealed: false, travel: 0, y: 30_000 };

  it('starts revealed at the top of the document', () => {
    expect(initialHeaderReveal(0).revealed).toBe(true);
  });

  it('hides once the reader has scrolled down past the threshold', () => {
    const state = nextHeaderReveal(initialHeaderReveal(0), REVEAL_THRESHOLD + 1, { topZone: 0 });
    expect(state.revealed).toBe(false);
  });

  it('stays revealed while downward travel is still short of the threshold', () => {
    const state = nextHeaderReveal(initialHeaderReveal(0), REVEAL_THRESHOLD - 1, { topZone: 0 });
    expect(state.revealed).toBe(true);
  });

  it('reveals once the reader has scrolled up past the threshold', () => {
    const state = nextHeaderReveal(deepAndHidden, 30_000 - REVEAL_THRESHOLD - 1);
    expect(state.revealed).toBe(true);
  });

  it('stays hidden while upward travel is still short of the threshold', () => {
    const state = nextHeaderReveal(deepAndHidden, 30_000 - (REVEAL_THRESHOLD - 1));
    expect(state.revealed).toBe(false);
  });

  // The threshold is against *accumulated* travel, not a single event. A
  // trackpad delivers a 30px flick as many small deltas; a per-event
  // comparison would never fire for any of them.
  it('accumulates travel across several small ticks in the same direction', () => {
    const ticks = [30_000 - 8, 30_000 - 16, 30_000 - 24, 30_000 - 32];
    expect(scrollThrough(deepAndHidden, ticks).revealed).toBe(true);
  });

  // This is the hysteresis. Without the reset, 400px of downward travel
  // leaves a +400 accumulator that a 24px flick up cannot overcome — the
  // header would need 424px of scrolling up to come back. With it, every
  // reversal is judged on its own.
  it('restarts the accumulator when the direction reverses', () => {
    const afterLongDescent = scrollThrough(initialHeaderReveal(0), [400], { topZone: 0 });
    expect(afterLongDescent.revealed).toBe(false);

    const afterSmallFlickUp = nextHeaderReveal(afterLongDescent, 400 - REVEAL_THRESHOLD - 1, { topZone: 0 });
    expect(afterSmallFlickUp.revealed).toBe(true);
  });

  // The mirror of the above, and the reason the reset is symmetric: a long
  // climb must not make the header impossible to dismiss again.
  it('restarts the accumulator when the direction reverses back to down', () => {
    const afterLongClimb = scrollThrough(deepAndHidden, [30_000 - 400]);
    expect(afterLongClimb.revealed).toBe(true);

    const afterSmallFlickDown = nextHeaderReveal(afterLongClimb, 30_000 - 400 + REVEAL_THRESHOLD + 1);
    expect(afterSmallFlickDown.revealed).toBe(false);
  });

  // iOS Safari fires `scroll` for momentum, for rubber-banding, and
  // sometimes for nothing at all. A zero delta must not disturb the
  // accumulator, or a run of them would erase a genuine gesture.
  it('leaves the decision and the accumulator untouched when nothing moved', () => {
    const midGesture = nextHeaderReveal(deepAndHidden, 30_000 - 10);
    const repeated = nextHeaderReveal(midGesture, 30_000 - 10);
    expect(repeated).toEqual(midGesture);
  });

  // A sticky header cannot be parked above a position it has not yet
  // reached, so inside the top zone "hidden" is a state the DOM will
  // contradict — and a header the reader can see would be marked `inert`.
  // Reachable without any large scroll: the reader zooms text, the header
  // grows, and a position that was below the zone is now inside it.
  it('reveals inside the top zone even when the move there was a scroll down', () => {
    const state = nextHeaderReveal({ revealed: false, travel: 0, y: 100 }, 105, { topZone: 120 });
    expect(state.revealed).toBe(true);
  });

  // Scrolling *down* while still inside the top zone must not hide the
  // header early — its natural position is still on screen, so hiding it
  // would mean parking a header the reader can see.
  it('stays revealed scrolling down within the top zone', () => {
    const state = scrollThrough(initialHeaderReveal(0), [30, 60], { topZone: 72 });
    expect(state.revealed).toBe(true);
  });

  // Rubber-band overscroll at the top of the document reports a negative
  // `scrollY` in WebKit. That is the top of the page, not a scroll up into
  // it.
  it('treats overscroll above the document top as the top zone', () => {
    const state = nextHeaderReveal({ revealed: false, travel: 500, y: 10 }, -40, { topZone: 0 });
    expect(state.revealed).toBe(true);
  });

  // Leaving the top zone with the accumulator already loaded would hide the
  // header on the first pixel below it.
  it('leaves the top zone with a cleared accumulator', () => {
    const inZone = nextHeaderReveal(initialHeaderReveal(0), 10, { topZone: 72 });
    expect(inZone.travel).toBe(0);
  });
});

describe('resyncHeaderReveal', () => {
  // A rail chip tap jumps the document by tens of thousands of pixels. Read
  // as a scroll it is the largest upward gesture the reader could possibly
  // make, and the header would fly in every time.
  it('moves the baseline to the jumped-to position without revealing', () => {
    const hidden: HeaderRevealState = { revealed: false, travel: 0, y: 30_000 };
    const state = resyncHeaderReveal(hidden, 1_200);
    expect(state.revealed).toBe(false);
    expect(state.y).toBe(1_200);
  });

  it('keeps a revealed header revealed across a programmatic jump', () => {
    const revealed: HeaderRevealState = { revealed: true, travel: -100, y: 1_200 };
    expect(resyncHeaderReveal(revealed, 30_000).revealed).toBe(true);
  });

  // Carrying the accumulator across the jump would let travel banked before
  // it fire against a position measured after it.
  it('clears the accumulator so pre-jump travel cannot fire later', () => {
    const midGesture: HeaderRevealState = { revealed: false, travel: 20, y: 5_000 };
    expect(resyncHeaderReveal(midGesture, 9_000).travel).toBe(0);
  });

  // The scroll event that the programmatic jump itself provokes arrives a
  // frame later. Measured from the resynced baseline it is a zero delta, so
  // it changes nothing — which is the whole mechanism.
  it('makes the scroll event the jump provokes a no-op', () => {
    const hidden: HeaderRevealState = { revealed: false, travel: 0, y: 30_000 };
    const afterJump = resyncHeaderReveal(hidden, 1_200);
    expect(nextHeaderReveal(afterJump, 1_200).revealed).toBe(false);
  });
});
