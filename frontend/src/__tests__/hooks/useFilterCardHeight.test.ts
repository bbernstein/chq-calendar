import { describe, expect, it, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useFilterCardHeight } from '@/hooks/useFilterCardHeight';
import { installResizeObserverMock } from '@/__tests__/helpers/resizeObserver';

afterEach(() => { vi.unstubAllGlobals(); document.documentElement.style.removeProperty('--filter-card-h'); });

// jsdom reports 0 for every layout measurement, so each test supplies its
// own `scrollHeight` and computed margin. What is being pinned is which
// numbers the hook combines — the header parks by exactly this value, and
// anything short of the card's full height plus its gap leaves the rail
// hanging below the viewport top.
function cardWith({ scrollHeight, marginBottom }: { scrollHeight: number; marginBottom: string }) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  el.style.marginBottom = marginBottom;
  return el;
}

describe('useFilterCardHeight', () => {
  it('publishes the card content height plus its bottom margin', () => {
    installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    act(() => { result.current(cardWith({ scrollHeight: 269, marginBottom: '16px' })); });
    expect(document.documentElement.style.getPropertyValue('--filter-card-h')).toBe('285px');
  });

  // The margin is the gap the card holds above the rail. Drop it and the
  // rail parks 16-24px below the viewport top, with a slice of the card
  // still showing above it.
  it('includes the margin rather than the content height alone', () => {
    installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    act(() => { result.current(cardWith({ scrollHeight: 300, marginBottom: '24px' })); });
    expect(document.documentElement.style.getPropertyValue('--filter-card-h')).toBe('324px');
  });

  // The load-bearing choice. While open over the list the card carries
  // `max-h-[70vh] overflow-y-auto`, so its rendered box is the cap and its
  // content is taller. Parking by the rendered box would leave the rail the
  // overflowed remainder too low the moment the panel closed — and only for
  // readers whose filter card exceeds 70vh.
  it('measures content height, not the capped rendered box', () => {
    installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    const el = cardWith({ scrollHeight: 900, marginBottom: '16px' });
    el.getBoundingClientRect = () => ({ height: 590 }) as DOMRect;
    act(() => { result.current(el); });
    expect(document.documentElement.style.getPropertyValue('--filter-card-h')).toBe('916px');
  });

  it('tolerates a card with no bottom margin', () => {
    installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    act(() => { result.current(cardWith({ scrollHeight: 200, marginBottom: '' })); });
    expect(document.documentElement.style.getPropertyValue('--filter-card-h')).toBe('200px');
  });

  // Text zoom, an added filter chip row, a week strip wrapping — all grow
  // the card, and a stale park leaves the rail off its mark by the delta.
  it('republishes when the card resizes', () => {
    const resize = installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    const el = cardWith({ scrollHeight: 269, marginBottom: '16px' });
    act(() => { result.current(el); });
    Object.defineProperty(el, 'scrollHeight', { value: 412, configurable: true });
    resize.trigger();
    expect(document.documentElement.style.getPropertyValue('--filter-card-h')).toBe('428px');
  });

  it('drops back to zero when the card unmounts', () => {
    installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    act(() => { result.current(cardWith({ scrollHeight: 269, marginBottom: '16px' })); });
    act(() => { result.current(null); });
    expect(document.documentElement.style.getPropertyValue('--filter-card-h')).toBe('0px');
  });
});
