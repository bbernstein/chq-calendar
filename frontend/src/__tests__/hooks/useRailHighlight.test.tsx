import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/preact';
import { useRailHighlight, type RailHighlight } from '@/hooks/useRailHighlight';
import { DAY_SECTION_ATTR, DAY_HEADER_ATTR } from '@/lib/utils/daySections';
import { installResizeObserverMock } from '@/__tests__/helpers/resizeObserver';

/**
 * jsdom has no layout, so every measurement this hook makes has to be stated
 * outright. A test that skipped this would pass on all-zero rects whether or
 * not the hook worked — which is exactly how the rail shipped a highlight
 * that never moved.
 *
 * Chips are laid out on a 48px pitch (44px wide, 4px gap), matching the real
 * `min-w-11 gap-1` row.
 */
const CHIP_W = 44;
const PITCH = 48;
const RAIL_H = 60;

interface LayoutSpec {
  /** Viewport-relative top per day section, plus that section's own height. */
  sections: Record<string, { top: number; height?: number; headerHeight?: number }>;
  /** Chip keys in row order; extents are derived from the pitch. */
  chips: string[];
  /** The strip's visible width. */
  clientWidth?: number;
}

function installLayout(spec: LayoutSpec) {
  const contentWidth = spec.chips.length * PITCH;
  const chipLeft = (key: string) => spec.chips.indexOf(key) * PITCH;
  const original = Element.prototype.getBoundingClientRect;

  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const el = this as HTMLElement;
    const chip = el.dataset?.chip;
    if (chip && spec.chips.includes(chip)) {
      // Content coordinates are `chipRect.left - contentRect.left`, so an
      // arbitrary non-zero content origin is used deliberately: a stub with
      // the content at 0 would let a hook that forgot to subtract still pass.
      return { left: 1000 + chipLeft(chip), width: CHIP_W, top: 0, height: 50 } as DOMRect;
    }
    if (el.hasAttribute?.('data-rail-content')) {
      return { left: 1000, width: contentWidth, top: 0, height: 50 } as DOMRect;
    }
    const sectionKey = el.getAttribute?.(DAY_SECTION_ATTR);
    if (sectionKey && spec.sections[sectionKey]) {
      const s = spec.sections[sectionKey];
      return { top: s.top, height: s.height ?? 800, left: 0, width: 400 } as DOMRect;
    }
    if (el.hasAttribute?.(DAY_HEADER_ATTR)) {
      const owner = el.closest(`[${DAY_SECTION_ATTR}]`);
      const key = owner?.getAttribute(DAY_SECTION_ATTR) ?? '';
      return { top: 0, height: spec.sections[key]?.headerHeight ?? 36, left: 0, width: 400 } as DOMRect;
    }
    return original.call(this);
  };

  document.documentElement.style.setProperty('--day-rail-h', `${RAIL_H}px`);
  document.body.innerHTML = Object.keys(spec.sections)
    .map(k => `<div ${DAY_SECTION_ATTR}="${k}"><div ${DAY_HEADER_ATTR}></div></div>`)
    .join('');
}

/** Captured `scrollLeft` writes — jsdom's own is not a real scroll position. */
let scrollWrites: number[] = [];

function Harness({ chips, windowDayKeys, onApi }: {
  chips: string[];
  windowDayKeys: string[];
  onApi: (api: RailHighlight) => void;
}) {
  const api = useRailHighlight(chips, windowDayKeys);
  onApi(api);
  return (
    <div ref={api.stripRef} data-rail-strip>
      <div ref={api.contentRef} data-rail-content>
        <div ref={api.pillRef} data-rail-pill />
        {chips.map(k => <button key={k} type="button" data-chip={k} />)}
        <div ref={api.clipRef} data-rail-clip />
      </div>
    </div>
  );
}

function mount(spec: LayoutSpec, windowDayKeys?: string[]) {
  installLayout(spec);
  let api!: RailHighlight;
  const utils = render(
    <Harness
      chips={spec.chips}
      windowDayKeys={windowDayKeys ?? Object.keys(spec.sections)}
      onApi={(a) => { api = a; }}
    />
  );
  const strip = utils.container.querySelector<HTMLElement>('[data-rail-strip]')!;
  // jsdom reports 0 for all three and ignores writes to scrollLeft.
  Object.defineProperty(strip, 'clientWidth', { value: spec.clientWidth ?? 240, configurable: true });
  Object.defineProperty(strip, 'scrollWidth', { value: spec.chips.length * PITCH, configurable: true });
  let scrollLeft = 0;
  Object.defineProperty(strip, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (v: number) => { scrollLeft = v; scrollWrites.push(v); },
  });
  return {
    api: () => api,
    strip,
    pill: utils.container.querySelector<HTMLElement>('[data-rail-pill]')!,
    clip: utils.container.querySelector<HTMLElement>('[data-rail-clip]')!,
  };
}

function scroll() {
  act(() => { window.dispatchEvent(new Event('scroll')); });
}

/** The pill's content-coordinate left, read back off the written transform. */
function pillLeft(pill: HTMLElement): number {
  const m = /translateX\(([-\d.]+)px\)/.exec(pill.style.transform);
  return m ? Number.parseFloat(m[1]) : Number.NaN;
}

beforeEach(() => {
  installResizeObserverMock();
  scrollWrites = [];
  // rAF runs inline so a dispatched scroll is measured within the same act().
  //
  // It must return 0. The hook throttles with `if (frame) return; frame =
  // requestAnimationFrame(...)`, and an inline rAF runs the callback — which
  // clears `frame` — *before* the assignment, so any truthy handle would be
  // written back afterwards and latch the throttle shut for the rest of the
  // test. Real rAF is asynchronous and assigns before the callback runs, so
  // this is an artefact of running it inline, not a defect in the hook.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  // Reduced motion by default, so the catch-up tween resolves to a single
  // assignment and the geometry assertions below are not racing an easing
  // curve. The tween itself is covered explicitly at the end of this file.
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
});

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.style.removeProperty('--day-rail-h');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useRailHighlight', () => {
  // d2 is the anchor (top above the rail); d3 is 700px away, well beyond any
  // ramp, so the handover has not begun.
  const atRest: LayoutSpec = {
    chips: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'],
    sections: { d1: { top: -900 }, d2: { top: -100 }, d3: { top: 700 } },
  };

  it('places the pill exactly on the anchor chip when no handover is in flight', () => {
    const { pill } = mount(atRest);
    scroll();
    expect(pillLeft(pill)).toBe(PITCH); // d2 is index 1
    expect(pill.style.width).toBe(`${CHIP_W}px`);
    expect(pill.style.opacity).toBe('1');
  });

  it('clips the highlighted copy to exactly the pill', () => {
    const { pill, clip } = mount(atRest);
    scroll();
    const left = pillLeft(pill);
    const right = atRest.chips.length * PITCH - (left + CHIP_W);
    expect(clip.style.clipPath).toBe(`inset(0 ${right}px 0 ${left}px)`);
  });

  it('centres the anchor chip in the strip', () => {
    const { strip } = mount(atRest);
    scroll();
    // d2's centre is 48 + 22 = 70; centring it in a 240 strip wants -50,
    // which clamps to 0 at the start of the season.
    expect(strip.scrollLeft).toBe(0);
  });

  it('slides the pill between two chips part-way through the handover', () => {
    // d3's section is 800 tall, so the ramp is 200. With d3's top 160 above
    // the limit's 61, 99 of that 200 remains → just past halfway.
    const { pill } = mount({
      chips: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'],
      sections: { d1: { top: -900 }, d2: { top: -100, height: 800 }, d3: { top: 161 } },
    });
    scroll();
    // ramp 200, remaining 161 - 61 = 100 → progress 0.5 → halfway between
    // chip d2 (48) and chip d3 (96).
    expect(pillLeft(pill)).toBeCloseTo(72, 5);
  });

  it('lands the pill on the next chip exactly as the handover completes', () => {
    const { pill } = mount({
      chips: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'],
      sections: { d1: { top: -900 }, d2: { top: -100, height: 800 }, d3: { top: 61 } },
    });
    scroll();
    // progress 1 on d2 puts the pill on d3's chip — the same place the very
    // next frame will put it once resolveAnchor flips. That coincidence is
    // what makes the motion continuous rather than merely smooth either side.
    expect(pillLeft(pill)).toBe(2 * PITCH);
  });

  it('holds the pill still while the reader is inside a long day', () => {
    const { pill } = mount({
      chips: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'],
      sections: { d1: { top: -900 }, d2: { top: -2000, height: 4000 }, d3: { top: 1800 } },
    });
    scroll();
    expect(pillLeft(pill)).toBe(PITCH);
  });

  it('lets the pill sit off-centre at the end of the season', () => {
    const { strip, pill } = mount({
      chips: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'],
      sections: { d1: { top: -900 }, d6: { top: -100 } },
    }, ['d1', 'd6']);
    scroll();
    // d6's centre is 5*48 + 22 = 262; centring wants 142, but maxScroll is
    // 288 - 240 = 48, so the strip stops and the pill drifts right of centre.
    expect(strip.scrollLeft).toBe(48);
    expect(pillLeft(pill)).toBe(5 * PITCH);
  });

  it('blanks the highlight when no day is resolvable', () => {
    const { pill, clip } = mount({ chips: ['d1', 'd2'], sections: {} }, []);
    scroll();
    expect(pill.style.opacity).toBe('0');
    expect(clip.style.clipPath).toBe('inset(0 100% 0 0)');
  });

  describe('peeking', () => {
    /** The reader moves the strip themselves, and the browser fires `scroll`. */
    function readerPans(strip: HTMLElement, to: number) {
      act(() => {
        strip.scrollLeft = to;
        strip.dispatchEvent(new Event('scroll'));
      });
    }

    it('stops driving the strip once the reader has moved it', () => {
      const { strip } = mount(atRest);
      scroll();
      readerPans(strip, 500);
      scrollWrites.length = 0;
      scroll();
      expect(scrollWrites).toEqual([]);
    });

    // Browser-measured regression. Suspending on `wheel`/`pointerdown` over
    // the strip also caught a plain vertical page scroll with the pointer
    // resting on the rail — which on a phone is exactly where the rail is.
    // One vertical wheel then 120px of page scroll moved the strip 0px.
    it('keeps driving the strip through a page scroll that merely passed over the rail', () => {
      const { strip } = mount(atRest);
      scroll();
      act(() => {
        strip.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, deltaX: 0 }));
        strip.dispatchEvent(new Event('pointerdown'));
      });
      scrollWrites.length = 0;
      scroll();
      // Neither event moved the strip, so neither is a peek.
      expect(scrollWrites.length).toBeGreaterThan(0);
    });

    it('keeps the pill glued to its day while the reader peeks', () => {
      // The whole point of the peek: the highlight still reports the day
      // being read, rather than catching whichever chip is dragged under it.
      const { strip, pill } = mount(atRest);
      scroll();
      readerPans(strip, 500);
      scroll();
      expect(pillLeft(pill)).toBe(PITCH);
      expect(pill.style.opacity).toBe('1');
    });

    it('lifts the peek once the reader scrolls into a different day', () => {
      const spec: LayoutSpec = {
        chips: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'],
        sections: { d1: { top: -900 }, d2: { top: -100 }, d3: { top: 700 } },
      };
      const { strip } = mount(spec);
      scroll();
      readerPans(strip, 500);
      scrollWrites.length = 0;
      // Still on d2 — the peek survives scrolling around within the day.
      scroll();
      expect(scrollWrites).toEqual([]);
      // Now d3 has passed the rail, so the anchor changes and the peek ends.
      spec.sections.d3.top = -50;
      scroll();
      expect(scrollWrites.length).toBeGreaterThan(0);
    });

    it('lifts the peek on an explicit commit to the day already being read', () => {
      // Tapping the current day's own chip changes no anchor, so nothing
      // else would hand the strip back.
      const { strip, api } = mount(atRest);
      scroll();
      readerPans(strip, 500);
      scrollWrites.length = 0;
      act(() => { api().resume(); });
      scroll();
      expect(scrollWrites.length).toBeGreaterThan(0);
    });
  });

  describe('catching up after a jump', () => {
    it('eases rather than teleporting when the strip is far out of position', () => {
      vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);
      // rAF that advances the clock, so the easing terminates.
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        now += 40;
        cb(now);
        return 0; // see the note in beforeEach
      });
      // Anchor far along the rail, so centring wants a large scrollLeft.
      const { strip } = mount({
        chips: Array.from({ length: 40 }, (_, i) => `c${i}`),
        sections: { c0: { top: -900 }, c30: { top: -100 } },
      }, ['c0', 'c30']);
      scroll();
      // Intermediate positions were written, not one assignment.
      expect(scrollWrites.length).toBeGreaterThan(2);
      expect(strip.scrollLeft).toBe(30 * PITCH + CHIP_W / 2 - 120);
    });

    it('teleports instead of easing under prefers-reduced-motion', () => {
      // matchMedia already reports reduced motion in this file's default
      // setup — this asserts that is what produces the single write.
      const { strip } = mount({
        chips: Array.from({ length: 40 }, (_, i) => `c${i}`),
        sections: { c0: { top: -900 }, c30: { top: -100 } },
      }, ['c0', 'c30']);
      scroll();
      expect(scrollWrites).toEqual([30 * PITCH + CHIP_W / 2 - 120]);
      expect(strip.scrollLeft).toBe(30 * PITCH + CHIP_W / 2 - 120);
    });
  });
});
