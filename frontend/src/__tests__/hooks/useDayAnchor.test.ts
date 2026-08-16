import { describe, expect, it, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useDayAnchor } from '@/hooks/useDayAnchor';
import { DAY_SECTION_ATTR } from '@/lib/utils/daySections';

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

afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

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

  it('scrollToDay scrolls the section into view', () => {
    mountWithTops({ '2026-07-04': 0, '2026-07-09': 3000 });
    const scrollIntoView = vi.fn();
    document.querySelector<HTMLElement>(`[${DAY_SECTION_ATTR}="2026-07-09"]`)!.scrollIntoView = scrollIntoView;
    const { result } = renderHook(() => useDayAnchor(['2026-07-04', '2026-07-09']));
    act(() => { result.current.scrollToDay('2026-07-09'); });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
  });

  it('scrollToDay is a no-op for a day that is not mounted', () => {
    mountWithTops({ '2026-07-04': 0 });
    const { result } = renderHook(() => useDayAnchor(['2026-07-04']));
    expect(() => act(() => { result.current.scrollToDay('2026-08-30'); })).not.toThrow();
  });
});
