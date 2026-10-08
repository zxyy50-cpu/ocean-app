// Offline shell: same-origin GET requests are served network-first and cached,
// so the APP opens without a connection after one online visit.
// Customer data never passes through here; it lives in IndexedDB.
const CACHE = "ocean-app-shell-v3";
const SHELL = ["./", "./index.html", "./classic.html", "./styles/app.css", "./styles/v3.css", "./src/main.js", "./src/main-classic.js", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.includes("/demo/")) return;
  event.respondWith(fetch(request, { cache: "no-cache" }).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  }).catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html"))));
});
