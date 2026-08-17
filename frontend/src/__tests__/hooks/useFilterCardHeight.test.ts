import { describe, expect, it, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useFilterCardHeight } from '@/hooks/useFilterCardHeight';
import { installResizeObserverMock } from '@/__tests__/helpers/resizeObserver';

afterEach(() => { vi.unstubAllGlobals(); document.documentElement.style.removeProperty('--filter-card-h'); });

// jsdom reports 0 for every layout measurement, so each test supplies its own
// rects. What is being pinned is WHICH distance is published and WHEN: the
// header parks by exactly this value, and anything else leaves the rail off
// the viewport's top edge by the difference.
function headerContainer({ cardTop, railTop, cardHeight = 0, withRail = true, cardPosition = 'static' }: {
  cardTop: number; railTop?: number; cardHeight?: number; withRail?: boolean; cardPosition?: string;
}) {
  const container = document.createElement('div');
  const card = document.createElement('div');
  card.setAttribute('data-filter-card', '');
  card.style.position = cardPosition;
  card.getBoundingClientRect = () => ({ top: cardTop, height: cardHeight }) as DOMRect;
  container.append(card);
  if (withRail) {
    const rail = document.createElement('div');
    rail.setAttribute('data-day-rail', '');
    rail.getBoundingClientRect = () => ({ top: railTop! }) as DOMRect;
    container.append(rail);
  }
  // jsdom's getComputedStyle needs the node in the document to report
  // inline styles reliably.
  document.body.append(container);
  return container;
}

const published = () => document.documentElement.style.getPropertyValue('--filter-card-h');

describe('useFilterCardHeight', () => {
  it('publishes the distance from the top of the card to the top of the rail', () => {
    installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    act(() => { result.current(headerContainer({ cardTop: 64, railTop: 349 })); });
    expect(published()).toBe('285px');
  });

  // The gap between card and rail is the card's `mb-4 sm:mb-6`, and it has to
  // ride up with the card. Measuring the card's own box alone parks the rail
  // 16-24px low, with a slice of the card still showing above it.
  it('includes the gap between the card and the rail, not just the card box', () => {
    installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    act(() => { result.current(headerContainer({ cardTop: 0, railTop: 324, cardHeight: 300 })); });
    expect(published()).toBe('324px');
  });

  // The reason this is one measurement rather than `scrollHeight` plus a
  // computed margin: a reconstructed distance can disagree with the layout.
  it('measures the real distance rather than reconstructing it from the card box', () => {
    installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    act(() => { result.current(headerContainer({ cardTop: 100, railTop: 700, cardHeight: 40 })); });
    expect(published()).toBe('600px');
  });

  // THE TRIGGER, which is a separate bug from the arithmetic. `ResizeObserver`
  // reports border and content boxes and never margins, so the observer has to
  // sit on the header CONTAINER — whose height is card + margin + rail — not
  // on the card, whose own box does not change when only its margin does.
  it('observes the header container, so a margin-only change still republishes', () => {
    const resize = installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    const container = headerContainer({ cardTop: 64, railTop: 349 });
    const card = container.querySelector('[data-filter-card]')!;
    const rail = container.querySelector('[data-day-rail]')!;
    act(() => { result.current(container); });
    expect(published()).toBe('285px');

    // A breakpoint widens the card's bottom margin. The card's own box is
    // untouched; only the rail moves down.
    rail.getBoundingClientRect = () => ({ top: 357 }) as DOMRect;
    resize.trigger();

    expect(published()).toBe('293px');
    expect(card.getBoundingClientRect().height).toBe(0);   // card box never changed
  });

  it('is correct while the header is already pinned above the viewport', () => {
    installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    act(() => { result.current(headerContainer({ cardTop: -285, railTop: 0 })); });
    expect(published()).toBe('285px');
  });

  // Mid-exit the card is `position: fixed` at a frozen rect and out of the
  // header's flow, so the distance describes nothing. Publishing it would set
  // the offset to roughly zero, and the moment the animation ended and the
  // header returned to its parked `top`, the card would flash back into view.
  it('holds the last good value while the card is out of flow mid-exit', () => {
    const resize = installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    const container = headerContainer({ cardTop: 64, railTop: 349 });
    act(() => { result.current(container); });
    expect(published()).toBe('285px');

    const card = container.querySelector('[data-filter-card]') as HTMLElement;
    card.style.position = 'fixed';
    card.getBoundingClientRect = () => ({ top: 0, height: 269 }) as DOMRect;
    resize.trigger();

    expect(published()).toBe('285px');
  });

  it('resumes publishing once the card is back in flow', () => {
    const resize = installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    const container = headerContainer({ cardTop: 64, railTop: 349 });
    const card = container.querySelector('[data-filter-card]') as HTMLElement;
    act(() => { result.current(container); });

    card.style.position = 'fixed';
    resize.trigger();
    card.style.position = 'static';
    card.getBoundingClientRect = () => ({ top: 64, height: 0 }) as DOMRect;
    resize.trigger();

    expect(published()).toBe('285px');
  });

  // An archived year with no navigable days renders no rail.
  it('falls back to the card box when there is no rail', () => {
    installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    act(() => { result.current(headerContainer({ cardTop: 64, cardHeight: 269, withRail: false })); });
    expect(published()).toBe('269px');
  });

  // Text zoom, an added chip row, a week strip wrapping — all move the rail,
  // and a stale park leaves it off its mark by the delta.
  it('republishes when the header resizes', () => {
    const resize = installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    const container = headerContainer({ cardTop: 64, railTop: 349 });
    const rail = container.querySelector('[data-day-rail]')!;
    act(() => { result.current(container); });

    rail.getBoundingClientRect = () => ({ top: 492 }) as DOMRect;
    resize.trigger();

    expect(published()).toBe('428px');
  });

  it('drops back to zero when the header unmounts', () => {
    installResizeObserverMock();
    const { result } = renderHook(() => useFilterCardHeight());
    act(() => { result.current(headerContainer({ cardTop: 64, railTop: 349 })); });
    act(() => { result.current(null); });
    expect(published()).toBe('0px');
  });
});
