import { useState, useCallback, useEffect } from 'react';
import { USER_STATE_EXPIRY_MS } from '@/lib/constants';

const STORAGE_KEY = 'chq-calendar-favorites';

interface StoredFavorites {
  eventIds: string[];
  lastSaved: number;
}

export function useFavorites() {
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: StoredFavorites = JSON.parse(stored);
        if (parsed.lastSaved && Date.now() - parsed.lastSaved < USER_STATE_EXPIRY_MS) {
          return new Set(parsed.eventIds);
        }
      }
    } catch (e) {
      console.warn('Failed to load favorites:', e);
    }
    return new Set();
  });

  useEffect(() => {
    try {
      const data: StoredFavorites = {
        eventIds: Array.from(favoriteIds),
        lastSaved: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save favorites:', e);
    }
  }, [favoriteIds]);

  const isFavorite = useCallback(
    (eventId: string) => favoriteIds.has(eventId),
    [favoriteIds]
  );

  const toggleFavorite = useCallback((eventId: string) => {
    setFavoriteIds(prev => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }, []);

  return {
    favoriteIds,
    isFavorite,
    toggleFavorite,
    favoriteCount: favoriteIds.size,
  };
}
