// FuelSharp NSW service worker
// - App shell: network-first, falling back to cache (so updates ship immediately but the app still opens offline)
// - Price data: network-first, falling back to the last cached copy (the page shows a "stale" banner from its timestamp)
// - Map tiles and third-party APIs are not cached here.
const CACHE = 'fuelsharp-v5';
const SHELL = [
    './',
    './index.html',
    './manifest.json',
    './icons/icon-192.png?v=2',
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;   // let the browser handle CDNs, tiles, APIs
    // Same-origin requests outside this app (the shared /assets/ fonts, analytics) are cached too, so the
    // page keeps its look offline. GoatCounter's count endpoint is cross-origin and never touched.

    event.respondWith(
        fetch(req)
            .then(res => {
                if (res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE).then(c => c.put(req, copy));
                }
                return res;
            })
            .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || Response.error()))
    );
});
