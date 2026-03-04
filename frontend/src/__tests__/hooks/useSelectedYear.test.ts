/// <reference types="vitest/globals" />
import { renderHook, act } from '@testing-library/preact';
import { useSelectedYear } from '@/hooks/useSelectedYear';

describe('useSelectedYear', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns default year when no URL param', () => {
    const { result } = renderHook(() =>
      useSelectedYear({ years: [2025, 2026, 2027], defaultYear: 2026 })
    );
    expect(result.current.selectedYear).toBe(2026);
  });

  it('reads year from URL param', () => {
    window.history.replaceState({}, '', '/?year=2025');
    const { result } = renderHook(() =>
      useSelectedYear({ years: [2025, 2026, 2027], defaultYear: 2026 })
    );
    expect(result.current.selectedYear).toBe(2025);
  });

  it('falls back to default for invalid URL param', () => {
    window.history.replaceState({}, '', '/?year=1999');
    const { result } = renderHook(() =>
      useSelectedYear({ years: [2025, 2026, 2027], defaultYear: 2026 })
    );
    expect(result.current.selectedYear).toBe(2026);
  });

  it('falls back to default for non-numeric URL param', () => {
    window.history.replaceState({}, '', '/?year=abc');
    const { result } = renderHook(() =>
      useSelectedYear({ years: [2025, 2026, 2027], defaultYear: 2026 })
    );
    expect(result.current.selectedYear).toBe(2026);
  });

  it('updates URL when setSelectedYear is called', () => {
    const { result } = renderHook(() =>
      useSelectedYear({ years: [2025, 2026, 2027], defaultYear: 2026 })
    );
    act(() => {
      result.current.setSelectedYear(2025);
    });
    expect(result.current.selectedYear).toBe(2025);
    expect(new URL(window.location.href).searchParams.get('year')).toBe('2025');
  });

  it('removes year param when selecting default year', () => {
    window.history.replaceState({}, '', '/?year=2025');
    const { result } = renderHook(() =>
      useSelectedYear({ years: [2025, 2026, 2027], defaultYear: 2026 })
    );
    act(() => {
      result.current.setSelectedYear(2026);
    });
    expect(result.current.selectedYear).toBe(2026);
    expect(new URL(window.location.href).searchParams.has('year')).toBe(false);
  });

  it('preserves other URL params when updating year', () => {
    window.history.replaceState({}, '', '/?search=music&year=2025');
    const { result } = renderHook(() =>
      useSelectedYear({ years: [2025, 2026, 2027], defaultYear: 2026 })
    );
    act(() => {
      result.current.setSelectedYear(2027);
    });
    const url = new URL(window.location.href);
    expect(url.searchParams.get('year')).toBe('2027');
    expect(url.searchParams.get('search')).toBe('music');
  });
});
