// Detects when a newer frontend build has been deployed and silently reloads
// so installed (home-screen) users pick it up. See
// docs/superpowers/specs/2026-07-15-pwa-auto-update-design.md.

export const VERSION_URL = '/version.json';
export const STORAGE_KEY = 'chq:reloadedForVersion';

type MinimalStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface CheckOptions {
  current?: string;
  storage?: MinimalStorage;
  reload?: () => void;
  fetchImpl?: typeof fetch;
}

// Pure decision: reload only when we have a fetched version that differs from
// what is running AND we have not already reloaded targeting that same version.
export function shouldReload(
  current: string | undefined,
  fetched: unknown,
  alreadyTargeted: string | null,
): boolean {
  if (typeof fetched !== 'string' || fetched.length === 0) return false;
  if (fetched === current) return false;
  if (fetched === alreadyTargeted) return false;
  return true;
}

export async function checkForUpdate(opts: CheckOptions = {}): Promise<void> {
  const {
    current = import.meta.env.VITE_APP_VERSION,
    storage = window.sessionStorage,
    reload = () => window.location.reload(),
    fetchImpl = fetch,
  } = opts;

  try {
    const res = await fetchImpl(VERSION_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as { version?: unknown };
    const fetched = data?.version;
    const alreadyTargeted = storage.getItem(STORAGE_KEY);
    if (shouldReload(current, fetched, alreadyTargeted)) {
      storage.setItem(STORAGE_KEY, fetched as string);
      reload();
    }
  } catch {
    // Offline, non-OK, or malformed response — keep running the current version.
  }
}

// Checks now and every time the app regains visibility (iOS fires
// visibilitychange when a home-screen app is reopened).
export function startVersionWatch(opts: CheckOptions = {}): void {
  void checkForUpdate(opts);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate(opts);
  });
}
