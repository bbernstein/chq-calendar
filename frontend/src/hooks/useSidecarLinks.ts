import { useEffect, useState } from 'react';

interface SidecarLinksFile<T> {
  generatedAt: string;
  matcherVersion: number;
  links: Record<string, T[]>;
}

interface LoadResult<T> {
  links: Record<string, T[]>;
  /** When true the result is durable (200/404) and may be cached forever. */
  cacheable: boolean;
}

const inflight = new Map<string, Promise<LoadResult<unknown>>>();
const resolved = new Map<string, Record<string, unknown[]>>();

async function loadLinks<T>(filePrefix: string, year: number): Promise<LoadResult<T>> {
  const key = `${filePrefix}-${year}`;
  if (resolved.has(key)) {
    return { links: resolved.get(key) as Record<string, T[]>, cacheable: true };
  }
  const existing = inflight.get(key);
  if (existing) return existing as Promise<LoadResult<T>>;

  const promise = (async (): Promise<LoadResult<T>> => {
    try {
      // Same dev/prod split as useEventData: Vite dev serves fixtures from
      // /public/data; production serves the Lambda-published sidecar from
      // the CloudFront calendar-cache path.
      const cacheBase = import.meta.env.DEV ? '/data' : '/cache/calendar-cache';
      const res = await fetch(`${cacheBase}/${key}.json`);
      if (res.status === 404) {
        return { links: {}, cacheable: true };
      }
      if (!res.ok) {
        return { links: {}, cacheable: false };
      }
      const payload = (await res.json()) as SidecarLinksFile<T>;
      return { links: payload.links ?? {}, cacheable: true };
    } catch {
      return { links: {}, cacheable: false };
    }
  })();

  inflight.set(key, promise as Promise<LoadResult<unknown>>);
  const result = await promise;
  if (result.cacheable) {
    resolved.set(key, result.links);
  }
  inflight.delete(key);
  return result;
}

/**
 * Shared loader for eventId-keyed sidecar files
 * (`<filePrefix>-<year>.json` with a `links` map). Module-level caches
 * dedupe concurrent loads across all consumers of the same file.
 */
export function useSidecarLinks<T>(
  filePrefix: string,
  year: number,
): { links: Record<string, T[]>; loading: boolean } {
  const key = `${filePrefix}-${year}`;
  const cached = resolved.get(key) as Record<string, T[]> | undefined;
  const [links, setLinks] = useState<Record<string, T[]>>(cached ?? {});
  const [loading, setLoading] = useState<boolean>(!cached);

  useEffect(() => {
    let cancelled = false;
    if (resolved.has(key)) {
      setLinks(resolved.get(key) as Record<string, T[]>);
      setLoading(false);
      return;
    }
    setLinks({});
    setLoading(true);
    loadLinks<T>(filePrefix, year).then((result) => {
      if (cancelled) return;
      setLinks(result.links);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [filePrefix, year, key]);

  return { links, loading };
}

/** Test-only: clear the module-level cache so each test starts fresh. */
export function __resetSidecarLinksCacheForTests(): void {
  inflight.clear();
  resolved.clear();
}
