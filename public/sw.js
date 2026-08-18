// Minimal hand-rolled service worker — no build step, no dependency. Two jobs:
// 1) precache the small set of static, unauthenticated assets that make up the
//    installable app shell (manifest + icons — NOT page HTML, which is dynamic
//    and per-account, so caching it here could serve one profile's data to another).
// 2) cache map tile requests so a previously-viewed area of the map stays visible
//    offline. Tiles are static images keyed by z/x/y, so a plain cache-first
//    strategy (no revalidation) is fine — they don't change under a given URL.

const SHELL_CACHE = "routy-shell-v1";
const TILE_CACHE = "routy-tiles-v1";

const SHELL_ASSETS = ["/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png"];

const TILE_HOSTS = ["tile.openstreetmap.org", "opentopomap.org", "server.arcgisonline.com", "tile.waymarkedtrails.org"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== SHELL_CACHE && key !== TILE_CACHE).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

function isTileRequest(url) {
  return TILE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const response = await fetch(event.request);
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        } catch (err) {
          return cached || Promise.reject(err);
        }
      }),
    );
    return;
  }

  if (url.origin === self.location.origin && SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
  }

  // Everything else (page navigations, API calls) goes straight to the network —
  // that content is dynamic and often authenticated, so it's deliberately not cached.
});
