/// <reference types="vitest/globals" />
import { renderHook, act } from '@testing-library/preact';
import { useFavorites } from '@/hooks/useFavorites';

describe('useFavorites', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with empty favorites', () => {
    const { result } = renderHook(() => useFavorites());
    expect(result.current.favoriteCount).toBe(0);
    expect(result.current.isFavorite('any-id')).toBe(false);
  });

  it('toggles a favorite on', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => { result.current.toggleFavorite('event-1'); });
    expect(result.current.isFavorite('event-1')).toBe(true);
    expect(result.current.favoriteCount).toBe(1);
  });

  it('toggles a favorite off', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => { result.current.toggleFavorite('event-1'); });
    act(() => { result.current.toggleFavorite('event-1'); });
    expect(result.current.isFavorite('event-1')).toBe(false);
    expect(result.current.favoriteCount).toBe(0);
  });

  it('handles multiple favorites', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => { result.current.toggleFavorite('event-1'); });
    act(() => { result.current.toggleFavorite('event-2'); });
    act(() => { result.current.toggleFavorite('event-3'); });
    expect(result.current.favoriteCount).toBe(3);
    expect(result.current.isFavorite('event-1')).toBe(true);
    expect(result.current.isFavorite('event-2')).toBe(true);
    expect(result.current.isFavorite('event-3')).toBe(true);
  });

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => { result.current.toggleFavorite('event-1'); });
    const stored = JSON.parse(localStorage.getItem('chq-calendar-favorites') || '{}');
    expect(stored.eventIds).toContain('event-1');
    expect(stored.lastSaved).toBeDefined();
  });

  it('restores from localStorage on mount', () => {
    localStorage.setItem('chq-calendar-favorites', JSON.stringify({
      eventIds: ['event-a', 'event-b'],
      lastSaved: Date.now(),
    }));
    const { result } = renderHook(() => useFavorites());
    expect(result.current.isFavorite('event-a')).toBe(true);
    expect(result.current.isFavorite('event-b')).toBe(true);
    expect(result.current.favoriteCount).toBe(2);
  });

  it('ignores expired localStorage data', () => {
    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    localStorage.setItem('chq-calendar-favorites', JSON.stringify({
      eventIds: ['old-event'],
      lastSaved: thirtyOneDaysAgo,
    }));
    const { result } = renderHook(() => useFavorites());
    expect(result.current.favoriteCount).toBe(0);
  });
});
