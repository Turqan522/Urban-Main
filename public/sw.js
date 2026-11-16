/* Cache the app shell, never API responses or mutations. Snapshot and queue live in the app. */
const CACHE = "urban-crisis-shell-v2";
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(["/", "/manifest.json", "/favicon.svg", "/icon-192.png", "/icon-512.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("urban-crisis-shell-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", event => {
  if (event.data?.type !== "CACHE_ASSETS" || !Array.isArray(event.data.urls)) return;
  event.waitUntil(caches.open(CACHE).then(cache => Promise.allSettled(event.data.urls.filter(value => {
    try { const url = new URL(value, self.location.origin); return url.origin === self.location.origin && /\.(js|css|woff2?|svg|png)$/.test(url.pathname); } catch { return false; }
  }).map(value => cache.add(value)))));
});
self.addEventListener("fetch", event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || request.headers.has("RSC")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(c => c.put("/", copy))); }
      return response;
    }).catch(async () => (await caches.match("/")) || new Response("Open Urban Crisis online once before using it offline.", { status: 503 })));
  } else if (["script", "style", "font", "image", "manifest"].includes(request.destination)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(c => c.put(request, copy))); }
      return response;
    })));
  }
});
