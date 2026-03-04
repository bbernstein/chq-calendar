import { useState, useEffect } from 'react';
import { CACHE_EXPIRY_MS, getDefaultYear, YEARS_MANIFEST_PATH } from '@/lib/constants';

interface YearsManifest {
  years: number[];
  defaultYear: number;
  generated: string;
}

interface UseAvailableYearsResult {
  years: number[];
  defaultYear: number;
  loading: boolean;
}

const CACHE_KEY = 'chq-calendar-years';

export function useAvailableYears(): UseAvailableYearsResult {
  const computedDefault = getDefaultYear();
  const [years, setYears] = useState<number[]>([computedDefault]);
  const [defaultYear, setDefaultYear] = useState<number>(computedDefault);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchManifest() {
      // Check localStorage cache first
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.cachedAt && Date.now() - parsed.cachedAt < CACHE_EXPIRY_MS) {
            if (!cancelled) {
              setYears(parsed.years);
              setDefaultYear(parsed.defaultYear);
              setLoading(false);
            }
            return;
          }
        }
      } catch {
        // Ignore cache read errors
      }

      // Fetch from network
      try {
        const url = import.meta.env.DEV ? '/data/years.json' : YEARS_MANIFEST_PATH;
        const response = await fetch(url);
        if (response.ok) {
          const manifest: YearsManifest = await response.json();
          if (!cancelled) {
            setYears(manifest.years);
            setDefaultYear(manifest.defaultYear);
            setLoading(false);
          }
          // Cache in localStorage
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
              ...manifest,
              cachedAt: Date.now(),
            }));
          } catch {
            // Ignore cache write errors
          }
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch {
        // Fallback: use computed default year
        if (!cancelled) {
          setYears([computedDefault]);
          setDefaultYear(computedDefault);
          setLoading(false);
        }
      }
    }

    fetchManifest();
    return () => { cancelled = true; };
  }, [computedDefault]);

  return { years, defaultYear, loading };
}
