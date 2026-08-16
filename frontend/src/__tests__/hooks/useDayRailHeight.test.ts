import { describe, expect, it, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useDayRailHeight } from '@/hooks/useDayRailHeight';
import { installResizeObserverMock } from '@/__tests__/helpers/resizeObserver';

afterEach(() => { vi.unstubAllGlobals(); document.documentElement.style.removeProperty('--day-rail-h'); });

describe('useDayRailHeight', () => {
  it('publishes the rail height as a custom property', () => {
    installResizeObserverMock();
    const { result } = renderHook(() => useDayRailHeight());
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ height: 56 }) as DOMRect;
    act(() => { result.current(el); });
    expect(document.documentElement.style.getPropertyValue('--day-rail-h')).toBe('56px');
  });

  it('republishes when the rail resizes', () => {
    const resize = installResizeObserverMock();
    const { result } = renderHook(() => useDayRailHeight());
    const el = document.createElement('div');
    let height = 56;
    el.getBoundingClientRect = () => ({ height }) as DOMRect;
    act(() => { result.current(el); });
    // Browser text zoom grows the chips; a hardcoded offset would leave every
    // scroll target landing underneath the rail from here on.
    height = 84;
    resize.trigger();
    expect(document.documentElement.style.getPropertyValue('--day-rail-h')).toBe('84px');
  });

  it('drops back to zero when the rail unmounts', () => {
    installResizeObserverMock();
    const { result } = renderHook(() => useDayRailHeight());
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ height: 56 }) as DOMRect;
    act(() => { result.current(el); });
    act(() => { result.current(null); });
    expect(document.documentElement.style.getPropertyValue('--day-rail-h')).toBe('0px');
  });
});
