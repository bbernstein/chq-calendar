import { describe, expect, it, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useFilterCardHeight } from '@/hooks/useFilterCardHeight';
import { installResizeObserverMock } from '@/__tests__/helpers/resizeObserver';

afterEach(() => { vi.unstubAllGlobals(); document.documentElement.style.removeProperty('--filter-card-h'); });

// jsdom reports 0 for every layout measurement, so each test supplies its
// own rects. What is being pinned is WHICH distance the hook publishes: the
// header parks by exactly this value, and anything else leaves the rail off
// the viewport's top edge by the difference.
function header({ cardTop, railTop, cardHeight = 0, withRail = true }: {
  cardTop: number; railTop?: number; cardHeight?: number; withRail?: boolean;
}) {
  const parent = document.createElement('div');
  const card = document.createElement('div');
  card.getBoundingClientRect = () => ({ top: cardTop, height: cardHeight }) as DOMRect;
  parent.append(card);
  if (withRail) {
    const rail = document.createElement('div');
    rail.setAttribute('data-day-rail', '');
    rail.getBoundingClientRect = () => ({ top: railTop! }) as DOMRect;
    parent.append(rail);
  }
  return card;
}

describe('useFilterCardHeight', () => {
  it('publishes the distance from the top of the card to the top of the rail', () => {
    installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    act(() => { result.current(header({ cardTop: 64, railTop: 349 })); });
    expect(document.documentElement.style.getPropertyValue('--filter-card-h')).toBe('285px');
  });

  // The gap between card and rail is the card's `mb-4 sm:mb-6`, and it has
  // to ride up with the card. Measuring the card's own box alone parks the
  // rail 16-24px low, with a slice of the card still showing above it.
  it('includes the gap between the card and the rail, not just the card box', () => {
    installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    act(() => { result.current(header({ cardTop: 0, railTop: 324, cardHeight: 300 })); });
    expect(document.documentElement.style.getPropertyValue('--filter-card-h')).toBe('324px');
  });

  // The reason this is one measurement rather than `scrollHeight` plus a
  // computed margin: `ResizeObserver` never reports a margin change, so the
  // reconstructed version went stale whenever a breakpoint moved the margin
  // without moving the card's own box. Asking the layout for the distance
  // cannot drift from the boxes it describes.
  it('measures the real distance rather than reconstructing it from the card box', () => {
    installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    // A card whose own box is nothing like the offset — only a hook reading
    // the rail's position gets this right.
    act(() => { result.current(header({ cardTop: 100, railTop: 700, cardHeight: 40 })); });
    expect(document.documentElement.style.getPropertyValue('--filter-card-h')).toBe('600px');
  });

  // Measured while pinned, the rail still sits the same distance below the
  // card — negative viewport coordinates included.
  it('is correct while the header is already pinned above the viewport', () => {
    installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    act(() => { result.current(header({ cardTop: -285, railTop: 0 })); });
    expect(document.documentElement.style.getPropertyValue('--filter-card-h')).toBe('285px');
  });

  // An archived year with no navigable days renders no rail. The card's own
  // box is the honest answer — there is nothing below it to hold clear of.
  it('falls back to the card box when there is no rail', () => {
    installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    act(() => { result.current(header({ cardTop: 64, cardHeight: 269, withRail: false })); });
    expect(document.documentElement.style.getPropertyValue('--filter-card-h')).toBe('269px');
  });

  // Text zoom, an added chip row, a week strip wrapping — all move the rail,
  // and a stale park leaves it off its mark by the delta.
  it('republishes when the header resizes', () => {
    const resize = installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    const parent = document.createElement('div');
    const card = document.createElement('div');
    card.getBoundingClientRect = () => ({ top: 64, height: 0 }) as DOMRect;
    const rail = document.createElement('div');
    rail.setAttribute('data-day-rail', '');
    let railTop = 349;
    rail.getBoundingClientRect = () => ({ top: railTop }) as DOMRect;
    parent.append(card, rail);

    act(() => { result.current(card); });
    railTop = 492;
    resize.trigger();

    expect(document.documentElement.style.getPropertyValue('--filter-card-h')).toBe('428px');
  });

  it('drops back to zero when the card unmounts', () => {
    installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    act(() => { result.current(header({ cardTop: 64, railTop: 349 })); });
    act(() => { result.current(null); });
    expect(document.documentElement.style.getPropertyValue('--filter-card-h')).toBe('0px');
  });
});
