/* Service worker: offline app shell with stale-while-revalidate so updates
 * actually reach returning users (cache is refreshed in the background on
 * every load, and a version bump wipes the old cache on activate). */
const CACHE = 'critter-casino-v37';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './manifest.webmanifest',
  './js/fx.js',
  './js/push.js',
  './js/sprites.js',
  './js/data.js',
  './js/state.js',
  './js/ui.js',
  './js/idle.js',
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

self.addEventListener('push', function (e) {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { body: e.data && e.data.text() }; }
  const title = data.title || 'Critter Casino';
  const opts = {
    body: data.body || 'Come back and play!',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: 'critter-daily',
    renotify: true,
    data: { url: data.url || './' }
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cl) {
      for (let i = 0; i < cl.length; i++) {
        if ('focus' in cl[i]) { cl[i].focus(); return; }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
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
