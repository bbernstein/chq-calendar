import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useDayAnchor } from '@/hooks/useDayAnchor';
import { DAY_SECTION_ATTR } from '@/lib/utils/daySections';
import { installResizeObserverMock } from '@/__tests__/helpers/resizeObserver';

/**
 * jsdom has no layout, so "which section is under the sticky chrome" has to
 * be stated outright: each key is given the viewport-relative top it would
 * have. A test that skipped this would pass on all-zero rects whether or not
 * the hook worked.
 */
function mountWithTops(tops: Record<string, number>) {
  document.body.innerHTML = Object.keys(tops)
    .map(k => `<div ${DAY_SECTION_ATTR}="${k}"></div>`)
    .join('');
  for (const [key, top] of Object.entries(tops)) {
    const el = document.querySelector<HTMLElement>(`[${DAY_SECTION_ATTR}="${key}"]`)!;
    el.getBoundingClientRect = () => ({ top }) as DOMRect;
  }
}

// The settle effect constructs a ResizeObserver on every mount now,
// regardless of whether a test ever calls scrollToDay — jsdom has none.
beforeEach(() => { installResizeObserverMock(); });
afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.style.removeProperty('--day-rail-h');
  vi.unstubAllGlobals();
  // The rAF spy in the throttle test below is never restored otherwise, and
  // a leaked spy on a global is the kind of contamination that surfaces as
  // an unrelated suite failing later.
  vi.restoreAllMocks();
});

describe('useDayAnchor', () => {
  it('anchors on the last day whose top has passed the sticky offset', () => {
    mountWithTops({ '2026-07-04': -300, '2026-07-05': -20, '2026-07-06': 400 });
    const { result } = renderHook(() => useDayAnchor(['2026-07-04', '2026-07-05', '2026-07-06']));
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(result.current.anchorDay).toBe('2026-07-05');
  });

  it('anchors on the first rendered day when nothing has scrolled past yet', () => {
    mountWithTops({ '2026-07-04': 120, '2026-07-05': 900 });
    const { result } = renderHook(() => useDayAnchor(['2026-07-04', '2026-07-05']));
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(result.current.anchorDay).toBe('2026-07-04');
  });

  it('clears the anchor when the rendered days empty out', () => {
    mountWithTops({ '2026-07-04': -20 });
    const { result, rerender } = renderHook(
      ({ keys }) => useDayAnchor(keys),
      { initialProps: { keys: ['2026-07-04'] } }
    );
    // Establish that the hook actually set state, so the null assertion
    // below is a transition, not just the useState initial value.
    expect(result.current.anchorDay).toBe('2026-07-04');
    mountWithTops({});
    rerender({ keys: [] });
    expect(result.current.anchorDay).toBeNull();
  });

  it('re-derives without a scroll when the rendered days change', () => {
    mountWithTops({ '2026-07-04': -300, '2026-07-05': -20 });
    const { result, rerender } = renderHook(
      ({ keys }) => useDayAnchor(keys),
      { initialProps: { keys: ['2026-07-04', '2026-07-05'] } }
    );
    expect(result.current.anchorDay).toBe('2026-07-05');
    // A prepend puts an earlier day above the reader without any scroll
    // event: the anchor must follow the content, not wait for a gesture.
    mountWithTops({ '2026-07-03': -700, '2026-07-04': -300, '2026-07-05': 40 });
    rerender({ keys: ['2026-07-03', '2026-07-04', '2026-07-05'] });
    expect(result.current.anchorDay).toBe('2026-07-04');
  });

  it('collapses two scroll events between frames into a single measurement', () => {
    mountWithTops({ '2026-07-04': -20 });
    // requestAnimationFrame is real in jsdom and does not run synchronously,
    // so two scroll dispatches issued back-to-back land inside the same
    // pending frame. A rafSpy call count of 1 across both dispatches is the
    // throttle firing once; a count of 2 is the throttle being absent.
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    renderHook(() => useDayAnchor(['2026-07-04']));
    const callsBeforeScroll = rafSpy.mock.calls.length;
    act(() => {
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('scroll'));
    });
    expect(rafSpy.mock.calls.length - callsBeforeScroll).toBe(1);
  });

  it('scrollToDay scrolls to the sticky offset, not to the raw viewport top', () => {
    // Not `scrollIntoView`: this path never consults the section's own
    // `scroll-margin-top: var(--day-rail-h)` (set in `EventListView.tsx`),
    // since that property is only read by a native `scrollIntoView`/anchor
    // scroll or CSS scroll-snap — neither of which runs here. Computing the
    // delta against `stickyOffset()` directly is what lands the target
    // correctly on this path, targeting the same `--day-rail-h` the CSS does.
    document.documentElement.style.setProperty('--day-rail-h', '50px');
    mountWithTops({ '2026-07-04': 0, '2026-07-09': 3000 });
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);
    const { result } = renderHook(() => useDayAnchor(['2026-07-04', '2026-07-09']));
    act(() => { result.current.scrollToDay('2026-07-09'); });
    // top(3000) - stickyOffset(50) = 2950.
    expect(scrollBy).toHaveBeenCalledWith(0, 2950);
  });

  it('scrollToDay is a no-op for a day that is not mounted', () => {
    mountWithTops({ '2026-07-04': 0 });
    const { result } = renderHook(() => useDayAnchor(['2026-07-04']));
    expect(() => act(() => { result.current.scrollToDay('2026-08-30'); })).not.toThrow();
  });

  // Browser-verified defect (see task-10 report): a smooth `scrollToDay`
  // finishes exactly as far short as content mounted just before it keeps
  // growing during the ~2s animation — a chip 6 days past the render window
  // landed ~1058px short of the target on a real page. jsdom has no layout,
  // so the resulting landing position cannot be asserted here; these two
  // tests instead pin the MECHANISM: the hold re-asserts on a page resize,
  // and a deliberate scroll gesture ends it. Both would fail against a
  // `scrollToDay` that only ever scrolls once and never holds.
  describe('holding the target at the sticky offset after scrollToDay', () => {
    it('re-asserts the held position when the page resizes afterward', () => {
      document.documentElement.style.setProperty('--day-rail-h', '50px');
      mountWithTops({ '2026-07-04': 0, '2026-07-09': 3000 });
      const scrollBy = vi.fn();
      vi.stubGlobal('scrollBy', scrollBy);
      const resize = installResizeObserverMock();
      const { result } = renderHook(() => useDayAnchor(['2026-07-04', '2026-07-09']));
      act(() => { result.current.scrollToDay('2026-07-09'); });
      scrollBy.mockClear();

      // Content above the target grew after the jump: its top moved from
      // the held 50 (the sticky offset) down to 1200.
      const el = document.querySelector<HTMLElement>(`[${DAY_SECTION_ATTR}="2026-07-09"]`)!;
      el.getBoundingClientRect = () => ({ top: 1200 }) as DOMRect;
      resize.trigger();

      // delta = 1200 - 50 = 1150.
      expect(scrollBy).toHaveBeenCalledWith(0, 1150);
    });

    // The other half of the arbitration `EventList`'s `revealDay` effect
    // already performs. `EventList` clears its prepend hold whenever a rail
    // navigation starts; nothing cleared THIS hold when a prepend started,
    // so "Show earlier" armed its own correction while this one was still
    // armed on a different day — and the prepend's own height change is what
    // fires the observer, so the reassert then yanked the reader back and
    // cancelled the correction the prepend existed to make. A mouse click
    // fires no wheel/touchstart/keydown, so nothing else could end it.
    it('drops the hold on demand, so an explicit prepend is not fought', () => {
      document.documentElement.style.setProperty('--day-rail-h', '50px');
      mountWithTops({ '2026-07-04': 0, '2026-07-09': 3000 });
      const scrollBy = vi.fn();
      vi.stubGlobal('scrollBy', scrollBy);
      const resize = installResizeObserverMock();
      const { result } = renderHook(() => useDayAnchor(['2026-07-04', '2026-07-09']));
      act(() => { result.current.scrollToDay('2026-07-09'); });
      scrollBy.mockClear();

      act(() => { result.current.cancelHold(); });

      const el = document.querySelector<HTMLElement>(`[${DAY_SECTION_ATTR}="2026-07-09"]`)!;
      el.getBoundingClientRect = () => ({ top: 1200 }) as DOMRect;
      resize.trigger();

      expect(scrollBy).not.toHaveBeenCalled();
    });

    // The hold's lifetime has to be bounded comparably to `EventList`'s,
    // which is commit-scoped. This one was set up in a `useEffect(..., [])`
    // and cleared only by a cancel gesture or its target leaving the DOM, so
    // it survived filter changes, scope changes and arbitrary elapsed time —
    // a scrollbar-thumb drag fires none of the cancel gestures either. The
    // day list changing is "this is a different list now".
    it('drops the hold once the day list it was armed against has changed', () => {
      document.documentElement.style.setProperty('--day-rail-h', '50px');
      mountWithTops({ '2026-07-04': 0, '2026-07-09': 3000 });
      const scrollBy = vi.fn();
      vi.stubGlobal('scrollBy', scrollBy);
      const resize = installResizeObserverMock();
      const { result, rerender } = renderHook(
        ({ keys }) => useDayAnchor(keys),
        { initialProps: { keys: ['2026-07-04', '2026-07-09'] } }
      );
      act(() => { result.current.scrollToDay('2026-07-09'); });
      scrollBy.mockClear();

      // A window expansion, a filter change, a scope change — any of them
      // hands down a different day list. The held day itself is still
      // mounted, so the "target left the DOM" clause cannot be what saves us.
      rerender({ keys: ['2026-07-03', '2026-07-04', '2026-07-09'] });

      const el = document.querySelector<HTMLElement>(`[${DAY_SECTION_ATTR}="2026-07-09"]`)!;
      el.getBoundingClientRect = () => ({ top: 1200 }) as DOMRect;
      resize.trigger();

      expect(scrollBy).not.toHaveBeenCalled();
    });

    it('stops re-asserting once the reader scrolls deliberately', () => {
      document.documentElement.style.setProperty('--day-rail-h', '50px');
      mountWithTops({ '2026-07-04': 0, '2026-07-09': 3000 });
      const scrollBy = vi.fn();
      vi.stubGlobal('scrollBy', scrollBy);
      const resize = installResizeObserverMock();
      const { result } = renderHook(() => useDayAnchor(['2026-07-04', '2026-07-09']));
      act(() => { result.current.scrollToDay('2026-07-09'); });
      scrollBy.mockClear();

      // A deliberate gesture, not the `scroll` event our own correction
      // fires — using `scroll` here would cancel the hold with the very
      // correction meant to maintain it.
      act(() => { window.dispatchEvent(new Event('wheel')); });

      const el = document.querySelector<HTMLElement>(`[${DAY_SECTION_ATTR}="2026-07-09"]`)!;
      el.getBoundingClientRect = () => ({ top: 1200 }) as DOMRect;
      resize.trigger();

      expect(scrollBy).not.toHaveBeenCalled();
    });
  });
});
