const CACHE_NAME = 'rta-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/main.js',
  '/storage.js',
  '/gps-engine.js',
  '/export-util.js',
  'https://unpkg.com/maplibre-gl@3.x/dist/maplibre-gl.js',
  'https://unpkg.com/maplibre-gl@3.x/dist/maplibre-gl.css',
  'https://cdn.tailwindcss.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});