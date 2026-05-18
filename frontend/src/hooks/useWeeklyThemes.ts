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

const inflight = new Map<number, Promise<Record<number, WeekTheme>>>();
const resolved = new Map<number, Record<number, WeekTheme>>();

async function loadThemes(year: number): Promise<Record<number, WeekTheme>> {
  if (resolved.has(year)) {
    return resolved.get(year)!;
  }
  const existing = inflight.get(year);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(`/data/weekly-themes/${year}.json`);
      if (!res.ok) return {};
      const payload = (await res.json()) as WeeklyThemesFile;
      const themes: Record<number, WeekTheme> = {};
      for (const w of payload.weeks ?? []) {
        themes[w.number] = w;
      }
      return themes;
    } catch {
      return {};
    }
  })();

  inflight.set(year, promise);
  const themes = await promise;
  resolved.set(year, themes);
  inflight.delete(year);
  return themes;
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
    setLoading(true);
    loadThemes(year).then((result) => {
      if (cancelled) return;
      setThemes(result);
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
