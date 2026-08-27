import { describe, it, expect } from 'vitest';
import {
  resolveAnchor,
  rampDistance,
  dayProgress,
  stripScrollLeft,
  pillGeometry,
  lerp,
  RAMP_MAX_PX,
  RAMP_SECTION_FRACTION,
} from '@/lib/utils/railPosition';

/**
 * A `topOf` lookup backed by a plain map, so these tests describe geometry
 * without a DOM. A key absent from the map stands for a day inside the view
 * window whose section is not mounted — the render window's subset is
 * smaller than the view window's day list, which is the case
 * `daySectionElement` returning null covers in the real hook.
 */
function tops(map: Record<string, number>) {
  return (key: string) => (key in map ? map[key] : null);
}

describe('resolveAnchor', () => {
  const keys = ['d1', 'd2', 'd3', 'd4'];

  it('returns null when there are no days', () => {
    expect(resolveAnchor([], 60, tops({}))).toBeNull();
  });

  it('keeps the last day whose top has passed the limit, and names the next', () => {
    // d1 and d2 are above the line, d3 is still below it.
    const at = resolveAnchor(keys, 60, tops({ d1: -900, d2: -200, d3: 400, d4: 1500 }));
    expect(at).toEqual({ key: 'd2', nextKey: 'd3', nextTop: 400 });
  });

  it('treats a top exactly at the limit as passed', () => {
    const at = resolveAnchor(keys, 60, tops({ d1: -900, d2: 60, d3: 400 }));
    expect(at?.key).toBe('d2');
  });

  it('falls back to the first day before anything has scrolled past', () => {
    // Nothing has passed the line, so the reader is plainly at the top of the
    // list. There is no handover in progress, so no next day and no ramp —
    // without this, `nextKey` would be d1 itself and progress would be
    // computed between a day and itself.
    const at = resolveAnchor(keys, 60, tops({ d1: 300, d2: 1200 }));
    expect(at).toEqual({ key: 'd1', nextKey: null, nextTop: null });
  });

  it('reports no next day once the last mounted section has passed', () => {
    const at = resolveAnchor(keys, 60, tops({ d1: -2000, d2: -1200, d3: -400 }));
    expect(at).toEqual({ key: 'd3', nextKey: null, nextTop: null });
  });

  it('skips days that are in the window but not mounted', () => {
    // d2 and d3 have no section yet; the handover in flight is d1 -> d4.
    const at = resolveAnchor(keys, 60, tops({ d1: -300, d4: 500 }));
    expect(at).toEqual({ key: 'd1', nextKey: 'd4', nextTop: 500 });
  });

  it('does not let an unmounted first day strand the anchor', () => {
    const at = resolveAnchor(keys, 60, tops({ d2: -300, d3: 500 }));
    expect(at).toEqual({ key: 'd2', nextKey: 'd3', nextTop: 500 });
  });

  // The walk reaches the end of the list in two situations that mean
  // opposite things, and it used to answer `keys[0]` for both.
  //
  // CI on Linux WebKit, after a landing that other checks confirm reached
  // today: the strip at `scrollLeft 0`, `aria-current` on 2026-01-03, the
  // reader on 2026-08-27 — and one pixel of scroll snapped both to today.
  // Both consumers had re-run this walk against a DOM that had not caught
  // up, been handed a confident "the first day of the year", and had no
  // reason to ask again until the reader's next gesture.
  it('answers nothing when it could measure nothing', () => {
    expect(resolveAnchor(keys, 60, tops({}))).toBeNull();
  });

  // The other direction is already covered above, by "reports no next day
  // once the last mounted section has passed": that case reaches the end of
  // the walk WITH measurements and must still answer. Proven by injection —
  // making `measured` permanently false fails that test and not this one.
  //
  // A test asserting `resolveAnchor(keys, 60, tops({ d1: 300 }))?.key` is
  // 'd1' was written here first and deleted: `d1`'s top is below the limit,
  // so the walk returns from inside the loop and never reaches the guard.
  // It would have passed against code that returned null unconditionally at
  // the end, while its comment claimed the opposite.
});

describe('rampDistance', () => {
  it('spans a quarter of an ordinary day section', () => {
    expect(rampDistance(600, 36)).toBe(600 * RAMP_SECTION_FRACTION);
  });

  it('caps at RAMP_MAX_PX so a very long day does not ramp forever', () => {
    expect(rampDistance(10_000, 36)).toBe(RAMP_MAX_PX);
  });

  it('never drops below the header height, so a one-event day still hands over', () => {
    // A quarter of 80px is 20px, which is shorter than the header itself —
    // the ramp would finish before the title had begun to move.
    expect(rampDistance(80, 36)).toBe(36);
  });

  it('survives an unmeasured section', () => {
    expect(rampDistance(0, 36)).toBe(36);
    expect(rampDistance(Number.NaN, 36)).toBe(36);
  });

  it('returns 0 when nothing has been measured at all', () => {
    // Both inputs unmeasured — `dayProgress` treats a zero ramp as "no
    // handover in progress" rather than dividing by it.
    expect(rampDistance(0, 0)).toBe(0);
  });
});

describe('dayProgress', () => {
  it('is 0 while the next day is further away than the ramp', () => {
    expect(dayProgress(1000, 60, 200)).toBe(0);
    // Exactly at the start of the ramp.
    expect(dayProgress(260, 60, 200)).toBe(0);
  });

  it('rises linearly across the ramp', () => {
    expect(dayProgress(160, 60, 200)).toBeCloseTo(0.5);
    expect(dayProgress(110, 60, 200)).toBeCloseTo(0.75);
  });

  it('reaches 1 exactly as the next day meets the limit', () => {
    // This is the instant `resolveAnchor` flips to the next day, which is
    // what makes the value continuous across the handover: progress hits 1
    // on the old anchor in the same frame it would restart at 0 on the new
    // one.
    expect(dayProgress(60, 60, 200)).toBe(1);
  });

  it('clamps rather than overshooting if the flip is measured a frame late', () => {
    expect(dayProgress(-40, 60, 200)).toBe(1);
  });

  it('is 0 when there is no ramp to travel', () => {
    expect(dayProgress(100, 60, 0)).toBe(0);
    expect(dayProgress(100, 60, -5)).toBe(0);
  });
});

describe('stripScrollLeft', () => {
  it('centres the pill in the strip', () => {
    expect(stripScrollLeft(500, 300, 2000)).toBe(350);
  });

  it('clamps at the start of the season, letting the pill sit left of centre', () => {
    // The strip cannot scroll before its own beginning, so the highlight
    // pins near the left edge on its own — no separate branch for the ends
    // of the range.
    expect(stripScrollLeft(20, 300, 2000)).toBe(0);
  });

  it('clamps at the end of the season, letting the pill sit right of centre', () => {
    // Content 2300 wide in a 300 viewport, so maxScroll is 2000 and the last
    // chip's centre sits at 2280. Centring it would want scrollLeft 2130,
    // which is past the end.
    expect(stripScrollLeft(2280, 300, 2000)).toBe(2000);
  });

  it('stays at 0 when the whole strip fits with nothing to scroll', () => {
    expect(stripScrollLeft(120, 400, 0)).toBe(0);
    // A negative max (content narrower than the viewport) is still 0.
    expect(stripScrollLeft(120, 400, -50)).toBe(0);
  });
});

describe('pillGeometry', () => {
  const a = { left: 100, width: 44 };
  const b = { left: 148, width: 44 };

  it('sits exactly on the anchor chip at rest', () => {
    expect(pillGeometry(a, b, 0)).toEqual({ left: 100, width: 44 });
  });

  it('sits exactly on the next chip when the handover completes', () => {
    expect(pillGeometry(a, b, 1)).toEqual({ left: 148, width: 44 });
  });

  it('straddles both chips mid-handover', () => {
    // The half-and-half state: stop scrolling here and the pill covers the
    // right half of one chip and the left half of the next.
    expect(pillGeometry(a, b, 0.5)).toEqual({ left: 124, width: 44 });
  });

  it('interpolates width too, for chips that are not the same size', () => {
    expect(pillGeometry({ left: 0, width: 40 }, { left: 60, width: 60 }, 0.5))
      .toEqual({ left: 30, width: 50 });
  });

  it('stays on the anchor when there is no next chip', () => {
    expect(pillGeometry(a, null, 0.8)).toEqual({ left: 100, width: 44 });
  });

  it('returns null when the anchor chip has no geometry', () => {
    expect(pillGeometry(null, b, 0.5)).toBeNull();
  });
});

describe('lerp', () => {
  it('interpolates between the endpoints', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.25)).toBe(2.5);
  });

  it('lands exactly on the far endpoint rather than near it', () => {
    // Integer coordinates cannot catch this — `a + (b - a) * t` happens to be
    // exact for them, so the previous version of this test could never have
    // failed. These are fractional, as `DOMRect` values are under browser
    // text zoom, and this specific pair returns 63.529707595868686 (high by
    // 7.1e-15) without the endpoint returned outright.
    expect(lerp(14.338952280847916, 63.52970759586868, 1)).toBe(63.52970759586868);
    expect(lerp(148, 196, 1)).toBe(196);
  });

  it('lands exactly on the near endpoint too', () => {
    expect(lerp(14.338952280847916, 63.52970759586868, 0)).toBe(14.338952280847916);
  });

  it('places the pill exactly on the next chip when a handover completes', () => {
    // The property `lerp`'s endpoint handling exists to protect: at progress
    // 1 the pill must sit on the next chip, not 7e-15 past it, because the
    // clip layer's inset is derived from the same number.
    const a = { left: 14.338952280847916, width: 44.5 };
    const b = { left: 63.52970759586868, width: 44.5 };
    expect(pillGeometry(a, b, 1)).toEqual(b);
  });
});
