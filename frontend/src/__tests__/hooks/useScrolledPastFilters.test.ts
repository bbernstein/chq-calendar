import { describe, expect, it, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useScrolledPastFilters } from '@/hooks/useScrolledPastFilters';
import { installIntersectionObserverMock } from '@/__tests__/helpers/intersectionObserver';

afterEach(() => { vi.unstubAllGlobals(); });

describe('useScrolledPastFilters', () => {
  it('starts not-scrolled', () => {
    installIntersectionObserverMock();
    const { result } = renderHook(() => useScrolledPastFilters());
    expect(result.current.scrolled).toBe(false);
  });

  it('flips to scrolled once the sentinel leaves the viewport', () => {
    const io = installIntersectionObserverMock();
    const { result } = renderHook(() => useScrolledPastFilters());
    const el = document.createElement('div');
    act(() => { result.current.sentinelRef(el); });

    io.trigger(false);
    expect(result.current.scrolled).toBe(true);
  });

  it('flips back once the sentinel re-enters the viewport', () => {
    const io = installIntersectionObserverMock();
    const { result } = renderHook(() => useScrolledPastFilters());
    const el = document.createElement('div');
    act(() => { result.current.sentinelRef(el); });

    io.trigger(false);
    expect(result.current.scrolled).toBe(true);

    io.trigger(true);
    expect(result.current.scrolled).toBe(false);
  });

  // Same latch as the unmount case, by a different route: a sentinel swap in
  // an environment with no observer to correct the reading. Without a reset
  // the stale `true` survives with nothing left running that could clear it,
  // and the filter card stays parked and inert with no way back to it.
  it('clears a stale scrolled reading when swapped with no observer available', () => {
    const io = installIntersectionObserverMock();
    const { result } = renderHook(() => useScrolledPastFilters());
    act(() => { result.current.sentinelRef(document.createElement('div')); });
    io.trigger(false);
    expect(result.current.scrolled).toBe(true);

    vi.stubGlobal('IntersectionObserver', undefined);
    act(() => { result.current.sentinelRef(document.createElement('div')); });

    expect(result.current.scrolled).toBe(false);
  });

  it('resets to not-scrolled when the sentinel unmounts, rather than holding a stale value', () => {
    const io = installIntersectionObserverMock();
    const { result } = renderHook(() => useScrolledPastFilters());
    const el = document.createElement('div');
    act(() => { result.current.sentinelRef(el); });
    io.trigger(false);
    expect(result.current.scrolled).toBe(true);

    act(() => { result.current.sentinelRef(null); });
    expect(result.current.scrolled).toBe(false);
  });
});
