const CACHE = 'cs-dust-online-v11-cs2-audio';
const CORE = [
  '/', '/manifest.webmanifest', '/css/style.css',
  '/js/main.js', '/js/game.js', '/js/hud.js', '/js/models.js',
  '/js/audio.js', '/js/net.js', '/js/textures.js', '/js/world.js',
  '/shared/constants.js', '/shared/core.js', '/shared/game.js',
  '/shared/maps.js', '/shared/nav.js', '/shared/physics.js',
  '/shared/ranks.js', '/shared/weapons.js',
  '/vendor/three.module.min.js', '/vendor/three.core.min.js'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(event.request, copy)).catch(() => {});
      return resp;
    }).catch(() => caches.match(event.request).then(r => r || caches.match('/')))
  );
});
