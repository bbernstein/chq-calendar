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
