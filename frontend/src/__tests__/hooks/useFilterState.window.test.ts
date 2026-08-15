import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useFilterState } from '@/hooks/useFilterState';

beforeEach(() => {
  localStorage.clear();
});

describe('useFilterState window bounds', () => {
  it('starts with no expansion', () => {
    const { result } = renderHook(() => useFilterState());
    expect(result.current.windowStartDay).toBeNull();
    expect(result.current.windowEndDay).toBeNull();
  });

  it('records an expanded end', () => {
    const { result } = renderHook(() => useFilterState());
    act(() => result.current.expandWindowEnd('2026-07-17'));
    expect(result.current.windowEndDay).toBe('2026-07-17');
  });

  it('records an expanded start', () => {
    const { result } = renderHook(() => useFilterState());
    act(() => result.current.expandWindowStart('2026-07-13'));
    expect(result.current.windowStartDay).toBe('2026-07-13');
  });

  it('clears both bounds when the date filter changes', () => {
    // Replaces the old "reset extraDays on dateFilter change" effect.
    // Without this, widening the window twice, switching scope, and
    // switching back returns a window wider than a fresh selection with
    // nothing on screen explaining why (#156 on iOS, same shape here).
    const { result } = renderHook(() => useFilterState());
    act(() => result.current.expandWindowEnd('2026-07-17'));
    act(() => result.current.setDateFilter('today'));
    expect(result.current.windowEndDay).toBeNull();
    expect(result.current.windowStartDay).toBeNull();
  });

  it('clears both bounds on resetWindow', () => {
    const { result } = renderHook(() => useFilterState());
    act(() => result.current.expandWindowEnd('2026-07-17'));
    act(() => result.current.expandWindowStart('2026-07-13'));
    act(() => result.current.resetWindow());
    expect(result.current.windowEndDay).toBeNull();
    expect(result.current.windowStartDay).toBeNull();
  });

  it('clears both bounds on clearFilters', () => {
    const { result } = renderHook(() => useFilterState());
    act(() => result.current.expandWindowEnd('2026-07-17'));
    act(() => result.current.clearFilters());
    expect(result.current.windowEndDay).toBeNull();
  });

  it('clears both bounds on reconcileFilters', () => {
    // Year switching. A day key from 2026 means nothing in 2025.
    const { result } = renderHook(() => useFilterState());
    act(() => result.current.expandWindowEnd('2026-07-17'));
    act(() => result.current.reconcileFilters([], [], false));
    expect(result.current.windowEndDay).toBeNull();
  });

  it('never persists the window to localStorage', () => {
    // Session-only, matching iOS's selectedDayKey and extraDays. A date
    // pinned days ago and silently restored on launch would be worse than
    // no restore at all.
    const { result } = renderHook(() => useFilterState());
    act(() => result.current.expandWindowEnd('2026-07-17'));
    const saved = JSON.parse(localStorage.getItem('chq-calendar-user-state')!);
    expect(saved).not.toHaveProperty('windowEndDay');
    expect(saved).not.toHaveProperty('windowStartDay');
    expect(saved).not.toHaveProperty('extraDays');
  });
});
