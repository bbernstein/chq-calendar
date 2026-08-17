import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { daySectionTop, daySectionMetrics, dayRailHeightPx } from '@/lib/utils/daySections';
import {
  resolveAnchor, rampDistance, dayProgress, stripScrollLeft, pillGeometry, lerp,
  type ChipExtent,
} from '@/lib/utils/railPosition';

/** How long the strip takes to catch up after a tap, a chevron, or `⟳ Now`. */
export const TWEEN_MS = 220;

/**
 * How far the strip has to be out of position before catching up is treated
 * as a jump to be animated rather than a scroll to be tracked.
 *
 * Measured in chips, not pixels, so it stays right at any text zoom.
 */
export const JUMP_CHIPS = 1.5;

/** Fallback chip pitch, used only before anything has been measured. */
const FALLBACK_PITCH = 48;

/**
 * Callback refs, not ref objects.
 *
 * The listener effect below has to re-run when these elements actually
 * appear, and a ref object mutating gives it nothing to depend on. `DayRail`
 * renders nothing at all until events have loaded, so the elements are null
 * on first mount and arrive later — an effect that missed that moment would
 * leave the strip's own `scroll` listener and the content `ResizeObserver`
 * permanently unattached, silently disabling peek detection in production
 * while every test that mounts with chips already present still passed.
 */
export type RailNodeRef = (el: HTMLDivElement | null) => void;

export interface RailHighlight {
  /** The horizontally scrolling element. */
  stripRef: RailNodeRef;
  /** The content inside it — the positioning context for pill and clip. */
  contentRef: RailNodeRef;
  /** The highlight itself. */
  pillRef: RailNodeRef;
  /** The duplicated, highlighted copy of the chip row. */
  clipRef: RailNodeRef;
  /** The content element, for the caller's own keyboard walk. */
  contentEl: RefObject<HTMLDivElement | null>;
  /** Hand `scrollLeft` back to the highlight after an explicit commit. */
  resume: () => void;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Drives the rail's highlight from scroll position, without re-rendering.
 *
 * The day the reader is on is a *fraction*, not a key: it advances
 * continuously as the list's own sticky day title hands over, so the
 * highlight tracks the reader's finger and stops half-done when they stop.
 * That fraction deliberately never becomes React state — `page.tsx` is the
 * whole application, and putting a per-frame value in `useState` would
 * re-render it sixty times a second. Everything here is measured in a
 * rAF-throttled callback and written straight to three DOM properties.
 *
 * The discrete anchor stays where it was, in `useDayAnchor`: it drives
 * `aria-current`, the chevron targets and `⟳ Now`, none of which want a
 * fractional day. Both resolve through the same `resolveAnchor`, so the pill
 * and the announced current day cannot name different days.
 *
 * **The invariant this rests on:** the anchor is derived from page scroll and
 * nothing else. This hook only ever reads it. Dragging the rail sideways is a
 * peek — it moves the reader's view of the season and never the page — so the
 * pill stays glued to the day being read and drifts off centre rather than
 * catching whatever chip is dragged under it.
 *
 * The four refs are created here rather than accepted as an argument so their
 * identity is stable: a caller passing a fresh `{ strip, pill, ... }` object
 * each render would re-subscribe every listener on every render.
 */
export function useRailHighlight(chipKeys: string[], windowDayKeys: string[]): RailHighlight {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const clipRef = useRef<HTMLDivElement | null>(null);

  // Bumped only when an element attaches or detaches — once on load, not per
  // render and never per frame. This is what the listener effect depends on,
  // so it re-runs exactly when there is something new to listen to.
  const [nodeGeneration, setNodeGeneration] = useState(0);
  const nodeSetter = (ref: RefObject<HTMLDivElement | null>): RailNodeRef =>
    (el) => {
      if (ref.current === el) return;
      ref.current = el;
      setNodeGeneration(n => n + 1);
    };
  const setStrip = useCallback(nodeSetter(stripRef), []);
  const setContent = useCallback(nodeSetter(contentRef), []);
  const setPill = useCallback(nodeSetter(pillRef), []);
  const setClip = useCallback(nodeSetter(clipRef), []);

  /** Chip extents in content coordinates, rebuilt only when the row changes. */
  const extents = useRef<Map<string, ChipExtent>>(new Map());
  const contentWidth = useRef(0);
  const pitch = useRef(FALLBACK_PITCH);

  /** True while the reader owns `scrollLeft` — see `resume` below. */
  const suspended = useRef(false);
  /**
   * The last `scrollLeft` this hook wrote, read back after writing.
   *
   * This is how a peek is detected: if the strip's position ever differs from
   * what we last put there, something other than us moved it. That is a
   * direct observation rather than an inference from event types, and it was
   * arrived at by watching the inference fail — suspending on `wheel` or
   * `pointerdown` over the strip also fires for a plain *vertical* page
   * scroll with the pointer resting on the rail, which on a phone is exactly
   * where the rail is. Browser-measured: one vertical wheel over the rail,
   * then 120px of page scroll, moved the strip 0px. Divergence cannot make
   * that mistake, and it catches every way the reader can move the strip —
   * touch drag, trackpad pan, scrollbar, keyboard — rather than the two the
   * event list happened to name.
   *
   * The comparison rests on one ordering assumption, stated here rather than
   * left implicit: a `scroll` event is dispatched no earlier than the task
   * that caused it, and its handler reads the *live* `scrollLeft` at dispatch
   * time. So by the time our own write's event is delivered, `lastWritten`
   * has already been updated to that same value and the two compare equal —
   * even mid-tween, where a write happens every frame. Every mainstream
   * engine defers scroll dispatch by at least a task. If one did not, our own
   * writes would read as peeks and the highlight would stop centring after
   * the first frame.
   */
  const lastWritten = useRef(0);
  /** The anchor as of the last frame, so a change of day can lift a peek. */
  const lastAnchor = useRef<string | null>(null);
  const tween = useRef<{ to: number; raf: number } | null>(null);

  // Serialized so the effects below re-run when the *contents* change rather
  // than on every render that hands down a new array identity. (NOTE for
  // humans, not a real eslint-disable: this repo has no
  // eslint-plugin-react-hooks, so a literal `react-hooks/exhaustive-deps`
  // disable comment is a hard ESLint 9 error rather than a silenced warning.)
  const chipsId = chipKeys.join(',');
  const keysId = windowDayKeys.join(',');

  const cancelTween = useCallback(() => {
    if (tween.current) {
      cancelAnimationFrame(tween.current.raf);
      tween.current = null;
    }
  }, []);

  /**
   * Hand `scrollLeft` back to the highlight.
   *
   * Called on any explicit commit — a chip, a chevron, `⟳ Now`. Scrolling the
   * page into a different day lifts a peek on its own (see `sync` below), but
   * tapping the chip for the day already being read changes no anchor, and
   * without this the strip would stay wherever the reader had panned it.
   */
  const resume = useCallback(() => {
    suspended.current = false;
    // Re-baseline before handing control back. `lastWritten` still points at
    // wherever *we* last wrote, which is not where the reader left the strip,
    // so a `scroll` event still in flight from their pan would compare
    // divergent and re-suspend immediately — silently undoing this call.
    const strip = stripRef.current;
    if (strip) lastWritten.current = strip.scrollLeft;
  }, []);

  /**
   * The one place `scrollLeft` is written.
   *
   * Reads the value back rather than recording what was asked for: the
   * browser clamps to the scrollable range, so storing the request would
   * leave `lastWritten` permanently disagreeing with reality at either end of
   * the season and read as a peek that never happened.
   */
  const writeScrollLeft = useCallback((strip: HTMLElement, value: number) => {
    strip.scrollLeft = value;
    lastWritten.current = strip.scrollLeft;
  }, []);

  /**
   * Ease the strip to a destination it cannot simply track.
   *
   * A tap scrolls the page instantly, so `scrollLeft` would otherwise
   * teleport across a week of chips. This is the only self-moving animation
   * in the rail — everything else is 1:1 with the reader's own gesture — so
   * it is the only thing `prefers-reduced-motion` turns off.
   */
  const startTween = useCallback((strip: HTMLElement, to: number) => {
    cancelTween();
    const from = strip.scrollLeft;
    if (prefersReducedMotion() || Math.abs(to - from) < 1) {
      writeScrollLeft(strip, to);
      return;
    }
    const t0 = performance.now();
    // Identity, not a boolean: a frame belonging to a superseded tween must
    // not null out the tween that replaced it.
    const self = { to, raf: 0 };
    const step = () => {
      if (tween.current !== self) return;
      const progress = Math.min(1, (performance.now() - t0) / TWEEN_MS);
      writeScrollLeft(strip, lerp(from, to, easeOutCubic(progress)));
      if (progress < 1) self.raf = requestAnimationFrame(step);
      else tween.current = null;
    };
    tween.current = self;
    self.raf = requestAnimationFrame(step);
  }, [cancelTween, writeScrollLeft]);

  /**
   * Re-measure the chip row.
   *
   * Rects rather than `offsetLeft`: the content element is the offset parent
   * today, but `offsetLeft` silently re-points at whatever positioned
   * ancestor appears above it later, and `chipRect.left - contentRect.left`
   * cannot. The content element scrolls with its chips, so that difference is
   * already scroll-independent — no `scrollLeft` term needed.
   */
  const measureChips = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;
    const contentRect = content.getBoundingClientRect();
    contentWidth.current = contentRect.width;
    const next = new Map<string, ChipExtent>();
    const lefts: number[] = [];
    // `:scope >` restricts the measurement to the real chip row. The
    // highlighted copy is a descendant of this same element; it carries no
    // `data-chip` today, so this is defence in depth rather than the only
    // thing keeping it out of the map — but an unscoped query would silently
    // start measuring every chip twice the day anything under `content`
    // gained a chip key, and the failure would be a mispositioned pill
    // rather than an error.
    for (const el of Array.from(content.querySelectorAll<HTMLElement>(':scope > [data-chip]'))) {
      const key = el.dataset.chip;
      if (!key || next.has(key)) continue;
      const rect = el.getBoundingClientRect();
      const left = rect.left - contentRect.left;
      next.set(key, { left, width: rect.width });
      lefts.push(left);
    }
    extents.current = next;
    // Pitch from the first gap rather than an average: chips are uniform, and
    // one subtraction cannot be skewed by a partially-laid-out row.
    if (lefts.length >= 2 && lefts[1] > lefts[0]) pitch.current = lefts[1] - lefts[0];
  }, []);

  /** Blank the highlight rather than leave it parked on a stale day. */
  const hide = useCallback(() => {
    if (pillRef.current) pillRef.current.style.opacity = '0';
    if (clipRef.current) clipRef.current.style.clipPath = 'inset(0 100% 0 0)';
  }, []);

  /**
   * Measure, compute, write. Every read is taken before any write, so a frame
   * never interleaves them and forces a synchronous re-layout.
   */
  const sync = useCallback(() => {
    const strip = stripRef.current;
    const pill = pillRef.current;
    const clip = clipRef.current;
    if (!strip || !pill || !clip) return;

    // This repeats the walk `useDayAnchor` also performs each frame, and that
    // duplication is a deliberate trade rather than an oversight. Measured in
    // Chromium against production data: 0.034ms per walk at a typical render
    // window (3 mounted day sections) and 0.335ms at a large one (16 sections,
    // 321 event cards) — so both hooks together cost 0.4% of a 16.7ms frame
    // typically and 4% at the large end. Sharing one measurement would mean
    // either threading a subscription from `useDayAnchor` through `page.tsx`
    // into this component, or hoisting a third hook that both depend on;
    // both trade a measured 4% worst case for a new coupling across the
    // boundary this design keeps clean. Revisit if the render window ever
    // stops being bounded — that, not the day list, is what sets this cost.
    const limit = dayRailHeightPx() + 1;
    const resolved = resolveAnchor(windowDayKeys, limit, daySectionTop);
    if (!resolved) {
      hide();
      lastAnchor.current = null;
      return;
    }

    // Scrolling into a different day lifts a peek: the reader has moved on
    // from whatever they had panned the rail to look at. Guarded on a
    // non-null previous anchor so the very first measured frame is not
    // mistaken for a change of day.
    if (lastAnchor.current !== null && resolved.key !== lastAnchor.current) {
      suspended.current = false;
      // Re-baseline for the same reason `resume` does — see there.
      lastWritten.current = strip.scrollLeft;
    }
    lastAnchor.current = resolved.key;

    const metrics = daySectionMetrics(resolved.key);
    const ramp = metrics ? rampDistance(metrics.height, metrics.headerHeight) : 0;
    const progress = resolved.nextTop === null ? 0 : dayProgress(resolved.nextTop, limit, ramp);

    const geometry = pillGeometry(
      extents.current.get(resolved.key) ?? null,
      resolved.nextKey ? extents.current.get(resolved.nextKey) ?? null : null,
      progress,
    );
    // The anchor day has no chip — reachable if the view window and the
    // navigable bounds ever disagree. Nothing to highlight.
    if (!geometry) { hide(); return; }

    const { left, width } = geometry;
    const right = Math.max(0, contentWidth.current - (left + width));

    pill.style.opacity = '1';
    pill.style.width = `${width}px`;
    pill.style.transform = `translateX(${left}px)`;
    // The clip layer is `inset-0` inside the content element, so its own box
    // is the content box and these insets are already in the same coordinate
    // space as `left` and `width`.
    clip.style.clipPath = `inset(0 ${right}px 0 ${left}px)`;

    // The reader is panning the rail. The pill above still tracks its day —
    // that is the point of the peek — but the strip stays where they put it.
    if (suspended.current) return;

    const desired = stripScrollLeft(
      left + width / 2,
      strip.clientWidth,
      strip.scrollWidth - strip.clientWidth,
    );
    const threshold = pitch.current * JUMP_CHIPS;

    if (tween.current) {
      // Let a running tween finish unless the destination has genuinely
      // moved — a second tap while the first is still travelling.
      if (Math.abs(desired - tween.current.to) > threshold) startTween(strip, desired);
      return;
    }
    if (Math.abs(desired - strip.scrollLeft) > threshold) startTween(strip, desired);
    else writeScrollLeft(strip, desired);
  }, [keysId, hide, startTween, writeScrollLeft]);

  // `nodeGeneration` is a dependency on both effects below for the same
  // reason the listener effect has it, and missing it is subtler here: the
  // chip row can appear without the chip *list* changing at all. `DayRail`
  // renders nothing while `scopeHasWindow` is false — an off-season
  // `'this-week'` restored from localStorage — with `chips` populated the
  // whole time. When the scope then resolves, `chipsId` and `keysId` are
  // unchanged, so without this the row would never be measured, `extents`
  // would stay empty, and the pill would not paint at all.
  // Two effects, not one, and the split is not cosmetic: `measureChips` walks
  // every chip in the row calling `getBoundingClientRect` — 251 of them in a
  // full season — and the row's geometry depends on the *chips*, never on the
  // day window. Measuring on `keysId` too meant a forced layout and 251 rect
  // reads on every filter and scope change, for a row that had not moved.
  //
  // Declaration order is the contract: measure runs before sync in the same
  // commit, so a commit that changes both the chips and the window still
  // places the pill against fresh extents.
  useLayoutEffect(() => {
    measureChips();
  }, [chipsId, nodeGeneration, measureChips]);

  // Placement before paint — in a passive effect the pill would flash at x=0
  // on the first frame. This one does follow the day window: the anchor moves
  // when the window does, even with the chip row untouched.
  useLayoutEffect(() => {
    sync();
  }, [chipsId, keysId, nodeGeneration, sync]);

  // `sync` and `measureChips` are reached through a ref so the listener
  // effect below does not depend on them. Both are recreated whenever the day
  // list changes, and wiring the listeners to them directly tore down and
  // rebuilt every `window` listener and the `ResizeObserver` on every filter,
  // scope and window change — churn that buys nothing, since none of the
  // wiring itself depends on the chip or day contents.
  const latest = useRef({ sync, measureChips });
  latest.current = { sync, measureChips };

  useEffect(() => {
    const strip = stripRef.current;
    const content = contentRef.current;
    // Nothing rendered — `DayRail` returns null while it has no days, or
    // while the scope resolves to no window at all. Attaching global scroll
    // and resize listeners now would schedule a rAF on every frame of every
    // scroll only for `sync` to bail on the same null refs. `nodeGeneration`
    // brings us straight back here the moment the elements exist.
    if (!strip || !content) return;

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; latest.current.sync(); });
    };
    const onResize = () => { latest.current.measureChips(); onScroll(); };

    // The reader moved the strip themselves — suspend until they scroll into
    // a different day or commit explicitly. Detected by the strip's position
    // diverging from the last value we put there, which is the only signal
    // that distinguishes a genuine pan from a vertical page scroll that
    // merely passed over the rail. The 1px tolerance absorbs the subpixel
    // rounding browsers apply to a fractional `scrollLeft`.
    const onStripScroll = () => {
      if (Math.abs(strip.scrollLeft - lastWritten.current) > 1) {
        suspended.current = true;
        cancelTween();
      }
    };

    // Passive throughout: none of these may delay a scroll.
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    strip.addEventListener('scroll', onStripScroll, { passive: true });

    // The chip row can change width without the window resizing — `⟳ Now`
    // and the Filters toggle appear and disappear beside it. Absent in some
    // older browsers and in jsdom without a stub; skipping it there only
    // loses a re-measure, which is better than throwing on mount.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
    observer?.observe(content);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      cancelTween();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      strip.removeEventListener('scroll', onStripScroll);
      observer?.disconnect();
    };
    // Keyed on the elements, not on the day list. `chipsId`/`keysId` change on
    // every filter, scope and window change and would tear down and rebuild
    // every listener for nothing — none of this wiring depends on the chip or
    // day contents, only `sync`'s closure does, and that is reached through
    // `latest`. But it cannot be mount-scoped either: the elements do not
    // exist on first mount.
  }, [nodeGeneration, cancelTween]);

  return {
    stripRef: setStrip, contentRef: setContent, pillRef: setPill, clipRef: setClip,
    contentEl: contentRef, resume,
  };
}
