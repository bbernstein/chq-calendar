/**
 * The geometry behind the day rail's scroll-linked highlight.
 *
 * Every function here is pure and takes its measurements as arguments, so
 * the whole model is testable without a layout. That is deliberate: the rail
 * has already shipped one bug that eleven green task reviews missed because
 * the failure lived in the seam between a measurement and the DOM. Keeping
 * the arithmetic out of the DOM does not test the seam — only a browser does
 * — but it does mean a seam bug cannot hide inside arithmetic that was never
 * checked.
 */

/** A chip's horizontal extent in the strip's own content coordinates. */
export interface ChipExtent {
  left: number;
  width: number;
}

export interface AnchorResolution {
  /** The day the reader is currently on. */
  key: string;
  /**
   * The day being handed over to, or null when no handover is in progress —
   * the reader is above the first day, or past the last mounted one.
   */
  nextKey: string | null;
  /** `nextKey`'s viewport-relative top, or null alongside a null `nextKey`. */
  nextTop: number | null;
}

/**
 * How much of a day section the highlight travels across, as a fraction.
 *
 * A quarter is long enough to be visible at flick speed (~200px is roughly
 * twelve frames) and short enough that the rail is unambiguously at rest for
 * most of a day's worth of reading.
 */
export const RAMP_SECTION_FRACTION = 0.25;

/**
 * The longest the handover may take, in pixels of scroll.
 *
 * Without a cap, a day with sixty events would start the rail moving
 * thousands of pixels before the title it is tracking does, and the two
 * would visibly disagree about which day the reader is in.
 */
export const RAMP_MAX_PX = 200;

/**
 * The day the reader is on, and the one being handed over to.
 *
 * The forward walk — "keep the last section whose top has passed the
 * chrome" — is the same question `useDayAnchor` has always asked, and this
 * is now the only place that asks it. Both the discrete anchor (which drives
 * `aria-current`) and the continuous highlight resolve through this
 * function, so the pill and the announced current day cannot name different
 * days. Two copies of the walk could drift; one cannot.
 *
 * `topOf` returns null for a day that is in the rendered list but has no
 * mounted section yet — the commit that produced the list hasn't landed as
 * DOM at the instant this runs. (It is never a windowing artefact: #274
 * phase 4 deleted the render window and then the view window, so there is no
 * subset left to lag behind.) Such days are skipped rather than ending the
 * walk.
 *
 * **Returns null when it could not measure a single day**, which is not the
 * same as "nothing has passed the chrome" even though the walk reaches the
 * end in both cases. Answering `keys[0]` for the second is right — the
 * reader is above the first day. Answering it for the first is a confident
 * report of the first day of the YEAR based on no evidence at all, and
 * because both consumers only re-derive on a scroll, a wrong answer here
 * survives until the reader's next gesture.
 *
 * That is not hypothetical. CI on Linux WebKit, after a landing the geometry
 * confirms reached today: the strip at `scrollLeft 0`, `aria-current` on
 * 2026-01-03, the reader on 2026-08-27 — and one pixel of scroll snapped
 * both to today. Two hooks that share this walk disagreeing with the page
 * they measure was the tell; each had re-run it against a DOM that had not
 * caught up, and pinned itself to the fallback.
 */
export function resolveAnchor(
  keys: string[],
  limit: number,
  topOf: (key: string) => number | null,
): AnchorResolution | null {
  if (keys.length === 0) return null;

  // The first day is the fallback: before any scroll nothing has passed the
  // chrome, and the reader is plainly looking at the top of the list.
  let key = keys[0];
  let anchored = false;
  // Whether any day could be measured at all. Without this the fallback
  // above is returned in two situations that mean opposite things — see the
  // doc comment.
  let measured = false;

  for (const candidate of keys) {
    const top = topOf(candidate);
    if (top === null) continue;
    measured = true;
    if (top <= limit) {
      key = candidate;
      anchored = true;
      continue;
    }
    // The first section still below the line. It is the handover target only
    // if something has actually passed: otherwise the reader is above the
    // first day, this candidate *is* the fallback anchor, and reporting it
    // as the next day would ask for progress between a day and itself.
    return anchored
      ? { key, nextKey: candidate, nextTop: top }
      : { key, nextKey: null, nextTop: null };
  }

  // Nothing was measurable, so there is no answer to give. Deliberately not
  // `keys[0]`: a caller that keeps its previous anchor for one frame is
  // right far more often than one told the reader is in January.
  if (!measured) return null;

  // Everything mounted has passed — the last day of the list.
  return { key, nextKey: null, nextTop: null };
}

/**
 * How much scroll the highlight takes to travel from one day to the next.
 *
 * Floored at the header height so a one-event day still hands over across at
 * least the distance its own title takes to move; a quarter of an 80px
 * section is 20px, which would finish before the title had begun.
 */
export function rampDistance(sectionHeight: number, headerHeight: number): number {
  const header = Number.isFinite(headerHeight) && headerHeight > 0 ? headerHeight : 0;
  const section = Number.isFinite(sectionHeight) && sectionHeight > 0 ? sectionHeight : 0;
  return Math.max(header, Math.min(section * RAMP_SECTION_FRACTION, RAMP_MAX_PX));
}

/**
 * How far the handover to the next day has got, from 0 to 1.
 *
 * Reaches 1 at the exact moment `resolveAnchor` flips to the next day, which
 * is what makes the value continuous across the flip rather than merely
 * smooth on either side of it.
 *
 * A ramp of 0 means nothing has been measured yet; that is "no handover in
 * progress", not a division to perform.
 */
export function dayProgress(nextTop: number, limit: number, ramp: number): number {
  if (!(ramp > 0)) return 0;
  const remaining = nextTop - limit;
  if (remaining >= ramp) return 0;
  if (remaining <= 0) return 1;
  return (ramp - remaining) / ramp;
}

/**
 * Where the strip should be scrolled to keep the highlight centred.
 *
 * The clamp is what gives the ends of the season their behaviour for free:
 * the strip cannot scroll past its own bounds, so near the first or last day
 * the pill simply stops being centred and pins toward that edge. No separate
 * branch, and nothing to keep in step with the centred case.
 */
export function stripScrollLeft(
  pillCentre: number,
  clientWidth: number,
  maxScroll: number,
): number {
  const upper = Math.max(0, maxScroll);
  return Math.min(upper, Math.max(0, pillCentre - clientWidth / 2));
}

/**
 * The highlight's extent, interpolated between the two chips it is between.
 *
 * Width is interpolated as well as position: chips are near enough uniform
 * today (`min-w-11` dominates a two-digit label) but nothing enforces that,
 * and a pill that kept one chip's width while sliding onto a wider one would
 * clip the label it is supposed to be highlighting.
 */
export function pillGeometry(
  anchor: ChipExtent | null,
  next: ChipExtent | null,
  progress: number,
): ChipExtent | null {
  if (!anchor) return null;
  if (!next) return { left: anchor.left, width: anchor.width };
  return {
    left: lerp(anchor.left, next.left, progress),
    width: lerp(anchor.width, next.width, progress),
  };
}

/**
 * Interpolate, landing exactly on the endpoints.
 *
 * The endpoints are returned outright rather than computed. `a + (b - a) * t`
 * is exact at `t === 0` but *not* at `t === 1`: `b - a` rounds first, and
 * adding that back to `a` need not reproduce `b`. Measured over 200,000
 * random pairs with realistic chip geometry, it misses in about 0.025% of
 * them — e.g. `lerp(14.338952280847916, 63.52970759586868, 1)` returns
 * `63.529707595868686`, high by 7.1e-15.
 *
 * An earlier version of this comment asserted the opposite — that
 * `a * (1 - t) + b * t` was the form that drifts. That was backwards: at
 * `t === 1` it evaluates `a * 0 + b * 1`, which is exactly `b`, and it missed
 * in 0 of the same 200,000 pairs. Either form is fine once the endpoints are
 * returned directly, which is what this now does, and the reasoning is
 * recorded because the wrong version of it was written down confidently once
 * already.
 *
 * The error is far below a device pixel and nothing rendered could show it.
 * It is fixed anyway because `pillGeometry` promises the pill sits *exactly*
 * on the chip it has finished travelling to, and a promise that holds only
 * for integer coordinates is one that quietly stops holding under browser
 * text zoom, where `DOMRect` values are fractional.
 */
export function lerp(a: number, b: number, t: number): number {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return a + (b - a) * t;
}
