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
 * six months earlier — it was legacy nobody had cause to notice.
 *
 * The escape hatch is opt-in and explicit. Set `VITE_LOCAL_DATA=true` to read
 * `/data` instead, for working offline or against a locally-synced feed; see
 * `backend/README-LOCAL-SYNC.md`. It is deliberately not "use the local file
 * if one happens to exist" — that is precisely the silent divergence that
 * produced #286, where the behaviour you get depends on the state of an
 * ignored directory rather than on anything you can read.
 *
 * The escape hatch works on the dev server and nowhere else — not under
 * `vite build`, and so not under `vite preview` either, which serves a build.
 * See `usingLocalData()` for why that is a guarantee rather than a default.
 *
 * **Keep this module import-free.** `scripts/setup-local.sh` (`check_events`)
 * fetches it from the running dev server and evaluates it in node to learn
 * which base the browser will read, and node cannot resolve the `/src/...`
 * specifiers Vite rewrites imports to. An import would not cause a false
 * pass (the check fails loudly when it cannot evaluate the module), but it
 * would break the one first-run check that asserts the calendar has events.
 * `src/__tests__/lib/dataSource.test.ts` fails on one, so it is caught here
 * rather than on someone's first run.
 */

/** The CDN prefix, proxied to production by Vite in dev and preview. */
export const CDN_DATA_BASE = '/cache/calendar-cache';

/** Files under `frontend/public/data/`, served by Vite from the working tree. */
export const LOCAL_DATA_BASE = '/data';

/**
 * True when the dev server was asked to read locally-synced files instead of
 * the CDN.
 *
 * Gated on `import.meta.env.DEV` as well as the flag, so a production bundle
 * can never request `/data`. Before #286 the `/data` branch was DEV-only by
 * construction; making the flag the only input would have let a developer
 * with `VITE_LOCAL_DATA=true` in their shell or `frontend/.env.local` ship a
 * bundle that asks CloudFront for `/data/all-events-<year>.json` — a 404 in
 * production, and so an empty calendar for every reader. `deploy-frontend.sh`
 * builds on the developer's machine, which is exactly where that variable
 * lives. Vite replaces `import.meta.env.DEV` with `false` in a build, so the
 * minifier drops the `/data` branch from the bundle entirely; it is not merely
 * untaken at runtime.
 *
 * Read through a function rather than a module constant so the value is not
 * captured at import time — that is what lets tests `vi.stubEnv` it without
 * re-importing the module. It does *not* make a `.env` edit take effect
 * without a restart: Vite statically replaces `import.meta.env.VITE_*` at
 * transform time, so changing `.env` still requires restarting the dev server
 * or test runner either way.
 */
export function usingLocalData(): boolean {
  return import.meta.env.DEV && String(import.meta.env.VITE_LOCAL_DATA) === 'true';
}

/** Base path for published data files, without a trailing slash. */
export function dataBase(): string {
  return usingLocalData() ? LOCAL_DATA_BASE : CDN_DATA_BASE;
}

/**
 * The localStorage key a hook caches published data under, namespaced by data
 * source.
 *
 * The hooks keep what they fetched for `CACHE_EXPIRY_MS` (an hour) and serve
 * it without touching the network. Keyed only by name, a developer who flips
 * `VITE_LOCAL_DATA` and restarts the dev server keeps seeing the *other*
 * source's data for up to that hour — the switch appears to do nothing, which
 * is the same kind of silent divergence #286 was about. So the local source
 * gets its own keys.
 *
 * Only the local source is suffixed. The CDN key is returned byte-for-byte
 * unchanged, because it is the one every production reader already holds a
 * warm entry under; renaming it would cost each of them a cold fetch for no
 * benefit. And since `usingLocalData()` is false in every build, production
 * can never produce a `-local` key at all.
 */
export function dataCacheKey(key: string): string {
  return usingLocalData() ? `${key}-local` : key;
}

/**
 * What to tell a developer when a data file did not load. Production readers
 * never see this — it goes to the console, and the on-screen story for a
 * reader whose season has no data is EmptyState's, which is correct for them.
 * The person staring at an empty calendar in dev is a different person with a
 * different problem, and #286 is what happens when we address only the first.
 *
 * `cause` is the HTTP status when the server answered, or the error when the
 * request never got an answer (`fetch()` rejected: offline, DNS, the dev
 * server's proxy unreachable) or the answer could not be read. Both need the
 * same remedy, and the second is the more likely one for a developer who is
 * offline — which is exactly who the local-data route is for.
 */
export function describeFetchFailure(url: string, cause?: number | Error): string {
  const what = cause === undefined
    ? `Failed to fetch ${url}`
    : typeof cause === 'number'
      ? `Failed to fetch ${url} (HTTP ${cause})`
      : `Failed to fetch ${url} (${cause.name}: ${cause.message})`;
  if (!import.meta.env.DEV) return what;
  return usingLocalData()
    ? `${what}\nVITE_LOCAL_DATA=true is set, so this reads ${LOCAL_DATA_BASE} from frontend/public/data/, which git ignores. Populate it with \`npm run sync:local --workspace=backend\` (see backend/README-LOCAL-SYNC.md), or unset VITE_LOCAL_DATA to load from the CDN instead.`
    : `${what}\nThis proxies to production via the /cache rule in vite.config.ts, so check your network connection. To work offline, sync a local copy (\`npm run sync:local --workspace=backend\`, see backend/README-LOCAL-SYNC.md) and set VITE_LOCAL_DATA=true.`;
}
