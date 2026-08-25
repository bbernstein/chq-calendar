/**
 * Whether the site header is showing, as a pure function of scroll position.
 *
 * The header is the only route to the "more" menu and the year selector
 * (#272), and below the fold it used to be unreachable without scrolling the
 * whole document back to the top — which from a rail tap can be tens of
 * thousands of pixels. It now reveals on scroll up and hides on scroll down,
 * and this module is the decision that drives it.
 *
 * ## Why the rule is a pure function rather than a hook
 *
 * The failure modes of a reveal-on-scroll header are all rule failures:
 * flickering on momentum, needing an implausibly long flick to come back
 * after a long descent, flashing in when the page jumps under a rail tap.
 * None of them need layout to reproduce, and jsdom — which has no layout, no
 * compositor and no scroll anchoring — cannot reproduce the geometry ones
 * anyway. So the rule is testable here and the geometry is left to
 * `e2e/verify-header-reveal.mjs`.
 */

/**
 * Accumulated travel, in px, that a direction must sustain before it flips
 * the decision.
 *
 * Small enough that "a small upward flick" is honestly small, large enough
 * that iOS Safari's momentum jitter — which reports a few px in the wrong
 * direction as a fling settles — cannot flip it.
 */
export const REVEAL_THRESHOLD = 24;

export interface HeaderRevealState {
  /** Whether the header is currently showing. */
  revealed: boolean;
  /**
   * Travel accumulated in the current direction, signed: positive is
   * scrolling down. Reset on every direction change — see `nextHeaderReveal`.
   */
  travel: number;
  /** The `scrollY` this state was computed at; the baseline for the next one. */
  y: number;
}

export const initialHeaderReveal = (y: number): HeaderRevealState => ({
  revealed: true,
  travel: 0,
  y,
});

/**
 * The decision after the scroll position moves to `y`.
 *
 * `topZone` is the header's own height. Within it the header's natural
 * position is still on screen, so "hidden" is not a state it can be in: a
 * sticky header cannot be parked above a position it has not yet reached, and
 * marking it hidden there would make a visible header `inert`.
 *
 * The accumulator restarts on every direction change, and that restart *is*
 * the hysteresis. Carrying it would mean a reader who has scrolled 400px down
 * needs 424px up to see the header again; judging each event on its own delta
 * instead would mean a trackpad's many-small-deltas flick never fires at all.
 * Restarting is the only rule that gets both right.
 */
export function nextHeaderReveal(
  prev: HeaderRevealState,
  y: number,
  { threshold = REVEAL_THRESHOLD, topZone = 0 }: { threshold?: number; topZone?: number } = {},
): HeaderRevealState {
  // At (or above — WebKit rubber-banding reports a negative `scrollY`) the
  // top of the document the header is simply shown, and the accumulator is
  // cleared so travel banked on the way in cannot fire on the way out.
  if (y <= topZone) return { revealed: true, travel: 0, y };

  const delta = y - prev.y;
  // `scroll` fires for momentum settling and for rubber-band release without
  // the position changing. Folding a zero into the accumulator is harmless
  // arithmetic, but returning `prev` unchanged keeps the state identity
  // stable for callers that compare it.
  if (delta === 0) return prev;

  const reversed = prev.travel !== 0 && Math.sign(delta) !== Math.sign(prev.travel);
  const travel = reversed ? delta : prev.travel + delta;

  if (travel >= threshold) return { revealed: false, travel, y };
  if (travel <= -threshold) return { revealed: true, travel, y };
  return { revealed: prev.revealed, travel, y };
}

/**
 * Move the baseline to `y` without re-deciding anything.
 *
 * The app scrolls the document itself in several places — a rail chip tap, the
 * filter panel's insertion correction, the day-anchor hold — and those jumps
 * are large. Read as gestures they are the biggest scroll the reader could
 * possibly make, so a rail tap would flash the header in on every use.
 *
 * The fix is a resync rather than a suppression flag, and the difference
 * matters. A flag has to guess how many `scroll` events a programmatic jump
 * will produce — several `scrollBy` calls in one frame coalesce into one
 * event, so a counter over-swallows and eats the reader's next real scroll.
 * Resyncing the baseline instead makes the provoked event a zero delta by
 * construction, and if the reader *does* scroll before it arrives, their
 * delta is measured from the correct post-jump position.
 */
export function resyncHeaderReveal(prev: HeaderRevealState, y: number): HeaderRevealState {
  return { revealed: prev.revealed, travel: 0, y };
}
