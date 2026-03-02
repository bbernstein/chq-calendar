import { useState, useEffect, useRef, useCallback } from 'react';
import type { Event, GlobalEventData, SeasonWeek } from '@/lib/types';
import { CACHE_EXPIRY_MS, ACTIVE_YEAR, getCategoryDisplayName, getLocationDisplayName } from '@/lib/constants';
import { decodeHtmlEntities, decodeEventHtmlEntities } from '@/lib/utils/eventHelpers';

interface UseEventDataProps {
  globalEventData: GlobalEventData;
  seasonWeeks: SeasonWeek[];
  setAvailableCategories: (categories: string[]) => void;
  setAvailableLocations: (locations: string[]) => void;
}

export function useEventData({ globalEventData, seasonWeeks, setAvailableCategories, setAvailableLocations }: UseEventDataProps) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const isLoadingRef = useRef(false);



  const fetchAllEvents = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      try {
        localStorage.removeItem('chq-calendar-events');
      } catch (e) {
        console.warn('Failed to clear localStorage:', e);
      }
    }

    if (!forceRefresh && globalEventData.events && globalEventData.loadedAt) {
      const decodedEvents = globalEventData.events.map(decodeEventHtmlEntities);
      setEvents(decodedEvents);
      setAvailableCategories(globalEventData.categories.map(cat => decodeHtmlEntities(cat) || cat));
      setAvailableLocations((globalEventData.locations || []).map(loc => decodeHtmlEntities(loc) || loc));
      setDataLoaded(true);
      return;
    }

    if (isLoadingRef.current && !forceRefresh) return;

    if (dataLoaded && !forceRefresh) return;

    isLoadingRef.current = true;

    if (!forceRefresh) {
      try {
        const cachedData = localStorage.getItem('chq-calendar-events');
        if (cachedData) {
          const parsed = JSON.parse(cachedData);
          if (parsed.timestamp && Date.now() - parsed.timestamp < CACHE_EXPIRY_MS && parsed.version === 'v3-categories') {
            const decodedEvents = parsed.events.map(decodeEventHtmlEntities);
            setEvents(decodedEvents);
            setAvailableCategories(parsed.categories.map((cat: string) => decodeHtmlEntities(cat) || cat));
            setAvailableLocations((parsed.locations || []).map((loc: string) => decodeHtmlEntities(loc) || loc));
            setDataLoaded(true);
            isLoadingRef.current = false;
            return;
          } else {
            localStorage.removeItem('chq-calendar-events');
          }
        }
      } catch (e) {
        console.warn('Failed to load from localStorage:', e);
      }
    }

    setLoading(true);
    try {
      const response = await fetch(
        import.meta.env.DEV
          ? `/data/all-events-${ACTIVE_YEAR}.json`
          : `/cache/calendar-cache/all-events-${ACTIVE_YEAR}.json`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        const rawEvents = data.data || [];
        const fetchedEvents = rawEvents.map(decodeEventHtmlEntities);
        setEvents(fetchedEvents);
        setDataLoaded(true);

        const allCategories: string[] = [];
        fetchedEvents.forEach((event: Event) => {
          if (event.categories && event.categories.length > 0) {
            allCategories.push(...event.categories.map(cat => cat.name));
          } else if (event.category) {
            allCategories.push(event.category);
          }
        });
        const categories = [...new Set(allCategories.filter(Boolean).map(cat => decodeHtmlEntities(cat) || cat))] as string[];

        const locations = [...new Set(fetchedEvents.map((e: Event) => e.location).filter(Boolean).map((loc: string) => decodeHtmlEntities(loc) || loc))] as string[];

        const allTags: string[] = [];
        fetchedEvents.forEach((event: Event) => {
          if (event.tags) allTags.push(...event.tags.map(tag => decodeHtmlEntities(tag) || tag));
          if (event.categories) allTags.push(...event.categories.map(cat => decodeHtmlEntities(cat.name) || cat.name));
        });

        const normalizeTag = (tag: string) => tag.toLowerCase().replace(/[-\s]+/g, ' ').trim();
        const seenNormalized = new Set<string>();
        const uniqueTags: string[] = [];

        const sortedByPreference = allTags.sort((a, b) => {
          const aHasSpaces = a.includes(' ');
          const bHasSpaces = b.includes(' ');
          if (aHasSpaces && !bHasSpaces) return -1;
          if (!aHasSpaces && bHasSpaces) return 1;
          const aHasCapitals = /[A-Z]/.test(a);
          const bHasCapitals = /[A-Z]/.test(b);
          if (aHasCapitals && !bHasCapitals) return -1;
          if (!aHasCapitals && bHasCapitals) return 1;
          return 0;
        });

        for (const tag of sortedByPreference) {
          if (!tag.startsWith('Week ')) {
            const normalized = normalizeTag(tag);
            if (!seenNormalized.has(normalized)) {
              seenNormalized.add(normalized);
              uniqueTags.push(tag);
            }
          }
        }

        const sortedCategories = categories.sort((a, b) => {
          const displayA = getCategoryDisplayName(a);
          const displayB = getCategoryDisplayName(b);
          return displayA.localeCompare(displayB);
        });

        const sortedLocations = locations.sort((a, b) => {
          const displayA = getLocationDisplayName(a);
          const displayB = getLocationDisplayName(b);
          return displayA.localeCompare(displayB);
        });
        const sortedTags = uniqueTags.sort();
        const weeks = seasonWeeks.map(w => w.number);

        setAvailableCategories(sortedCategories);
        setAvailableLocations(sortedLocations);

        if (globalEventData.setGlobalEventData) {
          globalEventData.setGlobalEventData({
            events: fetchedEvents,
            categories: sortedCategories,
            locations: sortedLocations,
            tags: sortedTags,
            weeks: weeks,
            loadedAt: Date.now()
          });
        }

        try {
          localStorage.setItem('chq-calendar-events', JSON.stringify({
            events: fetchedEvents,
            categories: sortedCategories,
            locations: sortedLocations,
            tags: sortedTags,
            weeks: weeks,
            timestamp: Date.now(),
            version: 'v3-categories'
          }));
        } catch (e) {
          console.warn('Failed to save to localStorage:', e);
        }
      } else {
        console.error('Failed to fetch events');
      }
    } catch (error) {
      console.error('Error fetching events:', error);
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  }, [dataLoaded, globalEventData, seasonWeeks, setAvailableCategories, setAvailableLocations]);

  useEffect(() => {
    fetchAllEvents();
  }, [fetchAllEvents]);

  return { events, loading };
}
