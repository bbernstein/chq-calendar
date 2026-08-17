import { describe, expect, it, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useElementOutOfView } from '@/hooks/useElementOutOfView';
import { installIntersectionObserverMock } from '@/__tests__/helpers/intersectionObserver';

afterEach(() => { vi.unstubAllGlobals(); });

describe('useElementOutOfView', () => {
  // "In view" is the safe default: it keeps whatever this guards reachable.
  // A briefly Tab-reachable filter card is a nuisance; one that is
  // permanently unreachable is a lockout.
  it('starts in view, before the observer has reported anything', () => {
    installIntersectionObserverMock();
    const { result } = renderHook(() => useElementOutOfView());
    expect(result.current.outOfView).toBe(false);
  });

  it('reports out of view once the element stops intersecting', () => {
    const io = installIntersectionObserverMock();
    const { result } = renderHook(() => useElementOutOfView());
    act(() => { result.current.ref(document.createElement('div')); });

    io.trigger(false);

    expect(result.current.outOfView).toBe(true);
  });

  // The card comes back when the reader scrolls up, or when the panel is
  // reopened over the list. Without this it would stay `inert` after
  // returning to view — visible and unusable.
  it('reports back in view once the element intersects again', () => {
    const io = installIntersectionObserverMock();
    const { result } = renderHook(() => useElementOutOfView());
    act(() => { result.current.ref(document.createElement('div')); });

    io.trigger(false);
    expect(result.current.outOfView).toBe(true);

    io.trigger(true);
    expect(result.current.outOfView).toBe(false);
  });

  it('resets to in view when the element unmounts rather than holding a stale value', () => {
    const io = installIntersectionObserverMock();
    const { result } = renderHook(() => useElementOutOfView());
    act(() => { result.current.ref(document.createElement('div')); });
    io.trigger(false);

    act(() => { result.current.ref(null); });

    expect(result.current.outOfView).toBe(false);
  });

  it('observes the replacement when the element is swapped', () => {
    const io = installIntersectionObserverMock();
    const { result } = renderHook(() => useElementOutOfView());
    act(() => { result.current.ref(document.createElement('div')); });
    act(() => { result.current.ref(document.createElement('div')); });

    io.trigger(false);

    expect(result.current.outOfView).toBe(true);
    // The first observer is gone rather than left watching a detached node.
    expect(io.liveCount).toBe(1);
    expect(io.totalCreated).toBe(2);
  });

  // The latch this guards against: an element that WAS out of view, then a
  // swap into an environment with no observer to correct the reading. Without
  // a reset on that path the stale `true` survives with nothing left running
  // that could ever clear it — and whatever it guards stays permanently
  // unreachable, which is the one direction this hook must not fail in.
  it('clears a stale out-of-view reading when swapped with no observer available', () => {
    const io = installIntersectionObserverMock();
    const { result } = renderHook(() => useElementOutOfView());
    act(() => { result.current.ref(document.createElement('div')); });
    io.trigger(false);
    expect(result.current.outOfView).toBe(true);

    vi.stubGlobal('IntersectionObserver', undefined);
    act(() => { result.current.ref(document.createElement('div')); });

    expect(result.current.outOfView).toBe(false);
  });

  // jsdom has no IntersectionObserver, and neither do a few old browsers.
  // Reporting "in view" there is the same answer a real browser gives before
  // its first callback, and it must not throw on mount.
  it('does not throw where IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { result } = renderHook(() => useElementOutOfView());

    expect(() => act(() => { result.current.ref(document.createElement('div')); })).not.toThrow();
    expect(result.current.outOfView).toBe(false);
  });
});
