/* Service worker: offline app shell with stale-while-revalidate so updates
 * actually reach returning users (cache is refreshed in the background on
 * every load, and a version bump wipes the old cache on activate). */
const CACHE = 'critter-casino-v3';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './manifest.webmanifest',
  './js/sprites.js',
  './js/data.js',
  './js/state.js',
  './js/ui.js',
  './js/games.js',
  './js/trade.js',
  './js/admin.js',
  './js/app.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // don't touch cross-origin
  e.respondWith((async function () {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req).then(function (resp) {
      if (resp && resp.status === 200 && resp.type === 'basic') cache.put(req, resp.clone());
      return resp;
    }).catch(function () { return null; });
    // serve cache immediately if present (and refresh in background), else network
    return cached || (await network) || cache.match('./index.html');
  })());
});
