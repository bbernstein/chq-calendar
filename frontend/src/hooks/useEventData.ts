import { useState, useEffect, useRef, useCallback } from 'react';
import type { Event, GlobalEventData, SeasonWeek } from '@/lib/types';
import { CACHE_EXPIRY_MS, getCategoryDisplayName, getLocationDisplayName } from '@/lib/constants';
import { decodeHtmlEntities, decodeEventHtmlEntities } from '@/lib/utils/eventHelpers';

interface UseEventDataProps {
  year: number;
  globalEventData: GlobalEventData;
  seasonWeeks: SeasonWeek[];
  setAvailableCategories: (categories: string[]) => void;
  setAvailableLocations: (locations: string[]) => void;
}

export function useEventData({ year, globalEventData, seasonWeeks, setAvailableCategories, setAvailableLocations }: UseEventDataProps) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const isLoadingRef = useRef(false);
  const cacheKey = `chq-calendar-events-${year}`;

  const fetchAllEvents = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      try {
        localStorage.removeItem(cacheKey);
      } catch (e) {
        console.warn('Failed to clear localStorage:', e);
      }
    }

    if (!forceRefresh && globalEventData.events && globalEventData.loadedAt && globalEventData.year === year) {
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
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
          const parsed = JSON.parse(cachedData);
          if (parsed.timestamp && Date.now() - parsed.timestamp < CACHE_EXPIRY_MS && parsed.version === 'v4-publisher-feeds') {
            const decodedEvents = parsed.events.map(decodeEventHtmlEntities);
            setEvents(decodedEvents);
            setAvailableCategories(parsed.categories.map((cat: string) => decodeHtmlEntities(cat) || cat));
            setAvailableLocations((parsed.locations || []).map((loc: string) => decodeHtmlEntities(loc) || loc));
            setDataLoaded(true);
            isLoadingRef.current = false;
            return;
          } else {
            localStorage.removeItem(cacheKey);
          }
        }
      } catch (e) {
        console.warn('Failed to load from localStorage:', e);
      }
    }

    setLoading(true);
    try {
      const sidecarEnabled = String(import.meta.env.VITE_ENABLE_PUBLISHER_FEEDS) === 'true';
      const cacheBase = import.meta.env.DEV ? '/data' : '/cache/calendar-cache';
      const primaryUrl = `${cacheBase}/all-events-${year}.json`;
      const sidecarUrl = sidecarEnabled ? `${cacheBase}/publisher-events-${year}.json` : null;

      // Cap sidecar latency so a slow/hung publisher endpoint can't delay the
      // primary calendar render. AbortSignal.timeout returns ok:false-equivalent
      // (rejected promise) which we already swallow with .catch(() => null).
      //
      // Why Promise.all (coupled render) and not "render primary, append sidecar
      // later": evaluated 2026-05-03 and deliberately kept coupled. Decoupling
      // would (a) re-derive categories/locations/tags after sidecar arrives,
      // churning the filter sidebar mid-interaction, (b) shift layout/scroll as
      // events are appended into already-rendered day groups, (c) split the
      // localStorage cache write and globalEventData publish into two stages,
      // (d) blur `dataLoaded` semantics, and (e) ~double the test surface.
      // Primary and sidecar live on the same CloudFront distribution and the
      // sidecar payload is small (~KB), so the 3s ceiling is defensive against
      // a worst case that has not been observed. Revisit only if telemetry
      // shows the sidecar measurably delaying primary render.
      const SIDECAR_TIMEOUT_MS = 3000;
      const sidecarFetch = sidecarUrl
        ? fetch(sidecarUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(SIDECAR_TIMEOUT_MS),
          }).catch(() => null)
        : Promise.resolve(null);

      const [primaryResp, sidecarResp] = await Promise.all([
        fetch(primaryUrl, { method: 'GET', headers: { 'Accept': 'application/json' } }),
        sidecarFetch,
      ]);

      if (primaryResp.ok) {
        const data = await primaryResp.json();
        let rawEvents = data.data || [];

        // Sidecar is purely additive: any failure (404, parse error, network) falls back
        // to primary-only. Use concat (not push) so we never mutate the response body.
        // Dedupe by id so a publisher echoing a primary event doesn't render twice.
        if (sidecarResp && sidecarResp.ok) {
          try {
            const sidecarJson = await sidecarResp.json();
            if (Array.isArray(sidecarJson.data)) {
              const seenIds = new Set<string>(rawEvents.map((e: Event) => e.id));
              const additions = sidecarJson.data.filter((e: Event) => e && e.id && !seenIds.has(e.id));
              rawEvents = rawEvents.concat(additions);
            }
          } catch {
            // Ignore sidecar parse errors; primary remains intact.
          }
        }

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
            loadedAt: Date.now(),
            year,
          });
        }

        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            events: fetchedEvents,
            categories: sortedCategories,
            locations: sortedLocations,
            tags: sortedTags,
            weeks: weeks,
            timestamp: Date.now(),
            version: 'v4-publisher-feeds'
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
  }, [year, cacheKey, dataLoaded, globalEventData, seasonWeeks, setAvailableCategories, setAvailableLocations]);

  useEffect(() => {
    setDataLoaded(false);
    setEvents([]);
    isLoadingRef.current = false;
  }, [year]);

  useEffect(() => {
    fetchAllEvents();
  }, [fetchAllEvents]);

  return { events, loading };
}
