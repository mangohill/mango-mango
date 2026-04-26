// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Tracker — Service Worker
// Strategy: Cache-first, background update
// Scope: https://mangohill.github.io/mango-mango/
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_NAME  = 'portfolio-tracker-v1';
const APP_URL     = '/mango-mango/';
const INDEX_URL   = '/mango-mango/index.html';

// All resources to pre-cache on install
const PRECACHE_URLS = [
  APP_URL,
  INDEX_URL,
];

// ── Install: pre-cache the app shell ─────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-caching app shell');
      // Cache both URL forms so either works offline
      return Promise.allSettled(
        PRECACHE_URLS.map(url =>
          fetch(url).then(res => {
            if(res.ok) return cache.put(url, res);
          }).catch(() => {}) // ignore network errors during install
        )
      );
    }).then(() => self.skipWaiting()) // activate immediately
  );
});

// ── Activate: clean up old caches ────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim()) // take control of all open pages
  );
});

// ── Fetch: Cache-first, background revalidation ───────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only handle GET requests for our own origin
  if(event.request.method !== 'GET') return;
  if(url.origin !== location.origin) return;

  // Don't intercept API calls (worker URL, Yahoo Finance, GitHub Gist, etc.)
  const isApiCall = url.hostname !== location.hostname ||
    url.pathname.startsWith('/api/') ||
    url.searchParams.has('symbols') ||
    url.searchParams.has('maif') ||
    url.searchParams.has('divs') ||
    url.hostname.includes('github') ||
    url.hostname.includes('yahoo') ||
    url.hostname.includes('gist') ||
    url.hostname.includes('monash') ||
    url.hostname.includes('cloudflare');

  if(isApiCall) return; // let it pass through normally

  // Cache-first strategy with background revalidation (stale-while-revalidate)
  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(event.request);

      // Fetch in background to update cache
      const networkFetch = fetch(event.request).then(networkRes => {
        if(networkRes && networkRes.ok) {
          cache.put(event.request, networkRes.clone());
          // Notify all clients a new version is available
          self.clients.matchAll().then(clients => {
            clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' }));
          });
        }
        return networkRes;
      }).catch(() => null);

      if(cached) {
        // Serve cache immediately, update in background
        event.waitUntil(networkFetch);
        return cached;
      }

      // No cache — wait for network
      const networkRes = await networkFetch;
      if(networkRes) return networkRes;

      // Both failed
      return new Response('App is offline. Please load the page while connected first.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' }
      });
    })
  );
});
