const CACHE_VERSION = 'chqcal-v4';
const STATIC_CACHE = CACHE_VERSION + '-static';
const DATA_CACHE = CACHE_VERSION + '-data';

const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/chq-calendar-icon-256.svg',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-192-maskable.png',
  '/icon-512-maskable.png',
];

// Install: pre-cache essential static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== DATA_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: route-based caching strategy
self.addEventListener('fetch', (event) => {
  // Only cache GET requests — Cache API doesn't support other methods
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Stale-while-revalidate for events JSON data
  // Serves cached data immediately, fetches fresh data in background
  if (url.pathname.includes('all-events') || url.pathname.includes('calendar-cache')) {
    event.respondWith(staleWhileRevalidate(event, DATA_CACHE));
    return;
  }

  // Cache-first for static assets (JS, CSS, SVG, ICO, fonts)
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }

  // Network-first for HTML pages (navigation)
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request, STATIC_CACHE));
    return;
  }

  // Default: network with cache fallback
  event.respondWith(networkFirst(event.request, STATIC_CACHE));
});

function isStaticAsset(pathname) {
  return /\.(js|css|svg|ico|png|jpg|jpeg|webp|woff2?)$/i.test(pathname);
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Offline', { status: 503 });
  }
}

// Stale-while-revalidate: serve cached data immediately, update cache in background
async function staleWhileRevalidate(event, cacheName) {
  const request = event.request;
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Fetch fresh data in background regardless. On a 404 we EVICT the cached
  // entry — that's the "resource was deleted upstream" signal (e.g. the
  // publisher sidecar JSON gets DeleteObject'd by PublisherSidecarPublisher
  // when a publisher is disabled or a year has zero published events).
  // Without eviction, stale-while-revalidate keeps serving the deleted
  // payload forever: cached entries are returned synchronously and the
  // background 404 wouldn't otherwise dislodge them.
  //
  // We deliberately limit eviction to 404 (not all non-OK). A transient
  // CloudFront/origin 5xx during background revalidation should NOT wipe a
  // perfectly valid cached body — on the next load, the user would see a
  // broken/empty page instead of usable stale data while the origin
  // recovers. Same reasoning for 403/429/etc.: those are not "the resource
  // is gone" signals. Network errors (.catch branch) preserve cache for
  // the same reason.
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    } else if (response.status === 404) {
      cache.delete(request);
    }
    return response;
  }).catch(() => null);

  // Keep SW alive until background fetch completes
  event.waitUntil(fetchPromise);

  // Return cached data immediately if available, otherwise wait for network
  if (cached) return cached;

  const response = await fetchPromise;
  if (response) return response;
  return new Response('Offline', { status: 503 });
}
