import { useEffect, useState } from 'react';

export type ArticleLinkKind = 'preview' | 'recap';

export interface ArticleLink {
  title: string;
  url: string;
  kind: ArticleLinkKind;
  /** YYYY-MM-DD publication date on chqdaily.com. */
  pubDate: string;
}

interface ArticleLinksFile {
  generatedAt: string;
  matcherVersion: number;
  links: Record<string, ArticleLink[]>;
}

export interface UseArticleLinksResult {
  /** eventId → linked Daily articles (previews first, then recaps). */
  links: Record<string, ArticleLink[]>;
  loading: boolean;
}

interface LoadResult {
  links: Record<string, ArticleLink[]>;
  /** When true the result is durable (200/404) and may be cached forever. */
  cacheable: boolean;
}

const inflight = new Map<number, Promise<LoadResult>>();
const resolved = new Map<number, Record<string, ArticleLink[]>>();

async function loadLinks(year: number): Promise<LoadResult> {
  if (resolved.has(year)) {
    return { links: resolved.get(year)!, cacheable: true };
  }
  const existing = inflight.get(year);
  if (existing) return existing;

  const promise = (async (): Promise<LoadResult> => {
    try {
      // Same dev/prod split as useEventData: Vite dev serves fixtures from
      // /public/data; production serves the Lambda-published sidecar from
      // the CloudFront calendar-cache path.
      const cacheBase = import.meta.env.DEV ? '/data' : '/cache/calendar-cache';
      const res = await fetch(`${cacheBase}/article-links-${year}.json`);
      if (res.status === 404) {
        return { links: {}, cacheable: true };
      }
      if (!res.ok) {
        return { links: {}, cacheable: false };
      }
      const payload = (await res.json()) as ArticleLinksFile;
      return { links: payload.links ?? {}, cacheable: true };
    } catch {
      return { links: {}, cacheable: false };
    }
  })();

  inflight.set(year, promise);
  const result = await promise;
  if (result.cacheable) {
    resolved.set(year, result.links);
  }
  inflight.delete(year);
  return result;
}

export function useArticleLinks(year: number): UseArticleLinksResult {
  const cached = resolved.get(year);
  const [links, setLinks] = useState<Record<string, ArticleLink[]>>(cached ?? {});
  const [loading, setLoading] = useState<boolean>(!cached);

  useEffect(() => {
    let cancelled = false;
    if (resolved.has(year)) {
      setLinks(resolved.get(year)!);
      setLoading(false);
      return;
    }
    setLinks({});
    setLoading(true);
    loadLinks(year).then((result) => {
      if (cancelled) return;
      setLinks(result.links);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [year]);

  return { links, loading };
}

/**
 * Test-only: clear the module-level cache so each test starts fresh.
 * Mirrors __resetWeeklyThemesCacheForTests in useWeeklyThemes.ts.
 */
export function __resetArticleLinksCacheForTests(): void {
  inflight.clear();
  resolved.clear();
}
