/**
 * Where the client fetches its published data from.
 *
 * There is one answer, and it is the same in dev, in `vite preview` and in
 * production: the CloudFront `calendar-cache` prefix. `vite.config.ts` proxies
 * `/cache` to https://www.chqcal.org for both the dev server and the preview
 * server, so a fresh clone renders real events with no fixture, no sync step
 * and no AWS credentials.
 *
 * It did not always work that way. Dev used to read `/data` — files under
 * `frontend/public/data/`, which `.gitignore` excludes. The result (#286) was
 * that `docker compose up` on a fresh clone rendered an empty calendar and the
 * reader got EmptyState's "try reloading in a moment", advice that could never
 * work; while anyone who had run the app before kept a warm `public/data/` and
 * never saw it. The `/cache` proxy had already made that branch unnecessary
 * five months earlier — it was legacy nobody had cause to notice.
 *
 * The escape hatch is opt-in and explicit. Set `VITE_LOCAL_DATA=true` to read
 * `/data` instead, for working offline or against a locally-synced feed; see
 * `backend/README-LOCAL-SYNC.md`. It is deliberately not "use the local file
 * if one happens to exist" — that is precisely the silent divergence that
 * produced #286, where the behaviour you get depends on the state of an
 * ignored directory rather than on anything you can read.
 */

/** The CDN prefix, proxied to production by Vite in dev and preview. */
export const CDN_DATA_BASE = '/cache/calendar-cache';

/** Files under `frontend/public/data/`, served by Vite from the working tree. */
export const LOCAL_DATA_BASE = '/data';

/**
 * True when this build was asked to read locally-synced files instead of the
 * CDN.
 *
 * Read through a function rather than a module constant so the value is not
 * captured at import time — that is what lets tests `vi.stubEnv` it without
 * re-importing the module. It does *not* make a `.env` edit take effect
 * without a restart: Vite statically replaces `import.meta.env.VITE_*` at
 * transform time, so changing `.env` still requires restarting the dev server
 * or test runner either way.
 */
export function usingLocalData(): boolean {
  return String(import.meta.env.VITE_LOCAL_DATA) === 'true';
}

/** Base path for published data files, without a trailing slash. */
export function dataBase(): string {
  return usingLocalData() ? LOCAL_DATA_BASE : CDN_DATA_BASE;
}

/**
 * What to tell a developer when a data file did not load. Production readers
 * never see this — it goes to the console, and the on-screen story for a
 * reader whose season has no data is EmptyState's, which is correct for them.
 * The person staring at an empty calendar in dev is a different person with a
 * different problem, and #286 is what happens when we address only the first.
 */
export function describeFetchFailure(url: string, status?: number): string {
  const what = status === undefined ? `Failed to fetch ${url}` : `Failed to fetch ${url} (HTTP ${status})`;
  if (!import.meta.env.DEV) return what;
  return usingLocalData()
    ? `${what}\nVITE_LOCAL_DATA=true is set, so this reads ${LOCAL_DATA_BASE} from frontend/public/data/, which git ignores. Populate it with \`npm run sync:local --workspace=backend\` (see backend/README-LOCAL-SYNC.md), or unset VITE_LOCAL_DATA to load from the CDN instead.`
    : `${what}\nThis proxies to production via the /cache rule in vite.config.ts, so check your network connection. To work offline, sync a local copy (\`npm run sync:local --workspace=backend\`, see backend/README-LOCAL-SYNC.md) and set VITE_LOCAL_DATA=true.`;
}
