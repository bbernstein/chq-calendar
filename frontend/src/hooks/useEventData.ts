import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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

  const apiUrl = useMemo(() =>
    process.env.NODE_ENV === 'development'
      ? (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001')
      : ''
  , []);

  console.log('API URL:', apiUrl, 'NODE_ENV:', process.env.NODE_ENV);

  const fetchAllEvents = useCallback(async (forceRefresh = false) => {
    console.log('fetchAllEvents called', {
      forceRefresh,
      isLoadingRef: isLoadingRef.current,
      globalDataLoaded: !!globalEventData.events
    });

    if (forceRefresh) {
      try {
        localStorage.removeItem('chq-calendar-events');
        console.log('Cleared local storage cache');
      } catch (e) {
        console.warn('Failed to clear localStorage:', e);
      }
    }

    if (!forceRefresh && globalEventData.events && globalEventData.loadedAt) {
      console.log('Loading from global store');
      const decodedEvents = globalEventData.events.map(decodeEventHtmlEntities);
      setEvents(decodedEvents);
      setAvailableCategories(globalEventData.categories.map(cat => decodeHtmlEntities(cat) || cat));
      setAvailableLocations((globalEventData.locations || []).map(loc => decodeHtmlEntities(loc) || loc));
      setDataLoaded(true);
      return;
    }

    if (isLoadingRef.current && !forceRefresh) {
      console.log('Already loading, skipping duplicate call');
      return;
    }

    if (dataLoaded && !forceRefresh) {
      console.log('Data already loaded, skipping API call');
      return;
    }

    isLoadingRef.current = true;

    if (!forceRefresh) {
      try {
        const cachedData = localStorage.getItem('chq-calendar-events');
        if (cachedData) {
          const parsed = JSON.parse(cachedData);
          if (parsed.timestamp && Date.now() - parsed.timestamp < CACHE_EXPIRY_MS && parsed.version === 'v3-categories') {
            console.log('Loading events from local cache (v3-categories)');
            const decodedEvents = parsed.events.map(decodeEventHtmlEntities);
            setEvents(decodedEvents);
            setAvailableCategories(parsed.categories.map((cat: string) => decodeHtmlEntities(cat) || cat));
            setAvailableLocations((parsed.locations || []).map((loc: string) => decodeHtmlEntities(loc) || loc));
            setDataLoaded(true);
            isLoadingRef.current = false;
            return;
          } else {
            console.log('Invalidating old cache (missing version or expired)');
            localStorage.removeItem('chq-calendar-events');
          }
        }
      } catch (e) {
        console.warn('Failed to load from localStorage:', e);
      }
    }

    setLoading(true);
    try {
      console.log('Loading all events for the season...');

      const response = await fetch(
        process.env.NODE_ENV === 'development'
          ? `/data/all-events-${ACTIVE_YEAR}.json`
          : `${apiUrl}/cache/calendar-cache/all-events-${ACTIVE_YEAR}.json`,
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
        console.log('Loaded all events:', fetchedEvents.length, 'events');
        console.log('First event:', fetchedEvents[0]);
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
  }, [apiUrl, dataLoaded, globalEventData, seasonWeeks, setAvailableCategories, setAvailableLocations]);

  useEffect(() => {
    console.log('Component mounted - Initial useEffect triggered');
    fetchAllEvents();
    return () => {
      console.log('Component unmounting!');
    };
  }, [fetchAllEvents]);

  return { events, loading };
}
