import { useEffect, useState } from 'react';

export interface WeekTheme {
  number: number;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
}

interface WeeklyThemesFile {
  year: number;
  scrapedAt: string;
  source: string;
  weeks: WeekTheme[];
}

export interface UseWeeklyThemesResult {
  themes: Record<number, WeekTheme>;
  loading: boolean;
}

interface LoadResult {
  themes: Record<number, WeekTheme>;
  /** When true the result is durable (200/404) and may be cached forever. */
  cacheable: boolean;
}

const inflight = new Map<number, Promise<LoadResult>>();
const resolved = new Map<number, Record<number, WeekTheme>>();

async function loadThemes(year: number): Promise<LoadResult> {
  if (resolved.has(year)) {
    return { themes: resolved.get(year)!, cacheable: true };
  }
  const existing = inflight.get(year);
  if (existing) return existing;

  const promise = (async (): Promise<LoadResult> => {
    try {
      const res = await fetch(`/data/weekly-themes/${year}.json`);
      if (res.status === 404) {
        // No themes file for this year — durable empty result.
        return { themes: {}, cacheable: true };
      }
      if (!res.ok) {
        // Transient (5xx / 403 / network error). Don't poison the cache.
        return { themes: {}, cacheable: false };
      }
      const payload = (await res.json()) as WeeklyThemesFile;
      const themes: Record<number, WeekTheme> = {};
      for (const w of payload.weeks ?? []) {
        themes[w.number] = w;
      }
      return { themes, cacheable: true };
    } catch {
      return { themes: {}, cacheable: false };
    }
  })();

  inflight.set(year, promise);
  const result = await promise;
  if (result.cacheable) {
    resolved.set(year, result.themes);
  }
  inflight.delete(year);
  return result;
}

export function useWeeklyThemes(year: number): UseWeeklyThemesResult {
  const cached = resolved.get(year);
  const [themes, setThemes] = useState<Record<number, WeekTheme>>(cached ?? {});
  const [loading, setLoading] = useState<boolean>(!cached);

  useEffect(() => {
    let cancelled = false;
    if (resolved.has(year)) {
      setThemes(resolved.get(year)!);
      setLoading(false);
      return;
    }
    // Clear stale themes from the prior year before the new fetch resolves,
    // so consumers don't briefly see the wrong year's data.
    setThemes({});
    setLoading(true);
    loadThemes(year).then((result) => {
      if (cancelled) return;
      setThemes(result.themes);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [year]);

  return { themes, loading };
}

/**
 * Test-only: clear the module-level cache so each test starts fresh.
 * The `inflight` / `resolved` Maps are deliberately module-scoped so all
 * consumers of `useWeeklyThemes` share one fetch — that's untestable across
 * Vitest cases without a reset hook. Do NOT call this from production code.
 */
export function __resetWeeklyThemesCacheForTests(): void {
  inflight.clear();
  resolved.clear();
}
